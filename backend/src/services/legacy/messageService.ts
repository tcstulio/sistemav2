import { sessionService } from './sessionService';
import { AudioTranscoder } from '../../utils/audioTranscoder';
import { MessageMedia } from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../utils/logger';

const log = createLogger('MessageService');

/**
 * #1658 — TTL da metadata das mensagens enviadas (24h). Notificações de cobrança/lembrete
 * normalmente recebem resposta em minutos/horas; manter a flag por 1 dia cobre o cenário
 * completo do chat 59936436445425@lid (3 notificações → "oi" do usuário) até o final do
 * expediente. Sem TTL, o Map cresceria para sempre em produção — o scheduler dispara
 * recorrências diárias por usuário. Valor fixo + persistência > Map eterno em memória.
 */
const METADATA_TTL_MS = 24 * 60 * 60 * 1000;

/** Caminho do store durável (sobrevive a restart — antes só vivia no Map do singleton). */
const METADATA_FILE = path.join(__dirname, '../../../data/sent_message_metadata.json');

interface StoredMetadata {
    metadata: Record<string, any>;
    sentAt: number;
}

/**
 * @deprecated Use channelRouter or moltbotGateway instead.
 * This service is kept for legacy WhatsApp-Web.js support.
 */
export class MessageService {
    private static instance: MessageService;
    private readonly sentMessageMetadata = new Map<string, StoredMetadata>();

    private constructor() {
        this.loadMetadataFromDisk();
    }

    public static getInstance(): MessageService {
        if (!MessageService.instance) {
            MessageService.instance = new MessageService();
        }
        return MessageService.instance;
    }

    /**
     * #1658 — Persiste a metadata em disco para sobreviver a restart (nodemon, deploy, OOM).
     * Sem isso, o filtro por `metadata.systemNotification` vira inútil depois de qualquer
     * reinício, voltando a depender só do regex fallback (frágil a mudanças de template).
     * Carrega só entradas não-expiradas — entradas velhas no disco viram lixo na primeira
     * leitura e são descartadas (ver `loadMetadataFromDisk`). Falha de leitura é fail-soft:
     * começa com Map vazio (a queda é só pra FRESCOS, scheduler continua emitindo).
     */
    private loadMetadataFromDisk(): void {
        try {
            if (!fs.existsSync(METADATA_FILE)) return;
            const raw = fs.readFileSync(METADATA_FILE, 'utf-8');
            const data = JSON.parse(raw) as Record<string, StoredMetadata>;
            const now = Date.now();
            let skipped = 0;
            for (const [id, entry] of Object.entries(data || {})) {
                if (!entry || typeof entry.sentAt !== 'number' || typeof entry.metadata !== 'object' || entry.metadata === null) {
                    skipped++;
                    continue;
                }
                if (now - entry.sentAt >= METADATA_TTL_MS) {
                    skipped++;
                    continue;
                }
                this.sentMessageMetadata.set(id, entry);
            }
            if (skipped > 0) {
                log.info(`[#1658] loadMetadataFromDisk: descartadas ${skipped} entrada(s) expirada(s)/inválida(s) do disco.`);
            }
            log.info(`[#1658] loadMetadataFromDisk: ${this.sentMessageMetadata.size} entrada(s) ativa(s) carregada(s).`);
        } catch (e: any) {
            log.warn(`[#1658] loadMetadataFromDisk falhou (fail-soft): ${e?.message}`);
        }
    }

