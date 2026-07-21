import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as fs from 'fs';
import { signDeeplink } from '../../utils/deeplinkToken';
import { REPORT_SCREENSHOT_TOKEN_KIND } from '../../services/issueReportService';

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
        processIssueReport: (...args: any[]) => mockProcessIssueReport(...args),
        // Mantém export dos constantes/helpers — só mockamos a função orquestradora.
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

describe('GET /api/issues/report/:id/screenshot', () => {
    const reportId = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

    it('retorna PNG com token válido', async () => {
        const token = signDeeplink(REPORT_SCREENSHOT_TOKEN_KIND, { reportId }, 3600);
        const res = await request(createApp()).get(`/api/issues/report/${reportId}/screenshot`).query({ token });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^image\/png/);
    });

    it('retorna 401 para token inválido', async () => {
        const res = await request(createApp()).get(`/api/issues/report/${reportId}/screenshot`).query({ token: 'invalid' });
        expect(res.status).toBe(401);
        expect(res.body.error.message).toMatch(/inválido ou expirado/);
    });
});

describe('GET /api/issues/report/:id/html', () => {
    const reportId = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

    it('exige autenticação e retorna HTML filtrado pelo primeiro match', async () => {
        (fs.readFileSync as any).mockReturnValue('<main><p class="error">primeiro</p><p class="error">segundo</p></main>');
        const res = await request(createApp()).get(`/api/issues/report/${reportId}/html`).query({ selector: '.error' });
        expect(res.status).toBe(200);
        expect(res.text).toBe('primeiro');
    });

    it('retorna 404 para seletor inexistente', async () => {
        (fs.readFileSync as any).mockReturnValue('<main>ok</main>');
        const res = await request(createApp()).get(`/api/issues/report/${reportId}/html`).query({ selector: '.missing' });
        expect(res.status).toBe(404);
        expect(res.body.error.message).toMatch(/não encontrado/);
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
