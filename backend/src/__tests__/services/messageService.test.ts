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
            { id: 'a@c.us', name: 'A', unreadCount: 2, timestamp: 100, isGroup: false, lastMessage: 'oi', accountId: 'sess-1' },
            { id: 'g@g.us', name: 'G', unreadCount: 0, timestamp: 200, isGroup: true, lastMessage: 'olá grupo', accountId: 'sess-1' },
            { id: 'c@c.us', name: 'C', unreadCount: 1, timestamp: 300, isGroup: false, lastMessage: '', accountId: 'sess-1' },
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
            { id: 'x@c.us', name: 'X', unreadCount: 0, timestamp: 1700000000, isGroup: false, lastMessage: '', accountId: 'sess-2' },
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