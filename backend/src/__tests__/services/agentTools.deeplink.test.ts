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

    it('prepare_edit_event gera /agenda/:id/edit com kind edit_event', async () => {
        const out = await executeTool('prepare_edit_event', { id: '15', label: 'Reunião Atualizada', percentage: '50' });
        const m = out.match(/\/agenda\/15\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_event');
        expect(payload!.data.id).toBe('15');
        expect(payload!.data.label).toBe('Reunião Atualizada');
        expect(payload!.data.percentage).toBe('50');
    });

    it('prepare_edit_event exige id', async () => {
        await expect(executeTool('prepare_edit_event', { label: 'x' })).rejects.toThrow();
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

    it('prepare_create_contact gera /contacts/new e exige firstname/lastname/socid', async () => {
        await expect(executeTool('prepare_create_contact', { firstname: 'João' })).rejects.toThrow();
        const out = await executeTool('prepare_create_contact', { firstname: 'João', lastname: 'Silva', socid: '5' });
        const m = out.match(/\/contacts\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_contact');
        expect(payload!.data.firstname).toBe('João');
        expect(payload!.data.socid).toBe('5');
    });

    it('prepare_edit_contact gera /contacts/:id/edit com kind edit_contact', async () => {
        const out = await executeTool('prepare_edit_contact', { id: '8', email: 'novo@x.com' });
        const m = out.match(/\/contacts\/8\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_contact');
        expect(payload!.data.id).toBe('8');
    });

    it('prepare_create_candidate gera /hr/candidates/new e exige firstname/lastname/email', async () => {
        await expect(executeTool('prepare_create_candidate', { firstname: 'João', lastname: 'Silva' })).rejects.toThrow();
        const out = await executeTool('prepare_create_candidate', { firstname: 'João', lastname: 'Silva', email: 'joao@x.com', fk_job_position: '5' });
        const m = out.match(/\/hr\/candidates\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_candidate');
        expect(payload!.data.firstname).toBe('João');
        expect(payload!.data.email).toBe('joao@x.com');
        expect(payload!.data.fk_job_position).toBe('5');
    });

    it('prepare_edit_candidate gera /hr/candidates/:id/edit com kind edit_candidate', async () => {
        const out = await executeTool('prepare_edit_candidate', { id: '42', note_public: 'Boa entrevista' });
        const m = out.match(/\/hr\/candidates\/42\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_candidate');
        expect(payload!.data.id).toBe('42');
        expect(payload!.data.note_public).toBe('Boa entrevista');
    });

    it('prepare_edit_job gera /hr/jobs/:id/edit com kind edit_job', async () => {
        const out = await executeTool('prepare_edit_job', { id: '5', label: 'Dev Sênior' });
        const m = out.match(/\/hr\/jobs\/5\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_job');
        expect(payload!.data.id).toBe('5');
        expect(payload!.data.label).toBe('Dev Sênior');
    });

    it('prepare_edit_job exige id', async () => {
        await expect(executeTool('prepare_edit_job', { label: 'x' })).rejects.toThrow();
    });

    it('prepare_edit_leave gera /hr/leaves/:id/edit com kind edit_leave', async () => {
        const out = await executeTool('prepare_edit_leave', { id: '9', date_debut: '2025-08-01', type: 'Sick Leave' });
        const m = out.match(/\/hr\/leaves\/9\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_leave');
        expect(payload!.data.id).toBe('9');
        expect(payload!.data.date_debut).toBe('2025-08-01');
        expect(payload!.data.type).toBe('Sick Leave');
    });

    it('prepare_edit_leave não inclui fk_user (funcionário é imutável)', async () => {
        const out = await executeTool('prepare_edit_leave', { id: '9', fk_user: '3', type: 'Unpaid' });
        const m = out.match(/\/hr\/leaves\/9\/edit\?prefill=([A-Za-z0-9._-]+)/);
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_leave');
        expect(payload!.data.fk_user).toBeUndefined();
        expect(payload!.data.type).toBe('Unpaid');
    });

    it('prepare_edit_ticket gera /tickets/:id/edit com kind edit_ticket', async () => {
        const out = await executeTool('prepare_edit_ticket', { id: '123', subject: 'Novo assunto', severity_code: 'HIGH' });
        const m = out.match(/\/tickets\/123\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_ticket');
        expect(payload!.data.id).toBe('123');
        expect(payload!.data.subject).toBe('Novo assunto');
        expect(payload!.data.severity_code).toBe('HIGH');
    });

    it('prepare_edit_ticket exige id', async () => {
        await expect(executeTool('prepare_edit_ticket', { subject: 'x' })).rejects.toThrow();
    });

    it('prepare_edit_ticket exige ao menos um campo para alterar', async () => {
        await expect(executeTool('prepare_edit_ticket', { id: '1' })).rejects.toThrow();
    });

    it('prepare_create_invoice gera /invoices/new com kind create_invoice e exige socid', async () => {
        await expect(executeTool('prepare_create_invoice', { date: '2025-06-15' })).rejects.toThrow();
        const out = await executeTool('prepare_create_invoice', { socid: '7', date: '2025-06-15' });
        const m = out.match(/\/invoices\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'create_invoice');
        expect(payload!.data.socid).toBe('7');
        expect(payload!.data.date).toBe('2025-06-15');
    });

    it('prepare_create_invoice carrega as linhas (arrays) com tipos normalizados', async () => {
        const out = await executeTool('prepare_create_invoice', {
            socid: '7',
            lines: [
                { fk_product: '42', desc: 'Serviço A', qty: '2', subprice: '100', remise_percent: '10' },
                { desc: 'Item livre', qty: 1, subprice: 50 },
            ],
        });
        const m = out.match(/\/invoices\/new\?prefill=([A-Za-z0-9._-]+)/);
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'create_invoice');
        expect(Array.isArray(payload!.data.lines)).toBe(true);
        expect(payload!.data.lines).toHaveLength(2);
        // textuais como string, numéricos como number
        expect(payload!.data.lines[0].fk_product).toBe('42');
        expect(payload!.data.lines[0].desc).toBe('Serviço A');
        expect(payload!.data.lines[0].qty).toBe(2);
        expect(payload!.data.lines[0].subprice).toBe(100);
        expect(payload!.data.lines[0].remise_percent).toBe(10);
        // linha sem fk_product é válida (item livre)
        expect(payload!.data.lines[1].fk_product).toBeUndefined();
        expect(payload!.data.lines[1].qty).toBe(1);
    });

    it('prepare_create_invoice descarta campos de linha fora da whitelist', async () => {
        const out = await executeTool('prepare_create_invoice', {
            socid: '7',
            lines: [{ desc: 'X', qty: 1, subprice: 10, hack: 'drop-me' }],
        });
        const m = out.match(/\/invoices\/new\?prefill=([A-Za-z0-9._-]+)/);
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'create_invoice');
        expect(payload!.data.lines[0].hack).toBeUndefined();
        expect(payload!.data.lines[0].desc).toBe('X');
    });

    it('prepare_create_proposal gera /proposals/new com linhas', async () => {
        const out = await executeTool('prepare_create_proposal', { socid: '3', project_id: '9', lines: [{ fk_product: '1', desc: 'A', qty: 2, subprice: 30 }] });
        const m = out.match(/\/proposals\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'create_proposal');
        expect(payload!.data.socid).toBe('3');
        expect(payload!.data.project_id).toBe('9');
        expect(payload!.data.lines[0].qty).toBe(2);
    });

    it('prepare_create_supplier_invoice gera /supplier_invoices/new e exige socid', async () => {
        await expect(executeTool('prepare_create_supplier_invoice', { date: '2025-01-01' })).rejects.toThrow();
        const out = await executeTool('prepare_create_supplier_invoice', { socid: '4', lines: [{ desc: 'Serviço', qty: 1, subprice: 200 }] });
        const m = out.match(/\/supplier_invoices\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'create_supplier_invoice');
        expect(payload!.data.socid).toBe('4');
        expect(payload!.data.lines[0].subprice).toBe(200);
    });

    it('prepare_create_supplier_proposal gera /supplier_proposals/new com linhas', async () => {
        const out = await executeTool('prepare_create_supplier_proposal', { socid: '5', lines: [{ fk_product: '8', desc: 'Peça', qty: 10, subprice: 5, remise_percent: 15 }] });
        const m = out.match(/\/supplier_proposals\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'create_supplier_proposal');
        expect(payload!.data.socid).toBe('5');
        expect(payload!.data.lines[0].fk_product).toBe('8');
        expect(payload!.data.lines[0].remise_percent).toBe(15);
    });

    it('prepare_create_order gera /orders/new com linhas e exige socid', async () => {
        await expect(executeTool('prepare_create_order', { date: '2025-02-02' })).rejects.toThrow();
        const out = await executeTool('prepare_create_order', { socid: '11', lines: [{ fk_product: '3', desc: 'Item', qty: 4, subprice: 25 }] });
        const m = out.match(/\/orders\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'create_order');
        expect(payload!.data.socid).toBe('11');
        expect(payload!.data.lines[0].qty).toBe(4);
        expect(payload!.data.lines[0].subprice).toBe(25);
    });

    it('prepare_create_mo gera /manufacturing/mo/new e exige product_to_produce_id', async () => {
        await expect(executeTool('prepare_create_mo', { qty: '5' })).rejects.toThrow();
        const out = await executeTool('prepare_create_mo', { product_to_produce_id: '88', qty: '5', label: 'Lote 1' });
        const m = out.match(/\/manufacturing\/mo\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_mo');
        expect(payload!.data.product_to_produce_id).toBe('88');
        expect(payload!.data.qty).toBe('5');
    });

    it('prepare_create_bom gera /manufacturing/bom/new e exige product_id', async () => {
        await expect(executeTool('prepare_create_bom', { qty: '2' })).rejects.toThrow();
        const out = await executeTool('prepare_create_bom', { product_id: '88', qty: '10' });
        const m = out.match(/\/manufacturing\/bom\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_bom');
        expect(payload!.data.product_id).toBe('88');
    });

    it('prepare_edit_bom gera /manufacturing/bom/:id/edit com kind edit_bom', async () => {
        const out = await executeTool('prepare_edit_bom', { id: '7', label: 'BOM revisada', qty: '20' });
        const m = out.match(/\/manufacturing\/bom\/7\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_bom');
        expect(payload!.data.id).toBe('7');
        expect(payload!.data.label).toBe('BOM revisada');
        expect(payload!.data.qty).toBe('20');
    });

    it('prepare_edit_bom não inclui product_id (produto final é imutável)', async () => {
        const out = await executeTool('prepare_edit_bom', { id: '7', product_id: '99', duration: '7200' });
        const m = out.match(/\/manufacturing\/bom\/7\/edit\?prefill=([A-Za-z0-9._-]+)/);
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_bom');
        expect(payload!.data.product_id).toBeUndefined();
        expect(payload!.data.duration).toBe('7200');
    });

    it('prepare_edit_bom exige id', async () => {
        await expect(executeTool('prepare_edit_bom', { label: 'x' })).rejects.toThrow();
    });

    it('prepare_edit_mo gera /manufacturing/mo/:id/edit com kind edit_mo', async () => {
        const out = await executeTool('prepare_edit_mo', { id: '12', label: 'Lote revisado', qty: '15' });
        const m = out.match(/\/manufacturing\/mo\/12\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_mo');
        expect(payload!.data.id).toBe('12');
        expect(payload!.data.label).toBe('Lote revisado');
        expect(payload!.data.qty).toBe('15');
    });

    it('prepare_edit_mo não inclui product_to_produce_id (produto é imutável)', async () => {
        const out = await executeTool('prepare_edit_mo', { id: '12', product_to_produce_id: '99', qty: '5' });
        const m = out.match(/\/manufacturing\/mo\/12\/edit\?prefill=([A-Za-z0-9._-]+)/);
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_mo');
        expect(payload!.data.product_to_produce_id).toBeUndefined();
        expect(payload!.data.qty).toBe('5');
    });

    it('prepare_edit_mo exige id', async () => {
        await expect(executeTool('prepare_edit_mo', { label: 'x' })).rejects.toThrow();
    });

    it('prepare_edit_invoice gera /invoices/:id/edit e carrega linhas a acrescentar', async () => {
        const out = await executeTool('prepare_edit_invoice', { id: '50', date: '2025-09-01', lines: [{ desc: 'Item extra', qty: 1, subprice: 99 }] });
        const m = out.match(/\/invoices\/50\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'edit_invoice');
        expect(payload!.data.id).toBe('50');
        expect(payload!.data.date).toBe('2025-09-01');
        expect(payload!.data.lines[0].subprice).toBe(99);
    });

    it('prepare_edit_invoice aceita só linhas (sem campo escalar)', async () => {
        const out = await executeTool('prepare_edit_invoice', { id: '50', lines: [{ desc: 'X', qty: 2, subprice: 10 }] });
        const m = out.match(/\/invoices\/50\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'edit_invoice');
        expect(payload!.data.lines).toHaveLength(1);
    });

    it('prepare_edit_invoice exige id', async () => {
        await expect(executeTool('prepare_edit_invoice', { date: '2025-09-01' })).rejects.toThrow();
    });

    it('prepare_edit_proposal gera /proposals/:id/edit com escalares', async () => {
        const out = await executeTool('prepare_edit_proposal', { id: '7', note_public: 'Atualizado' });
        const m = out.match(/\/proposals\/7\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'edit_proposal');
        expect(payload!.data.note_public).toBe('Atualizado');
    });

    it('prepare_edit_supplier_invoice e prepare_edit_supplier_proposal geram as rotas corretas', async () => {
        const a = await executeTool('prepare_edit_supplier_invoice', { id: '3', date: '2025-09-01' });
        expect(a).toMatch(/\/supplier_invoices\/3\/edit\?prefill=/);
        const b = await executeTool('prepare_edit_supplier_proposal', { id: '4', project_id: '2' });
        expect(b).toMatch(/\/supplier_proposals\/4\/edit\?prefill=/);
    });

    it('prepare_create_product gera /products/new e exige ref/label', async () => {
        await expect(executeTool('prepare_create_product', { ref: 'P-1' })).rejects.toThrow();
        const out = await executeTool('prepare_create_product', { ref: 'P-1', label: 'Camiseta', type: '0', price: '49.9' });
        const m = out.match(/\/products\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_product');
        expect(payload!.data.ref).toBe('P-1');
        expect(payload!.data.label).toBe('Camiseta');
        expect(payload!.data.price).toBe('49.9');
    });

    it('prepare_edit_product gera /products/:id/edit com kind edit_product', async () => {
        const out = await executeTool('prepare_edit_product', { id: '12', price: '59.9' });
        const m = out.match(/\/products\/12\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_product');
        expect(payload!.data.id).toBe('12');
        expect(payload!.data.price).toBe('59.9');
    });

    it('prepare_create_user gera /hr/users/new e exige login/email', async () => {
        await expect(executeTool('prepare_create_user', { login: 'jsilva' })).rejects.toThrow();
        const out = await executeTool('prepare_create_user', { login: 'jsilva', email: 'j@x.com', firstname: 'João' });
        const m = out.match(/\/hr\/users\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_user');
        expect(payload!.data.login).toBe('jsilva');
        expect(payload!.data.email).toBe('j@x.com');
    });

    it('prepare_edit_user não inclui login (imutável)', async () => {
        const out = await executeTool('prepare_edit_user', { id: '5', login: 'novo', job: 'Dev' });
        const m = out.match(/\/hr\/users\/5\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_user');
        expect(payload!.data.login).toBeUndefined();
        expect(payload!.data.job).toBe('Dev');
    });

    it('prepare_create_group e prepare_edit_group geram as rotas corretas', async () => {
        const a = await executeTool('prepare_create_group', { name: 'RH', note: 'Equipe' });
        expect(a).toMatch(/\/hr\/groups\/new\?prefill=/);
        const b = await executeTool('prepare_edit_group', { id: '2', name: 'Financeiro' });
        const m = b.match(/\/hr\/groups\/2\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_group');
        expect(payload!.data.name).toBe('Financeiro');
    });

    it('prepare_create_contract gera /contracts/new e exige socid', async () => {
        await expect(executeTool('prepare_create_contract', { date_contrat: '2025-01-01' })).rejects.toThrow();
        const out = await executeTool('prepare_create_contract', { socid: '9', date_contrat: '2025-01-01' });
        const m = out.match(/\/contracts\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_contract');
        expect(payload!.data.socid).toBe('9');
        expect(payload!.data.date_contrat).toBe('2025-01-01');
    });

    it('prepare_edit_contract gera /contracts/:id/edit com kind edit_contract', async () => {
        const out = await executeTool('prepare_edit_contract', { id: '6', note_public: 'Renovado' });
        const m = out.match(/\/contracts\/6\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_contract');
        expect(payload!.data.id).toBe('6');
        expect(payload!.data.note_public).toBe('Renovado');
    });

    it('prepare_edit_intervention gera /interventions/:id/edit com kind edit_intervention', async () => {
        const out = await executeTool('prepare_edit_intervention', { id: '15', description: 'Trabalho revisado', date: '2025-07-01' });
        const m = out.match(/\/interventions\/15\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_intervention');
        expect(payload!.data.id).toBe('15');
        expect(payload!.data.description).toBe('Trabalho revisado');
    });

    it('prepare_create_expense gera /hr/expenses/new e exige fk_user_author/datas', async () => {
        await expect(executeTool('prepare_create_expense', { fk_user_author: '1' })).rejects.toThrow();
        const out = await executeTool('prepare_create_expense', { fk_user_author: '1', date_debut: '2025-03-01', date_fin: '2025-03-01', total_ttc: '150.5' });
        const m = out.match(/\/hr\/expenses\/new\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_expense');
        expect(payload!.data.fk_user_author).toBe('1');
        expect(payload!.data.total_ttc).toBe('150.5');
    });

    it('prepare_edit_expense não inclui fk_user_author (imutável)', async () => {
        const out = await executeTool('prepare_edit_expense', { id: '8', fk_user_author: '9', total_ttc: '200' });
        const m = out.match(/\/hr\/expenses\/8\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_expense');
        expect(payload!.data.fk_user_author).toBeUndefined();
        expect(payload!.data.total_ttc).toBe('200');
    });

    it('prepare_edit_order gera /orders/:id/edit com kind edit_order (só o cabeçalho)', async () => {
        const out = await executeTool('prepare_edit_order', { id: '11', date: '2025-10-01' });
        const m = out.match(/\/orders\/11\/edit\?prefill=([A-Za-z0-9._-]+)/);
        expect(m).not.toBeNull();
        const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_order');
        expect(payload!.data.id).toBe('11');
        expect(payload!.data.date).toBe('2025-10-01');
    });

    it('prepare_edit_order não inclui socid nem linhas (cliente/itens imutáveis na edição)', async () => {
        const out = await executeTool('prepare_edit_order', { id: '11', socid: '99', date: '2025-10-01', lines: [{ desc: 'X', qty: 1, subprice: 10 }] });
        const m = out.match(/\/orders\/11\/edit\?prefill=([A-Za-z0-9._-]+)/);
        const payload = verifyDeeplink<Record<string, any>>(m![1], 'edit_order');
        expect(payload!.data.socid).toBeUndefined();
        expect(payload!.data.lines).toBeUndefined();
    });

    it('prepare_edit_order exige id', async () => {
        await expect(executeTool('prepare_edit_order', { date: '2025-10-01' })).rejects.toThrow();
    });

    it('entidade inexistente não suporta edição (retorna aviso)', async () => {
        const out = await executeTool('prepare_edit_inexistente', { id: '1', foo: 'bar' });
        expect(out).toContain('não suporta edição');
    });

    describe('prepare_batch_create (lote — Opção B)', () => {
        it('gera /batch/new com kind batch_create e os itens (simples)', async () => {
            const out = await executeTool('prepare_batch_create', {
                entity: 'customer',
                items: [
                    { name: 'Cliente A', email: 'a@x.com' },
                    { name: 'Cliente B', email: 'b@x.com', client: '1' },
                ],
            });
            const m = out.match(/\/batch\/new\?prefill=([A-Za-z0-9._-]+)/);
            expect(m).not.toBeNull();
            const payload = verifyDeeplink<Record<string, any>>(m![1], 'batch_create');
            expect(payload!.data.entity).toBe('customer');
            expect(payload!.data.items).toHaveLength(2);
            expect(payload!.data.items[0].name).toBe('Cliente A');
            expect(payload!.data.items[1].client).toBe('1');
        });

        it('carrega linhas por item (entidade com itens, ex.: fatura)', async () => {
            const out = await executeTool('prepare_batch_create', {
                entity: 'invoice',
                items: [
                    { socid: '7', lines: [{ desc: 'Serviço', qty: 2, subprice: 100 }] },
                    { socid: '9', lines: [{ desc: 'Item', qty: 1, subprice: 50 }] },
                ],
            });
            const m = out.match(/\/batch\/new\?prefill=([A-Za-z0-9._-]+)/);
            const payload = verifyDeeplink<Record<string, any>>(m![1], 'batch_create');
            expect(payload!.data.items[0].lines[0].qty).toBe(2);
            expect(payload!.data.items[1].socid).toBe('9');
        });

        it('descarta campos fora da whitelist da entidade', async () => {
            const out = await executeTool('prepare_batch_create', {
                entity: 'customer',
                items: [{ name: 'X', hack: 'drop-me' }],
            });
            const m = out.match(/\/batch\/new\?prefill=([A-Za-z0-9._-]+)/);
            const payload = verifyDeeplink<Record<string, any>>(m![1], 'batch_create');
            expect(payload!.data.items[0].hack).toBeUndefined();
            expect(payload!.data.items[0].name).toBe('X');
        });

        it('exige items não-vazio e rejeita lote grande (>50)', async () => {
            await expect(executeTool('prepare_batch_create', { entity: 'customer', items: [] })).rejects.toThrow();
            const big = Array.from({ length: 51 }, (_, i) => ({ name: `C${i}` }));
            await expect(executeTool('prepare_batch_create', { entity: 'customer', items: big })).rejects.toThrow();
        });

        it('entidade inexistente retorna aviso', async () => {
            const out = await executeTool('prepare_batch_create', { entity: 'inexistente', items: [{ name: 'X' }] });
            expect(out).toContain('não suporta criação');
        });
    });
});
