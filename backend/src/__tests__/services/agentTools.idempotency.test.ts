import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ORÁCULO do bug PROVADO no red-team 2026-07-17: uma tool de ESCRITA re-invocada no mesmo turno
// (retryWithBackoff do botService após throw pós-escrita; re-emissão de evento; fallback de provider)
// executava o efeito REAL mais de uma vez → fatura/validação DUPLICADA. A guarda de idempotência em
// executeTool (chaveada por ctx.turnId) impõe o contrato: uma escrita roda NO MÁXIMO 1× por turno.
const mockUiConfig = vi.hoisted(() => ({
    get: vi.fn(() => ({ actionGovernance: { irreversibleRequiresApproval: false, adminBypassIrreversible: true } } as any)),
}));
const mockDolibarr = vi.hoisted(() => ({
    validateInvoice: vi.fn(async () => ({ id: '1', ref: 'FA-1', status: 'validated' })),
    validateProposal: vi.fn(async () => ({ id: '1' })),
    getInvoices: vi.fn(async () => []),
}));
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-idem' } }));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

// "Disco" em memória para exercitar a persistência (restart) — o setup global mocka fs por completo.
const fakeDisk = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock('fs', async (importActual) => {
    const actual = await importActual<typeof import('fs')>();
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: (p: any) => fakeDisk.files.has(String(p)) || actual.existsSync(p),
            readFileSync: ((p: any, enc: any) => fakeDisk.files.has(String(p)) ? fakeDisk.files.get(String(p))! : actual.readFileSync(p, enc)) as any,
            unlinkSync: ((p: any) => { fakeDisk.files.delete(String(p)); }) as any,
        },
        existsSync: (p: any) => fakeDisk.files.has(String(p)),
        readFileSync: ((p: any, enc: any) => fakeDisk.files.has(String(p)) ? fakeDisk.files.get(String(p))! : '{}') as any,
        unlinkSync: ((p: any) => { fakeDisk.files.delete(String(p)); }) as any,
    };
});
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn((p: string, data: any) => { fakeDisk.files.set(String(p), JSON.stringify(data)); }),
}));

import { executeTool, runWithToolContext } from '../../services/agentTools';
import { __clearWriteIdempotencyForTests, __reloadWriteIdempotencyForTests } from '../../utils/writeIdempotency';

function profile(canValidate: string[]) {
    return {
        role: 't', dolibarrModules: {}, frontendScreens: {},
        agent: {
            canCreate: [], canEdit: [], canValidate, canDelete: [],
            canSendEmail: false, canSendWhatsapp: false, canAccessFinancial: false, canAccessAccounting: false,
            canAccessHR: false, canManageWebhooks: false, canCreateIssues: false, canStartTasks: false, canMergePRs: false,
            maxInvoiceAmount: null, maxOrderAmount: null, restrictedCustomers: [], restrictedProjects: [],
        },
        computedAt: 'now',
    } as any;
}

describe('agentTools — idempotência de escrita por turno (ctx.turnId)', () => {
    beforeEach(() => { vi.clearAllMocks(); fakeDisk.files.clear(); __clearWriteIdempotencyForTests(); });
    afterAll(() => { fakeDisk.files.clear(); __clearWriteIdempotencyForTests(); });

    it('MESMO turno: validate_invoice chamado 2× → escrita REAL roda 1× (cobre o bug do retry)', async () => {
        const ctx = { permissionProfile: profile(['invoice']), isAdmin: false, turnId: 'msg_ABC' };
        const out1 = await runWithToolContext(ctx, () => executeTool('validate_invoice', { invoice_id: '50' }));
        const out2 = await runWithToolContext(ctx, () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledTimes(1);      // efeito real UMA vez
        expect(out2).toBe(out1);                                            // 2ª devolve o resultado anterior
    });

    it('turnos DIFERENTES: executa em cada turno (não deduplica pedidos legítimos distintos)', async () => {
        await runWithToolContext({ permissionProfile: profile(['invoice']), isAdmin: false, turnId: 'msg_1' },
            () => executeTool('validate_invoice', { invoice_id: '50' }));
        await runWithToolContext({ permissionProfile: profile(['invoice']), isAdmin: false, turnId: 'msg_2' },
            () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledTimes(2);
    });

    it('ARGS diferentes no mesmo turno: chaves distintas → cada escrita executa', async () => {
        const base = { permissionProfile: profile(['invoice']), isAdmin: false, turnId: 'msg_X' };
        await runWithToolContext(base, () => executeTool('validate_invoice', { invoice_id: '50' }));
        await runWithToolContext(base, () => executeTool('validate_invoice', { invoice_id: '51' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledTimes(2);
    });

    it('SEM turnId (ex.: webapp): comportamento inalterado — executa toda vez', async () => {
        const ctx = { permissionProfile: profile(['invoice']), isAdmin: false }; // sem turnId
        await runWithToolContext(ctx, () => executeTool('validate_invoice', { invoice_id: '50' }));
        await runWithToolContext(ctx, () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledTimes(2);
    });

    it('erro do Dolibarr no MESMO turno: escrita ainda roda no máximo 1× (at-most-once por turno)', async () => {
        // Contrato: uma escrita que COMPLETA (sucesso OU erro tratado) roda 1×/turno. Re-tentar um erro
        // acontece num NOVO turno (msg nova = turnId novo), nunca dobra o efeito no mesmo turno.
        mockDolibarr.validateInvoice.mockRejectedValue(new Error('HTTP 500'));
        const ctx = { permissionProfile: profile(['invoice']), isAdmin: false, turnId: 'msg_ERR' };
        const out1 = await runWithToolContext(ctx, () => executeTool('validate_invoice', { invoice_id: '50' }));
        const out2 = await runWithToolContext(ctx, () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(out1).toMatch(/Erro ao validar/);
        expect(out2).toBe(out1);
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledTimes(1);
    });

    it('persiste entre "restarts": após reload do store, a escrita anterior ainda é reconhecida', async () => {
        const ctx = { permissionProfile: profile(['invoice']), isAdmin: false, turnId: 'msg_RESTART' };
        await runWithToolContext(ctx, () => executeTool('validate_invoice', { invoice_id: '77' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledTimes(1);
        __reloadWriteIdempotencyForTests(); // simula restart do processo (recarrega do "disco")
        await runWithToolContext(ctx, () => executeTool('validate_invoice', { invoice_id: '77' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledTimes(1); // ainda 1× — resiste a restart
    });
});
