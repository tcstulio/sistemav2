import { describe, it, expect } from 'vitest';
import { canSeeCustomPage } from '../../config/customPages';

const page = (groups: string[], users: string[]) => ({ visibility: { groups, users } });

describe('canSeeCustomPage', () => {
    it('admin sempre vê', () => {
        expect(canSeeCustomPage(page(['9'], []), { isAdmin: true, userId: '1', groupIds: [] })).toBe(true);
    });

    it('allow-list vazia = todos os logados', () => {
        expect(canSeeCustomPage(page([], []), { isAdmin: false, userId: '1', groupIds: [] })).toBe(true);
    });

    it('libera por usuário explícito', () => {
        expect(canSeeCustomPage(page([], ['7']), { isAdmin: false, userId: '7', groupIds: [] })).toBe(true);
        expect(canSeeCustomPage(page([], ['7']), { isAdmin: false, userId: '8', groupIds: [] })).toBe(false);
    });

    it('libera por grupo do usuário', () => {
        expect(canSeeCustomPage(page(['3'], []), { isAdmin: false, userId: '8', groupIds: ['3', '5'] })).toBe(true);
        expect(canSeeCustomPage(page(['3'], []), { isAdmin: false, userId: '8', groupIds: ['5'] })).toBe(false);
    });

    it('com restrição e sem match, nega', () => {
        expect(canSeeCustomPage(page(['3'], ['7']), { isAdmin: false, userId: '8', groupIds: ['5'] })).toBe(false);
    });
});
