import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1514: usuário LOGADO cujo perfil de permissões FALHOU a carregar (Dolibarr instável / id não
// resolvido) NÃO pode escrever sem checagem. Como readOnly é falsy no webapp, a trava readOnly não
// pega — a flag ctx.profileLoadFailed é o sinal fail-closed. Distinto de "sem perfil por ser contexto
// público" (esse é o legítimo — prepare_*/leitura seguem funcionando, contrato dos testes de gate).
const mockUiConfig = vi.hoisted(() => ({
    get: vi.fn(() => ({ actionGovernance: { irreversibleRequiresApproval: false, adminBypassIrreversible: true } } as any)),
}));
const mockDolibarr = vi.hoisted(() => ({
    validateInvoice: vi.fn(async () => ({ id: '1' })),
    getInvoices: vi.fn(async () => []),
}));
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-1514' } }));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, runWithToolContext } from '../../services/agentTools';

describe('agentTools — #1514 perfil falhou a carregar (fail-closed p/ escrita)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('perfil falhou + não-admin: ESCRITA irreversível (validate_invoice) é NEGADA', async () => {
        const out = await runWithToolContext({ profileLoadFailed: true, isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(out).toMatch(/não foi possível verificar suas permissões|perfil não carregou/i);
        expect(mockDolibarr.validateInvoice).not.toHaveBeenCalled();
    });

    it('perfil falhou + não-admin: prepare_* (deeplink, escrita real só no confirm) é PERMITIDO', async () => {
        const out = await runWithToolContext({ profileLoadFailed: true, isAdmin: false },
            () => executeTool('prepare_create_proposal', { socid: '7', lines: [] }).catch(e => String(e)));
        // Não deve cair na mensagem de "perfil não carregou" — o prepare_ é isento (gera deeplink).
        expect(out).not.toMatch(/perfil não carregou|não foi possível verificar suas permissões/i);
    });

    it('perfil falhou + não-admin: LEITURA segue permitida (não é escrita)', async () => {
        const out = await runWithToolContext({ profileLoadFailed: true, isAdmin: false },
            () => executeTool('list_invoices', {}).catch(e => String(e)));
        expect(out).not.toMatch(/perfil não carregou|não foi possível verificar suas permissões/i);
    });

    it('perfil falhou + ADMIN: admin escreve (isAdmin independe do perfil)', async () => {
        await runWithToolContext({ profileLoadFailed: true, isAdmin: true },
            () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledWith('50');
    });

    it('perfil NÃO falhou (contexto confiável legítimo sem perfil): comportamento inalterado — executa', async () => {
        // profileLoadFailed ausente/false = o caso legítimo (system/contrato). Sem a flag, a trava
        // não pega; validate_invoice executa como hoje (é o que os 81 testes de contrato asseguram).
        await runWithToolContext({ isAdmin: false },
            () => executeTool('validate_invoice', { invoice_id: '50' }));
        expect(mockDolibarr.validateInvoice).toHaveBeenCalledWith('50');
    });
});
