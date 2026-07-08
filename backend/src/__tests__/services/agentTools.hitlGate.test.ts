import { describe, it, expect, vi, beforeEach } from 'vitest';

// Gate HITL no executeTool: com o dial ligado, validate_* NÃO executa — devolve o deeplink de
// confirmação. DORMENTE por default (irreversibleRequiresApproval=false). adminBypass isenta admin.
const mockUiConfig = vi.hoisted(() => ({
    get: vi.fn(() => ({ actionGovernance: { irreversibleRequiresApproval: false, adminBypassIrreversible: true } } as any)),
}));
const mockDolibarr = vi.hoisted(() => ({
    validateInvoice: vi.fn(async () => ({ id: '1' })),
    validateOrder: vi.fn(async () => ({ id: '1' })),
    validateProposal: vi.fn(async () => ({ id: '1' })),
}));
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-hitlgate' } }));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, runWithToolContext } from '../../services/agentTools';

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
const govOff = { actionGovernance: { irreversibleRequiresApproval: false, adminBypassIrreversible: true } };
const govOnBypass = { actionGovernance: { irreversibleRequiresApproval: true, adminBypassIrreversible: true } };
const govOnNoBypass = { actionGovernance: { irreversibleRequiresApproval: true, adminBypassIrreversible: false } };

describe('agentTools — gate HITL de validate_* (dial-driven, dormente)', () => {
    beforeEach(() => { vi.clearAllMocks(); mockUiConfig.get.mockReturnValue(govOff as any); });

    it('dial OFF (default): validate_invoice executa como hoje (sem deeplink)', async () => {
        const out = await runWithToolContext({ permissionProfile: profile(['invoice']), isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledWith('50');
        expect(out).not.toMatch(/confirm-action/);
    });

    it('dial ON + não-admin: NÃO executa, devolve deeplink de confirmação', async () => {
        mockUiConfig.get.mockReturnValue(govOnBypass as any);
        const out = await runWithToolContext({ permissionProfile: profile(['invoice']), isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
        expect(out).toMatch(/\/confirm-action\?token=/);
    });

    it('dial ON + admin + adminBypass ON: admin executa direto (isento)', async () => {
        mockUiConfig.get.mockReturnValue(govOnBypass as any);
        await runWithToolContext({ permissionProfile: profile(['invoice']), isAdmin: true },
            () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledWith('50');
    });

    it('dial ON + admin + adminBypass OFF: admin TAMBÉM é gateado', async () => {
        mockUiConfig.get.mockReturnValue(govOnNoBypass as any);
        const out = await runWithToolContext({ permissionProfile: profile(['invoice']), isAdmin: true },
            () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
        expect(out).toMatch(/confirm-action/);
    });
});
