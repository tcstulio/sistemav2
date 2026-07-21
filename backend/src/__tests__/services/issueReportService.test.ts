import { describe, it, expect, vi, beforeEach } from 'vitest';

// `setup.ts` já provê um mock global de `fs`. Aqui só nos importamos do
// módulo para acessar os `vi.fn()` e asserir via `.mock.calls`.

const mockCreateGitHubIssue = vi.fn();

vi.mock('../../utils/githubIssue', async () => {
    const real = await vi.importActual<any>('../../utils/githubIssue');
    return {
        ...real,
        createGitHubIssue: (...args: any[]) => mockCreateGitHubIssue(...args),
        ensureGitHubLabel: vi.fn().mockResolvedValue(undefined),
        runGh: vi.fn().mockResolvedValue(''),
    };
});

import * as fs from 'fs';
import {
    decodeScreenshot,
    sanitizeHtmlSnapshot,
    persistScreenshot,
    persistHtmlSnapshot,
    buildDefaultTitle,
    processIssueReport,
    getReportScreenshotPath,
    getReportHtmlPath,
    getReportHtmlContent,
    getReportScreenshotLink,
    REPORT_SCREENSHOT_TOKEN_KIND,
    REPORT_ASSET_TTL_SECONDS,
    SCREENSHOT_MAX_BYTES,
    REPORTS_DIR,
    IssueReportPayload,
} from '../../services/issueReportService';
import { verifyDeeplink } from '../../utils/deeplinkToken';
import path from 'path';

beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubIssue.mockReset();
    mockCreateGitHubIssue.mockResolvedValue({
        url: 'https://github.com/tcstulio/sistemav2/issues/4242',
        number: 4242,
    });
});

describe('issueReportService — decodeScreenshot', () => {
    it('retorna null para input vazio/null', () => {
        expect(decodeScreenshot(undefined)).toBeNull();
        expect(decodeScreenshot(null)).toBeNull();
        expect(decodeScreenshot('')).toBeNull();
        expect(decodeScreenshot('   ')).toBeNull();
    });

    it('decodifica base64 puro (sem prefixo)', () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const result = decodeScreenshot(bytes.toString('base64'));
        expect(result).not.toBeNull();
        expect(result!.mime).toBe('image/png');
        expect(result!.bytes.equals(bytes)).toBe(true);
    });

    it('decodifica data URL com mime explícito', () => {
        const bytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
        const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
        const result = decodeScreenshot(dataUrl);
        expect(result).not.toBeNull();
        expect(result!.mime).toBe('image/jpeg');
        expect(result!.bytes.equals(bytes)).toBe(true);
    });

    it('rejeita mime não-imagem com AppError 400', () => {
        expect(() => decodeScreenshot('data:text/html;base64,PHNjcmlwdD4=')).toThrow(/imagem/);
    });

    it('rejeita base64 inválido (decoded vazio)', () => {
        expect(() => decodeScreenshot('###not-base64###')).toThrow(/base64/);
    });
});

describe('issueReportService — sanitizeHtmlSnapshot', () => {
    it('remove <script> executáveis', () => {
        const dirty = '<div>ok<script>alert(1)</script>fim</div>';
        const clean = sanitizeHtmlSnapshot(dirty);
        expect(clean).not.toContain('<script');
        expect(clean).not.toContain('alert(1)');
        expect(clean).toContain('<div>');
        expect(clean).toContain('fim');
    });

    it('remove inline event handlers (onclick, onerror)', () => {
        const dirty = '<p onclick="alert(1)">clica</p><img src="x" onerror="evil()">';
        const clean = sanitizeHtmlSnapshot(dirty);
        expect(clean).not.toContain('onclick=');
        expect(clean).not.toContain('onerror=');
        expect(clean).toContain('<p');
        expect(clean).toContain('<img');
    });

    it('remove javascript: schemes em hrefs', () => {
        const dirty = '<a href="javascript:alert(1)">link malicioso</a>';
        const clean = sanitizeHtmlSnapshot(dirty);
        expect(clean).not.toContain('javascript:');
    });

    it('mantém estrutura útil (tags, classes, ids, data-*)', () => {
        const html = '<div class="x" id="y" data-foo="bar" role="button"><span>texto</span></div>';
        const clean = sanitizeHtmlSnapshot(html);
        expect(clean).toContain('class="x"');
        expect(clean).toContain('id="y"');
        expect(clean).toContain('data-foo="bar"');
        expect(clean).toContain('role="button"');
        expect(clean).toContain('<span>texto</span>');
    });

    it('permite <style> para debug visual', () => {
        const html = '<style>.erro { color: red; }</style><div class="erro">x</div>';
        const clean = sanitizeHtmlSnapshot(html);
        expect(clean).toContain('<style>');
        expect(clean).toContain('color: red');
    });

    it('preserva http/https/data em src', () => {
        const html = '<img src="https://cdn.exemplo/logo.png">';
        const clean = sanitizeHtmlSnapshot(html);
        expect(clean).toContain('https://cdn.exemplo/logo.png');
    });
});

