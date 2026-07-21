/**
 * #1562 — ferramentas do Marciano para acessar o contexto visual/HTML de um
 * report quando o usuário descreve um problema visual.
 *
 * Garante que:
 *   - `get_report_screenshot` devolve uma URL assinada (TTL 1h) e renderiza
 *     como `<img>` para o LLM "ver" o print.
 *   - `get_report_screenshot` devolve mensagem amigável quando o reportId
 *     não existe (não estoura exceção nem retorna JSON cru).
 *   - `get_report_screenshot` exige reportId (param ausente → instrução clara).
 *   - `get_report_html` devolve HTML completo sem seletor.
 *   - `get_report_html` aplica seletor CSS quando informado (innerHTML do
 *     primeiro match).
 *   - `get_report_html` traduz SELECTOR_NO_MATCH/INVALID_SELECTOR em mensagens
 *     amigáveis para o LLM (em vez de expor `AppError` cru).
 *   - Ambas funcionam tanto para admin quanto para não-admin (NÃO estão em
 *     DEV_TOOLS — caso de uso é qualquer usuário descrevendo um bug visual).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-report-tools' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

// Mockamos o issueReportService p/ controlar 200/404 sem precisar de disco real.
// Mantemos `buildSignedScreenshotUrl` REAL (via vi.importActual) p/ garantir que
// o link devolvido bate com o que a rota /file.:ext valida (round-trip).
vi.mock('../../services/issueReportService', async () => {
    const real = await vi.importActual<any>('../../services/issueReportService');
    return {
        ...real,
        // Mantém `buildSignedScreenshotUrl` REAL p/ o token bater com o verificador.
        buildSignedScreenshotUrl: real.buildSignedScreenshotUrl,
        findPersistedScreenshot: vi.fn(),
        loadPersistedHtmlFiltered: vi.fn(),
    };
});

import { executeTool, runWithToolContext } from '../../services/agentTools';
import * as issueReportService from '../../services/issueReportService';

const mockFindPersistedScreenshot = (issueReportService as any).findPersistedScreenshot as ReturnType<typeof vi.fn>;
const mockLoadPersistedHtmlFiltered = (issueReportService as any).loadPersistedHtmlFiltered as ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('agentTools — get_report_screenshot (#1562)', () => {
    it('devolve URL assinada + tag <img> quando o reportId existe', async () => {
        mockFindPersistedScreenshot.mockReturnValue({ path: '/uploads/r.png', ext: 'png', mime: 'image/png' });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_screenshot', { reportId: 'r-1' }));
        expect(out).toContain('<img src="');
        expect(out).toMatch(/api\/issues\/report\/r-1\/file\.png\?token=/);
        expect(out).toContain('image/png');
        expect(out).toContain('válida por');
        expect(out).toContain('1h');
    });

    it('devolve mensagem amigável quando reportId não existe', async () => {
        mockFindPersistedScreenshot.mockReturnValue(null);
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_screenshot', { reportId: 'inexistente' }));
        expect(out).toMatch(/não encontrado/i);
        expect(out).toMatch(/inexistente/);
        // Não vaza código de erro técnico (AC: 404 amigável).
        expect(out).not.toContain('REPORT_NOT_FOUND');
        expect(out).not.toMatch(/404/);
    });

    it('instrui o usuário a passar reportId quando ausente', async () => {
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_screenshot', {}));
        expect(out).toMatch(/Informe o reportId/);
        // Deixa claro COMO chamar (exemplo do AC).
        expect(out).toContain('report #42');
    });

    it('aceita tanto reportId quanto report_id (snake_case defensivo)', async () => {
        mockFindPersistedScreenshot.mockReturnValue({ path: '/x.png', ext: 'png', mime: 'image/png' });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_screenshot', { report_id: 'r-2' }));
        expect(out).toContain('r-2');
        expect(mockFindPersistedScreenshot).toHaveBeenCalledWith('r-2');
    });

    it('roda para não-admin (não está em DEV_TOOLS — qualquer logado usa)', async () => {
        mockFindPersistedScreenshot.mockReturnValue({ path: '/x.png', ext: 'png', mime: 'image/png' });
        const out = await runWithToolContext({ userLogin: 'fulano', isAdmin: false },
            () => executeTool('get_report_screenshot', { reportId: 'r-3' }));
        // Não devolve a recusa típica de DEV_TOOLS.
        expect(out).not.toMatch(/administrador/i);
        expect(out).toContain('r-3');
    });

    it('roda para admin também (não tem trava de papel)', async () => {
        mockFindPersistedScreenshot.mockReturnValue({ path: '/x.png', ext: 'png', mime: 'image/png' });
        const out = await runWithToolContext({ userLogin: 'admin', isAdmin: true },
            () => executeTool('get_report_screenshot', { reportId: 'r-4' }));
        expect(out).toContain('r-4');
        expect(out).toContain('<img');
    });

    it('trata string vazia como reportId ausente', async () => {
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_screenshot', { reportId: '   ' }));
        expect(out).toMatch(/Informe o reportId/);
    });
});

describe('agentTools — get_report_html (#1562)', () => {
    it('devolve HTML completo quando sem seletor', async () => {
        mockLoadPersistedHtmlFiltered.mockReturnValue({ html: '<div>ok</div>', truncated: false });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_html', { reportId: 'r-html-1' }));
        expect(out).toContain('HTML do report r-html-1');
        expect(out).toContain('HTML completo, sem filtro');
        expect(out).toContain('<div>ok</div>');
        expect(mockLoadPersistedHtmlFiltered).toHaveBeenCalledWith('r-html-1', undefined);
    });

    it('aplica seletor CSS quando informado', async () => {
        mockLoadPersistedHtmlFiltered.mockReturnValue({ html: '<tr>x</tr>', truncated: false });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_html', { reportId: 'r-html-2', selector: '#tabela' }));
        expect(out).toContain('filtrado pelo seletor: #tabela');
        expect(out).toContain('<tr>x</tr>');
        expect(mockLoadPersistedHtmlFiltered).toHaveBeenCalledWith('r-html-2', '#tabela');
    });

    it('aceita tanto selector quanto css_selector (snake_case defensivo)', async () => {
        mockLoadPersistedHtmlFiltered.mockReturnValue({ html: '<td>x</td>', truncated: false });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_html', { reportId: 'r-html-3', css_selector: '.cls' }));
        expect(out).toContain('.cls');
        expect(mockLoadPersistedHtmlFiltered).toHaveBeenCalledWith('r-html-3', '.cls');
    });

    it('devolve mensagem amigável quando report não existe', async () => {
        mockLoadPersistedHtmlFiltered.mockImplementation(() => {
            const e: any = new Error('Report r-missing não encontrado');
            e.statusCode = 404;
            e.code = 'REPORT_NOT_FOUND';
            throw e;
        });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_html', { reportId: 'r-missing' }));
        expect(out).toMatch(/não encontrado/);
        expect(out).not.toContain('REPORT_NOT_FOUND');
        expect(out).not.toMatch(/404/);
    });

    it('sugere seletor mais amplo quando SELECTOR_NO_MATCH', async () => {
        mockLoadPersistedHtmlFiltered.mockImplementation(() => {
            const e: any = new Error('Nenhum elemento');
            e.statusCode = 404;
            e.code = 'SELECTOR_NO_MATCH';
            throw e;
        });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_html', { reportId: 'r-html-4', selector: '#nope' }));
        expect(out).toMatch(/Nenhum elemento encontrado/);
        expect(out).toMatch(/#nope/);
        expect(out).toMatch(/seletor mais amplo/);
    });

    it('explica seletor CSS inválido quando INVALID_SELECTOR', async () => {
        mockLoadPersistedHtmlFiltered.mockImplementation(() => {
            const e: any = new Error('Seletor ruim');
            e.statusCode = 400;
            e.code = 'INVALID_SELECTOR';
            throw e;
        });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_html', { reportId: 'r-html-5', selector: '   ' }));
        expect(out).toMatch(/Seletor CSS inválido/);
        expect(out).toMatch(/sintaxe padrão/);
    });

    it('instrui o usuário a passar reportId quando ausente', async () => {
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_html', {}));
        expect(out).toMatch(/Informe o reportId/);
    });

    it('trunca resposta gigante em 200KB com marcador', async () => {
        const huge = 'x'.repeat(250 * 1024);
        mockLoadPersistedHtmlFiltered.mockReturnValue({ html: huge, truncated: false });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_html', { reportId: 'r-html-6' }));
        expect(out).toContain('truncado em 200KB');
        expect(out).toContain('<!-- truncated -->');
    });

    it('marca truncated quando o service já marcou', async () => {
        mockLoadPersistedHtmlFiltered.mockReturnValue({ html: '<div>x</div>', truncated: true });
        const out = await runWithToolContext({ userLogin: 'joao', isAdmin: false },
            () => executeTool('get_report_html', { reportId: 'r-html-7' }));
        expect(out).toContain('HTML do report r-html-7');
        expect(out).toContain('<div>x</div>');
    });

    it('roda para não-admin (não está em DEV_TOOLS)', async () => {
        mockLoadPersistedHtmlFiltered.mockReturnValue({ html: '<div>x</div>', truncated: false });
        const out = await runWithToolContext({ userLogin: 'fulano', isAdmin: false },
            () => executeTool('get_report_html', { reportId: 'r-html-8' }));
        expect(out).not.toMatch(/administrador/i);
        expect(out).toContain('r-html-8');
    });
});

describe('agentTools — get_report_screenshot/html NÃO estão em DEV_TOOLS (#1562)', () => {
    it('DEV_TOOLS não inclui as novas ferramentas', async () => {
        const { DEV_TOOLS } = await import('../../services/agentTools');
        expect(DEV_TOOLS.has('get_report_screenshot')).toBe(false);
        expect(DEV_TOOLS.has('get_report_html')).toBe(false);
    });

    it('prompt COMPLETO (admin) documenta as duas ferramentas em português', async () => {
        const { getToolsPrompt } = await import('../../services/agentTools');
        const admin = getToolsPrompt({ isAdmin: true });
        expect(admin).toContain('get_report_screenshot');
        expect(admin).toContain('get_report_html');
        expect(admin).toContain('reportId');
        expect(admin).toMatch(/veja o print do report/);
        expect(admin).toMatch(/URL ASSINADA temporária/);
        expect(admin).toMatch(/seletor CSS opcional/);
        // A frase do AC #1562 ("peça para o Marciano ver o print do report #42")
        // é citada como exemplo DENTRO da tool (linha 1759), não no prompt —
        // mas pelo menos uma das frases-chave em português tem que estar lá.
    });

    it('prompt NÃO-admin TAMBÉM lista as duas (qualquer logado usa)', async () => {
        const { getToolsPrompt } = await import('../../services/agentTools');
        const nonAdmin = getToolsPrompt({ isAdmin: false });
        expect(nonAdmin).toContain('get_report_screenshot');
        expect(nonAdmin).toContain('get_report_html');
        // Não devem estar filtradas pelo gate de DEV_TOOLS — elas são de
        // uso geral (Ler+escrever relatório já é logado).
        expect(nonAdmin).toMatch(/URL ASSINADA/);
    });
});