/**
 * issueReportService.test.ts — issue #1561.
 *
 * Cobertura:
 *   - createGitHubIssue: sucesso (mock `gh` CLI), dedup (retorna URL da
 *     issue similar existente), skipDedup, erro de CLI propagado.
 *   - saveScreenshotFile: cria diretório, escreve PNG, retorna URLs.
 *   - saveHtmlSnapshot: cria diretório, escreve HTML, retorna URLs.
 *   - buildIssueMarkdown: monta corpo com seções esperadas (reporter,
 *     URL/viewport/UA, console errors/logs, screenshot link + data URI
 *     quando pequeno, HTML sanitizado em code block).
 *   - processIssueReport: orquestra tudo, retorna { reportId, issueUrl },
 *     continua mesmo se screenshot/HTML falharem, loga auditoria.
 *
 * Estratégia: mocka child_process.execFile (para o `gh` CLI) e
 * fs.promises (para IO de disco). Logger mockado via setup.ts global.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks ----------------------------------------------------------

const mockExecFileAsync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
    execFile: vi.fn(),
}));

vi.mock('util', () => ({
    promisify: () => mockExecFileAsync,
}));

const mockFs = vi.hoisted(() => ({
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
}));

vi.mock('fs', () => ({
    promises: {
        mkdir: mockFs.mkdir,
        writeFile: mockFs.writeFile,
    },
    default: { promises: { mkdir: mockFs.mkdir, writeFile: mockFs.writeFile } },
}));

// sanitize-html mockado para testar a integração sem depender da lib real
// (o teste do uploadSanitizer já valida o comportamento do sanitize real).
vi.mock('sanitize-html', () => {
    const fn = (html: string) => html;
    fn.defaults = {
        allowedTags: ['p', 'div', 'span', 'img', 'style'],
        allowedAttributes: { '*': ['style', 'class'] },
    };
    return { default: fn };
});

// Imports após mocks ------------------------------------------------------

import {
    createGitHubIssue,
    saveScreenshotFile,
    saveHtmlSnapshot,
    buildIssueMarkdown,
    processIssueReport,
    MAX_ISSUE_BODY_CHARS,
} from '../../services/issueReportService';

describe('issueReportService (#1561)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExecFileAsync.mockReset();
    });

    describe('createGitHubIssue', () => {
        it('rejeita título vazio', async () => {
            await expect(createGitHubIssue({ title: '', body: 'b' }))
                .rejects.toThrow(/title/);
        });

        it('cria issue quando não há duplicata', async () => {
            // 1ª chamada: gh issue list (sem duplicatas).
            // 2ª chamada: gh issue create (retorna URL).
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockResolvedValueOnce({ stdout: 'https://github.com/tcstulio/sistemav2/issues/12345' });

            const result = await createGitHubIssue({
                title: 'Bug no login',
                body: 'descrição do bug',
                labels: ['bug'],
            });

            expect(result.url).toBe('https://github.com/tcstulio/sistemav2/issues/12345');
            expect(result.number).toBe(12345);
            expect(result.duplicateOf).toBeUndefined();
            // 2 chamadas: list (com --json number,title) + create.
            expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
            const createCallArgs = mockExecFileAsync.mock.calls[1][1];
            expect(createCallArgs).toContain('issue');
            expect(createCallArgs).toContain('create');
            expect(createCallArgs).toContain('Bug no login');
            expect(createCallArgs).toContain('--label');
            expect(createCallArgs).toContain('bug');
        });

        it('não cria duplicata quando há issue similar aberta', async () => {
            mockExecFileAsync.mockResolvedValueOnce({
                stdout: JSON.stringify([
                    { number: 999, title: 'Bug no login' },
                ]),
            });

            const result = await createGitHubIssue({
                title: 'Bug no login',
                body: 'descrição',
            });

            expect(result.duplicateOf).toBe(999);
            expect(result.number).toBe(999);
            expect(result.url).toMatch(/\/issues\/999$/);
            expect(mockExecFileAsync).toHaveBeenCalledTimes(1); // só o list
        });

        it('skipDedup pula a checagem e cria direto', async () => {
            mockExecFileAsync.mockResolvedValueOnce({
                stdout: 'https://github.com/tcstulio/sistemav2/issues/42\n',
            });

            const result = await createGitHubIssue({
                title: 'Qualquer título',
                body: 'b',
                skipDedup: true,
            });

            expect(result.url).toMatch(/\/issues\/42$/);
            expect(result.number).toBe(42);
            expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
        });

        it('fail-open quando a checagem de duplicata falha', async () => {
            mockExecFileAsync
                .mockRejectedValueOnce(new Error('network'))
                .mockResolvedValueOnce({ stdout: 'https://github.com/tcstulio/sistemav2/issues/7\n' });

            const result = await createGitHubIssue({
                title: 'Título',
                body: 'b',
            });

            expect(result.number).toBe(7);
            expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
        });

        it('propaga erro real de criação', async () => {
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockRejectedValueOnce(new Error('gh auth failed'));

            await expect(createGitHubIssue({ title: 'T', body: 'b' }))
                .rejects.toThrow(/gh auth failed/);
        });

        it('trunca título e body para os limites do GitHub', async () => {
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockResolvedValueOnce({ stdout: 'https://github.com/tcstulio/sistemav2/issues/1\n' });

            const longTitle = 'a'.repeat(500);
            const longBody = 'b'.repeat(MAX_ISSUE_BODY_CHARS + 1000);

            await createGitHubIssue({ title: longTitle, body: longBody });

            const createArgs = mockExecFileAsync.mock.calls[1][1] as string[];
            const titleIdx = createArgs.indexOf('--title') + 1;
            const bodyIdx = createArgs.indexOf('--body') + 1;
            expect(createArgs[titleIdx].length).toBeLessThanOrEqual(250);
            expect(createArgs[bodyIdx].length).toBeLessThanOrEqual(MAX_ISSUE_BODY_CHARS);
        });
    });

    describe('saveScreenshotFile', () => {
        it('cria diretório, escreve arquivo e retorna URLs', async () => {
            const result = await saveScreenshotFile(
                'data:image/png;base64,iVBORw0KGgo=',
                'rep-123',
            );

            expect(mockFs.mkdir).toHaveBeenCalledWith(
                expect.stringMatching(/uploads[\\/]+reports/),
                { recursive: true },
            );
            expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
            const [filePath, buffer] = mockFs.writeFile.mock.calls[0];
            expect(filePath).toMatch(/rep-123\.png$/);
            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(result.absolutePath).toMatch(/rep-123\.png$/);
            expect(result.publicUrl).toBe('/uploads/reports/rep-123.png');
        });

        it('aceita base64 puro (sem prefixo data URL)', async () => {
            const result = await saveScreenshotFile('iVBORw0KGgo=', 'rep-2');
            expect(result.publicUrl).toBe('/uploads/reports/rep-2.png');
            expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
        });
    });

    describe('saveHtmlSnapshot', () => {
        it('cria diretório, escreve HTML e retorna URLs', async () => {
            const result = await saveHtmlSnapshot('<div>olá</div>', 'rep-3');

            expect(mockFs.mkdir).toHaveBeenCalled();
            const [filePath, content] = mockFs.writeFile.mock.calls[0];
            expect(filePath).toMatch(/rep-3\.html$/);
            expect(content).toBe('<div>olá</div>');
            expect(result.publicUrl).toBe('/uploads/reports/rep-3.html');
        });
    });

    describe('buildIssueMarkdown', () => {
        const basePayload = {
            userId: 'u-1',
            url: 'https://app/dash',
            viewport: '1920x1080',
            userAgent: 'Mozilla/5.0',
        };

        it('inclui descrição e contexto (reporter, url, viewport, UA)', () => {
            const md = buildIssueMarkdown(
                { ...basePayload, description: 'quebrou o botão' },
                'maria',
                undefined,
                undefined,
                undefined,
            );

            expect(md).toMatch(/quebrou o botão/);
            expect(md).toMatch(/Reportado por.*maria/);
            expect(md).toMatch(/User ID.*u-1/);
            expect(md).toMatch(/URL.*app\/dash/);
            expect(md).toMatch(/Viewport.*1920x1080/);
            expect(md).toMatch(/User-Agent.*Mozilla/);
        });

        it('inclui erros/logs de console truncados', () => {
            const md = buildIssueMarkdown(
                {
                    ...basePayload,
                    consoleErrors: ['TypeError: x is undefined', 'ReferenceError: y'],
                    consoleLogs: ['log1', 'log2'],
                    failedRequests: ['POST /api/x 500'],
                },
                undefined,
                undefined,
                undefined,
                undefined,
            );

            expect(md).toMatch(/Erros de console/);
            expect(md).toMatch(/TypeError: x is undefined/);
            expect(md).toMatch(/Logs de console/);
            expect(md).toMatch(/Chamadas que falharam/);
            expect(md).toMatch(/POST \/api\/x 500/);
        });

        it('inclui link do screenshot quando URL fornecida', () => {
            const md = buildIssueMarkdown(
                basePayload,
                undefined,
                '/uploads/reports/r.png',
                undefined,
                undefined,
            );

            expect(md).toMatch(/!\[Screenshot\]\(\/uploads\/reports\/r\.png\)/);
        });

        it('embute data URI quando screenshot é pequeno (≤40k base64)', () => {
            const small = 'data:image/png;base64,' + 'A'.repeat(100);
            const md = buildIssueMarkdown(
                basePayload,
                undefined,
                '/uploads/reports/r.png',
                small,
                undefined,
            );

            expect(md).toMatch(/data:image\/png;base64/);
        });

        it('NÃO embute data URI quando screenshot é grande', () => {
            const big = 'data:image/png;base64,' + 'A'.repeat(50_000);
            const md = buildIssueMarkdown(
                basePayload,
                undefined,
                '/uploads/reports/r.png',
                big,
                undefined,
            );

            // Link está presente; data URI NÃO.
            expect(md).toMatch(/!\[Screenshot\]\(\/uploads\/reports\/r\.png\)/);
            expect(md).not.toMatch(/data:image\/png;base64/);
        });

        it('inclui HTML sanitizado em code block html', () => {
            const md = buildIssueMarkdown(
                basePayload,
                undefined,
                undefined,
                undefined,
                '<div>olá</div>',
            );

            expect(md).toMatch(/HTML Snapshot \(sanitizado\)/);
            expect(md).toMatch(/```html/);
            expect(md).toMatch(/<div>olá<\/div>/);
        });

        it('trunca HTML sanitizado > 20000 chars', () => {
            const huge = '<div>' + 'a'.repeat(30_000) + '</div>';
            const md = buildIssueMarkdown(
                basePayload,
                undefined,
                undefined,
                undefined,
                huge,
            );

            expect(md.length).toBeLessThan(huge.length + 5000);
            expect(md).toMatch(/truncado/);
        });
    });

    describe('processIssueReport', () => {
        const fullPayload = {
            userId: 'u-99',
            url: 'https://app/dashboard',
            viewport: '1280x720',
            userAgent: 'Mozilla/5.0',
            description: 'Botão salvar não funciona',
            screenshot: 'data:image/png;base64,iVBORw0KGgo=',
            htmlSnapshot: '<html><body><script>x()</script><div>ok</div></body></html>',
            consoleErrors: ['Uncaught TypeError'],
        };

        it('orquestra pipeline completo e retorna reportId + issueUrl', async () => {
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockResolvedValueOnce({ stdout: 'https://github.com/tcstulio/sistemav2/issues/500\n' });

            const result = await processIssueReport(fullPayload, 'joao');

            expect(result.reportId).toMatch(/^[0-9a-f-]{36}$/i); // UUID
            expect(result.issueUrl).toMatch(/\/issues\/500$/);
            expect(result.issueNumber).toBe(500);
            expect(result.screenshotPath).toBe(`/uploads/reports/${result.reportId}.png`);
            expect(result.htmlPath).toBe(`/uploads/reports/${result.reportId}.html`);
        });

        it('continua criando a issue mesmo se screenshot falhar ao salvar', async () => {
            mockFs.writeFile.mockRejectedValueOnce(new Error('disk full'));
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockResolvedValueOnce({ stdout: 'https://github.com/tcstulio/sistemav2/issues/501\n' });

            const result = await processIssueReport(fullPayload, undefined);

            expect(result.issueUrl).toMatch(/\/issues\/501$/);
            expect(result.screenshotPath).toBeUndefined();
        });

        it('continua criando a issue mesmo se HTML falhar ao salvar', async () => {
            // 1ª escrita (screenshot) ok; 2ª (HTML) falha.
            mockFs.writeFile
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('_perms'));
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockResolvedValueOnce({ stdout: 'https://github.com/tcstulio/sistemav2/issues/502\n' });

            const result = await processIssueReport(fullPayload, undefined);

            expect(result.issueUrl).toMatch(/\/issues\/502$/);
            expect(result.htmlPath).toBeUndefined();
        });

        it('propaga erro quando createGitHubIssue lança', async () => {
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockRejectedValueOnce(new Error('gh CLI crashed'));

            await expect(processIssueReport(fullPayload, 'u'))
                .rejects.toThrow(/gh CLI crashed/);
        });

        it('funciona sem screenshot e sem htmlSnapshot (campos opcionais)', async () => {
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockResolvedValueOnce({ stdout: 'https://github.com/tcstulio/sistemav2/issues/1\n' });

            const minimal = {
                userId: 'u-1',
                url: '/x',
                viewport: '100x100',
                userAgent: 'ua',
            };

            const result = await processIssueReport(minimal, 'r');
            expect(result.reportId).toBeDefined();
            expect(result.issueUrl).toMatch(/\/issues\/1$/);
            expect(result.screenshotPath).toBeUndefined();
            expect(result.htmlPath).toBeUndefined();
        });

        it('passa labels customizadas para o helper createGitHubIssue', async () => {
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockResolvedValueOnce({ stdout: 'https://github.com/tcstulio/sistemav2/issues/9\n' });

            await processIssueReport({ ...fullPayload, labels: ['urgent', 'ux'] }, undefined);

            const createArgs = mockExecFileAsync.mock.calls[1][1] as string[];
            expect(createArgs).toContain('urgent');
            expect(createArgs).toContain('ux');
        });

        it('usa label default from-app quando nenhum label informado', async () => {
            mockExecFileAsync
                .mockResolvedValueOnce({ stdout: JSON.stringify([]) })
                .mockResolvedValueOnce({ stdout: 'https://github.com/tcstulio/sistemav2/issues/10\n' });

            await processIssueReport(fullPayload, undefined);

            const createArgs = mockExecFileAsync.mock.calls[1][1] as string[];
            expect(createArgs).toContain('from-app');
        });
    });
});
