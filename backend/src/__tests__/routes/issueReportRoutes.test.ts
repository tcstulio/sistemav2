import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// === Mocks Hoisted ===

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', login: 'joao', role: 'user', admin: '0' };
    next();
}));

const mockAdminAuditService = vi.hoisted(() => ({
    record: vi.fn(),
    list: vi.fn(),
}));

const mockProcessIssueReport = vi.hoisted(() => vi.fn());
// #1562 — mocks adicionais para os endpoints de leitura. Mantidos no mesmo
// `vi.hoisted` block p/ garantirem inicialização ANTES do `vi.mock` rodar.
const mockFindPersistedScreenshot = vi.hoisted(() => vi.fn());
const mockLoadPersistedScreenshot = vi.hoisted(() => vi.fn());
const mockLoadPersistedHtmlFiltered = vi.hoisted(() => vi.fn());
const mockBuildSignedScreenshotUrl = vi.hoisted(() => vi.fn());

// fs mock: writes no-op (não persistimos de verdade no teste de rota)
vi.mock('fs', async () => {
    return {
        default: {
            existsSync: vi.fn(() => true),
            mkdirSync: vi.fn(),
            writeFileSync: vi.fn(),
            readFileSync: vi.fn(() => Buffer.from('')),
            unlinkSync: vi.fn(),
            renameSync: vi.fn(),
            readdirSync: vi.fn(() => []),
        },
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi.fn(() => Buffer.from('')),
        unlinkSync: vi.fn(),
        renameSync: vi.fn(),
        readdirSync: vi.fn(() => []),
    };
});

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/adminAuditService', () => ({
    adminAuditService: mockAdminAuditService,
}));

vi.mock('../../services/issueReportService', async () => {
    const real = await vi.importActual<any>('../../services/issueReportService');
    return {
        ...real,
        // Mantém export das constantes/helpers — só mockamos as funções que os
        // endpoints invocam, deixando o resto (signReportFileToken etc.) real
        // p/ os testes de round-trip do token.
        processIssueReport: (...args: any[]) => mockProcessIssueReport(...args),
        findPersistedScreenshot: (...args: any[]) => mockFindPersistedScreenshot(...args),
        loadPersistedScreenshot: (...args: any[]) => mockLoadPersistedScreenshot(...args),
        loadPersistedHtmlFiltered: (...args: any[]) => mockLoadPersistedHtmlFiltered(...args),
        buildSignedScreenshotUrl: (...args: any[]) => mockBuildSignedScreenshotUrl(...args),
    };
});

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

vi.mock('../../utils/sentry', () => ({
    initSentry: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    getSentryRequestHandler: vi.fn(() => null),
}));

import issueReportRoutes from '../../routes/issueReportRoutes';
import { errorHandler } from '../../middleware/errorHandler';
import { AppError, ValidationError } from '../../middleware/errorHandler';
import * as fs from 'fs';

function createApp() {
    const app = express();
    app.use(express.json({ limit: '20mb' }));
    app.use('/api', issueReportRoutes);
    app.use(errorHandler);
    return app;
}

const validPayload = {
    userId: 'user-1',
    userLogin: 'joao',
    description: 'Pedido não carrega',
    title: 'Bug na tela de pedidos',
    url: 'http://app/orders/123',
    breadcrumb: 'Pedidos › Novo',
    viewport: '1280x800',
    userAgent: 'Mozilla/Chrome',
    htmlSnapshot: '<div><h1>Pedidos</h1></div>',
    screenshot: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    consoleErrors: ['Erro 500 em /api/orders'],
};

beforeEach(() => {
    vi.clearAllMocks();
    mockRequireDolibarrLogin.mockImplementation((req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', login: 'joao', role: 'user', admin: '0' };
        next();
    });
    mockAdminAuditService.record.mockReturnValue({
        id: 'audit-1', ts: 1, adminId: 'user-1', adminLogin: 'joao',
        action: 'issue.report.create', target: 'x', summary: 'y',
    });
    mockProcessIssueReport.mockResolvedValue({
        reportId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        issueUrl: 'https://github.com/tcstulio/sistemav2/issues/4242',
        issueNumber: 4242,
        screenshotUrl: '/static/reports/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png',
        htmlUrl: '/static/reports/a1b2c3d4-e5f6-7890-abcd-ef1234567890.html',
    });
});

