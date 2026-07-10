import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fase A / A2: os validate_* passam a escopar por cliente (restrictedCustomers) buscando o socid
// da entidade (o id do cliente NÃO vem nos args). Fail-closed quando não confirma o cliente.
const mockDolibarr = vi.hoisted(() => ({
    getInvoice: vi.fn(),
    getOrder: vi.fn(),
    getProposal: vi.fn(),
    validateInvoice: vi.fn(async () => ({ id: '1', status: 'validated' })),
    validateOrder: vi.fn(async () => ({ id: '1', status: 'validated' })),
    validateProposal: vi.fn(async () => ({ id: '1', status: 'validated' })),
}));

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-validatescope' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, runWithToolContext } from '../../services/agentTools';

function profileWith(agentOverrides: Record<string, any>) {
    return {
        role: 'test', dolibarrModules: {}, frontendScreens: {},
        agent: {
            canCreate: [], canEdit: [], canValidate: ['invoice', 'order', 'proposal'], canDelete: [],
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

describe('agentTools — escopo de cliente nos validate_* (Fase A / A2)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('bloqueia validate_invoice quando o cliente da fatura está FORA da allowlist (não valida)', async () => {
        mockDolibarr.getInvoice.mockResolvedValue({ id: '50', socid: '9' });
        const out = await runWithToolContext(
            { permissionProfile: profileWith({ restrictedCustomers: ['5'] }), isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '50' }),
        );
        expect(out).toMatch(/allowlist/i);
        expect(mockDolibarr.getInvoice).toHaveBeenCalledWith('50');
        expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
    });

    it('permite validate_invoice quando o cliente está DENTRO da allowlist', async () => {
        mockDolibarr.getInvoice.mockResolvedValue({ id: '50', socid: '5' });
        await runWithToolContext(
            { permissionProfile: profileWith({ restrictedCustomers: ['5'] }), isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '50' }),
        );
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledWith('50');
    });

    it('fail-closed: bloqueia se a entidade não for encontrada (socid indeterminado)', async () => {
        mockDolibarr.getInvoice.mockResolvedValue(null);
        const out = await runWithToolContext(
            { permissionProfile: profileWith({ restrictedCustomers: ['5'] }), isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '999' }),
        );
        expect(out).toMatch(/allowlist|desconhecido/i);
        expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
    });

    it('validate_order usa getOrder e o fk_soc da entidade', async () => {
        mockDolibarr.getOrder.mockResolvedValue({ id: '11', fk_soc: '7' });
        await runWithToolContext(
            { permissionProfile: profileWith({ restrictedCustomers: ['7'] }), isAdmin: false },
            () => executeTool('validate_order', { order_id: '11' }),
        );
        expect(mockDolibarr.getOrder).toHaveBeenCalledWith('11');
        expect(mockDolibarr.validateOrder).toHaveBeenCalledWith('11');
    });

    it('validate_proposal usa o getter novo getProposal e bloqueia fora da allowlist', async () => {
        mockDolibarr.getProposal.mockResolvedValue({ id: '3', socid: '99' });
        const out = await runWithToolContext(
            { permissionProfile: profileWith({ restrictedCustomers: ['5'] }), isAdmin: false },
            () => executeTool('validate_proposal', { proposal_id: '3' }),
        );
        expect(out).toMatch(/allowlist/i);
        expect(mockDolibarr.getProposal).toHaveBeenCalledWith('3');
        expect(mockDolibarr.validateProposal).not.toHaveBeenCalled();
    });

    it('sem allowlist (default): NÃO busca a entidade e valida direto (sem custo extra)', async () => {
        await runWithToolContext(
            { permissionProfile: profileWith({ restrictedCustomers: [] }), isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '50' }),
        );
        expect(mockDolibarr.getInvoice).not.toHaveBeenCalled();
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledWith('50');
    });

    it('admin ignora o escopo (não passa pelo bloco de caps)', async () => {
        await runWithToolContext(
            { permissionProfile: profileWith({ restrictedCustomers: ['999'] }), isAdmin: true },
            () => executeTool('validate_invoice', { invoice_id: '50' }),
        );
        expect(mockDolibarr.getInvoice).not.toHaveBeenCalled();
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledWith('50');
    });
});
