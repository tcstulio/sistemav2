import { describe, it, expect } from 'vitest';

import { MENU_REGISTRY, MENU_REGISTRY_ITEMS } from '../../config/menuRegistry';
import { applyOrderVisibility } from '../../utils/orderVisibility';

describe('menuRegistry', () => {
    it('has groups, each with at least one item', () => {
        expect(MENU_REGISTRY.length).toBeGreaterThan(0);
        for (const group of MENU_REGISTRY) {
            expect(group.items.length).toBeGreaterThan(0);
        }
    });

    it('flattened items match the sum of all group items', () => {
        const total = MENU_REGISTRY.reduce((acc, g) => acc + g.items.length, 0);
        expect(MENU_REGISTRY_ITEMS.length).toBe(total);
    });

    it('all item ids are unique', () => {
        const ids = MENU_REGISTRY_ITEMS.map(i => i.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every item has id, path and label', () => {
        for (const item of MENU_REGISTRY_ITEMS) {
            expect(item.id).toBeTruthy();
            expect(item.path).toBeTruthy();
            expect(item.label).toBeTruthy();
        }
    });

    describe('integration with applyOrderVisibility', () => {
        const group = MENU_REGISTRY.find(g => g.title === 'AGENTE IA')!;

        it('org default hides an item; rbac-filtered list never re-exposes it', () => {
            // simula que o RBAC já removeu "venues" da lista visível
            const rbacFiltered = group.items.filter(i => i.id !== 'venues');
            const result = applyOrderVisibility(
                rbacFiltered,
                i => i.id,
                { hidden: ['chat'], order: [] }, // org oculta "chat"
                null,
            );
            const ids = result.map(i => i.id);
            expect(ids).not.toContain('venues'); // RBAC continua valendo
            expect(ids).not.toContain('chat');   // org default oculta
            expect(ids).toContain('whatsapp');
        });

        it('user order overrides org order within a group', () => {
            const result = applyOrderVisibility(
                group.items,
                i => i.id,
                { hidden: [], order: ['email', 'chat', 'whatsapp'] },
                { hidden: [], order: ['simulator', 'whatsapp'] },
            );
            const ids = result.map(i => i.id);
            // user.order ganha: simulator e whatsapp vêm primeiro
            expect(ids[0]).toBe('simulator');
            expect(ids[1]).toBe('whatsapp');
        });

        it('user hidden is union with org hidden', () => {
            const result = applyOrderVisibility(
                group.items,
                i => i.id,
                { hidden: ['chat'], order: [] },
                { hidden: ['email'], order: [] },
            );
            const ids = result.map(i => i.id);
            expect(ids).not.toContain('chat');
            expect(ids).not.toContain('email');
        });
    });
});
