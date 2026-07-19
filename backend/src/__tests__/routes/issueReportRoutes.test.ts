/**
 * issueReportRoutes.test.ts — testes HTTP do POST /api/issues/report (#1561).
 *
 * Mocks:
 *   - requireDolibarrLogin (auth bypass, popula req.user).
 *   - processIssueReport (service) — isolamos a casca HTTP do pipeline.
 *
 * Cobertura (critérios de aceitação do #1561):
 *   - 201 + { reportId, issueUrl } em sucesso.
 *   - 400 se faltar campos obrigatórios: userId, url, viewport, userAgent (caseseparado p/ cada).
 *   - 413 PAYLOAD_TOO_LARGE quando o service relança AppError(413) (screenshot > 5MB).
 *   - 502 ISSUE_CREATE_FAILED quando o service relança erro não-AppError (ex.: `gh` falhou).
 *   - 405 em verbos não-POST.
 *   - title default (gerado a partir da url) quando ausente.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { AppError } from '../../middleware/errorHandler';
import { errorHandler } from '../../middleware/errorHandler';

// Auth mock — popula req.user e segue.
// Nota: NÃO setar `req.ip` — em Express 4.x é getter-only no prototype; atribuir
// lança "Cannot set property ip of #<IncomingMessage> which has only a getter"
// em strict mode. `req.ip` é populado pelo supertest a partir do socket real.
const mockRequireDolibarrLogin = vi.hoisted(() =>
    vi.fn((req: any, _res: any, next: any) => {
        req.user = { id: 'user-42', login: 'tulio' };
        next();
    })
);

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

// Service mock — isolamos a casca HTTP.
const mockProcessIssueReport = vi.hoisted(() => vi.fn());
vi.mock('../../services/issueReportService', () => ({
    processIssueReport: mockProcessIssueReport,
    MAX_SCREENSHOT_BYTES: 5 * 1024 * 1024,
}));

// Importação depois dos mocks.
import issueReportRoutes from '../../routes/issueReportRoutes';

function createApp() {
    const app = express();
    app.use(express.json({ limit: '15mb' }));
    app.use('/api/issues', issueReportRoutes);
    // errorHandler global — produz o envelope padronizado { success:false, error:{...} }.
    app.use(errorHandler);
    return app;
}

const validBody = {
    userId: 'user-42',
    url: 'https://app.example.com/dashboard',
    viewport: '1440x900',
    userAgent: 'Mozilla/5.0 (test) Chrome',
    title: 'Bug X',
    description: 'descrição',
    htmlSnapshot: '<div>html</div>',
    screenshotBase64: Buffer.from([1, 2, 3]).toString('base64'),
    consoleErrors: ['err'],
    consoleLogs: ['log'],
    failedRequests: ['GET /x → 500'],
};

describe('issueReportRoutes (#1561) — POST /api/issues/report', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequireDolibarrLogin.mockImplementation((req: any, _res: any, next: any) => {
            req.user = { id: 'user-42', login: 'tulio' };
            next();
        });
        app = createApp();
    });

    it('201 em sucesso — retorna { reportId, issueUrl } (campos do critério)', async () => {
        mockProcessIssueReport.mockResolvedValueOnce({
            reportId: '11111111-2222-3333-4444-555555555555',
            issueUrl: 'https://github.com/tcstulio/sistemav2/issues/1601',
            issueNumber: 1601,
            screenshotUrl: '/uploads/reports/abc.png',
            htmlUrl: '/uploads/reports/abc.html',
        });

        const res = await request(app).post('/api/issues/report').send(validBody);

        expect(res.status).toBe(201);
        expect(res.body.reportId).toBe('11111111-2222-3333-4444-555555555555');
        expect(res.body.issueUrl).toBe('https://github.com/tcstulio/sistemav2/issues/1601');
        // service chamado com userId + title do body.
        expect(mockProcessIssueReport).toHaveBeenCalledTimes(1);
        const [payload, reporter] = mockProcessIssueReport.mock.calls[0];
        expect(payload.userId).toBe('user-42');
        expect(payload.title).toBe('Bug X');
        expect(reporter.login).toBe('tulio');
    });

    it('gera title default (a partir da url) quando title ausente', async () => {
        mockProcessIssueReport.mockResolvedValueOnce({
            reportId: 'r-1', issueUrl: 'u', issueNumber: 1, screenshotUrl: null, htmlUrl: null,
        });
        const { title, ...withoutTitle } = validBody;
        await request(app).post('/api/issues/report').send(withoutTitle);

        const payload = mockProcessIssueReport.mock.calls[0][0];
        expect(payload.title).toContain('https://app.example.com/dashboard');
    });

    it('400 quando userId está ausente', async () => {
        const res = await request(app).post('/api/issues/report').send({ ...validBody, userId: '' });
        expect(res.status).toBe(400);
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('400 quando url está ausente', async () => {
        const res = await request(app).post('/api/issues/report').send({ ...validBody, url: '' });
        expect(res.status).toBe(400);
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('400 quando viewport está ausente', async () => {
        const res = await request(app).post('/api/issues/report').send({ ...validBody, viewport: '' });
        expect(res.status).toBe(400);
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('400 quando userAgent está ausente', async () => {
        const res = await request(app).post('/api/issues/report').send({ ...validBody, userAgent: '' });
        expect(res.status).toBe(400);
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('400 quando body está completamente vazio', async () => {
        const res = await request(app).post('/api/issues/report').send({});
        expect(res.status).toBe(400);
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('413 PAYLOAD_TOO_LARGE quando service relança AppError(413) (screenshot > 5MB)', async () => {
        mockProcessIssueReport.mockImplementationOnce(() => {
            throw new AppError(413, 'PAYLOAD_TOO_LARGE', {
                message: 'Screenshot excede o limite',
                details: { receivedBytes: 6 * 1024 * 1024, limit: 5 * 1024 * 1024 },
            });
        });
        const res = await request(app).post('/api/issues/report').send(validBody);
        expect(res.status).toBe(413);
        // envelope padronizado pelo errorHandler global
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('502 ISSUE_CREATE_FAILED quando service relança erro genérico (ex.: gh CLI falhou)', async () => {
        mockProcessIssueReport.mockRejectedValueOnce(new Error('gh not installed'));
        const res = await request(app).post('/api/issues/report').send(validBody);
        expect(res.status).toBe(502);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('ISSUE_CREATE_FAILED');
    });

    it('401 quando auth middleware rejeita (sem sessão Dolibarr)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((_req: any, res: any) =>
            res.status(401).json({ status: 'error', message: 'Authentication Required' })
        );
        const res = await request(app).post('/api/issues/report').send(validBody);
        expect(res.status).toBe(401);
        expect(mockProcessIssueReport).not.toHaveBeenCalled();
    });

    it('405 method_not_allowed para PUT /report', async () => {
        const res = await request(app).put('/api/issues/report').send({});
        expect(res.status).toBe(405);
        expect(res.body).toEqual({ error: 'method_not_allowed' });
    });

    it('405 method_not_allowed para DELETE /report', async () => {
        const res = await request(app).delete('/api/issues/report');
        expect(res.status).toBe(405);
        expect(res.body).toEqual({ error: 'method_not_allowed' });
    });
});
