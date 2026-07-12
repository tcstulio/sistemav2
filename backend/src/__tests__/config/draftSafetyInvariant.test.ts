import { describe, it, expect } from 'vitest';
import { ACTION_OVERRIDES } from '../../config/actionCatalog';
import { isConfirmable } from '../../services/agentActionConfirm';

/**
 * INVARIANTE de draft-safety (pivô rascunho-seguro, Etapa 2 P3):
 * toda tool de NEGÓCIO classificada como irreversível + requiresHITL DEVE ser confirmável
 * (estar no REGISTRY de agentActionConfirm) — senão o gate HITL (que desvia por isConfirmable,
 * não por classifyTool.requiresHITL) NÃO a pega e ela executaria direto.
 *
 * O domínio CÓDIGO (start_opencode_task/merge_opencode_task) está EXCLUÍDO de propósito: eles
 * são requiresHITL mas não-confirmáveis hoje — gap real rastreado na issue #1389, fora do escopo
 * de negócio. Este teste guarda a fronteira de NEGÓCIO e falha se alguém adicionar uma ação de
 * negócio irreversível sem gatear.
 */
describe('draft-safety: toda ação de NEGÓCIO irreversível é gated (HITL)', () => {
    const businessIrreversible = Object.entries(ACTION_OVERRIDES)
        .filter(([, c]) => c.domain === 'business' && c.reversibility === 'irreversible' && c.requiresHITL)
        .map(([tool]) => tool);

    it('há ações de negócio irreversíveis classificadas (sanity)', () => {
        expect(businessIrreversible.length).toBeGreaterThanOrEqual(5); // validate_invoice/order/proposal + delete_proposal + send_whatsapp
        expect(businessIrreversible).toContain('delete_proposal');
    });

    it.each(businessIrreversible)('%s é confirmável (no REGISTRY do HITL)', (tool) => {
        expect(isConfirmable(tool)).toBe(true);
    });

    it('nenhuma ação de negócio irreversível fura o gate (invariante)', () => {
        const furos = businessIrreversible.filter((t) => !isConfirmable(t));
        expect(furos).toEqual([]);
    });
});
