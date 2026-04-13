import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));
vi.mock('../../utils/safeStorage', () => ({
    safeStorage: {
        getItem: vi.fn().mockReturnValue(JSON.stringify({ apiKey: 'test-api-key' })),
        getJSON: vi.fn().mockReturnValue({ apiKey: 'test-api-key' })
    }
}));

import axios from 'axios';
import { EmailService } from '../../services/emailService';

describe('EmailService', () => {
    const mockAxios = axios as unknown as {
        get: ReturnType<typeof vi.fn>;
        post: ReturnType<typeof vi.fn>;
        put: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getAccounts', () => {
        it('fetches email accounts', async () => {
            const accounts = [{ id: '1', email: 'test@example.com' }];
            mockAxios.get.mockResolvedValue({ data: accounts });

            const result = await EmailService.getAccounts();

            expect(result).toEqual(accounts);
            expect(mockAxios.get).toHaveBeenCalledWith(expect.stringContaining('/accounts'), expect.any(Object));
        });
    });

    describe('addAccount', () => {
        it('adds a new email account', async () => {
            const response = { success: true, id: '123' };
            mockAxios.post.mockResolvedValue({ data: response });

            const result = await EmailService.addAccount({ email: 'test@example.com' });

            expect(result).toEqual(response);
        });
    });

    describe('updateAccount', () => {
        it('updates an existing account', async () => {
            mockAxios.put.mockResolvedValue({ data: undefined });

            await EmailService.updateAccount('1', { name: 'Updated' });

            expect(mockAxios.put).toHaveBeenCalledWith(expect.stringContaining('/accounts/1'), { name: 'Updated' }, expect.any(Object));
        });
    });

    describe('deleteAccount', () => {
        it('deletes an account', async () => {
            mockAxios.delete.mockResolvedValue({ data: undefined });

            await EmailService.deleteAccount('1');

            expect(mockAxios.delete).toHaveBeenCalledWith(expect.stringContaining('/accounts/1'), expect.any(Object));
        });
    });

    describe('testConnection', () => {
        it('tests IMAP connection', async () => {
            const response = { success: true, message: 'Connected' };
            mockAxios.post.mockResolvedValue({ data: response });

            const result = await EmailService.testConnection('imap', { host: 'imap.example.com', port: 993, user: 'test', password: 'pass' });

            expect(result).toEqual(response);
        });

        it('tests SMTP connection', async () => {
            const response = { success: true, message: 'Connected' };
            mockAxios.post.mockResolvedValue({ data: response });

            const result = await EmailService.testConnection('smtp', { host: 'smtp.example.com', port: 587, user: 'test', password: 'pass' });

            expect(result).toEqual(response);
        });
    });

    describe('getFolders', () => {
        it('fetches folders for an account', async () => {
            const folders = [{ name: 'INBOX', path: 'INBOX' }];
            mockAxios.get.mockResolvedValue({ data: folders });

            const result = await EmailService.getFolders('account1');

            expect(result).toEqual(folders);
        });
    });

    describe('getMessages', () => {
        it('fetches messages from a folder', async () => {
            const messages = [{ id: '1', subject: 'Test' }];
            mockAxios.get.mockResolvedValue({ data: messages });

            const result = await EmailService.getMessages('account1', 'INBOX', 20);

            expect(result).toEqual(messages);
            expect(mockAxios.get).toHaveBeenCalledWith(expect.stringContaining('/messages'), expect.any(Object));
        });
    });

    describe('getMessageBody', () => {
        it('fetches message body', async () => {
            const body = { html: '<p>Test</p>', text: 'Test' };
            mockAxios.get.mockResolvedValue({ data: body });

            const result = await EmailService.getMessageBody('account1', 123, 'INBOX');

            expect(result).toEqual(body);
        });
    });

    describe('sendEmail', () => {
        it('sends an email', async () => {
            const response = { success: true, messageId: 'msg123' };
            mockAxios.post.mockResolvedValue({ data: response });

            const result = await EmailService.sendEmail('account1', 'to@example.com', 'Subject', '<p>Body</p>');

            expect(result).toEqual(response);
        });

        it('sends email with attachments', async () => {
            const response = { success: true };
            mockAxios.post.mockResolvedValue({ data: response });
            const attachments = [{ name: 'file.pdf', url: 'http://example.com/file.pdf' }];

            await EmailService.sendEmail('account1', 'to@example.com', 'Subject', '<p>Body</p>', attachments, 'cc@example.com');

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/send'), expect.objectContaining({
                attachments
            }), expect.any(Object));
        });
    });

    describe('getUnreadCount', () => {
        it('returns unread count', async () => {
            mockAxios.get.mockResolvedValue({ data: { count: 5 } });

            const result = await EmailService.getUnreadCount('account1');

            expect(result).toBe(5);
        });
    });

    describe('searchMessages', () => {
        it('searches messages', async () => {
            const messages = [{ id: '1', subject: 'Found' }];
            mockAxios.get.mockResolvedValue({ data: messages });

            const result = await EmailService.searchMessages('account1', 'test query');

            expect(result).toEqual(messages);
        });
    });

    describe('modifyFlags', () => {
        it('adds flags to messages', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await EmailService.modifyFlags('account1', 'INBOX', [1, 2], 'addFlags', ['\\Seen']);

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/flags'), expect.any(Object), expect.any(Object));
        });
    });

    describe('deleteMessages', () => {
        it('deletes messages', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await EmailService.deleteMessages('account1', 'INBOX', [1, 2]);

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/delete'), expect.any(Object), expect.any(Object));
        });
    });

    describe('moveMessages', () => {
        it('moves messages to another folder', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await EmailService.moveMessages('account1', 'INBOX', [1], 'Archive');

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/move'), expect.any(Object), expect.any(Object));
        });
    });

    describe('getTemplates', () => {
        it('fetches email templates', async () => {
            const templates = [{ id: '1', name: 'Welcome' }];
            mockAxios.get.mockResolvedValue({ data: templates });

            const result = await EmailService.getTemplates();

            expect(result).toEqual(templates);
        });
    });

    describe('addTemplate', () => {
        it('adds a new template', async () => {
            const response = { success: true, id: '1' };
            mockAxios.post.mockResolvedValue({ data: response });

            const result = await EmailService.addTemplate({ name: 'Test', subject: 'Subject', body: 'Body' });

            expect(result).toEqual(response);
        });
    });

    describe('updateTemplate', () => {
        it('updates a template', async () => {
            mockAxios.put.mockResolvedValue({ data: undefined });

            await EmailService.updateTemplate('1', { name: 'Updated' });

            expect(mockAxios.put).toHaveBeenCalledWith(expect.stringContaining('/templates/1'), { name: 'Updated' }, expect.any(Object));
        });
    });

    describe('deleteTemplate', () => {
        it('deletes a template', async () => {
            mockAxios.delete.mockResolvedValue({ data: undefined });

            await EmailService.deleteTemplate('1');

            expect(mockAxios.delete).toHaveBeenCalledWith(expect.stringContaining('/templates/1'), expect.any(Object));
        });
    });

    describe('assignThread', () => {
        it('assigns a thread to a user', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await EmailService.assignThread('thread1', 'user1');

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/assign'), { threadId: 'thread1', userId: 'user1' }, expect.any(Object));
        });
    });

    describe('getAssignment', () => {
        it('gets thread assignment', async () => {
            mockAxios.get.mockResolvedValue({ data: { userId: 'user1' } });

            const result = await EmailService.getAssignment('thread1');

            expect(result).toBe('user1');
        });
    });

    describe('updateThreadSettings', () => {
        it('updates thread settings', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await EmailService.updateThreadSettings('thread1', { priority: 'high' });

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/settings/thread'), expect.any(Object), expect.any(Object));
        });
    });

    describe('getThreadSettings', () => {
        it('gets thread settings', async () => {
            const settings = { priority: 'high' };
            mockAxios.get.mockResolvedValue({ data: settings });

            const result = await EmailService.getThreadSettings('thread1');

            expect(result).toEqual(settings);
        });
    });

    describe('updateUserSettings', () => {
        it('updates user settings', async () => {
            mockAxios.post.mockResolvedValue({ data: undefined });

            await EmailService.updateUserSettings({ signature: 'My Sig' });

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/settings/user'), { signature: 'My Sig' }, expect.any(Object));
        });
    });

    describe('getUserStore', () => {
        it('gets user store data', async () => {
            const store = { userSettings: { signature: 'Sig' } };
            mockAxios.get.mockResolvedValue({ data: store });

            const result = await EmailService.getUserStore();

            expect(result).toEqual(store);
        });
    });

    describe('getHeaders error handling', () => {
        it('handles corrupted config gracefully', async () => {
            const { safeStorage } = await import('../../utils/safeStorage');
            vi.mocked(safeStorage.getItem).mockReturnValueOnce('invalid-json{');
            
            const accounts = [{ id: '1', email: 'test@example.com' }];
            mockAxios.get.mockResolvedValue({ data: accounts });

            const result = await EmailService.getAccounts();

            expect(result).toEqual(accounts);
        });
    });
});
