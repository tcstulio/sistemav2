/**
 * issueReportService.test.ts — testes do pipeline do POST /api/issues/report (#1561).
 *
 * Cobertura:
 *   - Sucesso end-to-end: gera reportId, chama createGitHubIssue com screenshot
 *     embutido (data URI) + HTML em code block, persiste artefatos, audita, retorna.
 *   - Sanitização: <script> é removido, atributos on* são removidos, estrutura mantida.
 *   - Screenshot > 5 MiB → rejeita com AppError 413 (PAYLOAD_TOO_LARGE).
 *   - HTML vazio/ausente → não quebra, gera issue sem code block HTML.
 *   - Falha na createGitHubIssue → auditoria registra `issue.report.github_failed` e relança.
 *   - Data URI só é embutida quando pequena; grandes viram link.
 *   - `buildReportIssueMarkdown` contém campos chave (URL, viewport, userId, consoleErrors).
 *   - `persistReportArtifacts` escreve .png, .html e .json (manifest) via fsImpl.
 *
 * Nota: o setup.ts global mocka `fs` para todos os testes. Aqui usamos um fsImpl
 * injetável (MemFS) para exercitar persistência sem acoplar ao mock global.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import {
    processIssueReport,
    buildReportIssueMarkdown,
    persistReportArtifacts,
    MAX_INLINE_DATAURI_CHARS,
    UPLOADS_URL_PREFIX,
    type IssueReportInput,
} from '../../services/issueReportService';
import { MAX_SCREENSHOT_BYTES, sanitizeReportHtml, b64ByteLength } from '../../middleware/uploadSanitizer';

/** In-memory fs minimal compatível com o subconjunto de fs usado pelo service. */
function makeMemFS() {
    const files = new Map<string, Buffer | string>();
    const dirs = new Set<string>();
    const impl = {
        mkdirSync: (p: string, opts?: any) => {
            void opts;
            dirs.add(p);
            // Registra todos os ancestrais como "existentes" p/ existsSync.
            let cur = p;
            for (let i = 0; i < 20; i++) {
                dirs.add(cur);
                const parent = path.dirname(cur);
                if (parent === cur) break;
                cur = parent;
            }
            return p;
        },
        writeFileSync: (p: string, data: any) => { files.set(p, data); },
        existsSync: (p: string) => files.has(p) || dirs.has(p),
        readFileSync: (p: string) => files.get(p),
        rmSync: (p: string) => { files.delete(p); dirs.delete(p); },
        readdirSync: (p: string) => [...files.keys()].filter((k) => k.startsWith(p + path.sep)),
        _files: files,
        _dirs: dirs,
    };
    return impl;
}

const baseInput: IssueReportInput = {
    userId: 'user-42',
    url: 'https://app.example.com/dashboard',
    viewport: '1440x900',
    userAgent: 'Mozilla/5.0 (test) Chrome',
    title: 'Botão salvar não funciona',
    description: 'Cliquei em salvar e nada aconteceu',
    breadcrumb: 'Dashboard › Modal Editar',
    htmlSnapshot: '<div><button onclick="evil()">ok</button><script>alert(1)</script></div>',
    screenshotBase64: Buffer.from('fake-png-bytes').toString('base64'),
    consoleErrors: ['TypeError: x is undefined'],
    consoleLogs: ['rendering dashboard'],
    failedRequests: ['POST /api/x → 500'],
    labels: ['from-app'],
};

const reporter = { id: 'user-42', login: 'tulio', ip: '127.0.0.1' };

