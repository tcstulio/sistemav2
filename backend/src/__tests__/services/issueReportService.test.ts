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
    SCREENSHOT_MAX_BYTES,
    SCREENSHOT_URL_TTL_SECONDS,
    REPORTS_DIR,
    IssueReportPayload,
    findPersistedScreenshot,
    loadPersistedScreenshot,
    buildSignedScreenshotUrl,
    verifySignedScreenshotToken,
    filterHtmlBySelector,
    loadPersistedHtmlFiltered,
    listReportFiles,
} from '../../services/issueReportService';
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

// =====================================================================
// #1562 — helpers de leitura de screenshot/HTML (ferramentas do agente Marciano)
// =====================================================================

describe('issueReportService — findPersistedScreenshot (#1562)', () => {
    it('retorna null quando nenhum arquivo do reportId existe', () => {
        // fs.existsSync defaulta para true no setup; sobrescreve p/ false neste teste.
        (fs.existsSync as any).mockReturnValue(false);
        expect(findPersistedScreenshot('rid-missing')).toBeNull();
    });

    it('retorna metadados quando existe .png', () => {
        (fs.existsSync as any).mockImplementation((p: string) => String(p).endsWith('.png'));
        const found = findPersistedScreenshot('rid-png');
        expect(found).not.toBeNull();
        expect(found!.ext).toBe('png');
        expect(found!.mime).toBe('image/png');
        expect(found!.path.replace(/\\/g, '/')).toContain('uploads/reports/rid-png.png');
    });

    it('retorna metadados quando existe .jpg (ext != mime)', () => {
        (fs.existsSync as any).mockImplementation((p: string) => String(p).endsWith('.jpg'));
        const found = findPersistedScreenshot('rid-jpg');
        expect(found!.ext).toBe('jpg');
        expect(found!.mime).toBe('image/jpeg');
    });

    it('retorna metadados quando existe .webp', () => {
        (fs.existsSync as any).mockImplementation((p: string) => String(p).endsWith('.webp'));
        const found = findPersistedScreenshot('rid-webp');
        expect(found!.ext).toBe('webp');
        expect(found!.mime).toBe('image/webp');
    });

    it('rejeita reportId malformado (path traversal, vazio, >128 chars)', () => {
        expect(() => findPersistedScreenshot('')).toThrow(/reportId/);
        expect(() => findPersistedScreenshot('../../../etc/passwd')).toThrow(/inválid/);
        expect(() => findPersistedScreenshot('a'.repeat(200))).toThrow(/inválid/);
        expect(() => findPersistedScreenshot('has space')).toThrow(/inválid/);
    });
});

describe('issueReportService — loadPersistedScreenshot (#1562)', () => {
    it('lança AppError 404 REPORT_NOT_FOUND com mensagem amigável', () => {
        (fs.existsSync as any).mockReturnValue(false);
        expect(() => loadPersistedScreenshot('rid-missing')).toThrow(/Report rid-missing não encontrado/);
    });

    it('lê bytes e devolve mime/ext quando arquivo existe', () => {
        const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        (fs.existsSync as any).mockImplementation((p: string) => String(p).endsWith('.png'));
        (fs.readFileSync as any).mockReturnValue(expected);
        const out = loadPersistedScreenshot('rid-ok');
        expect(out.bytes.equals(expected)).toBe(true);
        expect(out.mime).toBe('image/png');
        expect(out.ext).toBe('png');
    });
});

