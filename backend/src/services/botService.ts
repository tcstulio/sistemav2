import { messageService } from './legacy/messageService';
import { aiService } from './aiService';
import { runWithToolContext, getToolsPrompt, DEV_TOOLS } from './agentTools';
import { storeService } from './storeService';
import { dolibarrService } from './dolibarrService';
import { sessionService } from './legacy/sessionService';
import { schedulerService } from './schedulerService';
import { approvalService } from './approvalService';
import { interApiService } from './interApiService';
import { itauApiService } from './itauApiService';
import { logger } from '../utils/logger';
import { extractPdfText, extractPdfPageImages } from '../utils/pdfText';
import { FEATURES } from '../config/features';
import { isFinancialCommandsEnabled, isCrmContextInjectionEnabled, isWhatsappEmployeeElevationEnabled } from '../config/featureSwitches';
import { whatsappIdentityService, SenderIdentity } from './whatsappIdentityService';
import { userPermissionsService } from './userPermissionsService';
import { isQuotaError, quotaStatus } from './llmQuotaState';
import axios from 'axios';

const log = logger.child('BotService');

/**
 * Baixa uma URL de mídia gerada (áudio/imagem/vídeo do MiniMax, válida ~24h) e devolve como data URI
 * (`data:<mime>;base64,...`) para envio NATIVO no WhatsApp (sendVoice/sendFile). Best-effort: limita
 * tamanho (25MB) e tempo (30s); devolve null em erro — o link ainda vai no texto da resposta.
 */
async function fetchAsDataUri(url: string): Promise<string | null> {
    try {
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 25 * 1024 * 1024, maxBodyLength: 25 * 1024 * 1024 });
        const mime = (resp.headers['content-type'] as string) || 'application/octet-stream';
        const b64 = Buffer.from(resp.data).toString('base64');
        return `data:${mime};base64,${b64}`;
    } catch (e: any) {
        log.warn(`Falha ao baixar mídia p/ envio nativo (${String(url).slice(0, 60)}…): ${e?.message}`);
        return null;
    }
}

// #1501 — por design, o canal WhatsApp NUNCA é admin. O bot atende Comercial/Financeiro/Produtor:
// mesmo que o remetente tenha cargo admin no ERP, no canal WhatsApp ele é tratado como usuário
// de negócio. aiService internamente já chama getToolsPrompt({ isAdmin: getToolContext().isAdmin
// === true }) respeitando o runWithToolContext — mas tornamos isso EXPLÍCITO aqui também:
//   (a) documenta a invariante "WhatsApp nunca é admin" no próprio fluxo do bot;
//   (b) falhamos ALTO na primeira chamada se o filtro não-admin do #1498 algum dia regredir e
//       voltar a vazar DEV_TOOLS neste canal. Defesa em profundidade: executeTool também barra
//       DEV_TOOLS via ctx.isAdmin !== true, mas o ideal é não depender só dessa 2ª linha.
// Inicialização LAZY (não no module-load): botService entra num ciclo de imports
// (channelRouter→messageService→sessionService→botService), e chamar getToolsPrompt aqui
// dispararia um TDZ em agentTools.TOOLS_PROMPT_FULL antes da const ser avaliada. Adiar a
// construção até a 1ª chamada resolve o ciclo sem alterar a invariante "WhatsApp nunca é admin".
let _whatsappBotToolsPrompt: string | undefined;
export function getWhatsAppBotToolsPrompt(): string {
    if (_whatsappBotToolsPrompt !== undefined) return _whatsappBotToolsPrompt;
    const prompt = getToolsPrompt({ isAdmin: false });
    for (const devTool of DEV_TOOLS) {
        if (prompt.includes(devTool)) {
            log.error('#1501: getToolsPrompt({isAdmin:false}) vazou DEV_TOOL — filtro #1498 regrediu', { devTool });
            throw new Error(`#1501: WHATSAPP_BOT_TOOLS_PROMPT contém DEV_TOOL "${devTool}" — filtro não-admin #1498 regrediu`);
        }
    }
    _whatsappBotToolsPrompt = prompt;
    return _whatsappBotToolsPrompt;
}

/**
 * Converte links da resposta do agente para o formato que FUNCIONA no WhatsApp.
 *
 * No chat do webapp, o agente fala em links RELATIVOS de markdown — `[Ver evento](/agenda/65944)` —
 * que a SPA renderiza e navega internamente. No WhatsApp isso NÃO funciona por dois motivos:
 *   1) `/agenda/65944` é relativo — o celular não sabe o host (precisa ser absoluto);
 *   2) o WhatsApp NÃO renderiza a sintaxe markdown `[texto](url)` — mostra os colchetes crus
 *      e só torna clicável URLs "peladas" (`https://...`).
 *
 * Por isso a resposta do WhatsApp precisa de um tratamento DIFERENTE do chat do sistema:
 *   - link markdown `[label](/path | https://...)` → `label: https://base/path` (URL pelada, clicável);
 *     se o label for redundante (é o próprio id no fim da URL ou a própria URL), devolve só a URL.
 *   - caminho relativo solto (`/x/y` fora de markdown) → `https://base/x/y`.
 * Idempotente para URLs que já são absolutas.
 */
export function absolutizeLinksForWhatsApp(text: string, baseUrlRaw?: string): string {
    if (!text) return text;
    const baseUrl = (baseUrlRaw || process.env.FRONTEND_URL || 'https://app.coolgroove.com.br').replace(/\/+$/, '');
    const toAbs = (target: string): string =>
        /^https?:\/\//i.test(target) ? target : baseUrl + (target.startsWith('/') ? target : '/' + target);

    // 1) Links markdown: [label](/path) ou [label](https://...) → "label: URL_absoluta"
    let out = text.replace(/\[([^\]]+)\]\((\/[^)\s]+|https?:\/\/[^)\s]+)\)/g, (_m, label: string, target: string) => {
        const url = toAbs(target);
        const lbl = String(label).trim();
        // evita "65944: .../agenda/65944" (label é o id no fim da URL) ou "url: url"
        if (lbl === url || url.endsWith('/' + lbl)) return url;
        return `${lbl}: ${url}`;
    });

    // 2) Caminhos relativos SOLTOS (fora de markdown), precedidos por início/espaço.
    //    URLs já absolutizadas no passo 1 começam com "https://" (não casam este passo).
    out = out.replace(/(?<=^|\s)(\/[a-zA-Z0-9_\-\/\?=\.\&\%]+)/g, m => baseUrl + m);

    return out;
}

/**
 * Remove do TEXTO as URLs de mídia que vão ser entregues NATIVAMENTE (nota de voz/anexo).
 * O link no texto é redundante quando o arquivo vai anexado; o dono pediu p/ não mandar os dois.
 * Só remove URLs exatamente iguais às da mídia (não mexe em outros links). Também limpa rótulos
 * órfãos comuns deixados pela tool (ex.: "(mp3, válido ~24h):") e pontuação/espaço solto no fim.
 * PURA (testável). Se o texto ficar vazio, o caller põe um recado mínimo.
 */