describe('issueReportService (#1561)', () => {
    let memFS: ReturnType<typeof makeMemFS>;
    let createIssueMock: ReturnType<typeof vi.fn>;
    let auditMock: { record: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        memFS = makeMemFS();
        createIssueMock = vi.fn(async () => ({ url: 'https://github.com/tcstulio/sistemav2/issues/1601', number: 1601 }));
        auditMock = { record: vi.fn(() => ({ id: 'audit-1', ts: Date.now(), adminId: 'user-42', adminLogin: 'tulio', action: 'issue.report' })) };
    });

    it('sucesso: retorna { reportId, issueUrl } no formato esperado', async () => {
        const result = await processIssueReport(baseInput, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
        });

        expect(result.reportId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(result.issueUrl).toBe('https://github.com/tcstulio/sistemav2/issues/1601');
        expect(result.issueNumber).toBe(1601);
        expect(result.screenshotUrl).toBe(`${UPLOADS_URL_PREFIX}/${result.reportId}.png`);
        expect(result.htmlUrl).toBe(`${UPLOADS_URL_PREFIX}/${result.reportId}.html`);
    });

    it('chama createGitHubIssue com título + labels + body contendo URL/viewport/userAgent e HTML sanitizado', async () => {
        await processIssueReport(baseInput, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
        });

        expect(createIssueMock).toHaveBeenCalledTimes(1);
        const arg = createIssueMock.mock.calls[0][0];
        expect(arg.title).toBe('Botão salvar não funciona');
        expect(arg.labels).toEqual(['from-app']);
        expect(arg.body).toContain('https://app.example.com/dashboard');
        expect(arg.body).toContain('1440x900');
        expect(arg.body).toContain('Mozilla/5.0 (test) Chrome');
        expect(arg.body).toContain('user-42'); // userId / reporter
        // HTML sanitizado em code block — script removido.
        expect(arg.body).toContain('```html');
        expect(arg.body).not.toContain('<script');
        expect(arg.body).not.toContain('alert(1)');
        // consoleErrors/Logs incluídos.
        expect(arg.body).toContain('TypeError: x is undefined');
        expect(arg.body).toContain('rendering dashboard');
        expect(arg.body).toContain('POST /api/x → 500');
    });

    it('embute screenshot como data URI quando pequeno', async () => {
        await processIssueReport(baseInput, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
        });
        const body = createIssueMock.mock.calls[0][0].body;
        expect(body).toContain(`data:image/png;base64,${baseInput.screenshotBase64}`);
    });

    it('usa LINK quando screenshot é grande demais para embutir inline', async () => {
        const hugeB64 = 'A'.repeat(MAX_INLINE_DATAURI_CHARS + 100);
        // 'A'*25100 decodifica ~18k bytes — bem abaixo do limite de 5 MiB, passa no check de tamanho.
        const input = { ...baseInput, screenshotBase64: hugeB64 };
        const result = await processIssueReport(input, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
        });
        const body = createIssueMock.mock.calls[0][0].body;
        expect(body).not.toContain(`data:image/png;base64,${hugeB64}`);
        expect(body).toContain(result.screenshotUrl!);
    });

    it('registra auditoria em caso de sucesso (action=issue.report, quem + quando)', async () => {
        const fixedDate = new Date('2026-01-15T10:00:00.000Z');
        await processIssueReport(baseInput, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
            now: () => fixedDate,
        });
        expect(auditMock.record).toHaveBeenCalledWith(expect.objectContaining({
            action: 'issue.report',
            adminId: 'user-42',
            adminLogin: 'tulio',
            target: expect.stringMatching(/^[0-9a-f-]{36}$/i),
            summary: expect.stringContaining('tulio'),
        }));
        // "quando" está no summary (ISO timestamp).
        const summary = auditMock.record.mock.calls[0][0].summary as string;
        expect(summary).toContain(fixedDate.toISOString());
    });

    it('rejeita screenshot > 5 MiB com AppError 413 (PAYLOAD_TOO_LARGE)', async () => {
        // Gera um base64 cujo decodificado é 5 MiB + 1 byte.
        const justOver = MAX_SCREENSHOT_BYTES + 1;
        const buf = Buffer.alloc(justOver, 65); // 65 = 'A'
        const input = { ...baseInput, screenshotBase64: buf.toString('base64') };

        await expect(processIssueReport(input, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
        })).rejects.toMatchObject({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });

        expect(createIssueMock).not.toHaveBeenCalled();
    });

    it('aceita screenshot exatamente no limite (5 MiB)', async () => {
        const buf = Buffer.alloc(MAX_SCREENSHOT_BYTES, 65);
        const input = { ...baseInput, screenshotBase64: buf.toString('base64') };

        const result = await processIssueReport(input, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
        });
        expect(result.reportId).toBeDefined();
        // 5MB não cabe como data URI inline; vira link.
        expect(result.screenshotUrl).toContain(UPLOADS_URL_PREFIX);
    });

    it('falha na createGitHubIssue → registra auditoria github_failed E relança', async () => {
        const boom = new Error('gh CLI not installed');
        createIssueMock.mockRejectedValueOnce(boom);

        await expect(processIssueReport(baseInput, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
        })).rejects.toThrow('gh CLI not installed');

        expect(auditMock.record).toHaveBeenCalledWith(expect.objectContaining({
            action: 'issue.report.github_failed',
            adminId: 'user-42',
            target: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        }));
    });

    it('HTML vazio: gera issue sem code block HTML, mas mantém outros campos', async () => {
        const input = { ...baseInput, htmlSnapshot: '' };
        await processIssueReport(input, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
        });
        const body = createIssueMock.mock.calls[0][0].body;
        expect(body).not.toContain('```html');
        expect(body).toContain('https://app.example.com/dashboard');
    });

    it('persiste screenshot (.png), html (.html) e manifest (.json) via fsImpl', () => {
        const reportId = 'r-1234';
        const when = new Date('2026-07-19T12:00:00.000Z');
        const out = persistReportArtifacts({
            reportId,
            input: baseInput,
            sanitizedHtml: '<div>ok</div>',
            screenshotBuffer: Buffer.from([1, 2, 3, 4]),
            when,
            reporter,
            reportsDir: '/reports',
            fsImpl: memFS as any,
        });

        expect(out.screenshotPath).toBe(path.join('/reports', `${reportId}.png`));
        expect(out.htmlPath).toBe(path.join('/reports', `${reportId}.html`));

        expect(memFS._files.has(path.join('/reports', `${reportId}.png`))).toBe(true);
        expect(memFS._files.has(path.join('/reports', `${reportId}.html`))).toBe(true);
        const manifestRaw = String(memFS._files.get(path.join('/reports', `${reportId}.json`)));
        const manifest = JSON.parse(manifestRaw);
        expect(manifest.reportId).toBe(reportId);
        expect(manifest.reporter.login).toBe('tulio');
        expect(manifest.payload.url).toBe(baseInput.url);
        expect(manifest.artifacts.screenshot).toBe(out.screenshotUrl);
    });

    it('persistReportArtifacts sem screenshot/html: não cria esses arquivos', () => {
        const reportId = 'r-empty';
        const out = persistReportArtifacts({
            reportId,
            input: { ...baseInput, htmlSnapshot: '', screenshotBase64: undefined },
            sanitizedHtml: '',
            screenshotBuffer: null,
            when: new Date(),
            reporter,
            reportsDir: '/reports',
            fsImpl: memFS as any,
        });
        expect(out.screenshotPath).toBeNull();
        expect(out.htmlPath).toBeNull();
        expect(memFS._files.has(path.join('/reports', `${reportId}.png`))).toBe(false);
        expect(memFS._files.has(path.join('/reports', `${reportId}.html`))).toBe(false);
        // manifest ainda é escrito.
        expect(memFS._files.has(path.join('/reports', `${reportId}.json`))).toBe(true);
    });

    it('buildReportIssueMarkdown: contém título, descrição, contexto e identificadores', () => {
        const md = buildReportIssueMarkdown({
            title: 'X',
            description: 'desc',
            reportId: 'r-md',
            input: baseInput,
            reporter,
            when: new Date('2026-07-19T12:00:00.000Z'),
            screenshotUrl: '/uploads/reports/r-md.png',
            screenshotBase64: undefined,
            sanitizedHtml: '<div>clean</div>',
        });
        expect(md).toContain('# X');
        expect(md).toContain('desc');
        expect(md).toContain('`r-md`');
        expect(md).toContain('Dashboard › Modal Editar');
        expect(md).toContain('**User-Agent:**');
    });

    it('basePublicUrl transforma a URL servível em absoluta dentro do body da issue', async () => {
        await processIssueReport(baseInput, reporter, {
            createIssue: createIssueMock, audit: auditMock as any, reportsDir: '/reports', fsImpl: memFS as any,
            basePublicUrl: 'https://tunnel.example.com/',
        });
        const body = createIssueMock.mock.calls[0][0].body;
        // Screenshot base64 pequeno é embutido, mas o link direto também aparece (absoluto).
        expect(body).toContain('https://tunnel.example.com/uploads/reports/');
    });
});