describe('issueReportService — buildSignedScreenshotUrl / verifySignedScreenshotToken (#1562)', () => {
    it('gera URL com TTL default de 1h (3600s)', () => {
        const url = buildSignedScreenshotUrl('rid-1', 'png');
        expect(url).toMatch(/^\/api\/issues\/report\/rid-1\/file\.png\?token=/);
        // Decodifica o payload do token p/ checar o exp (~1h)
        const token = url.split('token=')[1];
        const [body] = token.split('.');
        const padded = body.replace(/-/g, '+').replace(/_/g, '/').padEnd(body.length + (4 - body.length % 4) % 4, '=');
        const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        const ttl = payload.exp - payload.iat;
        expect(ttl).toBe(SCREENSHOT_URL_TTL_SECONDS);
        expect(payload.kind).toBe('report-file');
        expect(payload.reportId).toBe('rid-1');
        expect(payload.ext).toBe('png');
    });

    it('aceita TTL customizado', () => {
        const url = buildSignedScreenshotUrl('rid-2', 'jpg', 60);
        const token = url.split('token=')[1];
        const [body] = token.split('.');
        const padded = body.replace(/-/g, '+').replace(/_/g, '/').padEnd(body.length + (4 - body.length % 4) % 4, '=');
        const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        expect(payload.exp - payload.iat).toBe(60);
    });

    it('verifySignedScreenshotToken aceita token válido', () => {
        const url = buildSignedScreenshotUrl('rid-3', 'png');
        const token = url.split('token=')[1];
        const ok = verifySignedScreenshotToken('rid-3', 'png', token);
        expect(ok).not.toBeNull();
        expect(ok!.reportId).toBe('rid-3');
        expect(ok!.ext).toBe('png');
    });

    it('verifySignedScreenshotToken rejeita token adulterado (assinatura)', () => {
        const url = buildSignedScreenshotUrl('rid-4', 'png');
        const token = url.split('token=')[1];
        // Adultera o body — assinatura vai ficar inválida.
        const [body, sig] = token.split('.');
        const tampered = body.replace(/^./, 'X') + '.' + sig;
        expect(verifySignedScreenshotToken('rid-4', 'png', tampered)).toBeNull();
    });

    it('verifySignedScreenshotToken rejeita reportId diferente', () => {
        const url = buildSignedScreenshotUrl('rid-5', 'png');
        const token = url.split('token=')[1];
        expect(verifySignedScreenshotToken('outro-rid', 'png', token)).toBeNull();
    });

    it('verifySignedScreenshotToken rejeita extensão diferente', () => {
        const url = buildSignedScreenshotUrl('rid-6', 'png');
        const token = url.split('token=')[1];
        expect(verifySignedScreenshotToken('rid-6', 'jpg', token)).toBeNull();
    });

    it('verifySignedScreenshotToken rejeita token expirado', () => {
        // Assina em "tempo real", avança o relógio 2h e tenta validar — TTL de 1h
        // já passou. `vi.setSystemTime` é o modo correto de simular passagem de
        // tempo sem dormir o teste.
        const realNow = Date.now();
        vi.setSystemTime(realNow);
        const url = buildSignedScreenshotUrl('rid-7', 'png');
        vi.setSystemTime(realNow + 2 * 60 * 60 * 1000); // +2h
        const token = url.split('token=')[1];
        try {
            expect(verifySignedScreenshotToken('rid-7', 'png', token)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('verifySignedScreenshotToken rejeita token ausente/null', () => {
        expect(verifySignedScreenshotToken('r', 'png', undefined)).toBeNull();
        expect(verifySignedScreenshotToken('r', 'png', null)).toBeNull();
        expect(verifySignedScreenshotToken('r', 'png', '')).toBeNull();
        expect(verifySignedScreenshotToken('r', 'png', 'invalid')).toBeNull();
    });

    it('rejeita extensão com caracteres inválidos', () => {
        expect(() => buildSignedScreenshotUrl('rid-x', '../../../etc/passwd')).toThrow(/Extensão/);
        expect(() => buildSignedScreenshotUrl('rid-x', '')).toThrow(/Extensão/);
    });
});

describe('issueReportService — filterHtmlBySelector (#1562)', () => {
    const html = `
        <html><body>
            <div id="app">
                <h1>Título</h1>
                <table id="orders">
                    <tr><td>linha 1</td></tr>
                    <tr><td>linha 2</td></tr>
                </table>
                <span class="erro">500</span>
                <span class="erro" data-foo="bar">outro</span>
            </div>
        </body></html>`;

    it('retorna innerHTML do primeiro match (#id)', () => {
        const out = filterHtmlBySelector(html, '#orders');
        expect(out).toContain('<tr>');
        expect(out).toContain('linha 1');
        expect(out).toContain('linha 2');
        // innerHTML NÃO inclui a tag #orders em si, só os filhos.
        expect(out).not.toMatch(/<table[^>]*>/);
    });

    it('retorna innerHTML com seletor de classe (.classe)', () => {
        const out = filterHtmlBySelector(html, '.erro');
        expect(out).toContain('500');
    });

    it('suporta seletor com descendentes (table tr)', () => {
        const out = filterHtmlBySelector(html, 'table#orders tr');
        expect(out).toContain('linha 1');
    });

    it('suporta seletor com atributo ([data-foo])', () => {
        const out = filterHtmlBySelector(html, '[data-foo="bar"]');
        expect(out).toContain('outro');
    });

    it('lança AppError 404 SELECTOR_NO_MATCH com mensagem amigável', () => {
        expect(() => filterHtmlBySelector(html, '#nao-existe')).toThrow(/Nenhum elemento/);
        try {
            filterHtmlBySelector(html, '#nao-existe');
        } catch (e: any) {
            expect(e.code).toBe('SELECTOR_NO_MATCH');
            expect(e.statusCode).toBe(404);
        }
    });

    it('rejeita seletor vazio', () => {
        expect(() => filterHtmlBySelector(html, '')).toThrow(/obrigatório/);
        expect(() => filterHtmlBySelector(html, '   ')).toThrow(/obrigatório/);
    });

    it('rejeita seletor > 500 chars (anti-DoS)', () => {
        const long = '.' + 'a'.repeat(600);
        expect(() => filterHtmlBySelector(html, long)).toThrow(/500/);
    });
});

describe('issueReportService — loadPersistedHtmlFiltered (#1562)', () => {
    it('lê HTML completo quando sem seletor', () => {
        const expected = '<div>ok</div>';
        (fs.existsSync as any).mockReturnValue(true);
        (fs.readFileSync as any).mockReturnValue(expected);
        const { html, truncated } = loadPersistedHtmlFiltered('rid-html-1');
        expect(html).toBe(expected);
        expect(truncated).toBe(false);
    });

    it('lê HTML filtrado quando seletor informado', () => {
        (fs.existsSync as any).mockReturnValue(true);
        (fs.readFileSync as any).mockReturnValue('<div id="a">A</div><div id="b">B</div>');
        const { html } = loadPersistedHtmlFiltered('rid-html-2', '#a');
        expect(html).toContain('A');
        expect(html).not.toContain('B');
    });

    it('marca truncated=true quando HTML tem sentinel de truncamento prévio', () => {
        (fs.existsSync as any).mockReturnValue(true);
        (fs.readFileSync as any).mockReturnValue('<div>x</div>\n<!-- truncated -->');
        const { truncated } = loadPersistedHtmlFiltered('rid-html-3');
        expect(truncated).toBe(true);
    });

    it('lança 404 amigável quando HTML não existe', () => {
        (fs.existsSync as any).mockReturnValue(false);
        expect(() => loadPersistedHtmlFiltered('rid-missing')).toThrow(/não encontrado ou sem HTML/);
    });

    it('rejeita reportId malformado', () => {
        expect(() => loadPersistedHtmlFiltered('../etc')).toThrow(/inválid/);
    });
});

describe('issueReportService — listReportFiles (#1562)', () => {
    it('retorna [] quando diretório não existe', () => {
        (fs.existsSync as any).mockReturnValue(false);
        expect(listReportFiles()).toEqual([]);
    });

    it('retorna nomes de arquivos do diretório', () => {
        (fs.existsSync as any).mockReturnValue(true);
        (fs.readdirSync as any).mockReturnValue(['abc.png', 'abc.html', 'def.jpg']);
        expect(listReportFiles()).toEqual(['abc.png', 'abc.html', 'def.jpg']);
    });
});