export function stripMediaUrls(text: string, urls: string[]): string {
    if (!text || !urls.length) return text;
    let out = text;
    for (const u of urls) {
        if (u) out = out.split(u).join('');
    }
    out = out
        .replace(/\([^)]*v[aá]lid[oa][^)]*\)/gi, '') // "(mp3, válido ~24h)" / "(válida ~24h)" (marca das tools)
        .replace(/[ \t]*[:：—–-][ \t]*$/gm, '')   // rótulo/dois-pontos/traço órfão no fim da linha
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return out;
}

// #1501 — fail-fast self-check de produção (defesa em profundidade contra regressão de
// #1498). Chamada no início de processMessage, ANTES de qualquer trabalho caro
// (identifySender, dolibarrService.getCustomerContext, aiService.generateReply). Custo
// ≈ 0 depois da 1ª chamada (cache em `_whatsappBotToolsPrompt` + flag local). Se o
// filtro não-admin algum dia regredir e vazar uma DEV_TOOL, jogamos throw ALTO no log
// já na 1ª mensagem — sem isso, a invariante "WhatsApp nunca é admin" só estaria
// coberta pelos testes. `executeTool` também barra DEV_TOOLS via ctx.isAdmin !== true,
// mas o ideal é não depender SÓ dessa 2ª linha. EXPORTADA para que o teste possa
// reinjetar o ciclo lazy no setup (vi.resetModules + re-import).
let _whatsappBotToolsPromptValidated = false;
export function validateWhatsAppBotToolsPrompt(): void {
    if (_whatsappBotToolsPromptValidated) return;
    getWhatsAppBotToolsPrompt(); // throws se uma DEV_TOOL escapar (regressão #1498)
    _whatsappBotToolsPromptValidated = true;
}

