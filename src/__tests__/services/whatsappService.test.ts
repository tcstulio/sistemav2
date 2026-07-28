import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));
vi.mock('../../utils/safeStorage', () => ({
    safeStorage: {
        getItem: vi.fn(),
        getJSON: vi.fn().mockReturnValue({ apiKey: 'test-api-key' })
    }
}));

import axios from 'axios';
import { WhatsAppService } from '../../services/whatsappService';

describe('WhatsAppService', () => {
    const mockAxios = axios as unknown as {
        get: ReturnType<typeof vi.fn>;
        post: ReturnType<typeof vi.fn>;
        put: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
        isAxiosError: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockAxios.isAxiosError = vi.fn().mockReturnValue(false);
    });

    describe('startSession', () => {
        it('starts a WhatsApp session', async () => {
            const response = { data: { sessionId: 'default', status: 'WORKING' } };
            mockAxios.post.mockResolvedValue(response);

            const result = await WhatsAppService.startSession('default');

            expect(result).toEqual(response.data);
        });
    });

    describe('getQrCode', () => {
        it('returns QR code blob', async () => {
            const blob = new Blob(['qr'], { type: 'image/png' });
            mockAxios.get.mockResolvedValue({ data: blob });

            const result = await WhatsAppService.getQrCode('default');

            expect(result).toEqual(blob);
        });

        it('returns null on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('QR not ready'));

            const result = await WhatsAppService.getQrCode('default');

            expect(result).toBeNull();
        });
    });

    describe('getAccounts', () => {
        it('fetches WhatsApp accounts', async () => {
            const sessions = [{
                id: 'default',
                status: 'WORKING',
                me: { id: '5511999999999@c.us', pushName: 'Test' }
            }];
            mockAxios.get.mockResolvedValue({ data: sessions });

            const result = await WhatsAppService.getAccounts();

            expect(result).toHaveLength(1);
            expect(result[0].status).toBe('connected');
            expect(result[0].platform).toBe('WAHA');
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('Failed'));

            const result = await WhatsAppService.getAccounts();

            expect(result).toEqual([]);
        });

        it('#envelope-fix: desembrulha a resposta padronizada { success, data:[...] } (#1568)', async () => {
            const sessions = [{ id: 'default', status: 'WORKING', me: { id: '5511999999999@c.us', pushName: 'T' } }];
            // o backend agora responde envelopado — antes o service fazia .map num objeto e retornava []
            mockAxios.get.mockResolvedValue({ data: { success: true, data: sessions } });

            const result = await WhatsAppService.getAccounts();

            expect(result).toHaveLength(1);
            expect(result[0].status).toBe('connected');
        });
    });

    describe('getConversations (envelope)', () => {
        it('desembrulha { success, data:[...] } e mapeia as conversas', async () => {
            const chats = [{ id: '5511@c.us', name: 'Cliente', timestamp: 1700000000, unreadCount: 2 }];
            mockAxios.get.mockResolvedValue({ data: { success: true, data: chats } });
            const result = await WhatsAppService.getConversations('default');
            expect(result).toHaveLength(1);
            expect(result[0].customerName).toBe('Cliente');
        });
        it('forma CRUA (não-envelopada) ainda funciona (backward-compat)', async () => {
            const chats = [{ id: '5511@c.us', name: 'Cliente' }];
            mockAxios.get.mockResolvedValue({ data: chats });
            const result = await WhatsAppService.getConversations('default');
            expect(result).toHaveLength(1);
        });
    });

    describe('createSession', () => {
        it('creates a new session', async () => {
            mockAxios.post.mockResolvedValue({ data: { success: true } });

            await WhatsAppService.createSession('new-session');

            expect(mockAxios.post).toHaveBeenCalled();
        });
    });

    describe('deleteSession', () => {
        it('deletes a session', async () => {
            mockAxios.delete.mockResolvedValue({ data: undefined });

            await WhatsAppService.deleteSession('default');

            expect(mockAxios.delete).toHaveBeenCalledWith(expect.stringContaining('/sessions/default'), expect.any(Object));
        });
    });

    describe('getConversations', () => {
        it('fetches conversations', async () => {
            const chats = [{
                id: '5511999999999@c.us',
                name: 'John Doe',
                lastMessage: 'Hello',
                timestamp: 1234567890,
                unreadCount: 2,
                isGroup: false
            }];
            mockAxios.get.mockResolvedValue({ data: chats });

            const result = await WhatsAppService.getConversations('default');

            expect(result).toHaveLength(1);
            expect(result[0].customerName).toBe('John Doe');
            expect(result[0].unreadCount).toBe(2);
        });

        it('handles object-style id', async () => {
            const chats = [{
                id: { _serialized: '5511999999999@c.us', user: '5511999999999' },
                name: 'John',
                isGroup: false
            }];
            mockAxios.get.mockResolvedValue({ data: chats });

            const result = await WhatsAppService.getConversations('default');

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('5511999999999@c.us');
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('Failed'));

            const result = await WhatsAppService.getConversations('default');

            expect(result).toEqual([]);
        });
    });

    describe('getMessages', () => {
        it('fetches messages for a conversation', async () => {
            const messages = [{
                id: 'msg1',
                fromMe: false,
                body: 'Hello',
                timestamp: 1234567890,
                ack: 2,
                senderName: 'John'
            }];
            mockAxios.get.mockResolvedValue({ data: messages });

            const result = await WhatsAppService.getMessages('5511999999999@c.us', 'default');

            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Hello');
            expect(result[0].sender).toBe('user');
            expect(result[0].status).toBe('read');
        });

        it('handles media messages', async () => {
            const messages = [{
                id: 'msg1',
                fromMe: true,
                body: '',
                type: 'image',
                mimetype: 'image/jpeg',
                hasMedia: true,
                timestamp: 1234567890
            }];
            mockAxios.get.mockResolvedValue({ data: messages });

            const result = await WhatsAppService.getMessages('chat1', 'default');

            expect(result[0].attachments).toBeDefined();
            expect(result[0].attachments![0].type).toBe('image');
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('Failed'));

            const result = await WhatsAppService.getMessages('chat1', 'default');

            expect(result).toEqual([]);
        });
    });

    describe('sendMessage', () => {
        it('sends a text message', async () => {
            const response = { data: { id: 'msg123', fromMe: true, body: 'Hello' } };
            mockAxios.post.mockResolvedValue(response);

            const result = await WhatsAppService.sendMessage('5511999999999@c.us', 'Hello');

            expect(result.text).toBe('Hello');
            expect(result.sender).toBe('agent');
        });

        it('handles object-style message id', async () => {
            const response = { data: { id: { _serialized: 'msg123' } } };
            mockAxios.post.mockResolvedValue(response);

            const result = await WhatsAppService.sendMessage('chat1', 'Test');

            expect(result.id).toBe('msg123');
        });

        it('throws on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Failed'));
            mockAxios.isAxiosError = vi.fn().mockReturnValue(true);

            await expect(WhatsAppService.sendMessage('chat1', 'Test')).rejects.toThrow();
        });
    });

    describe('sendAudioMessage', () => {
        it('sends audio message', async () => {
            const blob = new Blob(['audio'], { type: 'audio/ogg' });
            const response = { data: { id: 'msg123' } };
            mockAxios.post.mockResolvedValue(response);

            const result = await WhatsAppService.sendAudioMessage('chat1', blob);

            expect(result.text).toBe('🎤 Áudio');
            expect(result.attachments![0].type).toBe('audio');
        });
    });

    describe('sendFileMessage', () => {
        it('sends file message', async () => {
            const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
            const response = { data: { id: 'msg123' } };
            mockAxios.post.mockResolvedValue(response);

            const result = await WhatsAppService.sendFileMessage('chat1', file, 'http://mock.url');

            expect(result.text).toBe('test.pdf');
            expect(result.attachments![0].type).toBe('file');
        });
    });

    describe('assignConversation', () => {
        it('assigns conversation to user', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.assignConversation('chat1', 'user1');

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/assign'), expect.any(Object), expect.any(Object));
        });

        it('can unassign conversation', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.assignConversation('chat1', null);

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/assign'), { chatId: 'chat1', userId: null }, expect.any(Object));
        });
    });

    describe('getUserSettings', () => {
        it('fetches user settings', async () => {
            const settings = { theme: 'dark' };
            mockAxios.get.mockResolvedValue({ data: { mySettings: settings } });

            const result = await WhatsAppService.getUserSettings();

            expect(result).toEqual(settings);
        });
    });

    describe('getSessionSettings', () => {
        it('fetches session settings', async () => {
            const settings = { readReceipts: true };
            mockAxios.get.mockResolvedValue({ data: settings });

            const result = await WhatsAppService.getSessionSettings('default');

            expect(result).toEqual(settings);
        });
    });

    describe('getChatSettings', () => {
        it('fetches chat settings', async () => {
            const settings = { pinned: true };
            mockAxios.get.mockResolvedValue({ data: settings });

            const result = await WhatsAppService.getChatSettings('chat1');

            expect(result).toEqual(settings);
        });

        it('encodes chat ID in URL', async () => {
            mockAxios.get.mockResolvedValue({ data: {} });

            await WhatsAppService.getChatSettings('chat with spaces');

            expect(mockAxios.get).toHaveBeenCalledWith(expect.stringContaining('chat%20with%20spaces'), expect.any(Object));
        });
    });

    describe('updateUserSettings', () => {
        it('updates user settings', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.updateUserSettings({ theme: 'dark' });

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/settings/user'), { theme: 'dark' }, expect.any(Object));
        });
    });

    describe('updateSessionSettings', () => {
        it('updates session settings', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.updateSessionSettings('default', { readReceipts: false });

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/settings/session'), expect.objectContaining({ sessionId: 'default' }), expect.any(Object));
        });
    });

    describe('updateChatSettings', () => {
        it('updates chat settings', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.updateChatSettings('chat1', { pinned: true });

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/settings/chat'), expect.any(Object), expect.any(Object));
        });
    });

    describe('getProfile', () => {
        it('fetches profile', async () => {
            const profile = { pushName: 'My Name', status: 'online' };
            mockAxios.get.mockResolvedValue({ data: profile });

            const result = await WhatsAppService.getProfile('default');

            expect(result).toEqual(profile);
        });
    });

    describe('setProfilePicture', () => {
        it('sets profile picture', async () => {
            const file = new File(['image'], 'profile.jpg', { type: 'image/jpeg' });
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.setProfilePicture(file);

            expect(mockAxios.post).toHaveBeenCalled();
        });
    });

    describe('deleteProfilePicture', () => {
        it('deletes profile picture', async () => {
            mockAxios.delete.mockResolvedValue({ data: undefined });

            await WhatsAppService.deleteProfilePicture('default');

            expect(mockAxios.delete).toHaveBeenCalled();
        });
    });

    describe('setDisplayName', () => {
        it('sets display name', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.setDisplayName('New Name');

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/profile/name'), expect.any(Object), expect.any(Object));
        });
    });

    describe('setAbout', () => {
        it('sets status/about', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.setAbout('Available');

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/profile/status'), expect.any(Object), expect.any(Object));
        });
    });

    describe('setPresence', () => {
        it('sets presence to online', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.setPresence('online');

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/profile/presence'), expect.objectContaining({ presence: 'online' }), expect.any(Object));
        });

        it('sets presence to offline', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await WhatsAppService.setPresence('offline');

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/profile/presence'), expect.objectContaining({ presence: 'offline' }), expect.any(Object));
        });
    });

    describe('checkNumber', () => {
        it('checks if number is registered', async () => {
            const response = { data: { number: '5511999999999', isRegistered: true, chatId: 'chat1' } };
            mockAxios.get.mockResolvedValue(response);

            const result = await WhatsAppService.checkNumber('5511999999999');

            expect(result.isRegistered).toBe(true);
        });
    });
});
