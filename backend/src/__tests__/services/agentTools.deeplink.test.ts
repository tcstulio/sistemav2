import { describe, it, expect, vi } from 'vitest';

// segredo determinístico p/ o roundtrip sign->verify
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-agenttools-123' } }));
// agentTools importa estes no topo; mockamos para não carregar os serviços reais.
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool } from '../../services/agentTools';
import { verifyDeeplink } from '../../utils/deeplinkToken';

describe('agentTools — ações HITL via deeplink (#57 Peça 2/3)', () => {
    it('prepare_create_customer gera /customers/new com kind create_customer', async () => {
        const out = await executeTool('prepare_create_customer', { name: 'Fulano', email: 'f@x.com' });
        const m = out.match(/\/customers\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_customer');
        expect(payload).not.toBeNull();
        expect(payload!.data.name).toBe('Fulano');
        expect(payload!.data.email).toBe('f@x.com');
    });

    it('prepare_create_customer exige name', async () => {
        await expect(executeTool('prepare_create_customer', { email: 'f@x.com' })).rejects.toThrow();
    });

    it('prepare_edit_customer gera /customers/:id/edit com kind edit_customer e inclui o id', async () => {
        const out = await executeTool('prepare_edit_customer', { id: '42', email: 'novo@x.com' });
        const m = out.match(/\/customers\/42\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_customer');
        expect(payload).not.toBeNull();
        expect(payload!.data.id).toBe('42');
        expect(payload!.data.email).toBe('novo@x.com');
    });

    it('prepare_edit_customer exige id', async () => {
        await expect(executeTool('prepare_edit_customer', { email: 'x@y.com' })).rejects.toThrow();
    });

    it('prepare_edit_customer exige ao menos um campo para alterar', async () => {
        await expect(executeTool('prepare_edit_customer', { id: '7' })).rejects.toThrow();
    });

    it('prepare_create_ticket continua funcionando (compat com o slice anterior)', async () => {
        const out = await executeTool('prepare_create_ticket', { subject: 'S', message: 'M' });
        expect(out).toMatch(/\/tickets\/new\?prefill=/);
    });

    it('prepare_create_project gera /projects/new com kind create_project', async () => {
        const out = await executeTool('prepare_create_project', { title: 'Projeto X', socid: '5' });
        const m = out.match(/\/projects\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_project');
        expect(payload!.data.title).toBe('Projeto X');
        expect(payload!.data.socid).toBe('5');
    });

    it('prepare_edit_project gera /projects/:id/edit com kind edit_project', async () => {
        const out = await executeTool('prepare_edit_project', { id: '9', title: 'Novo Nome' });
        const m = out.match(/\/projects\/9\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_project');
        expect(payload!.data.id).toBe('9');
        expect(payload!.data.title).toBe('Novo Nome');
    });

    it('entidade sem suporte a edição retorna aviso (ticket não tem editRoute)', async () => {
        const out = await executeTool('prepare_edit_ticket', { id: '1', subject: 'x' });
        expect(out).toContain('não suporta edição');
    });
});
