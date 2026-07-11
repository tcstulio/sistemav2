import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-confirm-abc' } }));
const mockDolibarr = vi.hoisted(() => ({
    validateInvoice: vi.fn(async (id: string, key: string) => ({ id, validatedWith: key })),
    validateOrder: vi.fn(async (id: string, key: string) => ({ id, validatedWith: key })),
    validateProposal: vi.fn(async (id: string, key: string) => ({ id, validatedWith: key })),
}));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));

// Persistência do anti-replay (Fase 1): intercepta o "disco" num objeto em memória, para os
// testes de restart não dependerem do filesystem real nem sujarem backend/data.
const fakeDisk = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock('fs', async (importActual) => {
    const actual = await importActual<typeof import('fs')>();
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: (p: any) => fakeDisk.files.has(String(p)) || actual.existsSync(p),
            readFileSync: ((p: any, enc: any) => fakeDisk.files.has(String(p)) ? fakeDisk.files.get(String(p))! : actual.readFileSync(p, enc)) as any,
        },
    };
});
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn((p: string, data: any) => { fakeDisk.files.set(String(p), JSON.stringify(data)); }),
}));

import { isConfirmable, buildConfirmDeeplink, describeConfirm, executeConfirm, __reloadConsumedForTests } from '../../services/agentActionConfirm';

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

describe('anti-replay PERSISTIDO (Fase 1 — sobrevive a restart)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fakeDisk.files.clear();
        __reloadConsumedForTests();
    });

    it('replay após RESTART é bloqueado (o furo da versão em memória)', async () => {
        const link = buildConfirmDeeplink('validate_invoice', { invoice_id: '77' }, '42');
        const t = tokenFrom(link);
        expect((await executeConfirm(t, 'k')).ok).toBe(true);

        __reloadConsumedForTests(); // "restart": Map zerado, recarrega SÓ do disco

        const replay = await executeConfirm(t, 'k');
        expect(replay).toMatchObject({ ok: false });
        expect((replay as any).error).toMatch(/já foi usada/i);
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledTimes(1);
    });

    it('erro na execução NÃO deixa o jti consumido nem no disco (retry sobrevive a restart)', async () => {
        mockDolibarr.validateOrder.mockRejectedValueOnce(new Error('500'));
        const link = buildConfirmDeeplink('validate_order', { order_id: '9' }, '42');
        const t = tokenFrom(link);
        expect((await executeConfirm(t, 'k')).ok).toBe(false);

        __reloadConsumedForTests();

        mockDolibarr.validateOrder.mockResolvedValueOnce({ id: '9' });
        expect((await executeConfirm(t, 'k')).ok).toBe(true);
    });

    it('entradas EXPIRADAS são varridas do disco no cleanup (arquivo se auto-limita)', async () => {
        // Consome 1 confirmação → vai pro disco.
        const link = buildConfirmDeeplink('validate_invoice', { invoice_id: '5' }, '42');
        const t = tokenFrom(link);
        expect((await executeConfirm(t, 'k')).ok).toBe(true);
        const diskPath = [...fakeDisk.files.keys()][0];
        expect(diskPath).toBeTruthy();

        // Injeta no disco um jti já expirado ao lado do válido e "reinicia".
        const current = JSON.parse(fakeDisk.files.get(diskPath)!);
        const now = Math.floor(Date.now() / 1000);
        fakeDisk.files.set(diskPath, JSON.stringify({ ...current, jti_expirado: now - 10 }));
        __reloadConsumedForTests();

        // O válido continua bloqueado (recarregado do disco); o expirado foi FILTRADO no load.
        expect((await executeConfirm(t, 'k')).ok).toBe(false);

        // Na PRÓXIMA escrita (nova confirmação), o arquivo é reescrito sem o expirado.
        const link2 = buildConfirmDeeplink('validate_order', { order_id: '6' }, '42');
        expect((await executeConfirm(tokenFrom(link2), 'k')).ok).toBe(true);
        const after = JSON.parse(fakeDisk.files.get(diskPath)!);
        expect(after.jti_expirado).toBeUndefined();
        expect(Object.keys(after).length).toBe(2); // o do invoice '5' + o do order '6'
    });

    it('falha de persistência NÃO quebra a execução (fallback = memória, logado)', async () => {
        const { atomicWriteSync } = await import('../../utils/atomicWrite');
        vi.mocked(atomicWriteSync).mockImplementationOnce(() => { throw new Error('EPERM'); });
        const link = buildConfirmDeeplink('validate_proposal', { proposal_id: '8' }, '42');
        const r = await executeConfirm(tokenFrom(link), 'k');
        expect(r.ok).toBe(true); // ação executou; só a persistência falhou (logada)
    });
});
