import { describe, it, expect, vi } from 'vitest';

// F0.1/F0.3 (#1234): a trilha do agente passa a tagear domain/reversibility (do catálogo) +
// requestedVia. Mockamos só o socket (emit) — o resto (append/save no data/ do worktree) é inócuo.
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));

import { agentActivityService } from '../../services/agentActivityService';

describe('agentActivityService — trilha enriquecida (F0.1/F0.3)', () => {
    it('tagueia domain/reversibility do catálogo + requestedVia informado', () => {
        const a = agentActivityService.record({
            userId: '42', userName: 'Fulano', tool: 'validate_invoice', args: { invoice_id: '5' }, requestedVia: 'chat',
        });
        expect(a).toMatchObject({ domain: 'business', reversibility: 'irreversible', requestedVia: 'chat' });
    });

    it('leitura fica read/read e requestedVia default = unknown', () => {
        const a = agentActivityService.record({ userId: '1', userName: 'Y', tool: 'list_invoices' });
        expect(a).toMatchObject({ domain: 'read', reversibility: 'read', requestedVia: 'unknown' });
    });

    it('prepare_* (deeplink) fica reversível (não irreversível)', () => {
        const a = agentActivityService.record({ userId: '1', userName: 'Y', tool: 'prepare_create_proposal', args: { socid: '5' }, requestedVia: 'chat' });
        expect(a.reversibility).toBe('reversible');
    });
});
