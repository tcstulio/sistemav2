import { describe, it, expect } from 'vitest';
import { classifyTool, DEFAULT_ACTION_CLASS } from '../../config/actionCatalog';

describe('actionCatalog — classifyTool (robô-de-negócio F0 / #1234)', () => {
    it('leitura (list_/get_/search_/read_) = read, sem HITL', () => {
        for (const t of ['list_invoices', 'get_financial_summary', 'search_customer', 'read_page', 'check_stock']) {
            expect(classifyTool(t)).toMatchObject({ domain: 'read', reversibility: 'read', requiresHITL: false });
        }
    });

    it('prepare_* (deeplink) = business reversível SEM HITL aqui (o HITL é a tela de confirmação)', () => {
        expect(classifyTool('prepare_create_proposal')).toMatchObject({ domain: 'business', reversibility: 'reversible', requiresHITL: false });
        expect(classifyTool('prepare_edit_customer')).toMatchObject({ reversibility: 'reversible', requiresHITL: false });
    });

    it('efeito direto irreversível (validate_*/send_whatsapp) = requiresHITL', () => {
        for (const t of ['validate_invoice', 'validate_order', 'validate_proposal', 'send_whatsapp']) {
            expect(classifyTool(t)).toMatchObject({ domain: 'business', reversibility: 'irreversible', requiresHITL: true });
        }
    });

    it('notificações internas (notify_person/team) = business reversível sem HITL', () => {
        expect(classifyTool('notify_person')).toMatchObject({ reversibility: 'reversible', requiresHITL: false });
        expect(classifyTool('notify_team')).toMatchObject({ reversibility: 'reversible', requiresHITL: false });
    });

    it('domínio de CÓDIGO separado do de negócio', () => {
        expect(classifyTool('create_opencode_task')).toMatchObject({ domain: 'code' });
        expect(classifyTool('merge_opencode_task')).toMatchObject({ domain: 'code', reversibility: 'irreversible', requiresHITL: true });
        expect(classifyTool('list_github_issues')).toMatchObject({ domain: 'code', reversibility: 'read' });
    });

    it('interação (ask_user/web_search) = read, sem efeito', () => {
        expect(classifyTool('ask_user')).toMatchObject({ domain: 'read', requiresHITL: false });
        expect(classifyTool('web_search')).toMatchObject({ domain: 'read', requiresHITL: false });
    });

    it('FAIL-SAFE: tool desconhecida = default restrito (business/irreversible/HITL)', () => {
        expect(classifyTool('some_new_write_tool_xyz')).toEqual(DEFAULT_ACTION_CLASS);
        expect(DEFAULT_ACTION_CLASS).toMatchObject({ domain: 'business', reversibility: 'irreversible', requiresHITL: true });
    });
});