describe('uploadSanitizer (unidade)', () => {
    it('sanitizeReportHtml remove <script> e atributos on*, mantém estrutura', () => {
        const dirty = '<div onclick="x()"><script>alert(1)</script><p>texto</p><button>ok</button></div>';
        const clean = sanitizeReportHtml(dirty);
        expect(clean).not.toContain('<script');
        expect(clean).not.toContain('alert(1)');
        expect(clean).not.toMatch(/\son\w+=/i); // nenhum handler on*
        expect(clean).toContain('<div>');
        expect(clean).toContain('<p>texto</p>');
        expect(clean).toContain('<button>ok</button>');
    });

    it('sanitizeReportHtml remove javascript: URIs em href', () => {
        const dirty = '<a href="javascript:alert(1)">x</a>';
        const clean = sanitizeReportHtml(dirty);
        expect(clean).not.toContain('javascript:');
    });

    it('sanitizeReportHtml mantém estrutura: html/head/body/div para debug', () => {
        const dirty = '<html><head><title>T</title></head><body><div class="a">x</div></body></html>';
        const clean = sanitizeReportHtml(dirty);
        expect(clean).toContain('<html');
        expect(clean).toContain('<head');
        expect(clean).toContain('<body');
        expect(clean).toContain('<div');
    });

    it('sanitizeReportHtml retorna vazio para null/undefined', () => {
        expect(sanitizeReportHtml(null)).toBe('');
        expect(sanitizeReportHtml(undefined)).toBe('');
        expect(sanitizeReportHtml('')).toBe('');
    });

    it('b64ByteLength calcula tamanho decodificado corretamente (com padding)', () => {
        expect(b64ByteLength('AAAA')).toBe(3);   // 4 chars -> 3 bytes
        expect(b64ByteLength('AAA=')).toBe(2);   // padding 1
        expect(b64ByteLength('AA==')).toBe(1);   // padding 2
        expect(b64ByteLength('')).toBe(0);
    });
});
