import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/legacy/sessionService', () => ({
    sessionService: {
        getClient: vi.fn(),
        getStatus: vi.fn(() => 'WORKING'),
    },
}));

vi.mock('../../utils/audioTranscoder', () => ({
    AudioTranscoder: {
        convertAudioToOgg: vi.fn(),
    },
}));

vi.mock('whatsapp-web.js', () => ({
    MessageMedia: vi.fn(),
}));

import { messageService } from '../../services/legacy/messageService';
import { sessionService } from '../../services/legacy/sessionService';

function makeChat(over: Partial<{ id: string; name: string; unreadCount: number; timestamp: number; isGroup: boolean; lastMessageBody: string }> = {}) {
    return {
        id: { _serialized: over.id ?? '5511@c.us' },
        name: over.name ?? 'Contato 1',
        unreadCount: over.unreadCount ?? 0,
        timestamp: over.timestamp ?? 1700000000,
        isGroup: over.isGroup ?? false,
        lastMessage: over.lastMessageBody !== undefined ? { body: over.lastMessageBody } : undefined,
    };
}

describe('MessageService.getChats (#1480)', () => {
    let getChatsMock: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // evita waits reais mesmo em testes que não usam options (defaults = 1000ms x 4 = ~5s)
        vi.useFakeTimers();
        getChatsMock = vi.fn();
        (sessionService.getClient as any).mockReturnValue({ getChats: getChatsMock });
        (sessionService.getStatus as any).mockReturnValue('WORKING');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function flush(ms: number) {
        await vi.advanceTimersByTimeAsync(ms);
    }

    it('mapeia chats quando o store já está populado na 1ª tentativa', async () => {
        getChatsMock.mockResolvedValueOnce([
            makeChat({ id: 'a@c.us', name: 'A', unreadCount: 2, timestamp: 100, isGroup: false, lastMessageBody: 'oi' }),
            makeChat({ id: 'g@g.us', name: 'G', unreadCount: 0, timestamp: 200, isGroup: true, lastMessageBody: 'olá grupo' }),
            makeChat({ id: 'c@c.us', name: 'C', unreadCount: 1, timestamp: 300, isGroup: false }),
        ]);

        const result = await messageService.getChats('sess-1');

        expect(getChatsMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual([
            { id: 'a@c.us', phoneNumber: '', name: 'A', unreadCount: 2, timestamp: 100, isGroup: false, lastMessage: 'oi', accountId: 'sess-1' },
            { id: 'g@g.us', phoneNumber: '', name: 'G', unreadCount: 0, timestamp: 200, isGroup: true, lastMessage: 'olá grupo', accountId: 'sess-1' },
            { id: 'c@c.us', phoneNumber: '', name: 'C', unreadCount: 1, timestamp: 300, isGroup: false, lastMessage: '', accountId: 'sess-1' },
        ]);
    });

    it('retenta quando o store devolve [] inicialmente e devolve os chats após carregar (#1480)', async () => {
        // duas tentativas com store vazio, terceira carrega
        getChatsMock
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([makeChat({ id: 'x@c.us', name: 'X' })]);

        const promise = messageService.getChats('sess-2', { maxRetries: 4, retryDelayMs: 500 });

        await flush(500);
        await flush(500);
        const result = await promise;

        expect(getChatsMock).toHaveBeenCalledTimes(3);
        expect(result).toEqual([
            { id: 'x@c.us', phoneNumber: '', name: 'X', unreadCount: 0, timestamp: 1700000000, isGroup: false, lastMessage: '', accountId: 'sess-2' },
        ]);
    });

    it('retenta quando wwebjs lança "Store is not ready" e devolve os chats depois (#1480)', async () => {
        getChatsMock
            .mockRejectedValueOnce(new Error('Store is not ready'))
            .mockResolvedValueOnce([makeChat({ id: 'r@c.us', name: 'R' })]);

        const promise = messageService.getChats('sess-3', { maxRetries: 4, retryDelayMs: 250 });

        await flush(250);
        const result = await promise;

        expect(getChatsMock).toHaveBeenCalledTimes(2);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('r@c.us');
    });

    it('devolve [] quando o store fica vazio em todas as tentativas (sessão realmente sem chats)', async () => {
        getChatsMock.mockResolvedValue([]);

        const promise = messageService.getChats('sess-4', { maxRetries: 2, retryDelayMs: 100 });

        await flush(100);
        await flush(100);
        const result = await promise;

        // maxRetries=2 → 3 iterações (0,1,2)
        expect(getChatsMock).toHaveBeenCalledTimes(3);
        expect(result).toEqual([]);
    });

    it('relança o último erro quando todas as tentativas falham', async () => {
        const finalErr = new Error('Page evaluation failed: Store is not ready');
        getChatsMock
            .mockImplementationOnce(() => Promise.reject(new Error('tentativa 1')))
            .mockImplementationOnce(() => Promise.reject(new Error('tentativa 2')))
            .mockImplementationOnce(() => Promise.reject(finalErr));

        const promise = messageService.getChats('sess-5', { maxRetries: 2, retryDelayMs: 100 }).catch(e => e);

        await flush(100);
        await flush(100);

        const result = await promise;
        expect(result).toBe(finalErr);
        expect(getChatsMock).toHaveBeenCalledTimes(3);
    });

    it('aceita a chamada sem `options` (assinatura retrocompatível)', async () => {
        getChatsMock.mockResolvedValueOnce([makeChat({ id: 'legacy@c.us' })]);

        const result = await messageService.getChats('sess-legacy');

        expect(getChatsMock).toHaveBeenCalledTimes(1);
        expect(result).toHaveLength(1);
        expect(result[0].accountId).toBe('sess-legacy');
    });

    it('lança se a sessão não existir', async () => {
        (sessionService.getClient as any).mockReturnValueOnce(undefined);

        await expect(messageService.getChats('missing')).rejects.toThrow(/missing/);
        expect(getChatsMock).not.toHaveBeenCalled();
    });

    it('lança se a sessão não estiver WORKING', async () => {
        (sessionService.getStatus as any).mockReturnValueOnce('STARTING');

        await expect(messageService.getChats('starting')).rejects.toThrow(/not ready/);
        expect(getChatsMock).not.toHaveBeenCalled();
    });
});

// #1658 — metadata de mensagens enviadas. Cobre 5 caminhos:
//   (1) `sendText` COM `metadata` salva uma entrada no Map interna e em disco.
//   (2) `getMessages` lê a entrada e devolve `metadata` cru (sem `sentAt`).
//   (3) `sendText` SEM `metadata` não polui o Map.
//   (4) TTL: entrada expirada some na PRÓXIMA leitura (lazy eviction em getMessages).
//   (5) Persistência: restart (clear in-memory + load from disk) recupera entradas não-expiradas.
//   (6) Load no boot: entradas EXPIRADAS do disco são descartadas (não há lixo no Map).
// Para os testes que exercitam I/O real (5 e 6), restauramos o `fs` real com `importActual`
// porque o `setup.ts` global intercepta TODAS as operações de fs (mock). Esses dois testes
// só rodam no caminho de boot/disk-write do `MessageService` — sem efeito colateral nos
// outros.
describe('MessageService metadata (#1658)', () => {
    let sendMessageMock: any;
    let getChatByIdMock: any;
    let fetchMessagesMock: any;
    const chatId = '5511@c.us';
    const sessionId = 'sess-meta';

    function makeMappedMessage(id: string, body: string, fromMe: boolean) {
        return {
            id: { _serialized: id },
            body,
            fromMe,
            timestamp: Math.floor(Date.now() / 1000),
            hasMedia: false,
            ack: 2,
            _data: {},
            type: 'chat',
            getContact: () => Promise.resolve({ name: 'Sender', pushname: 'S' }),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        // evita waits reais mesmo em testes que não usam options (defaults = 1000ms x 4 = ~5s)
        vi.useFakeTimers();
        sendMessageMock = vi.fn();
        getChatByIdMock = vi.fn();
        fetchMessagesMock = vi.fn();
        (sessionService.getClient as any).mockReturnValue({
            sendMessage: sendMessageMock,
            getChatById: getChatByIdMock,
        });
        (sessionService.getStatus as any).mockReturnValue('WORKING');
        getChatByIdMock.mockResolvedValue({
            fetchMessages: fetchMessagesMock,
        });
        // isola o tracker entre testes (o Map vive no singleton)
        (messageService as any).__resetSentMessageMetadataForTests();
    });

    afterEach(() => {
        vi.useRealTimers();
        (messageService as any).__resetSentMessageMetadataForTests();
    });

    async function sendAndGet(body: string, metadata?: Record<string, any>) {
        sendMessageMock.mockResolvedValueOnce({
            id: { _serialized: 'msg_A' },
            body,
            timestamp: 1700000000,
        });
        fetchMessagesMock.mockResolvedValueOnce([makeMappedMessage('msg_A', body, true)]);
        await messageService.sendText(sessionId, chatId, body, metadata);
        const msgs = await messageService.getMessages(sessionId, chatId, 5);
        return msgs[0];
    }

    it('sendText com metadata: a entrada aparece em getMessages() pelo mesmo id (happy path)', async () => {
        const mapped = await sendAndGet('Olá TULIO, a tarefa TK1234-5678 venceu.', { systemNotification: true });
        expect(mapped.metadata).toEqual({ systemNotification: true });
    });

    it('sendText SEM metadata: não adiciona nada no Map (não cresce sem motivo)', async () => {
        sendMessageMock.mockResolvedValueOnce({
            id: { _serialized: 'msg_B' },
            body: 'msg normal',
            timestamp: 1700000000,
        });
        fetchMessagesMock.mockResolvedValueOnce([makeMappedMessage('msg_B', 'msg normal', true)]);

        await messageService.sendText(sessionId, chatId, 'msg normal'); // sem metadata
        const msgs = await messageService.getMessages(sessionId, chatId, 5);

        expect(msgs[0].metadata).toBeUndefined();
    });

    it('TTL: entrada EXPIRADA (TTL=24h) some na próxima leitura (nunca mais retorna metadata)', async () => {
        sendMessageMock.mockResolvedValueOnce({
            id: { _serialized: 'msg_C' },
            body: 'antiga',
            timestamp: 1700000000,
        });
        await messageService.sendText(sessionId, chatId, 'antiga', { systemNotification: true });

        // envelhece o singleton: o `sentAt` original é "agora"; avança 25h para além do TTL.
        const internalMap = (messageService as any).sentMessageMetadata as Map<string, any>;
        const stored = internalMap.get('msg_C');
        stored.sentAt = Date.now() - (25 * 60 * 60 * 1000);

        fetchMessagesMock.mockResolvedValueOnce([makeMappedMessage('msg_C', 'antiga', true)]);
        const msgs = await messageService.getMessages(sessionId, chatId, 5);

        // expirada: deve sumir, o `metadata` no retorno vem `undefined`.
        expect(msgs[0].metadata).toBeUndefined();
        // e a entrada foi removida do Map (lazy eviction)
        expect(internalMap.has('msg_C')).toBe(false);
    });

    // Persistência + load-from-disk: usam `vi.importActual('fs')` para contornar o mock
    // global do `setup.ts` que intercepta TODAS as operações de fs. Aqui testamos o
    // FLUXO COMPLETO do `loadMetadataFromDisk` real, contra disco real, em tmp isolado.
    it('persistência: salva em data/sent_message_metadata.json e recarrega após reset (sobrevive a restart)', async () => {
        const realFs: any = await vi.importActual('fs');
        const realPath: any = await vi.importActual('path');

        // Spy nos mocks de fs importados pelo messageService para que eles executem o
        // código REAL de fs neste teste específico. setup.ts mockou `fs` globalmente.
        const fsMod: any = await import('fs');
        const writeSpy = vi.spyOn(fsMod, 'writeFileSync').mockImplementation(((p: string, data: string) => realFs.writeFileSync(p, data)) as any);
        const readSpy = vi.spyOn(fsMod, 'readFileSync').mockImplementation(((p: string, enc: string) => realFs.readFileSync(p, enc as any)) as any);
        const existsSpy = vi.spyOn(fsMod, 'existsSync').mockImplementation(((p: string) => realFs.existsSync(p)) as any);
        const renameSpy = vi.spyOn(fsMod, 'renameSync').mockImplementation(((a: string, b: string) => realFs.renameSync(a, b)) as any);
        const mkdirSpy = vi.spyOn(fsMod, 'mkdirSync').mockImplementation(((p: string, opts?: any) => realFs.mkdirSync(p, opts)) as any);
        const unlinkSpy = vi.spyOn(fsMod, 'unlinkSync').mockImplementation(((p: string) => realFs.unlinkSync(p)) as any);

        try {
            // Limpa o estado antes (caso um teste anterior tenha deixado lixo)
            (messageService as any).__resetSentMessageMetadataForTests();

            sendMessageMock.mockResolvedValueOnce({
                id: { _serialized: 'msg_PERSIST' },
                body: 'persistir',
                timestamp: 1700000000,
            });
            // sendText dispara saveMetadataToDisk internamente
            await messageService.sendText(sessionId, chatId, 'persistir', { systemNotification: true });

            // Simula RESTART: zerar Map em memória + forçar o singleton a reler do disco
            // (loadMetadataFromDisk roda no construtor e é re-chamável para testes)
            (messageService as any).sentMessageMetadata.clear();
            (messageService as any).loadMetadataFromDisk();

            const internalMap = (messageService as any).sentMessageMetadata as Map<string, any>;
            expect(internalMap.has('msg_PERSIST')).toBe(true);

            // getMessages vê a metadata como se nunca tivesse acontecido o restart
            fetchMessagesMock.mockResolvedValueOnce([makeMappedMessage('msg_PERSIST', 'persistir', true)]);
            const msgs = await messageService.getMessages(sessionId, chatId, 5);
            expect(msgs[0].metadata).toEqual({ systemNotification: true });
        } finally {
            // restaura os mocks originais e limpa o arquivo de teste
            writeSpy.mockRestore();
            readSpy.mockRestore();
            existsSpy.mockRestore();
            renameSpy.mockRestore();
            mkdirSpy.mockRestore();
            unlinkSpy.mockRestore();
            const META_FILE = realPath.join(__dirname, '../../../data/sent_message_metadata.json');
            try { if (realFs.existsSync(META_FILE)) realFs.unlinkSync(META_FILE); } catch { /* ignore */ }
        }
    });

    it('load no boot: descarta entradas EXPIRADAS do disco (não carrega lixo no Map)', async () => {
        const realFs: any = await vi.importActual('fs');
        const realPath: any = await vi.importActual('path');
        const META_FILE = realPath.join(__dirname, '../../../data/sent_message_metadata.json');

        // escreve manualmente um arquivo com 1 entrada fresca e 1 vencida (TTL+1s)
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const obj = {
            FRESH: { metadata: { systemNotification: true }, sentAt: now - (oneDay - 60_000) }, // 1 min de margem
            EXPIRED: { metadata: { systemNotification: true }, sentAt: now - (oneDay + 60_000) }, // 1 min além do TTL
        };

        const dir = realPath.dirname(META_FILE);
        if (!realFs.existsSync(dir)) realFs.mkdirSync(dir, { recursive: true });
        realFs.writeFileSync(META_FILE, JSON.stringify(obj, null, 2), 'utf-8');

        // Spy nos mocks de fs para que o `loadMetadataFromDisk` REAL leia o disco
        const fsMod: any = await import('fs');
        const readSpy = vi.spyOn(fsMod, 'readFileSync').mockImplementation(((p: string, enc: string) => realFs.readFileSync(p, enc as any)) as any);
        const existsSpy = vi.spyOn(fsMod, 'existsSync').mockImplementation(((p: string) => realFs.existsSync(p)) as any);

        try {
            // simula boot: zera Map e reload
            (messageService as any).sentMessageMetadata.clear();
            (messageService as any).loadMetadataFromDisk();

            const internalMap = (messageService as any).sentMessageMetadata as Map<string, any>;
            expect(internalMap.has('FRESH')).toBe(true);
            expect(internalMap.has('EXPIRED')).toBe(false);
        } finally {
            readSpy.mockRestore();
            existsSpy.mockRestore();
            try { if (realFs.existsSync(META_FILE)) realFs.unlinkSync(META_FILE); } catch { /* ignore */ }
        }
    });
});