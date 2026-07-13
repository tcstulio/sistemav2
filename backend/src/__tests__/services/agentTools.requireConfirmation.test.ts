/**
 * #1397 (Dial 4) — ENFORCEMENT TEST: o admin lista tools em `requireConfirmationFor` e o motor
 * DESVIA essas tools p/ HITL (deeplink de confirmação). Antes o método `requiresConfirmation()`
 * existia mas NUNCA era chamado (config-teatro da auditoria #1124).
 *
 * Regra de aceite (issue #1397): cada item só fecha com teste de enforcement — mudar o dial MUDA
 * o comportamento observável.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-1397-dial4' } }));

const mockDolibarr = vi.hoisted(() => ({
    getInvoice: vi.fn(),
    getOrder: vi.fn(),
    getProposal: vi.fn(),
    validateInvoice: vi.fn(),
    validateOrder: vi.fn(),
    validateProposal: vi.fn(),
    getUserById: vi.fn(),
}));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));

// #1397 — dial 4: agentConfigService.requiresConfirmation retorna o que o admin configurou.
const mockAgentConfig = vi.hoisted(() => ({
    isToolBlocked: vi.fn(() => false),
    requiresConfirmation: vi.fn(() => false),
}));
vi.mock('../../services/agentConfigService', () => ({ agentConfigService: mockAgentConfig }));

vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));
vi.mock('../../services/legacy/messageService', () => ({ messageService: { sendText: vi.fn(), sendFile: vi.fn(), sendVoice: vi.fn() } }));
vi.mock('../../services/legacy/sessionService', () => ({ sessionService: { getStatus: vi.fn(() => 'STOPPED'), getFirstWorkingSessionId: vi.fn(() => undefined) } }));
vi.mock('../../services/moltbotGateway', () => ({ moltbotGateway: { sendMessage: vi.fn(), sendFile: vi.fn(), sendVoice: vi.fn() } }));
vi.mock('../../services/emailService', () => ({ emailService: { sendEmail: vi.fn() } }));

// uiConfigService — defaults seguros (governança desligada → não bloqueia por valor).
const mockUiConfig = vi.hoisted(() => ({
    get: vi.fn(() => ({
        actionGovernance: {
            irreversibleRequiresApproval: false,
            adminBypassIrreversible: true,
            approvalValueThreshold: null,
            whatsappDestinationAllowlist: [],
            businessActionsEnabled: true,
        },
    })),
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));

vi.mock('../../config/features', () => ({
    FEATURES: { WHATSAPP_PROVIDER: 'legacy', MOLTBOT_ENABLED: false, DRY_RUN_MODE: false },
    isUsingMoltbot: vi.fn(() => false),
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { executeTool, runWithToolContext } from '../../services/agentTools';

describe('Dial 4 — agentConfig.requireConfirmationFor (#1397)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAgentConfig.isToolBlocked.mockReturnValue(false);
        // default: nenhuma tool exige confirmação (preserva os outros testes)
        mockAgentConfig.requiresConfirmation.mockReturnValue(false);
        mockUiConfig.get.mockReturnValue({
            actionGovernance: {
                irreversibleRequiresApproval: false,
                adminBypassIrreversible: true,
                approvalValueThreshold: null,
                whatsappDestinationAllowlist: [],
                businessActionsEnabled: true,
            },
        });
        mockDolibarr.validateInvoice.mockResolvedValue({ ok: true });
        mockDolibarr.validateOrder.mockResolvedValue({ ok: true });
        mockDolibarr.validateProposal.mockResolvedValue({ ok: true });
    });

    it('tool NÃO em requireConfirmationFor → executa normalmente (validate_invoice chama Dolibarr)', async () => {
        mockAgentConfig.requiresConfirmation.mockReturnValue(false);
        mockDolibarr.getInvoice.mockResolvedValue({ id: '50', socid: '100' });

        await runWithToolContext({ userId: 'u1' }, async () => {
            const result = await executeTool('validate_invoice', { invoice_id: '50' });
            // Se HITL tivesse desviado, o resultado seria a string do deeplink. Executou normal:
            // o retorno vem do dolibarrService.validateInvoice (string amigável), não a HITL.
            expect(result).toMatch(/validada/i);
            expect(result).not.toMatch(/CONFIRMAÇÃO HUMANA/);
            // valida que Dolibarr foi chamado com o id correto (segundo arg = chave API do user
            // ou do sistema, não vamos cravar o valor — basta o 1º arg)
            expect(mockDolibarr.validateInvoice).toHaveBeenCalled();
            expect(mockDolibarr.validateInvoice.mock.calls[0][0]).toBe('50');
        });
    });

    it('tool em requireConfirmationFor → desvia p/ HITL (NÃO chama Dolibarr)', async () => {
        mockAgentConfig.requiresConfirmation.mockImplementation((tool: string) => tool === 'validate_invoice');

        await runWithToolContext({ userId: 'u1' }, async () => {
            const result = await executeTool('validate_invoice', { invoice_id: '50' });
            expect(result).toMatch(/CONFIRMAÇÃO HUMANA/);
            expect(result).toMatch(/requireConfirmationFor/);
            // CRÍTICO: Dolibarr NÃO foi chamado (a ação está pausada aguardando humano)
            expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
        });
    });

    it('tool NÃO confirmável mesmo em requireConfirmationFor → executa normal (sem deeplink)', async () => {
        // 'list_invoices' NÃO está no registry HITL. Mesmo se o admin configurasse por engano,
        // o gate só desvia actions no REGISTRY (validate_*, delete_proposal, send_whatsapp).
        mockAgentConfig.requiresConfirmation.mockReturnValue(true);
        mockDolibarr.listInvoices = vi.fn().mockResolvedValue([]);

        await runWithToolContext({ userId: 'u1' }, async () => {
            const result = await executeTool('list_invoices', { status: 'unpaid', limit: 10 });
            expect(result).not.toMatch(/CONFIRMAÇÃO HUMANA/);
            // list_invoices devolve HTML — apenas garante que não veio o deeplink.
        });
    });

    it('Mudança do dial MUDA o comportamento observável (enforcement core da issue)', async () => {
        mockDolibarr.getInvoice.mockResolvedValue({ id: '50', socid: '100' });

        await runWithToolContext({ userId: 'u1' }, async () => {
            // dial OFF (default) → executa direto
            mockAgentConfig.requiresConfirmation.mockReturnValue(false);
            const rOff = await executeTool('validate_invoice', { invoice_id: '50' });
            expect(mockDolibarr.validateInvoice).toHaveBeenCalledTimes(1);
            expect(rOff).not.toMatch(/CONFIRMAÇÃO HUMANA/);

            // dial ON → desvia p/ HITL
            vi.clearAllMocks();
            mockAgentConfig.isToolBlocked.mockReturnValue(false);
            mockAgentConfig.requiresConfirmation.mockReturnValue(true);
            mockDolibarr.getInvoice.mockResolvedValue({ id: '50', socid: '100' });
            const rOn = await executeTool('validate_invoice', { invoice_id: '50' });
            expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
            expect(rOn).toMatch(/CONFIRMAÇÃO HUMANA/);
        });
    });
});