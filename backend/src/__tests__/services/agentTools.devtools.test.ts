/**
 * #1498 — DEV_TOOLS / getToolsPrompt / enforcement em executeTool.
 *
 * Garante que:
 *   - `DEV_TOOLS` contém exatamente as 13 ferramentas listadas na issue.
 *   - `getToolsPrompt({ isAdmin: true })` devolve o prompt COMPLETO com as 13 DEV_TOOLS.
 *   - `getToolsPrompt({ isAdmin: false })` devolve prompt SEM qualquer menção às 13.
 *   - `getToolsPrompt({ isAdmin: false })` continua listando TODAS as ferramentas de negócio
 *     (search, list_*, prepare_*, validate_*, send_*, notify_*, get_financial_*, etc.).
 *   - `executeTool` RECUSA DEV_TOOLS para não-admin (defesa em profundidade — mesmo com
 *     prompt injetado ou chamador externo).
 *   - `executeTool` EXECUTA DEV_TOOLS para admin.
 *   - `executeTool` EXECUTA ferramentas de negócio para QUALQUER papel.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-devtools' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { DEV_TOOLS, getToolsPrompt, executeTool, runWithToolContext } from '../../services/agentTools';

const EXPECTED_DEV_TOOLS = [
    'create_github_issue',
    'list_github_issues',
    'create_bug_report',
    'create_opencode_task',
    'list_opencode_tasks',
    'start_opencode_task',
    'opencode_task_feedback',
    'merge_opencode_task',
    'read_project_file',
    'search_code',
    'project_structure',
    'read_logs',
    'git_recent',
] as const;

describe('agentTools — DEV_TOOLS exportado com as 13 ferramentas (#1498)', () => {
    it('tem exatamente as 13 ferramentas esperadas', () => {
        expect(DEV_TOOLS.size).toBe(13);
    });

    it.each(EXPECTED_DEV_TOOLS)('contém "%s"', (name) => {
        expect(DEV_TOOLS.has(name)).toBe(true);
    });

    it('não contém nenhuma ferramenta de negócio (search, list_invoices, prepare_*, etc.)', () => {
        expect(DEV_TOOLS.has('search')).toBe(false);
        expect(DEV_TOOLS.has('list_invoices')).toBe(false);
        expect(DEV_TOOLS.has('prepare_create_proposal')).toBe(false);
        expect(DEV_TOOLS.has('validate_invoice')).toBe(false);
        expect(DEV_TOOLS.has('send_whatsapp')).toBe(false);
        expect(DEV_TOOLS.has('notify_person')).toBe(false);
        expect(DEV_TOOLS.has('notify_team')).toBe(false);
        expect(DEV_TOOLS.has('get_financial_summary')).toBe(false);
        expect(DEV_TOOLS.has('get_screen_help')).toBe(false);
        expect(DEV_TOOLS.has('generate_image')).toBe(false);
        expect(DEV_TOOLS.has('ask_user')).toBe(false);
        expect(DEV_TOOLS.has('list_user_tasks')).toBe(false);
    });
});

describe('getToolsPrompt — versão admin (#1498)', () => {
    it('lista TODAS as 13 DEV_TOOLS no conteúdo', () => {
        const p = getToolsPrompt({ isAdmin: true });
        for (const name of EXPECTED_DEV_TOOLS) {
            expect(p).toContain(name);
        }
    });

    it('lista ferramentas de negócio (search, list_*, prepare_create_proposal)', () => {
        const p = getToolsPrompt({ isAdmin: true });
        expect(p).toContain('search(query');
        expect(p).toContain('list_invoices');
        expect(p).toContain('list_users');
        expect(p).toContain('prepare_create_proposal');
        expect(p).toContain('validate_invoice');
        expect(p).toContain('send_whatsapp');
        expect(p).toContain('notify_person');
        expect(p).toContain('ask_user');
        expect(p).toContain('list_user_tasks');
    });
});

describe('getToolsPrompt — versão não-admin (#1498)', () => {
    it('NÃO contém NENHUMA das 13 DEV_TOOLS no conteúdo (regressão)', () => {
        const p = getToolsPrompt({ isAdmin: false });
        for (const name of EXPECTED_DEV_TOOLS) {
            expect(p).not.toContain(name);
        }
    });

    it('NÃO contém "create_github_issue" nem como substring (cobertura dupla)', () => {
        const p = getToolsPrompt({ isAdmin: false });
        expect(p).not.toMatch(/create_github_issue/);
        expect(p).not.toMatch(/list_github_issues/);
        expect(p).not.toMatch(/create_opencode_task/);
    });

    it('remove o bloco das SEÇÕES dedicadas (GESTÃO DO PROJETO + TASK RUNNER)', () => {
        const p = getToolsPrompt({ isAdmin: false });
        expect(p).not.toContain('FERRAMENTA DE GESTÃO DO PROJETO');
        expect(p).not.toMatch(/FERRAMENTAS DE TASK RUNNER/);
    });

    it('remove as entradas numeradas dentro da seção mista de VERIFICAÇÃO', () => {
        const p = getToolsPrompt({ isAdmin: false });
        // "FERRAMENTAS DE VERIFICAÇÃO E COMUNICAÇÃO" ainda existe pra explicar notify_*,
        // mas as 5 entradas DEV (read_project_file etc.) somem.
        expect(p).toMatch(/FERRAMENTAS DE VERIFICAÇÃO/);
        expect(p).toContain('ask_user');     // não-admin pode fazer
        expect(p).toContain('notify_team');  // não-admin pode mandar
    });

    it('NÃO toca nas ferramentas de negócio — todas continuam listadas', () => {
        const p = getToolsPrompt({ isAdmin: false });
        expect(p).toContain('search(query');
        expect(p).toContain('list_invoices');
        expect(p).toContain('list_users');
        expect(p).toContain('list_user_tasks');
        expect(p).toContain('prepare_create_proposal');
        expect(p).toContain('validate_invoice');
        expect(p).toContain('validate_proposal');
        expect(p).toContain('send_whatsapp');
        expect(p).toContain('notify_person');
        expect(p).toContain('notify_team');
        expect(p).toContain('ask_user');
        expect(p).toContain('generate_image');
        expect(p).toContain('generate_speech');
        expect(p).toContain('get_financial_summary');
        expect(p).toContain('get_screen_help');
        expect(p).toContain('list_suppliers');
        expect(p).toContain('list_events');
        expect(p).toContain('prepare_create_task');
        expect(p).toContain('prepare_create_customer');
        expect(p).toContain('prepare_create_invoice');
        expect(p).toContain('validate_order');
        expect(p).toContain('delete_proposal');
    });

    it('prompt NÃO-admin é menor que o admin (filtro removeu conteúdo)', () => {
        const admin = getToolsPrompt({ isAdmin: true });
        const nonAdmin = getToolsPrompt({ isAdmin: false });
        expect(nonAdmin.length).toBeLessThan(admin.length);
    });
});

describe('executeTool — defesa em profundidade para DEV_TOOLS (#1498)', () => {
    it('não-admin executando create_github_issue: RECUSA educadamente, sem side effects', async () => {
        const out = await runWithToolContext({ isAdmin: false, userLogin: 'fulano' },
            () => executeTool('create_github_issue', { title: 'bug', body: 'b' }));
        expect(out).toMatch(/administrador/i);
        expect(out).not.toContain('{}');
    });

    it('não-admin executando read_project_file: RECUSA educadamente', async () => {
        const out = await runWithToolContext({ isAdmin: false, userLogin: 'fulano' },
            () => executeTool('read_project_file', { file_path: 'src/index.ts' }));
        expect(out).toMatch(/administrador/i);
    });

    it('não-admin executando search_code (uma read-only): RECUSA mesmo assim (admin-only)', async () => {
        const out = await runWithToolContext({ isAdmin: false, userLogin: 'fulano' },
            () => executeTool('search_code', { pattern: 'foo' }));
        expect(out).toMatch(/administrador/i);
    });

    it('admin (isAdmin === true) executando create_github_issue: PASSA pelo gate (não-recusa)', async () => {
        // O handler real provavelmente precisa de rede / GitHub CLI — mas o teste cobre SÓ o gate
        // (que vem ANTES do switch). Se o gate fosse admin-only estourado, ele devolveria
        // "administrador"; o teste só nega essa mensagem.
        const out = await runWithToolContext({ isAdmin: true, userLogin: 'admin' },
            () => executeTool('create_github_issue', { title: 'bug', body: 'b' }).catch((e: any) => `ERR: ${e.message}`));
        expect(out).not.toMatch(/restrita ao papel/i);
    });

    it('admin executando read_project_file: PASSA pelo gate', async () => {
        const out = await runWithToolContext({ isAdmin: true, userLogin: 'admin' },
            () => executeTool('read_project_file', { file_path: 'src/index.ts' }).catch((e: any) => `ERR: ${e.message}`));
        expect(out).not.toMatch(/restrita ao papel/i);
    });

    it('ferramenta de negócio (search/list_users/prepare_create_proposal) roda INDEPENDENTE do papel', async () => {
        // Não-admin: roda (sem ser barrado pelo gate de DEV_TOOLS).
        const outNonAdmin = await runWithToolContext({ isAdmin: false, userLogin: 'fulano' },
            () => executeTool('list_users', { search: 'a' }).catch((e: any) => `ERR: ${e.message}`));
        expect(outNonAdmin).not.toMatch(/restrita ao papel/i);

        // Sem contexto definido (isAdmin undefined): roda.
        const outUndef = await executeTool('list_users', { search: 'a' }).catch((e: any) => `ERR: ${e.message}`);
        expect(outUndef).not.toMatch(/restrita ao papel/i);
    });

    it('ferramenta de negócio (send_whatsapp) com isAdmin !== true NÃO é barrada pelo gate de DEV_TOOLS', async () => {
        const out = await runWithToolContext({ isAdmin: false, userLogin: 'fulano' },
            () => executeTool('send_whatsapp', { phone: '5511999990000', message: 'oi' }).catch((e: any) => `ERR: ${e.message}`));
        // Gate de DEV_TOOLS não dispara. Pode dar OUTRO erro (allowlist, perfil etc.) mas nunca
        // "restrita ao papel de administrador".
        expect(out).not.toMatch(/restrita ao papel/i);
    });
});