    /**
     * #1658 — Grava assincronamente para não bloquear o sendText. Usa escrita atômica
     * (.tmp + rename) para evitar corrupção se o processo morrer no meio. Falha de
     * escrita é fail-soft (o Map em memória continua válido até o próximo restart).
     */
    private saveMetadataToDisk(): void {
        try {
            const dir = path.dirname(METADATA_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const obj: Record<string, StoredMetadata> = {};
            const now = Date.now();
            for (const [id, entry] of this.sentMessageMetadata.entries()) {
                if (now - entry.sentAt < METADATA_TTL_MS) {
                    obj[id] = entry;
                }
            }
            const tmp = METADATA_FILE + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
            fs.renameSync(tmp, METADATA_FILE);
        } catch (e: any) {
            log.warn(`[#1658] saveMetadataToDisk falhou (fail-soft): ${e?.message}`);
        }
    }

    /**
     * #1658 — Remove preguiçosamente entradas expiradas na hora de LER. Mantém o Map
     * enxuto sem precisar de timer global (que sobreviveria a testes por nada). Chamada
     * automaticamente em `getMessages` (único caminho de leitura).
     */
    private evictExpiredMetadata(): void {
        const now = Date.now();
        let removed = 0;
        for (const [id, entry] of this.sentMessageMetadata.entries()) {
            if (now - entry.sentAt >= METADATA_TTL_MS) {
                this.sentMessageMetadata.delete(id);
                removed++;
            }
        }
        if (removed > 0) {
            // Persiste o estado póstumo para não trazer os "mortos" de volta no próximo load
            this.saveMetadataToDisk();
        }
    }

    /**
     * #1658 — SÓ TESTES: zera a metadata de mensagens enviadas. Idêntico a
     * `__resetMessageDedupForTests` — usado pelo botService.test para isolar
     * o tracker entre testes (cada teste é livre pra setar as suas notificações
     * sem vazar pro próximo).
     */
    public __resetSentMessageMetadataForTests(): void {
        this.sentMessageMetadata.clear();
        try { if (fs.existsSync(METADATA_FILE)) fs.unlinkSync(METADATA_FILE); } catch { /* ignore */ }
    }

    private getClient(sessionId: string) {
        const client = sessionService.getClient(sessionId);
        if (!client) throw new Error(`Session ${sessionId} not found`);
        if (sessionService.getStatus(sessionId) !== 'WORKING') throw new Error(`Session ${sessionId} not ready`);
        return client;
    }

    private formatChatId(chatId: string) {
        return chatId.includes('@') ? chatId : `${chatId}@c.us`;
    }

    async sendText(sessionId: string, chatId: string, text: string, metadata?: Record<string, any>) {
        const client = this.getClient(sessionId);
        const msg = await client.sendMessage(this.formatChatId(chatId), text);
        const id = msg.id._serialized;
        // #1658 — persiste o metadata com TTL + em disco. `id` usado pelo `getMessages`:
        // os ids do wwebjs são estáveis (mesma mensagem = mesmo id dentro de uma sessão
        // e através de reinício enquanto a msg existir no chat). Vale para as próximas
        // ~12h, suficiente para a próxima mensagem do usuário acionar o filtro.
        if (metadata) {
            const entry: StoredMetadata = { metadata, sentAt: Date.now() };
            this.sentMessageMetadata.set(id, entry);
            this.saveMetadataToDisk();
        }
        return { id, timestamp: msg.timestamp };
    }

    async sendFile(sessionId: string, chatId: string, fileData: string, filename: string, caption?: string) {
        const client = this.getClient(sessionId);
        const mimetype = fileData.split(';')[0].split(':')[1];
        const data = fileData.split(',')[1];

        const media = new MessageMedia(mimetype, data, filename);
        const msg = await client.sendMessage(this.formatChatId(chatId), media, { caption });

        return { id: msg.id._serialized || (msg.id as any).$1 };
    }

    async sendVoice(sessionId: string, chatId: string, fileData: string) {
        const client = this.getClient(sessionId);

        if (!fileData.startsWith('data:')) throw new Error('Invalid Audio Data Format');

        log.info(`Transcoding audio for ${chatId}...`);

        // Use isolated AudioTranscoder
        const convertedBase64 = await AudioTranscoder.convertAudioToOgg(fileData);

        const media = new MessageMedia('audio/ogg; codecs=opus', convertedBase64, 'voice.ogg');
        const msg = await client.sendMessage(this.formatChatId(chatId), media, { sendAudioAsVoice: true });

        return { id: msg.id._serialized || (msg.id as any).$1, timestamp: msg.timestamp };
    }

    /**
     * #1480: wwebjs dispara 'ready' (status → WORKING) ANTES do store interno terminar de
     * carregar os chats. Em sessões recém-conectadas, `client.getChats()` pode retornar `[]`
     * (ou lançar com "Page evaluation failed" / "Store is not ready") por alguns segundos —
     * antes o endpoint engolia o caso e devolvia `[]`/500, então a UI mostrava "sessão
     * conectada, nenhuma conversa" mesmo com a sessão funcional. Aqui: faz retry com backoff
     * leve até o store encher, ou até esgotar as tentativas. Mantém a assinatura existente
     * (sem `options` é retrocompatível com todos os callers).
     */
    async getChats(sessionId: string, options?: { maxRetries?: number; retryDelayMs?: number }) {
        const client = this.getClient(sessionId);
        const maxRetries = options?.maxRetries ?? 4;
        const retryDelayMs = options?.retryDelayMs ?? 1000;

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const chats = await client.getChats();
                if (Array.isArray(chats) && chats.length > 0) {
                    if (attempt > 0) {
                        log.info(`[${sessionId}] getChats: store wwebjs carregou após ${attempt} retry(s) (${chats.length} chats).`);
                    }
                    const formattedChats = await Promise.all(chats.map(async c => {
                        let id = c.id._serialized || (c.id as any).$1;
                        let phoneNumber = '';
                        
                        if (id.includes('@lid')) {
                            try {
                                const contact = await client.getContactById(id).catch(() => null);
                                if (contact && contact.number) {
                                    phoneNumber = contact.number;
                                } else if (contact && contact.isMe && client.info) {
                                    phoneNumber = client.info.me?.user || client.info.wid.user;
                                } else if (client.info && id === client.info.wid._serialized) {
                                    phoneNumber = client.info.me?.user || client.info.wid.user;
                                }
                            } catch (err) {}
                        }

                        return {
                            id,
                            phoneNumber,
                            name: c.name,
                            unreadCount: c.unreadCount,
                            timestamp: Math.min(c.timestamp, Math.floor(Date.now() / 1000)),
                            isGroup: c.isGroup,
                            lastMessage: (c as any).lastMessage ? (c as any).lastMessage.body : '',
                            accountId: sessionId
                        };
                    }));
                    return formattedChats;
                }
                // status=WORKING mas store vazio → race do #1480. Aguarda e tenta de novo,
                // exceto na última iteração (devolve [] honestamente = "sessão conectada, sem chats").
                if (attempt < maxRetries) {
                    log.warn(`[${sessionId}] getChats vazio (tentativa ${attempt + 1}/${maxRetries + 1}); aguardando ${retryDelayMs}ms para o store wwebjs carregar.`);
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                }
            } catch (e: any) {
                lastError = e;
                // Mesmo cenário por outro caminho: wwebjs lança "Page evaluation failed" /
                // "Store is not ready" enquanto o store interno sobe. Aguarda e tenta de novo.
                if (attempt < maxRetries) {
                    log.warn(`[${sessionId}] getChats erro (tentativa ${attempt + 1}/${maxRetries + 1}): ${e?.message?.slice(0, 120) || e}. Aguardando ${retryDelayMs}ms.`);
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                }
            }
        }

