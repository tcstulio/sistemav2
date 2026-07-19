import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    },
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
}));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { userNotifyPrefsStore } from '../../services/userNotifyPrefsStore';

describe('userNotifyPrefsStore (#1578)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('get / isOptedOut (default opt-in)', () => {
        it('usuário desconhecido → { optedOut: false } (default NÃO é opt-out)', () => {
            expect(userNotifyPrefsStore.get('user-novo')).toEqual({ optedOut: false });
            expect(userNotifyPrefsStore.isOptedOut('user-novo')).toBe(false);
        });

        it('userId vazio → default (defesa)', () => {
            expect(userNotifyPrefsStore.get('')).toEqual({ optedOut: false });
            expect(userNotifyPrefsStore.isOptedOut('')).toBe(false);
        });
    });

    describe('setOptOut', () => {
        it('persiste optedOut=true e reflete em isOptedOut', () => {
            const result = userNotifyPrefsStore.setOptOut('user-1', true);
            expect(result).toEqual({ optedOut: true });
            expect(userNotifyPrefsStore.isOptedOut('user-1')).toBe(true);
            expect(userNotifyPrefsStore.get('user-1')).toEqual({ optedOut: true });
        });

        it('desfaz opt-out (optedOut=false volta a permitir notificações)', () => {
            userNotifyPrefsStore.setOptOut('user-2', true);
            userNotifyPrefsStore.setOptOut('user-2', false);
            expect(userNotifyPrefsStore.isOptedOut('user-2')).toBe(false);
        });

        it('é isolado por usuário (opt-out de um não afeta outro)', () => {
            userNotifyPrefsStore.setOptOut('user-a', true);
            expect(userNotifyPrefsStore.isOptedOut('user-b')).toBe(false);
        });

        it('ignora userId vazio (não persiste state fictício)', () => {
            const result = userNotifyPrefsStore.setOptOut('', true);
            expect(result).toEqual({ optedOut: false });
        });
    });
});