describe('POST /api/issues/report', () => {
    it('retorna 201 com reportId e issueUrl em sucesso', async () => {
        const res = await request(createApp())
            .post('/api/issues/report')
            .send(validPayload)
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.reportId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        expect(res.body.issueUrl).toContain('/issues/4242');
        expect(res.body.issueNumber).toBe(4242);
        expect(res.body.screenshotUrl).toMatch(/^\/static\/reports\//);
        expect(res.body.htmlUrl).toMatch(/^\/static\/reports\/.*\.html$/);
    });

    it('chama processIssueReport com o payload validado', async () => {
        await request(createApp())
            .post('/api/issues/report')
            .send(validPayload)
            .set('Content-Type', 'application/json');
        expect(mockProcessIssueReport).toHaveBeenCalledTimes(1);
        const arg = mockProcessIssueReport.mock.calls[0][0];
        expect(arg.userId).toBe('user-1');
        expect(arg.userLogin).toBe('joao');
        expect(arg.url).toBe('http://app/orders/123');
        expect(arg.viewport).toBe('1280x800');
        expect(arg.userAgent).toBe('Mozilla/Chrome');
        expect(arg.screenshot).toContain('iVBORw0KGgo');
    });

    it('registra entrada no audit log (não-bloqueante)', async () => {
        const res = await request(createApp())
            .post('/api/issues/report')
            .send(validPayload)
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(201);
        expect(mockAdminAuditService.record).toHaveBeenCalledTimes(1);
        const auditArg = mockAdminAuditService.record.mock.calls[0][0];
        expect(auditArg.action).toBe('issue.report.create');
        expect(auditArg.adminId).toBe('user-1');
        expect(auditArg.adminLogin).toBe('joao');
        expect(auditArg.target).toContain('/issues/4242');
        expect(auditArg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('audit log falhando NÃO derruba a response 201', async () => {
        mockAdminAuditService.record.mockImplementation(() => { throw new Error('disk full'); });
        const res = await request(createApp())
            .post('/api/issues/report')
            .send(validPayload)
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
    });
});

describe('POST /api/issues/report — validação 400', () => {
    it('retorna 400 quando userId falta', async () => {
        const { userId, ...rest } = validPayload;
        const res = await request(createApp())
            .post('/api/issues/report')
            .send(rest)
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('retorna 400 quando url falta', async () => {
        const { url, ...rest } = validPayload;
        const res = await request(createApp())
            .post('/api/issues/report')
            .send(rest)
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(400);
        expect(res.body.error.details.some((d: any) => d.field === 'url')).toBe(true);
    });

    it('retorna 400 quando viewport falta', async () => {
        const { viewport, ...rest } = validPayload;
        const res = await request(createApp())
            .post('/api/issues/report')
            .send(rest)
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(400);
        expect(res.body.error.details.some((d: any) => d.field === 'viewport')).toBe(true);
    });

    it('retorna 400 quando userAgent falta', async () => {
        const { userAgent, ...rest } = validPayload;
        const res = await request(createApp())
            .post('/api/issues/report')
            .send(rest)
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(400);
        expect(res.body.error.details.some((d: any) => d.field === 'userAgent')).toBe(true);
    });

    it('retorna 400 quando múltiplos campos faltam (não falha no primeiro)', async () => {
        const res = await request(createApp())
            .post('/api/issues/report')
            .send({ description: 'foo' })
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(400);
        const fields = res.body.error.details.map((d: any) => d.field);
        expect(fields).toContain('userId');
        expect(fields).toContain('url');
        expect(fields).toContain('viewport');
        expect(fields).toContain('userAgent');
    });
});

describe('POST /api/issues/report — limite 413', () => {
    it('retorna 413 quando screenshot decodificado > 5MB (estimativa por length)', async () => {
        // 5MB decodificado = ~6.97MB de base64 puro.
        const hugeBase64 = 'A'.repeat(7 * 1024 * 1024);
        const res = await request(createApp())
            .post('/api/issues/report')
            .send({ ...validPayload, screenshot: hugeBase64 })
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(413);
        expect(res.body.error.code).toBe('SCREENSHOT_TOO_LARGE');
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('screenshot menor que 5MB passa da pré-checagem 413', async () => {
        // 1MB de 'A's = ~1.33MB base64, decodificado fica bem abaixo de 5MB.
        const small = 'A'.repeat(1024 * 1024);
        const res = await request(createApp())
            .post('/api/issues/report')
            .send({ ...validPayload, screenshot: small })
            .set('Content-Type', 'application/json');
        // processIssueReport está mockado, então chega a 201.
        expect(res.status).toBe(201);
    });
});

describe('POST /api/issues/report — 502 em falha do GitHub', () => {
    it('mapeia falha do createGitHubIssue para 502', async () => {
        mockProcessIssueReport.mockRejectedValue(
            new AppError(502, 'GITHUB_ISSUE_CREATE_FAILED', 'gh issue create failed: bad token')
        );
        const res = await request(createApp())
            .post('/api/issues/report')
            .send(validPayload)
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(502);
        expect(res.body.error.code).toBe('GITHUB_ISSUE_CREATE_FAILED');
    });

    it('mapeia erro de validação (Zod → ValidationError) para 400 envelope padronizado', async () => {
        const res = await request(createApp())
            .post('/api/issues/report')
            .send({ nothing: 'relevant' })
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.message).toBeDefined();
    });
});

describe('POST /api/issues/report — auth', () => {
    it('aplica requireDolibarrLogin (401 quando ausente)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((_req: any, res: any) => {
            res.status(401).json({ error: 'unauthorized' });
        });
        const res = await request(createApp())
            .post('/api/issues/report')
            .send(validPayload)
            .set('Content-Type', 'application/json');
        expect(res.status).toBe(401);
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });
});

describe('GET /api/issues/report/_health', () => {
    it('retorna ok com metadados do endpoint', async () => {
        const res = await request(createApp()).get('/api/issues/report/_health');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.endpoint).toBe('POST /api/issues/report');
    });
});

// =====================================================================
// #1562 — endpoints de LEITURA de screenshot/HTML (ferramentas do agente Marciano)
// =====================================================================

// Para os testes das rotas de leitura, mockamos `findPersistedScreenshot`,
// `loadPersistedScreenshot` e `loadPersistedHtmlFiltered` para controlar
// 200/404 sem depender de arquivos reais em disco. O service real já tem
// testes próprios (issueReportService.test.ts); aqui validamos só o
// contrato HTTP — status, body shape, aplicação de token, etc.

describe('GET /api/issues/report/:id/screenshot (#1562)', () => {
    beforeEach(() => {
        mockFindPersistedScreenshot.mockReset();
        mockBuildSignedScreenshotUrl.mockReset();
    });

    it('retorna 200 com URL assinada (TTL 1h) quando screenshot existe', async () => {
        mockFindPersistedScreenshot.mockReturnValue({ path: '/uploads/reports/r1.png', ext: 'png', mime: 'image/png' });
        mockBuildSignedScreenshotUrl.mockReturnValue('/api/issues/report/r1/file.png?token=abc.def');
        const res = await request(createApp()).get('/api/issues/report/r1/screenshot');
        expect(res.status).toBe(200);
        expect(res.body.reportId).toBe('r1');
        expect(res.body.mime).toBe('image/png');
        expect(res.body.ext).toBe('png');
        expect(res.body.url).toBe('/api/issues/report/r1/file.png?token=abc.def');
        expect(res.body.ttlSeconds).toBe(3600);
        expect(res.body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(mockBuildSignedScreenshotUrl).toHaveBeenCalledWith('r1', 'png', 3600);
    });

    it('retorna 404 REPORT_NOT_FOUND com mensagem amigável quando report não existe', async () => {
        mockFindPersistedScreenshot.mockReturnValue(null);
        const res = await request(createApp()).get('/api/issues/report/missing/screenshot');
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('REPORT_NOT_FOUND');
        expect(res.body.error.message).toContain('missing');
        expect(res.body.error.message).toMatch(/screenshot/);
    });

    it('aplica requireDolibarrLogin (401 sem auth)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((_req: any, res: any) => {
            res.status(401).json({ error: 'unauthorized' });
        });
        mockFindPersistedScreenshot.mockReturnValue({ path: '/x.png', ext: 'png', mime: 'image/png' });
        const res = await request(createApp()).get('/api/issues/report/r1/screenshot');
        expect(res.status).toBe(401);
        expect(mockBuildSignedScreenshotUrl).not.toHaveBeenCalled();
    });

    it('rejeita reportId malformado com 400 INVALID_REPORT_ID', async () => {
        mockFindPersistedScreenshot.mockImplementation(() => {
            const e: any = new Error('reportId contém caracteres inválidos');
            e.statusCode = 400;
            e.code = 'INVALID_REPORT_ID';
            throw e;
        });
        const res = await request(createApp()).get('/api/issues/report/has%20space/screenshot');
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_REPORT_ID');
    });
});

describe('GET /api/issues/report/:id/html (#1562)', () => {
    beforeEach(() => {
        mockLoadPersistedHtmlFiltered.mockReset();
    });

    it('retorna 200 com HTML completo quando sem seletor', async () => {
        mockLoadPersistedHtmlFiltered.mockReturnValue({ html: '<div>conteúdo</div>', truncated: false });
        const res = await request(createApp()).get('/api/issues/report/r2/html');
        expect(res.status).toBe(200);
        expect(res.body.html).toBe('<div>conteúdo</div>');
        expect(res.body.selector).toBeNull();
        expect(res.body.matchedSelector).toBe(false);
        expect(res.body.truncated).toBe(false);
        expect(mockLoadPersistedHtmlFiltered).toHaveBeenCalledWith('r2', undefined);
    });

    it('aceita ?selector= e repassa para o service', async () => {
        mockLoadPersistedHtmlFiltered.mockReturnValue({ html: '<tr>x</tr>', truncated: false });
        const res = await request(createApp()).get('/api/issues/report/r3/html?selector=%23tabela-pedidos');
        expect(res.status).toBe(200);
        expect(res.body.selector).toBe('#tabela-pedidos');
        expect(res.body.matchedSelector).toBe(true);
        expect(mockLoadPersistedHtmlFiltered).toHaveBeenCalledWith('r3', '#tabela-pedidos');
    });

    it('respeita ?maxBytes truncando resposta gigante', async () => {
        const huge = 'x'.repeat(500 * 1024);
        mockLoadPersistedHtmlFiltered.mockReturnValue({ html: huge, truncated: false });
        const res = await request(createApp()).get('/api/issues/report/r4/html?maxBytes=1024');
        expect(res.status).toBe(200);
        expect(res.body.truncated).toBe(true);
        expect(res.body.bytes).toBeLessThanOrEqual(1024 + 100); // margem do sentinel
        expect(res.body.html).toContain('<!-- truncated -->');
    });

    it('traduz SELECTOR_NO_MATCH (404 do service) para resposta 404', async () => {
        mockLoadPersistedHtmlFiltered.mockImplementation(() => {
            const e: any = new Error('Nenhum elemento');
            e.statusCode = 404;
            e.code = 'SELECTOR_NO_MATCH';
            throw e;
        });
        const res = await request(createApp()).get('/api/issues/report/r5/html?selector=%23nope');
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('SELECTOR_NO_MATCH');
    });

    it('retorna 404 amigável quando report não existe', async () => {
        mockLoadPersistedHtmlFiltered.mockImplementation(() => {
            const e: any = new Error('Report não encontrado');
            e.statusCode = 404;
            e.code = 'REPORT_NOT_FOUND';
            throw e;
        });
        const res = await request(createApp()).get('/api/issues/report/inexistente/html');
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('REPORT_NOT_FOUND');
    });

    it('retorna 400 INVALID_SELECTOR quando service detecta seletor ruim', async () => {
        mockLoadPersistedHtmlFiltered.mockImplementation(() => {
            const e: any = new Error('Seletor inválido');
            e.statusCode = 400;
            e.code = 'INVALID_SELECTOR';
            throw e;
        });
        const res = await request(createApp()).get('/api/issues/report/r6/html?selector=%20%20');
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_SELECTOR');
    });

    it('aplica requireDolibarrLogin (401 sem auth)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((_req: any, res: any) => {
            res.status(401).json({ error: 'unauthorized' });
        });
        const res = await request(createApp()).get('/api/issues/report/r7/html');
        expect(res.status).toBe(401);
        expect(mockLoadPersistedHtmlFiltered).not.toHaveBeenCalled();
    });
});