        if (lastError) {
            // Esgotou retries e a ÚLTIMA iteração terminou em erro (não em array vazio).
            throw lastError;
        }

        // Esgotou retries com [] em todas as tentativas: a sessão está limpa mesmo.
        return [];
    }

    async getMessages(sessionId: string, chatId: string, limit: number = 50) {
        const client = this.getClient(sessionId);
        const chatIdFormatted = this.formatChatId(chatId);

        let chat;
        try {
            chat = await client.getChatById(chatIdFormatted);
        } catch (e) { /* fallback to getContactById below */ }

        if (!chat) {
            try {
                const contact = await client.getContactById(chatIdFormatted);
                if (contact) chat = await contact.getChat();
            } catch (e) { /* contact lookup failed, will throw below */ }
        }

        if (!chat) return [];

        const messages = await chat.fetchMessages({ limit });

        // #1658 — expurga entradas expiradas UMA vez por chamada (não por item). Custo
        // ≈ O(n) onde n = notificações ainda vivas — em produção n é pequeno (algumas
        // dezenas) e o ganho é manter o disco enxuto (sem reescrita eterna).
        this.evictExpiredMetadata();

        const mappedMessages = await Promise.all(messages.map(async (m: any) => {
            const messageId = m.id._serialized || (m.id as any).$1;
            const stored = this.sentMessageMetadata.get(messageId);
            return {
                id: messageId,
                body: m.body,
                fromMe: m.fromMe,
                timestamp: Math.min(m.timestamp, Math.floor(Date.now() / 1000)),
                hasMedia: m.hasMedia,
                ack: m.ack,
                sender: m.fromMe ? 'agent' : 'user',
                senderName: await this.resolveSenderName(client, m),
                status: m.ack >= 3 ? 'read' : m.ack >= 2 ? 'delivered' : 'sent',
                type: m.type,
                mimetype: m._data?.mimetype,
                metadata: stored?.metadata,
            };
        }));

        return mappedMessages.sort((a, b) => a.timestamp - b.timestamp);
    }

    private async resolveSenderName(client: any, msg: any): Promise<string> {
        if (msg._data?.notifyName) return msg._data.notifyName;
        try {
            const contact = await msg.getContact();
            if (contact) return contact.name || contact.pushname || contact.shortName;
        } catch (e) { /* contact info unavailable, return empty */ }
        return '';
    }

    async getMessageMedia(sessionId: string, messageId: string) {
        const client = this.getClient(sessionId);
        try {
            const msg = await client.getMessageById(messageId);
            if (msg && msg.hasMedia) {
                const media = await msg.downloadMedia();
                if (media) {
                    return {
                        data: Buffer.from(media.data, 'base64'),
                        contentType: media.mimetype
                    };
                }
            }
        } catch (e) {
            log.error('Error fetching media', e);
        }
        return null;
    }
}

export const messageService = MessageService.getInstance();
