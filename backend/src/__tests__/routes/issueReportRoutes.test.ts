/**
 * issueReportRoutes.test.ts — issue #1561.
 *
 * Cobertura (HTTP via supertest):
 *   - 401 quando auth ausente (requireDolibarrLogin mockado).
 *   - 400 quando faltam campos obrigatórios (userId, url, viewport, userAgent).
 *   - 413 quando screenshot > 5MB (screenshotSizeGuard).
 *   - 201 com envelope { success:true, data:{ reportId, issueUrl } } em sucesso.
 *   - 500 com envelope { success:false, error } quando service lança.
 *   - 200 informativo no GET /report.
 *
 * Mocks:
 *   - authMiddleware.requireDolibarrLogin (contorna Dolibarr real)
 *   - issueReportService.processIssueReport (casca fina — service já testado)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() =>
    vi.fn((req: any, _res: any, next: any) => {
        req.user = { login: 'tester', admin: '0' };
        next();
    })
);

const mockProcessIssueReport = vi.hoisted(() =>
    vi.fn(async (payload: any, reporter: string | undefined) => ({
        reportId: 'fixed-uuid-1234',
        issueUrl: 'https://github.com/tcstulio/sistemav2/issues/999',
        issueNumber: 999,
        screenshotPath: '/uploads/reports/fixed-uuid-1234.png',
        htmlPath: '/uploads/reports/fixed-uuid-1234.html',
        _payload: payload,
        _reporter: reporter,
    }))
);

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/issueReportService', () => ({
    processIssueReport: mockProcessIssueReport,
    createGitHubIssue: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    }),
}));

import issueReportRoutes from '../../routes/issueReportRoutes';

function createApp() {
    const app = express();
    app.use(express.json({ limit: '15mb' }));
    app.use('/api/issues', issueReportRoutes);
    return app;
}

const VALID_PAYLOAD = {
    userId: 'u-1',
    url: 'https://app/dashboard',
    viewport: '1920x1080',
    userAgent: 'Mozilla/5.0',
    description: 'botão salvar não funciona',
    screenshot: 'data:image/png;base64,iVBORw0KGgo=',
    htmlSnapshot: '<html><body><div>ok</div></body></html>',
    consoleErrors: ['Uncaught TypeError'],
};

describe('issueReportRoutes POST /api/issues/report (#1561)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    it('retorna 201 com { success:true, data:{ reportId, issueUrl } } em sucesso', async () => {
        const res = await request(app)
            .post('/api/issues/report')
            .send(VALID_PAYLOAD);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.reportId).toBeDefined();
        expect(res.body.data.issueUrl).toMatch(/github\.com.*\/issues\/999$/);
        expect(res.body.data.issueNumber).toBe(999);
        expect(res.body.data.screenshotUrl).toMatch(/\/uploads\/reports\//);
        expect(res.body.data.htmlUrl).toMatch(/\/uploads\/reports\//);

        expect(mockProcessIssueReport).toHaveBeenCalledTimes(1);
        const [payload, reporter] = mockProcessIssueReport.mock.calls[0];
        expect(payload.userId).toBe('u-1');
        expect(reporter).toBe('tester');
    });

    it('retorna 400 quando userId está ausente', async () => {
        const { userId, ...noUserId } = VALID_PAYLOAD;
        const res = await request(app)
            .post('/api/issues/report')
            .send(noUserId);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('retorna 400 quando url está ausente', async () => {
        const res = await request(app)
            .post('/api/issues/report')
            .send({ ...VALID_PAYLOAD, url: '' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('retorna 400 quando viewport está ausente', async () => {
        const res = await request(app)
            .post('/api/issues/report')
            .send({ ...VALID_PAYLOAD, viewport: undefined });

        expect(res.status).toBe(400);
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('retorna 400 quando userAgent está ausente', async () => {
        const res = await request(app)
            .post('/api/issues/report')
            .send({ ...VALID_PAYLOAD, userAgent: null });

        expect(res.status).toBe(400);
    });

    it('retorna 400 quando payload está completamente vazio', async () => {
        const res = await request(app)
            .post('/api/issues/report')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.details.fields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ field: 'userId' }),
                expect.objectContaining({ field: 'url' }),
                expect.objectContaining({ field: 'viewport' }),
                expect.objectContaining({ field: 'userAgent' }),
            ])
        );
    });

    it('retorna 413 quando screenshot > 5MB (antes de chamar service)', async () => {
        const bigB64 = 'A'.repeat(Math.ceil(6 * 1024 * 1024 / 0.75));
        const res = await request(app)
            .post('/api/issues/report')
            .send({ ...VALID_PAYLOAD, screenshot: bigB64 });

        expect(res.status).toBe(413);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
        expect(res.body.error.details.maxBytes).toBeDefined();
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('aceita screenshot exatamente no limite (5MB)', async () => {
        const bytes = 5 * 1024 * 1024;
        const b64 = 'A'.repeat(Math.ceil(bytes / 0.75));
        const res = await request(app)
            .post('/api/issues/report')
            .send({ ...VALID_PAYLOAD, screenshot: b64 });

        expect(res.status).toBe(201);
        expect(mockProcessIssueReport).toHaveBeenCalled();
    });

    it('retorna 500 com envelope quando service lança', async () => {
        mockProcessIssueReport.mockRejectedValueOnce(new Error('gh CLI crashed'));
        const res = await request(app)
            .post('/api/issues/report')
            .send(VALID_PAYLOAD);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('ISSUE_REPORT_FAILED');
        expect(res.body.error.message).toMatch(/gh CLI crashed/);
    });

    it('exige auth — 401 quando requireDolibarrLogin bloqueia', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce(
            (_req: any, res: any) => res.status(401).json({ status: 'error', message: 'Authentication Required' })
        );

        const res = await request(app)
            .post('/api/issues/report')
            .send(VALID_PAYLOAD);

        expect(res.status).toBe(401);
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('GET /report retorna 200 informativo (não chama service)', async () => {
        const res = await request(app).get('/api/issues/report');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.required).toEqual(
            expect.arrayContaining(['userId', 'url', 'viewport', 'userAgent'])
        );
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('passa labels customizadas do payload para o service', async () => {
        const res = await request(app)
            .post('/api/issues/report')
            .send({ ...VALID_PAYLOAD, labels: ['urgent', 'ux'] });

        expect(res.status).toBe(201);
        const [payload] = mockProcessIssueReport.mock.calls[0];
        expect(payload.labels).toEqual(['urgent', 'ux']);
    });
});
