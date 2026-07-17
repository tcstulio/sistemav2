import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-deny-internal' } }));
// Leituras internas mockadas p/ retornar VAZIO: assim, QUANDO o gate permite, o dispatch roda e
// devolve "Nenhum … encontrado" — nunca a mensagem de negação. Se o gate bloquear, nem chega aqui.
vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {
        listUsers: vi.fn(async () => []),
        listBankAccounts: vi.fn(async () => []),
    },
}));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, runWithToolContext } from '../../services/agentTools';

// #segurança (decisão do dono 2026-07-17: "nada de dado interno"): remetente NÃO identificado no
// WhatsApp (readOnly=true, SEM permissionProfile — cliente OU desconhecido) não pode rodar NENHUMA
// tool de leitura de dado interno. O contexto do próprio cliente já vem no prompt via CRM.
const DENY = 'não está disponível neste contexto';

describe('agentTools — remetente NÃO identificado (readOnly sem perfil) não lê dado interno', () => {
    // reads que expõem dado interno: usuários, banco, PII de cliente, RH, financeiro
    const internalReads = [
        'list_users',
        'list_bank_accounts',
        'get_customer_details',
        'list_leave_requests',
        'get_financial_summary',
    ];

    for (const tool of internalReads) {
        it(`nega leitura interna: ${tool}`, async () => {
            const result = await runWithToolContext({ readOnly: true }, () => executeTool(tool, {}));
            expect(result).toContain(DENY);
            // É o gate de DADO INTERNO, não o de escrita — a mensagem de escrita traz "(somente leitura)".
            expect(result).not.toContain('somente leitura');
        });
    }

    it('funcionário ELEVADO (readOnly=false + perfil) NÃO é bloqueado pelo gate de dado interno', async () => {
        const profile = { role: 'user', agent: { canCreate: [], canEdit: [], canValidate: [], canDelete: [] } };
        const result = await runWithToolContext(
            { readOnly: false, userId: '7', permissionProfile: profile as any },
            () => executeTool('list_users', {}),
        );
        expect(result).not.toContain(DENY);
    });

    it('ADMIN (readOnly ausente/falsy, isAdmin) NÃO é bloqueado', async () => {
        const result = await runWithToolContext({ isAdmin: true }, () => executeTool('list_users', {}));
        expect(result).not.toContain(DENY);
    });

    it('webapp normal (readOnly ausente, sem perfil) NÃO é bloqueado — o gate só atua em readOnly', async () => {
        const result = await runWithToolContext({}, () => executeTool('list_users', {}));
        expect(result).not.toContain(DENY);
    });
});