// Delay helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry helper with exponential backoff
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (e: any) {
            lastError = e;
            if (attempt < maxRetries - 1) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                log.warn(`Retry attempt ${attempt + 1}/${maxRetries} failed. Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    throw lastError || new Error('Max retries exceeded');
}

/** Id ESTÁVEL de uma mensagem do WhatsApp (string), tolerante ao formato do whatsapp-web.js. */
function messageId(message: any): string {
    const id = message?.id;
    if (!id) return '';
    if (typeof id === 'string') return id;
    return String(id._serialized || id.id || '');
}

// Dedup de mensagem (red-team 2026-07-17): o whatsapp-web.js RE-EMITE `message_create` em
// reconexão/replay (o próprio churn de @lid da memória). Sem dedup, o pipeline inteiro roda 2× →
// escrita duplicada, LLM em dobro e resposta repetida. Guarda o msg.id por uma janela curta (a
// re-emissão é logo após reconectar). Complementa a idempotência de ESCRITA (writeIdempotency): esta
// corta ANTES de gastar LLM/responder; aquela é o backstop durável só do efeito de escrita.
const MSG_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 min
const seenMessages = new Map<string, number>();
function alreadyProcessed(id: string): boolean {
    if (!id) return false; // sem id não dá p/ deduplicar — segue (não pior que hoje)
    const now = Date.now();
    for (const [k, exp] of seenMessages) if (exp <= now) seenMessages.delete(k); // limpeza preguiçosa
    if (seenMessages.has(id)) return true;
    seenMessages.set(id, now + MSG_DEDUP_TTL_MS);
    return false;
}

/** SÓ TESTES: zera o dedup de mensagens (o Map é de processo; testes reusam ids). */
export function __resetMessageDedupForTests(): void { seenMessages.clear(); }

/**
 * Guarda de IDADE contra replay de reconexão.
 *
 * Na reconexão da sessão (cada restart do backend, cada oscilação de rede) o whatsapp-web.js
 * RE-EMITE as mensagens NÃO-LIDAS antigas como `message_create`, com o timestamp ORIGINAL. O
 * dedup por id só protege contra a MESMA msg 2× dentro de 5 min E é zerado a cada restart (Map
 * de processo) — então, sem guarda de idade, toda reconexão faz o bot reprocessar mensagens
 * velhas ("o bot recebe várias mensagens"). Aqui descartamos a mensagem cujo timestamp é mais
 * velho que o teto (default 120s, env WHATSAPP_MAX_MESSAGE_AGE_SECONDS).
 *
 * Fail-OPEN: sem timestamp confiável (ausente/0/NaN) NÃO descarta — melhor responder de novo do
 * que engolir uma mensagem real. Timestamp no futuro (bug conhecido do WhatsApp) → idade negativa
 * → não descarta (tratado como ao-vivo). `timestampSec` é Unix em SEGUNDOS (formato wwebjs).
 */
export function isReplayedOldMessage(timestampSec: unknown, nowMs: number, maxAgeSec: number): boolean {
    const ts = Number(timestampSec);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    const ageSec = Math.floor(nowMs / 1000) - ts;
    return ageSec > maxAgeSec;
}

/**
 * #1658 — discriminador de mensagens que NÃO devem entrar no histórico do LLM.
 *
 * Critérios (todos os três precisam ser satisfeitos para a remoção dar certo):
 *   (a) FLAG explícita `metadata.systemNotification === true` — setada no PONTO DE ENVIO
 *       (schedulerService/notificationService → channelRouter → messageService). Cobre
 *       todas as notificações NOVAS com garantia semântica do emissor.
 *   (b) FALLBACK por regex do template canônico de cobrança/lembrete — cobre o histórico
 *       ANTIGO (pré-tag) e mensagens de outros providers (moltbot) que ainda não foram
 *       reemitidas com a flag. Pattern: "Olá <Nome>, a tarefa TK####-#### …" ou
 *       "Olá <Nome>, você é responsável pela tarefa TK####-#### …". A combinação com o
 *       token TK\d{4}-\d{4} garante que NÃO confunde com um "Olá, fulano…" do próprio
 *       usuário (cenário `botService.test.ts`).
 *   (c) Saídas de comandos internos do bot (`/status`, `/ajuda`, etc.) e qualquer
 *       mensagem que comece com `/` — o histórico do agente não deve ver seus próprios
 *       comandos como turno conversacional.
 *
 * Pura (sem I/O, sem estado de processo) para que `botService.test.ts` consiga asserir a
 * transformação sem subir o LLM nem mocks de serviço. Caso a expressão de template mude
 * no futuro, basta atualizar a regex e os testes de "isAgentHistoryExcluded: false
 * para conversa real" automaticamente validam que mensagens genuínas não caem na
 * peneira.
 */
export function isAgentHistoryExcluded(msg: any): boolean {
    const body: string = (msg?.body || '').toString();
    if (!body) {
        // Mensagem vazia (mídia sem caption ou whitespace) ainda pode ser uma notif se
        // vier explicitamente marcada — confiamos na flag nesse caso. Sem flag, deixa
        // passar para o discriminador de mídia (vira "[Mídia recebida: tipo]").
        if (msg?.metadata?.systemNotification === true) return true;
        return false;
    }
    if (msg?.metadata?.systemNotification === true) return true;
    if (body.includes('Status do Sistema')) return true;
    if (body.includes('Comandos Disponíveis')) return true;
    if (body.startsWith('/')) return true;
    // Fallback de template (cobre histórico pré-flag + outros providers sem propagação
    // de metadata). A exigência do TK####-#### evita falso-positivo em saudações reais.
    if (/^Olá [^,]+, (a tarefa|você é responsável pela tarefa)\b/i.test(body) &&
        /TK\d{4}-\d{4}/.test(body)) {
        return true;
    }
    return false;
}

const chatResetTimestamps = new Map<string, number>();

export function resetChatHistory(chatId: string): void {
    chatResetTimestamps.set(chatId, Date.now());
}

export function getChatResetTimestamp(chatId: string): number | undefined {
    return chatResetTimestamps.get(chatId);
}

export function clearAllChatResetTimestampsForTests(): void {
    chatResetTimestamps.clear();
}

/**
 * #1658 — monta a lista de turnos `{role, parts}` enviada para o LLM a partir do
 * histórico bruto de `messageService.getMessages`. PURE (sem I/O) para que testes
 * determinísticos consigam asserir a transformação. Aplica:
 *
 *   1. Exclusão via `isAgentHistoryExcluded` (notificações + comandos do próprio bot).
 *   2. Limpeza de body (remove assinatura residual injetada em turn anterior).
 *   3. Prefix de sender em grupo + placeholder de mídia sem texto.
 *   4. Consolidação de turnos consecutivos do MESMO role+emitente (regra igual ao
 *      código legado, só isolada em função pura para teste). Em 1:1, consolida por
 *      role; em grupo, exige role E sender iguais (evita "mesclar" falantes diferentes).
 *   5. `senderName` é stripado após embed em `parts` (LLM não precisa do campo cru).
 *
 * @param rawHistory  Lista de mensagens vinda de `messageService.getMessages`.
 * @param isGroup     Se o chat é grupo (`@g.us`); controla o prefixo e a consolidação.
 */
export function buildAgentHistory(rawHistory: any[], isGroup: boolean): { role: 'user' | 'model'; parts: string }[] {
    const cleaned = rawHistory
        .filter((m: any) => !isAgentHistoryExcluded(m))
        .map((m: any) => {
            const cleanBody = (m.body || '').replace(/(\n\s*~.*)+$/g, '').trim();
            const mediaNote = (m.hasMedia && !cleanBody) ? `[Mídia recebida: ${m.type || 'arquivo'}]` : '';
            const senderPrefix = (!m.fromMe && isGroup && m.senderName) ? `[${m.senderName}]: ` : '';
            const parts = senderPrefix + (cleanBody || mediaNote);
            return {
                role: m.fromMe ? 'model' as const : 'user' as const,
                parts,
                senderName: m.senderName || null,
            };
        })
        .filter((m: any) => m.parts && m.parts.length > 0 && !m.parts.startsWith('Erro LLM Local'));

    const consolidated: { role: 'user' | 'model'; parts: string; senderName: string | null }[] = [];
    for (const msg of cleaned) {
        const lastMsg = consolidated[consolidated.length - 1];
        const sameRole = lastMsg?.role === msg.role;
        const sameSender = lastMsg?.senderName === msg.senderName;
        if (consolidated.length > 0 && sameRole && (sameSender || !isGroup)) {
            lastMsg.parts += `\n${msg.parts}`;
        } else {
            consolidated.push({ role: msg.role, parts: msg.parts, senderName: msg.senderName });
        }
    }

    return consolidated.map(m => ({ role: m.role, parts: m.parts }));
}

// Teto de mensagens pendentes por chat (anti-crescimento sem limite) e watchdog do turno.
const MAX_CHAT_QUEUE = Number(process.env.WHATSAPP_MAX_CHAT_QUEUE) || 10;
const CHAT_TURN_WATCHDOG_MS = 5 * 60 * 1000;

class BotService {
    // Serialização POR CHAT (`${sessionId}:${from}`): as mensagens do MESMO chat rodam UMA de cada
    // vez, em ordem. Sem isso, o handler de message_create (sessionService, fire-and-forget) roda
    // vários processMessage em paralelo → sob rajada o LLM responde a pergunta ERRADA (turnos
    // degenerados + consolidação do histórico). Chaves distintas por chat NÃO se bloqueiam.
    private chatChains = new Map<string, Promise<void>>();
    private chatPending = new Map<string, number>();
    // Conversa POR CHAT em memória (turnos user+model em ordem, cap 40). É a FONTE do histórico
    // enviada ao LLM — o getMessages do WhatsApp NÃO retorna as respostas que o bot ACABOU de enviar
    // (atrasam/somem no fetch), então o histórico ficava só com as PERGUNTAS acumuladas e o modelo
    // re-respondia TODAS (o "dump de identidade", PROVADO por captura do input real). O buffer
    // registra pergunta→resposta (serializado por chat, sem corrida) → o modelo vê a conversa correta.
    private chatTurns = new Map<string, { role: 'user' | 'model'; parts: string }[]>();
    private chatResetApplied = new Map<string, number>();  // resetTime já aplicado (limpa o buffer no /reset)

    /**
     * ENTRADA (síncrona): guardas baratas (fromMe/dedup/idade) + enfileira na corrente do chat.
     * Retorna a promise do elo — testes que dão `await` preservam a semântica sequencial. O trabalho
     * pesado (LLM) roda em runOne, serializado por chat.
     */
    async processMessage(message: any): Promise<void> {
        if (message?.fromMe) return; // ignora as próprias mensagens
        const msgId = messageId(message);
        // Dedup + idade rodam AQUI (síncrono, no enfileiramento) — NUNCA no dequeue: uma msg que
        // espera vários turnos LLM na fila não pode ser descartada como "replay" por idade acumulada.
        if (alreadyProcessed(msgId)) {
            log.debug(`Mensagem ${msgId.slice(0, 16)}… já processada — ignorando re-emissão.`);
            return;
        }
        const maxMsgAgeSec = Number(process.env.WHATSAPP_MAX_MESSAGE_AGE_SECONDS) || 120;
        if (isReplayedOldMessage(message?.timestamp, Date.now(), maxMsgAgeSec)) {
            const ageSec = Math.floor(Date.now() / 1000) - Number(message.timestamp);
            log.info(`Mensagem ${msgId.slice(0, 16)}… tem ${ageSec}s (> ${maxMsgAgeSec}s) — replay de reconexão, ignorando.`);
            return;
        }
        const key = `${message?.sessionId}:${message?.from}`;
        const pending = this.chatPending.get(key) || 0;
        if (pending >= MAX_CHAT_QUEUE) {
            log.warn(`Fila do chat ${key} cheia (${pending}/${MAX_CHAT_QUEUE}) — descartando msg ${msgId.slice(0, 16)}…`);
            return;
        }
        this.chatPending.set(key, pending + 1);
        const prev = this.chatChains.get(key) || Promise.resolve();
        const link: Promise<void> = prev
            .catch(() => { })                                  // uma falha não rompe a corrente
            .then(() => this.runOneWithWatchdog(message, key))
            .finally(() => {
                const n = (this.chatPending.get(key) || 1) - 1;
                if (n <= 0) {
                    this.chatPending.delete(key);
                    // chatTurns NÃO é apagado aqui: é a conversa, persiste entre mensagens (limpo só no /reset).
                    if (this.chatChains.get(key) === link) this.chatChains.delete(key);
                } else {
                    this.chatPending.set(key, n);
                }
            });
        this.chatChains.set(key, link);
        return link;
    }

    /** SÓ TESTES: zera as filas + o buffer de conversa por chat (Maps de processo). */
    __resetChatQueuesForTests(): void {
        this.chatChains.clear();
        this.chatPending.clear();
        this.chatTurns.clear();
        this.chatResetApplied.clear();
    }

    /** Envolve runOne num watchdog: se um turno pendurar > 5min, libera a fila (não trava o chat). */
    private async runOneWithWatchdog(message: any, key: string): Promise<void> {
        let timer: any;
        try {
            await Promise.race([
                this.runOne(message, key),
                new Promise<void>(resolve => {
                    timer = setTimeout(() => {
                        log.warn(`Watchdog: turno do chat ${key} passou de ${CHAT_TURN_WATCHDOG_MS / 1000}s — liberando a fila.`);
                        resolve();
                    }, CHAT_TURN_WATCHDOG_MS);
                }),
            ]);
        } catch (e: any) {
            log.error(`runOne error (${key}): ${e?.message}`);
        } finally {
            clearTimeout(timer);
        }
    }

    /** Processa UMA mensagem (já desduplicada/idade-checada no enfileiramento). Serializado por chat. */
    private async runOne(message: any, key: string) {
        let replied = false; // resposta principal já enviada? (guarda a rede de segurança do catch)
        try {
            const msgId = messageId(message);

            // 2. Identify Context
            const chatId = message.from; // e.g. 551199999999@c.us
            const sessionId = message.sessionId;
            let body = message.body;

            // AUDIO TRANSCRIPTION - Transcribe voice messages for LLM processing.
            // #1127: respeita a flag AUDIO_TRANSCRIPTION_ENABLED (antes transcrevia SEMPRE, sem como
            // cortar o custo de ASR). Default true; setar AUDIO_TRANSCRIPTION_ENABLED=false desliga.
            if (FEATURES.AUDIO_TRANSCRIPTION_ENABLED && (message.type === 'ptt' || message.type === 'audio') && message.hasMedia) {
                log.info('Audio message detected, attempting transcription...');
                try {
                    const media = await messageService.getMessageMedia(sessionId, message.id);
                    if (media && media.data) {
                        const base64Audio = Buffer.isBuffer(media.data)
                            ? media.data.toString('base64')
                            : media.data;
                        const mimeType = media.contentType || 'audio/ogg';
                        const transcription = await aiService.transcribeAudio(base64Audio, mimeType, 'chat');
                        body = `[Áudio transcrito]: ${transcription}`;
                        log.debug(`Audio transcribed: ${transcription.substring(0, 50)}...`);
                    }
                } catch (e: any) {
                    log.warn(`Audio transcription failed: ${e.message}`);
                    body = '[Áudio recebido - transcrição falhou]';
                }
            }

            // IMAGEM recebida → passa pro generateReply (visão/OCR via glm-4.6v em describeImage).
            // Best-effort: se a visão não estiver configurada/sem saldo, o modelo responde sem a imagem.
            let incomingImages: string[] = [];
            if (message.type === 'image' && message.hasMedia) {
                let imageLoaded = false;
                try {
                    const media = await messageService.getMessageMedia(sessionId, message.id);
                    if (media && media.data) {
                        const b64 = Buffer.isBuffer(media.data) ? media.data.toString('base64') : String(media.data);
                        incomingImages = [`data:${media.contentType || 'image/jpeg'};base64,${b64}`];
                        imageLoaded = true;
                        log.info('Image message detected → passando para a visão.');
                    }
                } catch (e: any) {
                    log.warn(`Falha ao buscar imagem recebida: ${e.message}`);
                }
                // Uma imagem NUNCA pode ser descartada em silêncio pela guarda de corpo vazio abaixo.
                // Sem legenda: dá um corpo mínimo p/ SEMPRE chegar ao generateReply. Se o download
                // falhou (sessão instável do WhatsApp, decrypt), avisa que não conseguiu carregar —
                // o dono via o bot "não responder à imagem"; agora ao menos reconhece (e a gente
                // descobre que é o download que falha, não a visão).
                if (!body || body.length < 2) {
                    body = imageLoaded
                        ? '[imagem enviada]'
                        : '[o usuário enviou uma imagem, mas não consegui carregá-la para análise — peça para reenviar]';
                }
            }

            // DOCUMENTO recebido (PDF) → baixa e EXTRAI O TEXTO p/ injetar no contexto do LLM
            // (o dono quer que o agente "receba PDFs", ex.: boletos). Nunca descarta em silêncio.
            if (message.type === 'document' && message.hasMedia) {
                let pdfText = '';
                let pdfImages: string[] = [];
                let docLoaded = false;
                try {
                    const media = await messageService.getMessageMedia(sessionId, message.id);
                    const mime = String(media?.contentType || message.mimetype || '').toLowerCase();
                    if (media && media.data) {
                        docLoaded = true;
                        if (mime.includes('pdf')) {
                            const buf = Buffer.isBuffer(media.data) ? media.data : Buffer.from(media.data);
                            pdfText = (await extractPdfText(buf)).trim();
                            if (pdfText) {
                                log.info('PDF recebido → texto extraído p/ o contexto.');
                            } else {
                                // PDF SEM camada de texto (digitalizado/scan) → renderiza as páginas
                                // como imagem e manda p/ a VISÃO (OCR). Boletos escaneados etc.
                                pdfImages = (await extractPdfPageImages(buf, 3)) || [];
                                if (pdfImages.length) log.info(`PDF sem texto → ${pdfImages.length} página(s) renderizada(s) p/ a visão.`);
                            }
                        }
                    }
                } catch (e: any) {
                    log.warn(`Falha ao ler documento recebido: ${e.message}`);
                }
                if (pdfText) {
                    const legenda = (body && body.length >= 2) ? `\nLegenda do usuário: ${body}` : '';
                    body = `[Documento PDF recebido]${legenda}\n\nConteúdo extraído do PDF (responda com base nele):\n${pdfText}`;
                } else if (pdfImages.length) {
                    incomingImages = pdfImages; // a visão descreve/faz OCR de cada página
                    if (!body || body.length < 2) body = '[documento PDF digitalizado — as páginas foram anexadas como imagens; analise o conteúdo]';
                } else if (!body || body.length < 2) {
                    body = docLoaded
                        ? '[o usuário enviou um documento, mas não consegui extrair o texto nem renderizá-lo (talvez outro formato) — peça para descrever ou reenviar]'
                        : '[o usuário enviou um documento, mas não consegui carregá-lo — peça para reenviar]';
                }
            }

            if (!body || body.length < 2) return; // Ignore empty/short messages

            // #1501 — canal WhatsApp NUNCA é admin (ver comentário em getWhatsAppBotToolsPrompt
            // acima). Fail-fast: se o filtro não-admin de #1498 regrediu, o throw aqui aborta a
            // mensagem ANTES de chamar aiService.generateReply — sem LLM tokens gastos.
            validateWhatsAppBotToolsPrompt();

            log.info(`Processing incoming message from ${chatId} (Session: ${sessionId})`);

            // SPECIAL COMMANDS - Process before auto-reply check
            if (body.startsWith('/')) {
                const handled = await this.handleCommand(body, sessionId, chatId);
                if (handled) return; // Command was handled, don't continue to LLM
            }

            // CONFIRMATION DETECTION - Check for pending confirmations (SIM/NÃO)
            const confirmation = schedulerService.checkConfirmation(chatId);
            if (confirmation) {
                const normalizedBody = body.toLowerCase().trim();
                const isConfirm = ['sim', 'yes', 's', 'confirmo', 'ok', '1'].includes(normalizedBody);
                const isReject = ['não', 'nao', 'no', 'n', 'cancelo', 'cancelar', '2'].includes(normalizedBody);

                if (isConfirm || isReject) {
                    const callback = schedulerService.handleConfirmationResponse(chatId, isConfirm);
                    const response = isConfirm
                        ? '✅ Confirmação recebida! Obrigado.'
                        : '❌ Cancelamento registrado.';
                    await messageService.sendText(sessionId, chatId, response);
                    log.info(`Confirmation ${isConfirm ? 'accepted' : 'rejected'} for ${chatId}`);
                    return; // Don't process further
                }
            }

            // CHATBOT FLOW - Check for active flow or trigger new one
            const activeFlow = schedulerService.getActiveFlow(chatId);
            if (activeFlow) {
                // Process response in active flow
                const result = schedulerService.processFlowResponse(chatId, body);

                if (result.response) {
                    await messageService.sendText(sessionId, chatId, result.response);
                }

                if (result.nextStep && !result.endFlow) {
                    await messageService.sendText(sessionId, chatId, result.nextStep.message);
                }

                log.debug(`Flow processed for ${chatId}, ended: ${result.endFlow}`);
                return; // Don't continue to LLM
            } else {
                // Check if message triggers a new flow
                const triggeredFlow = schedulerService.checkFlowTrigger(sessionId, body);
                if (triggeredFlow) {
                    const firstStep = schedulerService.startFlow(chatId, triggeredFlow);
                    if (firstStep) {
                        await messageService.sendText(sessionId, chatId, firstStep.message);
                        log.info(`Started flow "${triggeredFlow.name}" for ${chatId}`);
                        return; // Don't continue to LLM
                    }
                }
            }

            // 3. Resolve Effective Auto-Reply Status
            // Priority: Chat Override > Session Default
            const chatSettings = storeService.getChatSettings(chatId);
            const sessionSettings = storeService.getSessionSettings(sessionId);

            let shouldReply = false;

            if (chatSettings.autoReplyEnabled !== undefined) {
                shouldReply = chatSettings.autoReplyEnabled;
                log.debug(`Chat ${chatId} has override: ${shouldReply}`);
            } else {
                shouldReply = sessionSettings.autoReply;
            }

            if (!shouldReply) {
                // Check if it's a group with specific settings
                // [ANTIGRAVITY] Group Logic
                if (chatId.endsWith('@g.us')) {
                    const groupSettings = chatSettings.groupSettings;

                    if (groupSettings?.llmEnabled) {
                        log.debug(`Group ${chatId} has LLM explicitly enabled.`);

                        // 1. Frequency Check
                        if (groupSettings.responseFrequency && groupSettings.lastRepliedAt) {
                            const now = Date.now();
                            const elapsed = now - groupSettings.lastRepliedAt;
                            let required = groupSettings.responseFrequency.value * 3600000; // Hours default
                            if (groupSettings.responseFrequency.unit === 'days') required = required * 24;
                            if (groupSettings.responseFrequency.unit === 'minutes') required = groupSettings.responseFrequency.value * 60000;

                            if (elapsed < required) {
                                log.debug(`Group ${chatId} skipping: Frequency limit not met. (Elapsed: ${elapsed / 1000}s, Required: ${required / 1000}s)`);
                                return;
                            }
                        }

                        // 2. Burst / Spam Check
                        if (groupSettings.burstHandling?.enabled) {
                            const threshold = groupSettings.burstHandling.threshold || 5;
                            const currentCount = (groupSettings.messageCounter || 0) + 1;

                            log.debug(`Group ${chatId} Burst Counter: ${currentCount}/${threshold}`);

                            // Update Counter
                            storeService.updateChatSettings(chatId, {
                                groupSettings: {
                                    ...groupSettings,
                                    messageCounter: currentCount
                                }
                            });

                            if (currentCount < threshold) {
                                return; // Wait for more messages
                            }

                            // Threshold Met! Reset counter will happen if we proceed
                        }

                        // Passed checks -> Proceed to Reply
                        shouldReply = true;
                    }
                }
            }

            if (!shouldReply) {
                return;
            }

            log.info(`Generating Auto-Reply for ${chatId}...`);

            // Detect if this is a group chat
            const isGroup = chatId.endsWith('@g.us');

            // 5. Histórico da conversa — FONTE = buffer em memória por chat (chatTurns), NÃO o
            // getMessages (que não retorna as respostas recém-enviadas pelo bot; ver comentário do
            // campo). Serializado por chat → sem corrida. O modelo vê pergunta→resposta→nova pergunta
            // e responde só a última — mata o re-despejo de identidade na raiz.
            const historyLimit = sessionSettings.historyLimit || 30;
            const resetTime = chatResetTimestamps.get(chatId) || 0;
            let turns = this.chatTurns.get(key);
            // /reset novo → zera o buffer daquele chat.
            if (resetTime && (this.chatResetApplied.get(key) || 0) < resetTime) {
                turns = [];
                this.chatTurns.set(key, turns);
                this.chatResetApplied.set(key, resetTime);
            }
            // Cold start (buffer vazio, ex.: pós-restart): começa VAZIO — NÃO semeia do getMessages.
            // O getMessages é justamente a fonte quebrada (não retorna as respostas recém-enviadas do
            // bot); semear dele re-introduzia o re-despejo de identidade a cada restart (o buffer
            // esvazia + o marcador do /reset é em memória → o seed trazia perguntas acumuladas SEM as
            // respostas → o modelo re-respondia todas). O buffer passa a ser 100% em-processo/confiável.
            // Custo honesto: após um restart o bot "esquece" o contexto anterior (aceitável; muito
            // melhor que re-despejar). Follow-up p/ recuperar contexto entre restarts: PERSISTIR o
            // buffer em disco (não re-semear da fonte não-confiável).
            if (!turns) {
                turns = [];
                this.chatTurns.set(key, turns);
            }
            // Registra a pergunta atual (não duplica se o seed já a trouxe como último turno).
            const isTranscribedAudio = message.type === 'ptt' || message.type === 'audio';
            const lastBuf = turns[turns.length - 1];
            const alreadyLast = !!lastBuf && lastBuf.role === 'user' && String(lastBuf.parts).includes(body);
            if (!alreadyLast || isTranscribedAudio) {
                turns.push({ role: 'user', parts: body });
            }
            if (turns.length > 40) turns.splice(0, turns.length - 40); // cap de memória por chat
            const history: any[] = turns.slice(-historyLimit);

            // 6. Resolve Signature & Context (Session/Account Level)
            let context = sessionSettings.autoReplyContext || "Você é um assistente virtual útil.";

            // [ANTIGRAVITY] INJECT SYSTEM DATE/TIME
            const now = new Date();
            const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            context += `\n\n[SISTEMA] Data atual: ${dateStr}. Hora: ${timeStr}. Use esta referência para termos relativos (hoje, ontem, amanhã).`;

            // Add group-specific context for better LLM behavior
            if (isGroup) {
                context += "\n\n[CONTEXTO DE GRUPO] Esta é uma conversa de grupo do WhatsApp. Múltiplos usuários participam. Os nomes dos remetentes estão indicados entre colchetes [Nome]. Responda de forma que seja útil para todos no grupo.";
            }

            // Identidade do remetente (funcionário × cliente × desconhecido) — decide o contexto
            // de permissões e o que injetar no LLM. Grupo NUNCA identifica: o autor é ambíguo e
            // manipulável pelos demais participantes (fail-closed = unknown).
            let senderIdentity: SenderIdentity = { kind: 'unknown' };
            if (!isGroup) {
                try {
                    senderIdentity = await whatsappIdentityService.identifySender(message.realSender || chatId);
                } catch (e: any) {
                    log.warn(`Identificação do remetente falhou (${e?.message}) — seguindo como desconhecido.`);
                }
            }

            // [ANTIGRAVITY] INJECT CRM DATA
            // #1129: kill-switch de privacidade (env + toggle de UI) — desligado em incidente
            // NÃO injeta dados do cliente no LLM. Mesmo padrão do kill-switch financeiro.
            if (isCrmContextInjectionEnabled() && senderIdentity.kind === 'customer') {
                try {
                    log.info(`Found CRM Customer: ${senderIdentity.name}`);
                    const crmData = await dolibarrService.getCustomerContext(senderIdentity.thirdpartyId);
                    context += `\n\n[DADOS DO CLIENTE IDENTIFICADO NO CRM]\nNome: ${senderIdentity.name}\n${crmData}\n\nUse estes dados para responder perguntas sobre faturas, tickets ou status.`;
                } catch (crmError) {
                    log.error("CRM Injection Failed", crmError);
                }
            } else if (isCrmContextInjectionEnabled() && senderIdentity.kind === 'unknown' && !isGroup) {
                context += `\n\n[CRM] Remetente não identificado no banco de dados.`;
            }

            let signatureName = "Assistente Virtual";
            if (sessionSettings.signatureName && sessionSettings.signatureName.trim().length > 0) {
                signatureName = sessionSettings.signatureName;
            }

            // Send typing indicator before generating reply
            try {
                await sessionService.sendTyping(sessionId, chatId);
            } catch (e) {
                log.warn('Failed to send typing indicator');
            }

            // Generate reply with retry on failure.
            // Mensagem de WhatsApp de entrada é input NÃO-CONFIÁVEL: o default é somente-leitura
            // (nenhuma tool de escrita/efeito externo). Exceção controlada: FUNCIONÁRIO identificado
            // pelo telefone, em chat 1:1, com o kill-switch whatsappEmployeeElevation ligado — recebe
            // o próprio perfil de permissões, como no chat do webapp. isAdmin fica SEMPRE false por
            // aqui: ação irreversível continua exigindo o deeplink /confirm-action logado no webapp
            // (o login é o 2º fator; adminBypassIrreversible nunca se aplica via WhatsApp).
            // turnId ESTÁVEL do turno = id da mensagem do WhatsApp. Torna toda escrita idempotente por
            // (turno, ator, tool, args): a mesma escrita não roda 2× se o retryWithBackoff re-invocar
            // generateReply após um throw pós-escrita, nem numa re-emissão do evento. Ver writeIdempotency.
            // #1501 — `isAdmin: false` explícito em TODOS os caminhos (default e elevação de funcionário):
            // o canal WhatsApp nunca é admin, ponto.
            const turnId = messageId(message);
            // Mídia gerada durante o turno (as tools generate_speech/image/video/get_document_pdf
            // empurram aqui); enviada NATIVAMENTE após a resposta de texto (nota de voz / anexo).
            const pendingMedia: NonNullable<Parameters<typeof runWithToolContext>[0]['pendingMedia']> = [];
            let toolCtx: Parameters<typeof runWithToolContext>[0] = { readOnly: true, isAdmin: false, turnId, pendingMedia };
            // #segurança — só ELEVA (perfil + escrita) com match do número COMPLETO (E.164). O
            // matchStrength só existe como 'full' (matchEmployee já exige número inteiro), mas a
            // checagem explícita é defesa em profundidade: um match fraco jamais concede perfil.
            // #1501 — `isAdmin: false` permanece EXPLÍCITO mesmo no caminho de elevação de
            // funcionário: o canal WhatsApp nunca é admin, mesmo que o usuário seja admin no ERP.
            if (senderIdentity.kind === 'employee' && senderIdentity.matchStrength === 'full' && !isGroup && isWhatsappEmployeeElevationEnabled()) {
                try {
                    const permissionProfile = await userPermissionsService.getProfile(senderIdentity.userId);
                    const permContext = await userPermissionsService.getProfileForContext(senderIdentity.userId);
                    toolCtx = { readOnly: false, userId: senderIdentity.userId, isAdmin: false, permissionProfile, turnId, pendingMedia };
                    context += `\n\n[FUNCIONÁRIO IDENTIFICADO]\nVocê está falando com ${senderIdentity.displayName} (usuário interno, id ${senderIdentity.userId}), identificado pelo telefone.\n\n${permContext}`;
                    log.info(`Funcionário identificado no WhatsApp: ${senderIdentity.displayName} (id ${senderIdentity.userId}) — contexto com o perfil do usuário.`);
                } catch (e: any) {
                    log.warn(`Elevação de funcionário falhou (${e?.message}) — mantendo somente-leitura.`);
                }
            }
            let replyResult = await retryWithBackoff(
                () => runWithToolContext(toolCtx, () => aiService.generateReply(history, context, incomingImages.length ? incomingImages : undefined)),
                3,
                1000
            );
            let replyText = typeof replyResult === 'string' ? replyResult : replyResult.text;

            // Links: APENAS para o WhatsApp, absolutiza e converte markdown → URL pelada clicável.
            // A interface web continua usando os links relativos de markdown (SPA navega internamente).
            if (replyText) {
                replyText = absolutizeLinksForWhatsApp(replyText);
            }

            // Cleanup: Strip any hallucinated signatures in the response
            if (replyText) {
                replyText = replyText.replace(/(\n\s*~.*)+$/g, '').trim();
            }

            // Link redundante: quando há mídia p/ anexar nativamente, remove a URL dela do TEXTO
            // (o WhatsApp já entrega o arquivo — o dono pediu p/ não mandar os dois). Otimista: tira
            // o link ANTES de enviar o texto; se o envio nativo falhar, o link volta como FALLBACK
            // (mensagem separada, mais abaixo). WhatsApp-only: o webapp continua com o link no texto.
            const nativeMediaUrls = pendingMedia.map(m => m.url).filter((u): u is string => !!u);
            if (replyText && nativeMediaUrls.length) {
                replyText = stripMediaUrls(replyText, nativeMediaUrls);
            }
            // Se o texto ficou vazio (o modelo só mandou o link), põe um recado mínimo.
            if ((!replyText || replyText.trim().length < 2) && pendingMedia.length) {
                replyText = 'Segue o arquivo. 📎';
            }

            // 7. Append Signature
            const finalMessage = `${replyText}\n\n~ ${signatureName}`;

            await sleep(1500); // Reduced to 1.5s since real typing is now shown

            await messageService.sendText(sessionId, chatId, finalMessage);
            replied = true; // resposta principal saiu → catch NÃO deve mandar recado de erro
            log.info(`Auto-reply sent to ${chatId}`);
            // Registra a RESPOSTA do bot no buffer (SÓ após envio OK). É ISTO que faltava no
            // getMessages e causava o re-despejo: agora a conversa em memória tem pergunta→resposta,
            // então a próxima mensagem vê o histórico correto e não re-responde as anteriores.
            turns.push({ role: 'model', parts: replyText });
            if (turns.length > 40) turns.splice(0, turns.length - 40);

            // ENVIO NATIVO de mídia gerada no turno (nota de voz / anexo). As tools
            // generate_speech/image/video/get_document_pdf registram em pendingMedia. Best-effort e
            // sequencial; falha em uma não impede as outras nem a resposta. Se um envio nativo falhar,
            // guarda a URL p/ mandar como FALLBACK (o link foi removido do texto otimista acima).
            const failedMediaUrls: string[] = [];
            for (const media of pendingMedia) {
                try {
                    const dataUri = media.dataUri || (media.url ? await fetchAsDataUri(media.url) : null);
                    if (!dataUri) { if (media.url) failedMediaUrls.push(media.url); continue; } // download falhou
                    if (media.kind === 'audio') {
                        await messageService.sendVoice(sessionId, chatId, dataUri);
                    } else {
                        const fname = media.filename || (media.kind === 'image' ? 'imagem.jpg' : media.kind === 'video' ? 'video.mp4' : 'arquivo');
                        await messageService.sendFile(sessionId, chatId, dataUri, fname, media.caption);
                    }
                    log.info(`Mídia nativa enviada (${media.kind}) para ${chatId}`);
                } catch (e: any) {
                    log.warn(`Falha ao enviar mídia nativa (${media.kind}) para ${chatId}: ${e?.message}`);
                    if (media.url) failedMediaUrls.push(media.url);
                }
            }
            // Fallback: se algum envio nativo falhou, manda o(s) link(s) numa mensagem separada
            // (o texto principal saiu limpo). Assim o usuário nunca fica sem o arquivo NEM sem o link.
            if (failedMediaUrls.length) {
                try {
                    await messageService.sendText(sessionId, chatId, `Segue o link (caso o arquivo não abra): ${failedMediaUrls.join('  ')}`);
                } catch { /* best-effort */ }
            }

            // [ANTIGRAVITY] Update Group Stats (Last Replied / Reset Burst)
            if (chatId.endsWith('@g.us')) {
                const currentFn = storeService.getChatSettings(chatId).groupSettings || {};
                storeService.updateChatSettings(chatId, {
                    groupSettings: {
                        ...currentFn,
                        lastRepliedAt: Date.now(),
                        messageCounter: 0 // Reset burst counter
                    }
                });
            }

        } catch (error: any) {
            log.error(`Process Error: ${error.message}`);
            // REDE DE SEGURANÇA: nunca ficar MUDO. Se a resposta principal ainda NÃO saiu, avisa o
            // usuário em vez de sumir (o dono via o bot "não responder"). Duas mensagens:
            //  • CAPACIDADE (cota do provedor: GLM 1310, MiniMax "usage limit"/"Token Plan", 429) →
            //    recado de "sem capacidade, tente mais tarde".
            //  • QUALQUER outra falha não reconhecida (ex.: MiniMax 1211, GLM 400) → recado técnico
            //    genérico. ANTES o bot só falava no caso de cota e SUMIA em todo o resto.
            // Só 1:1 (não polui grupo). Se `replied`, a resposta já foi enviada → não manda nada.
            try {
                if (!replied) {
                    const detail = error?.response?.data?.error?.message || error?.message || '';
                    const chatId = message?.from;
                    const sessionId = message?.sessionId;
                    if (chatId && sessionId && !String(chatId).endsWith('@g.us')) {
                        const msg = (isQuotaError(detail) || quotaStatus().exhausted)
                            ? 'No momento estou sem capacidade de IA para responder 🛰️ É temporário (limite do provedor). Pode tentar de novo mais tarde.'
                            : 'Tive um problema técnico agora e não consegui responder 🛠️ Pode mandar de novo, por favor?';
                        await messageService.sendText(sessionId, chatId, msg);
                    }
                }
            } catch (notifyErr: any) {
                log.warn(`Falha ao enviar aviso de erro do bot: ${notifyErr?.message}`);
            }
        }
    }

    /**
     * Handle special slash commands
     * Returns true if command was handled, false otherwise
     */
    private async handleCommand(body: string, sessionId: string, chatId: string): Promise<boolean> {
        const cmd = body.split(' ')[0].toLowerCase().trim();

        try {
            switch (cmd) {
                case '/status':
                    const sessionStatus = storeService.getSessionSettings(sessionId);
                    const statusMsg = `📊 *Status do Sistema*\n\n` +
                        `✅ Bot: Ativo\n` +
                        `🤖 Auto-resposta: ${sessionStatus.autoReply ? 'Ligada' : 'Desligada'}\n` +
                        `📝 Histórico LLM: ${sessionStatus.historyLimit || 10} mensagens\n` +
                        `⏰ Hora: ${new Date().toLocaleString('pt-BR')}`;
                    await messageService.sendText(sessionId, chatId, statusMsg);
                    return true;

                case '/reset':
                case '/limpar':
                    resetChatHistory(chatId);
                    await messageService.sendText(sessionId, chatId, '🧹 *Histórico de conversa resetado!* As mensagens anteriores a este momento serão ignoradas nos próximos atendimentos.');
                    return true;

                case '/ajuda':
                case '/help':
                    const helpMsg = `📖 *Comandos Disponíveis*\n\n` +
                        `*Gerais:*\n` +
                        `/status - Mostra status do sistema\n` +
                        `/resumo - Resume a conversa atual\n` +
                        `/reset - Limpa o histórico de conversa com o bot\n` +
                        `/ajuda - Lista comandos disponíveis\n\n` +
                        `*Financeiro (requer aprovação):*\n` +
                        `/pagar <código_barras> - Pagar boleto\n` +
                        `/pix <chave> <valor> - Enviar PIX\n` +
                        `/saldo [inter|itau] - Consultar saldo`;
                    await messageService.sendText(sessionId, chatId, helpMsg);
                    return true;

                case '/resumo':
                    // Fetch history and summarize
                    const history = await messageService.getMessages(sessionId, chatId, 20);
                    if (history.length === 0) {
                        await messageService.sendText(sessionId, chatId, '❌ Nenhuma mensagem encontrada para resumir.');
                        return true;
                    }

                    const historyText = history.map((m: any) =>
                        `${m.fromMe ? 'BOT' : (m.senderName || 'USUÁRIO')}: ${m.body || '[mídia]'}`
                    ).join('\n');

                    const summaryContext = `Resuma a seguinte conversa em bullet points concisos em português:\n\n${historyText}`;

                    try {
                        await sessionService.sendTyping(sessionId, chatId);
                        // #segurança (red-team 2026-07-17): /resumo roda o MESMO loop de tools do
                        // generateReply com histórico controlável pelo remetente. Sem contexto de tool,
                        // executeTool herdava o DEFAULT (readOnly falsy) → um tool JSON emitido aqui
                        // escreveria SEM gate. Fecha embrulhando em readOnly (resumo é leitura pura).
                        const summaryResult = await retryWithBackoff(
                            () => runWithToolContext({ readOnly: true }, () => aiService.generateReply([], summaryContext)),
                            2, 1000
                        );
                        const summary = typeof summaryResult === 'string' ? summaryResult : summaryResult.text;
                        await messageService.sendText(sessionId, chatId, `📋 *Resumo da Conversa*\n\n${summary}`);
                    } catch (e) {
                        await messageService.sendText(sessionId, chatId, '❌ Erro ao gerar resumo. Tente novamente.');
                    }
                    return true;

                // ===== COMANDOS FINANCEIROS (com aprovação) =====

                case '/pagar': {
                    // #1129: kill-switch de admin (env + toggle de UI) — desligado em incidente bloqueia /pagar.
                    if (!isFinancialCommandsEnabled()) {
                        await messageService.sendText(sessionId, chatId,
                            '🔒 *Comandos financeiros desativados*\n\nO pagamento via bot está temporariamente indisponível. Contate um administrador.');
                        return true;
                    }
                    const args = body.split(' ').slice(1);
                    const codigoBarras = args.join('').replace(/\D/g, ''); // Remove non-digits

                    if (!codigoBarras || codigoBarras.length < 44) {
                        await messageService.sendText(sessionId, chatId,
                            '❌ *Formato inválido*\n\nUso: `/pagar <código_de_barras>`\n\nExemplo: `/pagar 23793.38128 60000.000000 00000.000006 1 84340000012345`');
                        return true;
                    }

                    // Detectar banco padrão (pode ser configurável)
                    const banco: 'inter' | 'itau' = 'inter';

                    // Criar ação pendente de aprovação
                    const action = await approvalService.createPendingAction({
                        type: 'pagar_boleto',
                        banco,
                        payload: {
                            codigoDeBarras: codigoBarras,
                            dataPagamento: new Date().toISOString().split('T')[0],
                        },
                        description: `Pagar boleto: ${codigoBarras.substring(0, 20)}...`,
                        requestedBy: chatId,
                    });

                    // Armazenar info de notificação
                    (action as any).notifyOnComplete = { sessionId, chatId };

                    await messageService.sendText(sessionId, chatId,
                        `⏳ *Pagamento enviado para aprovação*\n\n` +
                        `📋 ID: ${action.id.substring(0, 8)}\n` +
                        `🏦 Banco: ${banco.toUpperCase()}\n` +
                        `📊 Status: Aguardando aprovação\n\n` +
                        `Você será notificado quando o pagamento for aprovado ou rejeitado.`);
                    return true;
                }

                case '/pix': {
                    // #1129: kill-switch de admin (env + toggle de UI) — desligado em incidente bloqueia /pix.
                    if (!isFinancialCommandsEnabled()) {
                        await messageService.sendText(sessionId, chatId,
                            '🔒 *Comandos financeiros desativados*\n\nO envio de PIX via bot está temporariamente indisponível. Contate um administrador.');
                        return true;
                    }
                    const args = body.split(' ').slice(1);

                    if (args.length < 2) {
                        await messageService.sendText(sessionId, chatId,
                            '❌ *Formato inválido*\n\nUso: `/pix <chave> <valor>`\n\nExemplas:\n`/pix 11999999999 100.00`\n`/pix email@exemplo.com 50`\n`/pix 12345678901234 250.99`');
                        return true;
                    }

                    const chave = args[0];
                    const valorStr = args[1].replace(',', '.');
                    const valor = parseFloat(valorStr);

                    if (isNaN(valor) || valor <= 0) {
                        await messageService.sendText(sessionId, chatId, '❌ Valor inválido. Use formato: 100.00');
                        return true;
                    }

                    const banco: 'inter' | 'itau' = 'inter';

                    const action = await approvalService.createPendingAction({
                        type: 'enviar_pix',
                        banco,
                        payload: {
                            chave,
                            valor: valor.toFixed(2),
                            descricao: `PIX via WhatsApp`,
                        },
                        description: `PIX R$ ${valor.toFixed(2)} para ${chave}`,
                        requestedBy: chatId,
                    });

                    (action as any).notifyOnComplete = { sessionId, chatId };

                    await messageService.sendText(sessionId, chatId,
                        `⏳ *PIX enviado para aprovação*\n\n` +
                        `📋 ID: ${action.id.substring(0, 8)}\n` +
                        `🔑 Chave: ${chave}\n` +
                        `💰 Valor: R$ ${valor.toFixed(2)}\n` +
                        `🏦 Banco: ${banco.toUpperCase()}\n\n` +
                        `Você será notificado quando o PIX for aprovado ou rejeitado.`);
                    return true;
                }

                case '/saldo': {
                    const args = body.split(' ').slice(1);
                    const bancoArg = args[0]?.toLowerCase();

                    let banco: 'inter' | 'itau' = 'inter'; // Default
                    if (bancoArg === 'itau' || bancoArg === 'itaú') {
                        banco = 'itau';
                    }

                    await messageService.sendText(sessionId, chatId, `⏳ Consultando saldo no ${banco.toUpperCase()}...`);

                    try {
                        let saldo: any;
                        if (banco === 'inter') {
                            saldo = await interApiService.getSaldo();
                        } else {
                            saldo = await itauApiService.getSaldo();
                        }

                        const saldoFormatado = typeof saldo === 'object'
                            ? `R$ ${(saldo.disponivel || saldo.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                            : `R$ ${saldo}`;

                        await messageService.sendText(sessionId, chatId,
                            `💰 *Saldo ${banco.toUpperCase()}*\n\n` +
                            `📊 Disponível: ${saldoFormatado}\n` +
                            `⏰ Consultado em: ${new Date().toLocaleString('pt-BR')}`);
                    } catch (e: any) {
                        await messageService.sendText(sessionId, chatId,
                            `❌ *Erro ao consultar saldo*\n\n${e.message || 'Serviço indisponível'}`);
                    }
                    return true;
                }

                default:
                    // Unknown command - don't handle, let it pass to LLM
                    return false;
            }
        } catch (error: any) {
            log.error(`Command error (${cmd}): ${error.message}`);
            return false;
        }
    }
}

export const botService = new BotService();
