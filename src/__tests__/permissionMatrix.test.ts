import { describe, it, expect } from 'vitest';
import { canAccessScreen } from '../utils/screenAccess';
import { deriveScreenMatrix, visibleScreens, WRITE_ACTIONS } from '../utils/permissionMatrix';

// Identidades de exemplo (mesmo shape de user.rights / getGroupRights).
const ADMIN = { admin: 1, rights: {} };
const FINANCEIRO = { admin: 0, rights: { facture: { lire: '1', creer: '1', valider: '1', paiement: '1' } } };
const FREELA = { admin: 0, rights: {} };

describe('canAccessScreen (VER)', () => {
    it('admin vê tudo', () => {
        expect(canAccessScreen(ADMIN, 'invoices')).toBe(true);
        expect(canAccessScreen(ADMIN, 'hr')).toBe(true);
        expect(canAccessScreen(ADMIN, 'users')).toBe(true);
    });

    it('dashboard é público (qualquer logado vê)', () => {
        expect(canAccessScreen(FREELA, 'dashboard')).toBe(true);
    });

    it('Financeiro vê Faturas (facture.lire) mas NÃO vê RH nem Usuários', () => {
        expect(canAccessScreen(FINANCEIRO, 'invoices')).toBe(true);
        expect(canAccessScreen(FINANCEIRO, 'payments')).toBe(true);
        expect(canAccessScreen(FINANCEIRO, 'hr')).toBe(false);
        expect(canAccessScreen(FINANCEIRO, 'users')).toBe(false);
    });

    it('freela (sem rights) NÃO vê tela interna', () => {
        expect(canAccessScreen(FREELA, 'invoices')).toBe(false);
        expect(canAccessScreen(FREELA, 'customers')).toBe(false);
    });

    it('identidade nula não vê nada', () => {
        expect(canAccessScreen(null, 'dashboard')).toBe(false);
    });
});

// Trava o SUPERSET do de-dup (#1073): estas telas antes só existiam na cópia inline do
// DolibarrContext. Agora que o gate vivo importa RIGHTS_MAP, elas têm de resolver aqui também.
describe('superset de telas (de-dup #1073)', () => {
    const SUPRIMENTOS = { admin: 0, rights: { fournisseur: { lire: '1' } } };
    const COMERCIAL = { admin: 0, rights: { societe: { lire: '1' } } };
    const USER_SELF = { admin: 0, rights: { user: { self: { read: '1' } } } };

    it('admin vê as telas novas', () => {
        for (const s of ['whatsapp', 'reports', 'settings', 'supplier_proposals', 'movements', 'system_events']) {
            expect(canAccessScreen(ADMIN, s)).toBe(true);
        }
    });

    it('reports/monthly_report seguem o módulo facture (Financeiro vê, freela não)', () => {
        expect(canAccessScreen(FINANCEIRO, 'reports')).toBe(true);
        expect(canAccessScreen(FINANCEIRO, 'monthly_report')).toBe(true);
        expect(canAccessScreen(FREELA, 'reports')).toBe(false);
    });

    it('supplier_proposals exige módulo fournisseur (Financeiro-só-facture NÃO vê)', () => {
        expect(canAccessScreen(SUPRIMENTOS, 'supplier_proposals')).toBe(true);
        expect(canAccessScreen(FINANCEIRO, 'supplier_proposals')).toBe(false);
    });

    it('telas de comunicação seguem societe.lire', () => {
        expect(canAccessScreen(COMERCIAL, 'whatsapp')).toBe(true);
        expect(canAccessScreen(COMERCIAL, 'chat')).toBe(true);
        expect(canAccessScreen(FREELA, 'whatsapp')).toBe(false);
    });

    it('settings segue o perm aninhado user.self.read', () => {
        expect(canAccessScreen(USER_SELF, 'settings')).toBe(true);
        expect(canAccessScreen(FREELA, 'settings')).toBe(false);
    });
});

describe('deriveScreenMatrix (papel×tela×ação)', () => {
    it('gera uma linha por tela do MENU_REGISTRY', () => {
        const rows = deriveScreenMatrix(ADMIN);
        expect(rows.length).toBeGreaterThan(10);
        expect(rows.find((r) => r.screenId === 'invoices')).toBeTruthy();
        // cada linha tem todas as ações resolvidas
        for (const r of rows) {
            for (const a of WRITE_ACTIONS) expect(typeof r.actions[a]).toBe('boolean');
        }
    });

    it('admin: pode VER e FAZER (create) em Faturas', () => {
        const r = deriveScreenMatrix(ADMIN).find((x) => x.screenId === 'invoices')!;
        expect(r.canView).toBe(true);
        expect(r.actions.create).toBe(true);
        expect(r.actions.delete).toBe(true);
    });

    it('Financeiro: cria/valida/paga Faturas; NÃO faz nada em RH (nem vê)', () => {
        const rows = deriveScreenMatrix(FINANCEIRO);
        const inv = rows.find((x) => x.screenId === 'invoices')!;
        expect(inv.canView).toBe(true);
        expect(inv.actions.create).toBe(true);
        expect(inv.actions.validate).toBe(true);
        expect(inv.actions.pay).toBe(true);

        const hr = rows.find((x) => x.screenId === 'hr')!;
        expect(hr.canView).toBe(false);
        // EFETIVO: não pode FAZER o que não pode VER
        expect(hr.actions.create).toBe(false);
    });

    it('freela: não FAZ nada em tela que não vê (efetivo)', () => {
        const inv = deriveScreenMatrix(FREELA).find((x) => x.screenId === 'invoices')!;
        expect(inv.canView).toBe(false);
        expect(inv.actions.create).toBe(false);
        expect(inv.actions.delete).toBe(false);
    });

    it('actionsGated reflete o WRITE_MAP: Clientes é gated, Agenda não', () => {
        const rows = deriveScreenMatrix(ADMIN);
        expect(rows.find((x) => x.screenId === 'customers')!.actionsGated).toBe(true);
        expect(rows.find((x) => x.screenId === 'agenda')!.actionsGated).toBe(false);
    });
});

describe('visibleScreens (tour por papel)', () => {
    it('freela vê só o público; Financeiro vê mais', () => {
        const freela = visibleScreens(FREELA).map((r) => r.screenId);
        expect(freela).toContain('dashboard');
        expect(freela).not.toContain('invoices');

        const fin = visibleScreens(FINANCEIRO).map((r) => r.screenId);
        expect(fin).toContain('invoices');
        expect(fin.length).toBeGreaterThan(freela.length);
    });
});