describe('issueReportService — persistScreenshot', () => {
    it('grava arquivo .png quando mime image/png', () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        const fp = persistScreenshot('rid-1', bytes, 'image/png');
        // Path normalizado p/ OS atual — só checamos que termina com `.png`
        // e contém o reportId esperado.
        expect(fp).toMatch(/rid-1\.png$/);
        expect(fp.replace(/\\/g, '/')).toContain('uploads/reports/rid-1.png');
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('usa extensão baseada no mime (jpg, png, etc.)', () => {
        persistScreenshot('rid-2', Buffer.from([0x00]), 'image/jpeg');
        const calls = (fs.writeFileSync as any).mock.calls;
        const last = calls[calls.length - 1][0] as string;
        expect(last.endsWith('.jpg')).toBe(true);
    });

    it('rejeita screenshot > 5MB com AppError 413', () => {
        const big = Buffer.alloc(SCREENSHOT_MAX_BYTES + 1, 0x00);
        expect(() => persistScreenshot('big', big, 'image/png')).toThrow(/excede o limite/);
    });

    it('sanitiza extensão de mime malicioso (application/x-evil)', () => {
        const fp = persistScreenshot('rid-3', Buffer.from([0x00]), 'application/x-evil');
        expect(fp.endsWith('.png')).toBe(true);
    });
});

describe('issueReportService — persistHtmlSnapshot', () => {
    it('persiste HTML e retorna path com truncated=false', () => {
        const { path: fp, truncated } = persistHtmlSnapshot('hid-1', '<div>ok</div>');
        expect(fp).toMatch(/hid-1\.html$/);
        expect(truncated).toBe(false);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('trunca HTML maior que 1MB', () => {
        const huge = '<div>' + 'x'.repeat(2 * 1024 * 1024) + '</div>';
        const { truncated } = persistHtmlSnapshot('hid-big', huge);
        expect(truncated).toBe(true);
    });

    it('remove <script> antes de gravar', () => {
        persistHtmlSnapshot('hid-2', '<div><script>bad()</script>ok</div>');
        const calls = (fs.writeFileSync as any).mock.calls;
        const lastWritten = calls[calls.length - 1][1] as Buffer | string;
        const text = Buffer.isBuffer(lastWritten) ? lastWritten.toString('utf8') : String(lastWritten);
        expect(text).not.toContain('<script');
    });
});

describe('issueReportService — assets de report', () => {
    const reportId = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

    it('encontra apenas assets de report com UUID válido', () => {
        expect(getReportScreenshotPath(reportId)?.replace(/\\/g, '/')).toContain(`${REPORTS_DIR.replace(/\\/g, '/')}/${reportId}.png`);
        expect(getReportHtmlPath(reportId)?.endsWith(`${reportId}.html`)).toBe(true);
        expect(getReportScreenshotPath('../report')).toBeNull();
        expect(getReportHtmlPath('42')).toBeNull();
    });

    it('retorna o HTML completo ou o innerHTML do primeiro match', () => {
        (fs.readFileSync as any).mockReturnValue('<main><p class="error">primeiro</p><p class="error">segundo</p></main>');
        expect(getReportHtmlContent(reportId)).toContain('<main>');
        expect(getReportHtmlContent(reportId, '.error')).toBe('primeiro');
    });

    it('retorna erros amigáveis para seletor ausente ou inválido', () => {
        (fs.readFileSync as any).mockReturnValue('<main>ok</main>');
        expect(() => getReportHtmlContent(reportId, '.missing')).toThrow(/não encontrado/);
        expect(() => getReportHtmlContent(reportId, '[')).toThrow(/inválido/);
    });

    it('gera link de screenshot com token válido por uma hora', () => {
        const link = getReportScreenshotLink(reportId);
        expect(link).toContain(`/api/issues/report/${reportId}/screenshot?token=`);
        const token = new URLSearchParams(link!.split('?')[1]).get('token');
        const payload = verifyDeeplink<{ reportId: string }>(token!, REPORT_SCREENSHOT_TOKEN_KIND);
        expect(payload?.data.reportId).toBe(reportId);
        expect(payload!.exp - payload!.iat).toBe(REPORT_ASSET_TTL_SECONDS);
    });
});


describe('issueReportService — buildDefaultTitle', () => {
    it('monta título a partir da URL', () => {
        expect(buildDefaultTitle('http://app.coolgroove.com.br/orders/123'))
            .toBe('Report via app — http://app.coolgroove.com.br/orders/123');
    });

    it('limita o tamanho da URL usada no título', () => {
        const longUrl = 'http://app/' + 'a'.repeat(300);
        const t = buildDefaultTitle(longUrl);
        expect(t.length).toBeLessThan(longUrl.length + 50);
    });

    it('cai para placeholder se URL vazia', () => {
        expect(buildDefaultTitle('')).toBe('Report via app — (sem url)');
    });
});

describe('issueReportService — processIssueReport (integração)', () => {
    const basePayload: IssueReportPayload = {
        userId: 'user-1',
        userLogin: 'joao',
        description: 'Pedido não carrega',
        url: 'http://app/orders/123',
        breadcrumb: 'Pedidos › Novo',
        viewport: '1280x800',
        userAgent: 'Mozilla/Chrome',
        // png mínimo (8 bytes válidos)
        htmlSnapshot: '<div><h1>Pedidos</h1><script>alert(1)</script></div>',
        screenshot: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        consoleErrors: ['Erro 500 em /api/orders'],
    };

    it('orquestra persistência + helper + retorna URLs', async () => {
        const result = await processIssueReport(basePayload);
        expect(result.reportId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(result.issueUrl).toContain('github.com/tcstulio/sistemav2/issues/4242');
        expect(result.issueNumber).toBe(4242);
        expect(result.screenshotUrl).toBe(`/static/reports/${result.reportId}.png`);
        expect(result.htmlUrl).toBe(`/static/reports/${result.reportId}.html`);
    });

    it('chama createGitHubIssue com título contendo a URL', async () => {
        const result = await processIssueReport(basePayload);
        const arg = mockCreateGitHubIssue.mock.calls[0][0];
        expect(arg.title).toContain('http://app/orders/123');
        expect(arg.title.length).toBeLessThanOrEqual(250);
        expect(arg.body).toContain('Pedido não carrega');
        expect(arg.body).toContain('Pedidos › Novo');
        expect(arg.body).toContain('http://app/orders/123');
        expect(arg.body).toContain('1280x800');
        expect(result.issueUrl).toContain('4242');
    });

    it('cria diretório de reports quando ausente (mkdir idempotente)', async () => {
        // Força o path "não existe" para garantir que mkdirSync seja chamado.
        (fs.existsSync as any).mockReturnValueOnce(false);
        await processIssueReport(basePayload);
        expect(fs.mkdirSync).toHaveBeenCalled();
        const callArgs = (fs.mkdirSync as any).mock.calls[0] as any[];
        expect(String(callArgs[0])).toContain('uploads');
        expect(callArgs[1]).toEqual(expect.objectContaining({ recursive: true }));
    });

    it('limita consoleErrors a 20 no context', async () => {
        const payload = {
            ...basePayload,
            consoleErrors: Array.from({ length: 50 }, (_, i) => `err ${i}`),
        };
        await processIssueReport(payload as IssueReportPayload);
        const arg = mockCreateGitHubIssue.mock.calls[0][0];
        // Verifica via context que chega ao buildIssueBody: o body não deve ter
        // entradas a partir de "err 20" (0-indexed). buildIssueBuilder usa slice(0,20).
        expect(arg.body).toContain('err 0');
        expect(arg.body).not.toContain('err 20');
    });

    it('não inclui htmlSnapshot/base64 no body (vai em arquivo)', async () => {
        await processIssueReport(basePayload);
        const arg = mockCreateGitHubIssue.mock.calls[0][0];
        // O base64 do screenshot tem ~100 chars; não deve vazar.
        expect(arg.body).not.toContain('iVBORw0KGgoAAAA');
        expect(arg.body).toMatch(/Snapshot HTML|pulado|anexo|salvo/i);
    });

    it('usa título customizado quando fornecido', async () => {
        await processIssueReport({ ...basePayload, title: '  Bug crítico nas ordens  ' });
        const arg = mockCreateGitHubIssue.mock.calls[0][0];
        expect(arg.title).toBe('Bug crítico nas ordens');
    });

    it('inclui labels extras quando fornecido (sem duplicar from-app)', async () => {
        await processIssueReport({ ...basePayload, extraLabels: ['from-app', 'p1', 'critical'] });
        const arg = mockCreateGitHubIssue.mock.calls[0][0];
        expect(arg.labels).toContain('from-app');
        expect(arg.labels).toContain('p1');
        expect(arg.labels).toContain('critical');
        const fromAppCount = arg.labels.filter((l: string) => l === 'from-app').length;
        expect(fromAppCount).toBe(1);
    });

    it('rejeita screenshot > 5MB com AppError 413', async () => {
        const payload = {
            ...basePayload,
            // 5MB+ de zeros → base64 ≈ 6.7MB
            screenshot: 'A'.repeat(7 * 1024 * 1024),
        };
        await expect(processIssueReport(payload as IssueReportPayload)).rejects.toThrow(/excede o limite/);
        expect(mockCreateGitHubIssue).not.toHaveBeenCalled();
    });
});
