import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('fs');
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('storeService', () => {
    let storeService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();

        mockedFs.existsSync.mockReturnValue(false);

        const mod = await import('../../services/storeService');
        storeService = mod.storeService;
    });

    describe('constructor / load', () => {
        it('creates data dir if it does not exist', () => {
            expect(mockedFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
        });

        it('loads from file when it exists', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            const mockData = JSON.stringify({
                user_settings: { u1: { signatureName: 'John' } },
                session_settings: { s1: { autoReply: true } },
                chat_settings: { c1: { autoReplyEnabled: true } },
                conversation_assignments: { c1: { userId: 'u1', assignedAt: 123 } },
            });

            mockedFs.existsSync
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(true);
            mockedFs.readFileSync.mockReturnValue(mockData);

            const mod = await import('../../services/storeService');
            const svc = mod.storeService;

            expect(svc.getUserSettings('u1')).toEqual({ signatureName: 'John' });
            expect(svc.getSessionSettings('s1')).toEqual({ autoReply: true });
        });

        it('handles load error gracefully', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
            mockedFs.readFileSync.mockImplementation(() => {
                throw new Error('read error');
            });

            const mod = await import('../../services/storeService');
            const svc = mod.storeService;
            expect(svc.getUserSettings('u1')).toEqual({});
        });

        it('handles missing fields in loaded data by using defaults', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({}));

            const mod = await import('../../services/storeService');
            const svc = mod.storeService;
            expect(svc.getSessionSettings('any')).toEqual({ autoReply: false });
        });
    });

    describe('getUserSettings', () => {
        it('returns empty object for unknown user', () => {
            expect(storeService.getUserSettings('unknown')).toEqual({});
        });

        it('returns saved user settings', () => {
            storeService.updateUserSettings('u1', { signatureName: 'Alice' });
            expect(storeService.getUserSettings('u1')).toEqual({ signatureName: 'Alice' });
        });
    });

    describe('updateUserSettings', () => {
        it('creates new user settings', () => {
            storeService.updateUserSettings('u1', { signatureName: 'Bob' });
            expect(storeService.getUserSettings('u1')).toEqual({ signatureName: 'Bob' });
        });

        it('merges with existing settings', () => {
            storeService.updateUserSettings('u1', { signatureName: 'Bob' });
            storeService.updateUserSettings('u1', { signatureName: 'Charlie' });
            expect(storeService.getUserSettings('u1')).toEqual({ signatureName: 'Charlie' });
        });
    });

    describe('getSessionSettings', () => {
        it('returns default for unknown session', () => {
            expect(storeService.getSessionSettings('unknown')).toEqual({ autoReply: false });
        });

        it('returns saved session settings', () => {
            storeService.updateSessionSettings('s1', { autoReply: true, name: 'Test' });
            expect(storeService.getSessionSettings('s1')).toEqual(expect.objectContaining({ autoReply: true, name: 'Test' }));
        });
    });

    describe('updateSessionSettings', () => {
        it('does not overwrite existing values with undefined', () => {
            storeService.updateSessionSettings('s1', { autoReply: true, name: 'Test', signatureName: 'Sig' });
            storeService.updateSessionSettings('s1', { autoReply: undefined as any });
            const settings = storeService.getSessionSettings('s1');
            expect(settings.autoReply).toBe(true);
            expect(settings.name).toBe('Test');
            expect(settings.signatureName).toBe('Sig');
        });

        it('sets historyLimit', () => {
            storeService.updateSessionSettings('s1', { historyLimit: 20 });
            expect(storeService.getSessionSettings('s1').historyLimit).toBe(20);
        });
    });

    describe('getChatSettings', () => {
        it('returns empty object for unknown chat', () => {
            expect(storeService.getChatSettings('unknown')).toEqual({});
        });
    });

    describe('updateChatSettings', () => {
        it('updates chat settings', () => {
            storeService.updateChatSettings('c1', { autoReplyEnabled: true });
            expect(storeService.getChatSettings('c1')).toEqual({ autoReplyEnabled: true });
        });

        it('merges groupSettings with existing', () => {
            storeService.updateChatSettings('c1', {
                groupSettings: { llmEnabled: true },
            });
            storeService.updateChatSettings('c1', {
                groupSettings: { messageCounter: 5 },
            });
            const settings = storeService.getChatSettings('c1');
            expect(settings.groupSettings.llmEnabled).toBe(true);
            expect(settings.groupSettings.messageCounter).toBe(5);
        });

        it('preserves existing groupSettings when updating non-groupSettings', () => {
            storeService.updateChatSettings('c1', {
                groupSettings: { llmEnabled: true },
            });
            storeService.updateChatSettings('c1', { autoReplyEnabled: false });
            const settings = storeService.getChatSettings('c1');
            expect(settings.groupSettings.llmEnabled).toBe(true);
            expect(settings.autoReplyEnabled).toBe(false);
        });

        it('updates responseFrequency and burstHandling', () => {
            storeService.updateChatSettings('c1', {
                groupSettings: {
                    responseFrequency: { value: 30, unit: 'minutes' as const },
                    burstHandling: { enabled: true, threshold: 5 },
                },
            });
            const settings = storeService.getChatSettings('c1');
            expect(settings.groupSettings.responseFrequency).toEqual({ value: 30, unit: 'minutes' });
            expect(settings.groupSettings.burstHandling).toEqual({ enabled: true, threshold: 5 });
        });
    });

    describe('assignConversation', () => {
        it('assigns user to conversation', () => {
            storeService.assignConversation('chat1', 'user1');
            const assignment = storeService.getAssignment('chat1');
            expect(assignment.userId).toBe('user1');
            expect(assignment.assignedAt).toBeGreaterThan(0);
        });

        it('unassigns when userId is null', () => {
            storeService.assignConversation('chat1', 'user1');
            storeService.assignConversation('chat1', null);
            const assignment = storeService.getAssignment('chat1');
            expect(assignment.userId).toBeUndefined();
        });

        it('returns undefined for unknown chat', () => {
            expect(storeService.getAssignment('unknown')).toBeUndefined();
        });
    });

    describe('updateLastResponder', () => {
        it('sets lastResponderId', () => {
            storeService.updateLastResponder('chat1', 'responder1');
            const assignment = storeService.getAssignment('chat1');
            expect(assignment.lastResponderId).toBe('responder1');
        });

        it('keeps existing assignedAt', () => {
            storeService.assignConversation('chat1', 'user1');
            const originalAssignedAt = storeService.getAssignment('chat1').assignedAt;
            storeService.updateLastResponder('chat1', 'responder1');
            const assignment = storeService.getAssignment('chat1');
            expect(assignment.assignedAt).toBe(originalAssignedAt);
            expect(assignment.lastResponderId).toBe('responder1');
        });

        it('sets assignedAt when no existing assignment', () => {
            storeService.updateLastResponder('chat2', 'responder1');
            const assignment = storeService.getAssignment('chat2');
            expect(assignment.assignedAt).toBeGreaterThan(0);
        });
    });

    describe('resolveUser', () => {
        it('returns undefined for unknown chat', () => {
            expect(storeService.resolveUser('unknown')).toBeUndefined();
        });

        it('returns explicit userId first', () => {
            storeService.assignConversation('chat1', 'user1');
            storeService.updateLastResponder('chat1', 'responder1');
            expect(storeService.resolveUser('chat1')).toBe('user1');
        });

        it('falls back to lastResponderId', () => {
            storeService.updateLastResponder('chat1', 'responder1');
            expect(storeService.resolveUser('chat1')).toBe('responder1');
        });
    });

    describe('resolveSignature', () => {
        it('returns null for null user', () => {
            expect(storeService.resolveSignature(null)).toBeNull();
        });

        it('returns null for user without id', () => {
            expect(storeService.resolveSignature({})).toBeNull();
        });

        it('returns custom signatureName if set', () => {
            storeService.updateUserSettings('u1', { signatureName: 'Custom Sig' });
            expect(storeService.resolveSignature({ id: 'u1', firstname: 'John' })).toBe('Custom Sig');
        });

        it('returns firstname as default', () => {
            expect(storeService.resolveSignature({ id: 'u1', firstname: 'John' })).toBe('John');
        });

        it('falls back to lastname when firstname is numeric', () => {
            expect(storeService.resolveSignature({ id: 'u1', firstname: '12345', lastname: 'Doe' })).toBe('Doe');
        });

        it('falls back to login when firstname is numeric and no lastname', () => {
            expect(storeService.resolveSignature({ id: 'u1', firstname: '12345', login: 'johndoe' })).toBe('johndoe');
        });

        it('falls back to login when firstname is whitespace numbers', () => {
            expect(storeService.resolveSignature({ id: 'u1', firstname: '123 45', login: 'johndoe' })).toBe('johndoe');
        });

        it('returns null when no name available', () => {
            expect(storeService.resolveSignature({ id: 'u1' })).toBeNull();
        });

        it('returns null when firstname is numeric and no lastname or login', () => {
            expect(storeService.resolveSignature({ id: 'u1', firstname: '12345' })).toBeNull();
        });
    });

    describe('formatMessageWithSignature', () => {
        it('appends signature to message', () => {
            const result = storeService.formatMessageWithSignature('Hello', { id: 'u1', firstname: 'John' });
            expect(result).toBe('Hello\n\n~ John');
        });

        it('returns message without signature when no name', () => {
            const result = storeService.formatMessageWithSignature('Hello', null);
            expect(result).toBe('Hello');
        });

        it('returns message without signature when user has no id', () => {
            const result = storeService.formatMessageWithSignature('Hello', {});
            expect(result).toBe('Hello');
        });
    });

    describe('save error handling', () => {
        it('handles save error gracefully', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            const mockAtomicWrite = vi.fn().mockImplementation(() => { throw new Error('write fail'); });
            vi.doMock('../../utils/atomicWrite', () => ({ atomicWriteSync: mockAtomicWrite }));
            mockedFs.existsSync.mockReturnValue(false);

            const mod = await import('../../services/storeService');
            const svc = mod.storeService;
            svc.updateUserSettings('u1', { signatureName: 'Test' });
            expect(mockAtomicWrite).toHaveBeenCalled();
        });
    });
});
