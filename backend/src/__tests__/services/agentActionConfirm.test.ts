import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-confirm-abc' } }));
const mockDolibarr = vi.hoisted(() => ({
    validateInvoice: vi.fn(async (id: string, key: string) => ({ id, validatedWith: key })),
    validateOrder: vi.fn(async (id: string, key: string) => ({ id, validatedWith: key })),
    validateProposal: vi.fn(async (id: string, key: string) => ({ id, validatedWith: key })),
}));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));

import { isConfirmable, buildConfirmDeeplink, describeConfirm, executeConfirm } from '../../services/agentActionConfirm';

const tokenFrom = (link: string) => decodeURIComponent(link.split('token=')[1]);

describe('agentActionConfirm — HITL de ação irreversível (§8.1)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('isConfirmable: só validate_* (v1)', () => {
        expect(isConfirmable('validate_invoice')).toBe(true);
        expect(isConfirmable('validate_order')).toBe(true);
        expect(isConfirmable('validate_proposal')).toBe(true);
        expect(isConfirmable('send_whatsapp')).toBe(false);
        expect(isConfirmable('list_invoices')).toBe(false);
    });

    it('build → describe: descreve a ação SEM executar', () => {
        const link = buildConfirmDeeplink('validate_invoice', { invoice_id: '50' }, '42');
        expect(link).toMatch(/^\/confirm-action\?token=/);
        const d = describeConfirm(tokenFrom(link));
        expect(d).toMatchObject({ ok: true, action: 'validate_invoice', entityType: 'invoice', entityId: '50', actorUserId: '42' });
        expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
    });

    it('execute: valida COM A CHAVE DO USUÁRIO (RBAC real)', async () => {
        const link = buildConfirmDeeplink('validate_invoice', { invoice_id: '50' }, '42');
        const r = await executeConfirm(tokenFrom(link), 'user-key-xyz');
        expect(r).toMatchObject({ ok: true, action: 'validate_invoice' });
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledWith('50', 'user-key-xyz');
    });

    it('anti-replay: a MESMA confirmação não executa 2x', async () => {
        const link = buildConfirmDeeplink('validate_order', { order_id: '11' }, '42');
        const t = tokenFrom(link);
        expect((await executeConfirm(t, 'k')).ok).toBe(true);
        const r2 = await executeConfirm(t, 'k');
        expect(r2).toMatchObject({ ok: false });
        expect((r2 as any).error).toMatch(/já foi usada/i);
        expect(mockDolibarr.validateOrder).toHaveBeenCalledTimes(1);
    });

    it('token inválido/adulterado → erro, não executa nem descreve', async () => {
        expect((await executeConfirm('lixo.assinatura', 'k')).ok).toBe(false);
        expect(describeConfirm('lixo.assinatura').ok).toBe(false);
        expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
    });

    it('erro real na execução (ex.: RBAC 403) LIBERA o jti p/ nova tentativa', async () => {
        mockDolibarr.validateProposal.mockRejectedValueOnce(new Error('403 Forbidden'));
        const link = buildConfirmDeeplink('validate_proposal', { proposal_id: '3' }, '42');
        const t = tokenFrom(link);
        const r1 = await executeConfirm(t, 'k');
        expect(r1.ok).toBe(false);
        mockDolibarr.validateProposal.mockResolvedValueOnce({ id: '3' });
        const r2 = await executeConfirm(t, 'k'); // pode re-tentar (não consumiu no erro)
        expect(r2.ok).toBe(true);
    });
});