describe('GET /api/issues/report/:id/file.:ext?token=... (#1562)', () => {
    // Para o teste end-to-end do file route, deixamos o service REAL assinar
    // e validar o token (só assim garantimos que o formato do token bate).
    // Os testes anteriores de token (round-trip + adulteração) vivem no
    // issueReportService.test.ts e cobrem o service isolado.

    beforeEach(() => {
        // Restaura a implementação REAL para esta suite (alguns describes
        // acima substituem por mockReturnValue; limpamos aqui para os testes
        // que dependem do signing real).
        mockBuildSignedScreenshotUrl.mockReset();
    });

    it('serve o arquivo binário com Content-Type correto quando token válido', async () => {
        const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        // Configura o fs mock: existeSync true p/ o .png, readFileSync → pngBytes.
        (fs.existsSync as any).mockImplementation((p: string) => String(p).endsWith('.png'));
        (fs.readFileSync as any).mockImplementation((p: string) => {
            if (String(p).endsWith('.png')) return pngBytes;
            return Buffer.from('');
        });
        // Configura o mock do loadPersistedScreenshot p/ devolver o payload esperado.
        mockLoadPersistedScreenshot.mockReturnValue({ bytes: pngBytes, mime: 'image/png', ext: 'png' });
        // Gera um token REAL via o helper de signing do utilitário (não mockado).
        const { signReportFileToken } = await import('../../utils/reportFileToken');
        const token = signReportFileToken({ reportId: 'r-file-1', ext: 'png' }, 60);

        const res = await request(createApp()).get(`/api/issues/report/r-file-1/file.png?token=${token}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/image\/png/);
        expect(Buffer.from(res.body).equals(pngBytes)).toBe(true);
    });

    it('retorna 401 quando token ausente', async () => {
        (fs.existsSync as any).mockReturnValue(true);
        const res = await request(createApp()).get('/api/issues/report/r-file-2/file.png');
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    });

    it('retorna 401 quando token adulterado', async () => {
        (fs.existsSync as any).mockReturnValue(true);
        const res = await request(createApp()).get('/api/issues/report/r-file-3/file.png?token=invalid');
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    });

    it('retorna 400 INVALID_EXT quando extensão tem caracteres inválidos', async () => {
        const res = await request(createApp()).get('/api/issues/report/r-file-4/file.php?token=abc');
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_EXT');
    });

    it('retorna 401 quando token pertence a OUTRO reportId', async () => {
        (fs.existsSync as any).mockReturnValue(true);
        const { signReportFileToken } = await import('../../utils/reportFileToken');
        const token = signReportFileToken({ reportId: 'outro-report', ext: 'png' }, 60);
        const res = await request(createApp()).get(`/api/issues/report/r-file-5/file.png?token=${token}`);
        expect(res.status).toBe(401);
    });
});
