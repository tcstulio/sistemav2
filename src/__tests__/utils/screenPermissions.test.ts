import { describe, it, expect } from 'vitest';
import { resolveScreenAccess, ScreenPermissions } from '../../utils/screenPermissions';

const perms: ScreenPermissions = {
    groups: {
        g1: { hidden: ['invoices'], allowed: ['simulator'] },
        g2: { hidden: [], allowed: ['venues'] },
    },
    users: {
        u1: { hidden: ['orders'], allowed: ['invoices'] }, // re-libera o que o grupo escondeu
        u2: { hidden: ['settings'], allowed: [] },          // tela protegida
    },
};

describe('resolveScreenAccess', () => {
    it('admin sempre tem acesso (bypass total)', () => {
        expect(resolveScreenAccess({ screenId: 'invoices', base: false, isAdmin: true })).toBe(true);
    });

    it('sem perms, devolve o base', () => {
        expect(resolveScreenAccess({ screenId: 'invoices', base: true, isAdmin: false })).toBe(true);
        expect(resolveScreenAccess({ screenId: 'invoices', base: false, isAdmin: false })).toBe(false);
    });

    it('grupo hidden bloqueia tela que o base liberava', () => {
        expect(resolveScreenAccess({ screenId: 'invoices', base: true, isAdmin: false, groupIds: ['g1'], perms })).toBe(false);
    });

    it('grupo allowed libera tela de app sem direito Dolibarr', () => {
        expect(resolveScreenAccess({ screenId: 'simulator', base: false, isAdmin: false, groupIds: ['g1'], perms })).toBe(true);
        expect(resolveScreenAccess({ screenId: 'venues', base: false, isAdmin: false, groupIds: ['g2'], perms })).toBe(true);
    });

    it('pessoa vence grupo: user.allowed re-libera o que o grupo escondeu', () => {
        expect(resolveScreenAccess({ screenId: 'invoices', base: true, isAdmin: false, userId: 'u1', groupIds: ['g1'], perms })).toBe(true);
    });

    it('pessoa hidden bloqueia mesmo com base true', () => {
        expect(resolveScreenAccess({ screenId: 'orders', base: true, isAdmin: false, userId: 'u1', perms })).toBe(false);
    });

    it('telas protegidas (settings/dashboard) ignoram hidden', () => {
        expect(resolveScreenAccess({ screenId: 'settings', base: true, isAdmin: false, userId: 'u2', perms })).toBe(true);
        expect(resolveScreenAccess({ screenId: 'dashboard', base: true, isAdmin: false, userId: 'u2', perms })).toBe(true);
    });

    it('usuário sem regra e sem grupo relevante mantém o base', () => {
        expect(resolveScreenAccess({ screenId: 'invoices', base: true, isAdmin: false, userId: 'unknown', groupIds: ['gX'], perms })).toBe(true);
    });

    it('múltiplos grupos: hidden de um vence allowed de outro (no escopo grupo)', () => {
        const p: ScreenPermissions = {
            groups: { a: { hidden: [], allowed: ['reports'] }, b: { hidden: ['reports'], allowed: [] } },
            users: {},
        };
        expect(resolveScreenAccess({ screenId: 'reports', base: false, isAdmin: false, groupIds: ['a', 'b'], perms: p })).toBe(false);
    });
});
