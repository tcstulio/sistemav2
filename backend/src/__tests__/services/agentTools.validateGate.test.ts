import { describe, it, expect, vi, beforeEach } from 'vitest';

// Gate de permissão por ENTIDADE nos validate_*: o array canValidate nunca era enforçado
// (`![]` é sempre false e getEntityFromTool só cobre prepare_create_/prepare_edit_). Sem o gate,
// um não-admin (o agente é aberto a qualquer logado) validava qualquer fatura/pedido/proposta.
const mockDolibarr = vi.hoisted(() => ({
    validateInvoice: vi.fn(async () => ({ id: '1', status: 'validated' })),
    validateOrder: vi.fn(async () => ({ id: '1', status: 'validated' })),
    validateProposal: vi.fn(async () => ({ id: '1', status: 'validated' })),
}));

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-validategate' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, runWithToolContext } from '../../services/agentTools';

function profileWith(agentOverrides: Record<string, any>) {
    return {
        role: 'test', dolibarrModules: {}, frontendScreens: {},
        agent: {
            canCreate: [], canEdit: [], canValidate: [], canDelete: [],
            canSendEmail: false, canSendWhatsapp: false, canAccessFinancial: false,
            canAccessAccounting: false, canAccessHR: false, canManageWebhooks: false,
            canCreateIssues: false, canStartTasks: false, canMergePRs: false,
            maxInvoiceAmount: null, maxOrderAmount: null,
            restrictedCustomers: [], restrictedProjects: [],
            ...agentOverrides,
        },
        computedAt: 'now',
    } as any;
}

describe('agentTools — gate de permissão nos validate_* (canValidate por entidade)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('não-admin com canValidate=[] é BLOQUEADO (não valida)', async () => {
        const out = await runWithToolContext(
            { permissionProfile: profileWith({ canValidate: [] }), isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '50' }),
        );
        expect(out).toMatch(/permissão para validar/i);
        expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
    });

    it('não-admin com canValidate=["invoice"] PODE validar fatura', async () => {
        await runWithToolContext(
            { permissionProfile: profileWith({ canValidate: ['invoice'] }), isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '50' }),
        );
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledWith('50');
    });

    it('canValidate=["invoice"] NÃO habilita pedido (escopo por entidade)', async () => {
        const out = await runWithToolContext(
            { permissionProfile: profileWith({ canValidate: ['invoice'] }), isAdmin: false },
            () => executeTool('validate_order', { order_id: '11' }),
        );
        expect(out).toMatch(/permissão para validar/i);
        expect(mockDolibarr.validateOrder).not.toHaveBeenCalled();
    });

    it('admin ignora o gate (valida)', async () => {
        await runWithToolContext(
            { permissionProfile: profileWith({ canValidate: [] }), isAdmin: true },
            () => executeTool('validate_proposal', { proposal_id: '3' }),
        );
        expect(mockDolibarr.validateProposal).toHaveBeenCalledWith('3');
    });

    it('canValidate=["all"] habilita qualquer entidade', async () => {
        await runWithToolContext(
            { permissionProfile: profileWith({ canValidate: ['all'] }), isAdmin: false },
            () => executeTool('validate_order', { order_id: '11' }),
        );
        expect(mockDolibarr.validateOrder).toHaveBeenCalledWith('11');
    });
});
