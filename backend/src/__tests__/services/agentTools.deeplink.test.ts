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

    it('prepare_create_supplier gera /suppliers/new com kind create_supplier', async () => {
        const out = await executeTool('prepare_create_supplier', { name: 'Fornecedor ACME', email: 'acme@x.com' });
        const m = out.match(/\/suppliers\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_supplier');
        expect(payload!.data.name).toBe('Fornecedor ACME');
    });

    it('prepare_edit_supplier gera /suppliers/:id/edit com kind edit_supplier', async () => {
        const out = await executeTool('prepare_edit_supplier', { id: '3', phone: '11 5555-0000' });
        const m = out.match(/\/suppliers\/3\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_supplier');
        expect(payload!.data.id).toBe('3');
        expect(payload!.data.phone).toBe('11 5555-0000');
    });

    it('prepare_create_task exige project_id', async () => {
        await expect(executeTool('prepare_create_task', { label: 'T' })).rejects.toThrow();
    });

    it('prepare_create_task gera /tasks/new com kind create_task', async () => {
        const out = await executeTool('prepare_create_task', { label: 'Setup', project_id: '7', planned_workload: '8' });
        const m = out.match(/\/tasks\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_task');
        expect(payload!.data.label).toBe('Setup');
        expect(payload!.data.project_id).toBe('7');
    });

    it('prepare_edit_task gera /tasks/:id/edit com kind edit_task', async () => {
        const out = await executeTool('prepare_edit_task', { id: '12', label: 'Novo título' });
        const m = out.match(/\/tasks\/12\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_task');
        expect(payload!.data.id).toBe('12');
    });

    it('prepare_create_category gera /categories/new com kind create_category', async () => {
        const out = await executeTool('prepare_create_category', { label: 'Clientes VIP', type: 'customer' });
        const m = out.match(/\/categories\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_category');
        expect(payload!.data.label).toBe('Clientes VIP');
        expect(payload!.data.type).toBe('customer');
    });

    it('prepare_edit_category gera /categories/:id/edit com kind edit_category', async () => {
        const out = await executeTool('prepare_edit_category', { id: '4', label: 'Renomeada' });
        const m = out.match(/\/categories\/4\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_category');
        expect(payload!.data.id).toBe('4');
    });

    it('prepare_create_event gera /agenda/new com kind create_event', async () => {
        const out = await executeTool('prepare_create_event', { label: 'Reunião', date_start: '2025-06-15T14:30' });
        const m = out.match(/\/agenda\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_event');
        expect(payload!.data.label).toBe('Reunião');
        expect(payload!.data.date_start).toBe('2025-06-15T14:30');
    });

    it('prepare_edit_event não é suportado (evento só tem criação por ora)', async () => {
        const out = await executeTool('prepare_edit_event', { id: '1', label: 'x' });
        expect(out).toContain('não suporta edição');
    });

    it('prepare_create_intervention gera /interventions/new e exige socid', async () => {
        await expect(executeTool('prepare_create_intervention', { description: 'x' })).rejects.toThrow();
        const out = await executeTool('prepare_create_intervention', { socid: '9', description: 'Troca de peça' });
        const m = out.match(/\/interventions\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_intervention');
        expect(payload!.data.socid).toBe('9');
    });

    it('prepare_create_job gera /hr/jobs/new com kind create_job', async () => {
        const out = await executeTool('prepare_create_job', { label: 'Dev Python', qty: '2' });
        const m = out.match(/\/hr\/jobs\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_job');
        expect(payload!.data.label).toBe('Dev Python');
    });

    it('prepare_create_leave gera /hr/leaves/new e exige fk_user/datas', async () => {
        await expect(executeTool('prepare_create_leave', { fk_user: '1' })).rejects.toThrow();
        const out = await executeTool('prepare_create_leave', { fk_user: '1', date_debut: '2025-07-01', date_fin: '2025-07-10' });
        const m = out.match(/\/hr\/leaves\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_leave');
        expect(payload!.data.fk_user).toBe('1');
    });

    it('entidade sem suporte a edição retorna aviso (ticket não tem editRoute)', async () => {
        const out = await executeTool('prepare_edit_ticket', { id: '1', subject: 'x' });
        expect(out).toContain('não suporta edição');
    });
});
