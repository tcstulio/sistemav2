import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-unknown-tool' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool } from '../../services/agentTools';

describe('agentTools — ferramenta inexistente LANÇA p/ auto-correção (#1355)', () => {
    it('prepare_validate_proposal (o caso real) LANÇA UnknownToolError, não retorna string', async () => {
        // Antes: retornava "Ferramenta desconhecida" e o startsWith(prepare_) cuspia na tela.
        await expect(executeTool('prepare_validate_proposal', { proposal_id: '303' }))
            .rejects.toMatchObject({ name: 'UnknownToolError' });
    });

    it('a mensagem SUGERE a ferramenta correta (validate_proposal) p/ o modelo corrigir', async () => {
        try {
            await executeTool('prepare_validate_proposal', { proposal_id: '303' });
            throw new Error('deveria ter lançado');
        } catch (e: any) {
            expect(e.name).toBe('UnknownToolError');
            expect(e.message).toMatch(/validate_proposal/);
            expect(e.message).toMatch(/não existe/i);
            // instrui a agir agora (não deixa o modelo "anunciar e parar")
            expect(e.message).toMatch(/JSON|agora/i);
        }
    });

    it('sugestão por RAIZ SEMÂNTICA cobre variações (approve/confirm), não só 1 alias', async () => {
        for (const bad of ['approve_proposal', 'confirm_proposal', 'validar_proposta', 'finalize_proposal']) {
            await expect(executeTool(bad, { id: '1' })).rejects.toMatchObject({ name: 'UnknownToolError' });
            try { await executeTool(bad, { id: '1' }); } catch (e: any) {
                expect(e.message).toMatch(/validate_proposal/);
            }
        }
    });

    it('valida invoice/order pela entidade certa', async () => {
        try { await executeTool('prepare_validate_invoice', { id: '1' }); } catch (e: any) {
            expect(e.message).toMatch(/validate_invoice/);
        }
        try { await executeTool('approve_order', { id: '1' }); } catch (e: any) {
            expect(e.message).toMatch(/validate_order/);
        }
    });

    it('nome de criar/editar alucinado aponta p/ o prepare_ certo', async () => {
        try { await executeTool('create_proposal', { socid: '1' }); } catch (e: any) {
            expect(e.message).toMatch(/prepare_create/);
        }
        try { await executeTool('update_invoice', { id: '1' }); } catch (e: any) {
            expect(e.message).toMatch(/prepare_edit/);
        }
    });

    it('nome totalmente sem raiz reconhecível ainda lança (sem sugestão específica)', async () => {
        await expect(executeTool('xyzzy_frobnicate', {})).rejects.toMatchObject({ name: 'UnknownToolError' });
    });

    it('ferramenta prepare_ REAL (create) continua gerando deeplink — zero regressão', async () => {
        const out = await executeTool('prepare_create_customer', { name: 'Fulano', email: 'f@x.com' });
        expect(out).toMatch(/\?prefill=/);
    });
});
