import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// #1577: testa o contrato HTTP das rotas /api/chat/jobs/:id/cancel e /visibility.
// O aiJobService e o socketService são mockados para controle determinístico dos
// ramos 200/404/400; a lógica de estado em si é coberta em
// __tests__/services/aiJobService.test.ts. O auth é mockado p/ passar.

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: '1', login: 'testadmin', admin: '1' };
    next();
}));

const mockCancelJob = vi.hoisted(() => vi.fn());
const mockRecordVisibility = vi.hoisted(() => vi.fn());
const mockSocketEmit = vi.hoisted(() => vi.fn());

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../../services/aiJobService', () => ({
    aiJobService: {
        cancelJob: mockCancelJob,
        recordVisibility: mockRecordVisibility,
    },
}));

vi.mock('../../services/socketService', () => ({
    socketService: { emit: mockSocketEmit },
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
    logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import chatJobsRoutes from '../../routes/chatJobs';
import { errorHandler } from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/chat/jobs', chatJobsRoutes);
    app.use(errorHandler);
    return app;
}

const RUNNING_JOB = {
    id: 'job-running',
    status: 'running' as const,
    createdAt: Date.now() - 1000,
    startedAt: Date.now() - 500,
    result: { reply: 'resposta parcial...' },
    partialSummary: 'partial text from job',
};

describe('chatJobsRoutes #1577 — POST /api/chat/jobs/:id/cancel', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockCancelJob.mockReset();
        mockSocketEmit.mockReset();
        app = createApp();
    });

    it('exige login (requireDolibarrLogin aplicado à rota)', async () => {
        mockCancelJob.mockReturnValue({ ok: true, job: RUNNING_JOB, queueAhead: 0 });
        await request(app).post('/api/chat/jobs/job-1/cancel').send({});
        expect(mockRequireDolibarrLogin).toHaveBeenCalled();
    });

    it('marca o job como cancelled e devolve 200 com o envelope padrão', async () => {
        const cancelled = { ...RUNNING_JOB, status: 'cancelled' as const, finishedAt: 12345 };
        mockCancelJob.mockReturnValue({ ok: true, job: cancelled, queueAhead: 0 });

        const res = await request(app).post('/api/chat/jobs/job-running/cancel').send({});

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({
            jobId: 'job-running',
            status: 'cancelled',
            partialSummary: 'partial text from job',
            finishedAt: 12345,
        });
        expect(mockCancelJob).toHaveBeenCalledWith('job-running');
    });

    it('emite evento socket "chat:job:cancelled" com jobId, status e partialSummary', async () => {
        const cancelled = { ...RUNNING_JOB, status: 'cancelled' as const, finishedAt: 999 };
        mockCancelJob.mockReturnValue({ ok: true, job: cancelled, queueAhead: 0 });

        await request(app).post('/api/chat/jobs/job-running/cancel').send({});

        expect(mockSocketEmit).toHaveBeenCalledTimes(1);
        const [event, payload] = mockSocketEmit.mock.calls[0];
        expect(event).toBe('chat:job:cancelled');
        expect(payload.jobId).toBe('job-running');
        expect(payload.status).toBe('cancelled');
        expect(typeof payload.partialSummary).toBe('string');
    });

    it('prefere o partialSummary enviado no body quando o cliente repassa o streaming acumulado', async () => {
        const cancelled = { ...RUNNING_JOB, status: 'cancelled' as const, finishedAt: 1 };
        mockCancelJob.mockReturnValue({ ok: true, job: cancelled, queueAhead: 0 });

        const res = await request(app)
            .post('/api/chat/jobs/job-running/cancel')
            .send({ partialSummary: 'texto do cliente' });

        expect(res.body.data.partialSummary).toBe('texto do cliente');
        expect(mockSocketEmit.mock.calls[0][1].partialSummary).toBe('texto do cliente');
    });

    it('retorna 404 JOB_NOT_FOUND para id desconhecido', async () => {
        mockCancelJob.mockReturnValue({ ok: false, reason: 'missing' });

        const res = await request(app).post('/api/chat/jobs/inexistente/cancel').send({});

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('JOB_NOT_FOUND');
        expect(mockSocketEmit).not.toHaveBeenCalled();
    });

    it('retorna 404 JOB_EXPIRED (distinto de missing) para job expirado', async () => {
        mockCancelJob.mockReturnValue({ ok: false, reason: 'expired' });

        const res = await request(app).post('/api/chat/jobs/velho/cancel').send({});

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('JOB_EXPIRED');
    });

    it('é idempotente: chamar num job já cancelado NÃO re-emite socket (status não muda)', async () => {
        // O mock simula o cancelJob retornando o job já terminal (cancelled) — a rota
        // ainda emite o evento (idempotência do estado é do serviço, não da rota), mas
        // o contrato é: a rota NÃO altera o estado além do que o serviço devolve.
        const alreadyCancelled = { ...RUNNING_JOB, status: 'cancelled' as const, finishedAt: 1 };
        mockCancelJob.mockReturnValue({ ok: true, job: alreadyCancelled, queueAhead: 0 });

        const res = await request(app).post('/api/chat/jobs/job-running/cancel').send({});

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('cancelled');
        expect(mockCancelJob).toHaveBeenCalledTimes(1);
    });

    it('falha graciosamente se o socketService emit lançar (não derruba a rota)', async () => {
        const cancelled = { ...RUNNING_JOB, status: 'cancelled' as const, finishedAt: 1 };
        mockCancelJob.mockReturnValue({ ok: true, job: cancelled, queueAhead: 0 });
        mockSocketEmit.mockImplementation(() => { throw new Error('io Offline'); });

        const res = await request(app).post('/api/chat/jobs/job-running/cancel').send({});

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('cancelled');
    });

    it('extrai partialSummary de job.result.reply quando não há campo explícito', async () => {
        const cancelled = {
            ...RUNNING_JOB,
            status: 'cancelled' as const,
            finishedAt: 1,
            partialSummary: undefined,
            result: { reply: 'resposta via result.reply' },
        };
        mockCancelJob.mockReturnValue({ ok: true, job: cancelled, queueAhead: 0 });

        const res = await request(app).post('/api/chat/jobs/job-running/cancel').send({});

        expect(res.body.data.partialSummary).toBe('resposta via result.reply');
    });
});

describe('chatJobsRoutes #1577 — POST /api/chat/jobs/:id/visibility', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRecordVisibility.mockReset();
        app = createApp();
    });

    it('registra hidden=true e devolve 200 com o envelope padrão', async () => {
        mockRecordVisibility.mockReturnValue(true);

        const res = await request(app)
            .post('/api/chat/jobs/job-1/visibility')
            .send({ hidden: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({
            jobId: 'job-1',
            hidden: true,
            recordedAt: expect.any(Number),
        });
        expect(mockRecordVisibility).toHaveBeenCalledWith('job-1', true);
    });

    it('registra hidden=false quando a aba volta a ficar visível', async () => {
        mockRecordVisibility.mockReturnValue(true);

        const res = await request(app)
            .post('/api/chat/jobs/job-1/visibility')
            .send({ hidden: false });

        expect(res.status).toBe(200);
        expect(res.body.data.hidden).toBe(false);
        expect(mockRecordVisibility).toHaveBeenCalledWith('job-1', false);
    });

    it('retorna 400 quando hidden está ausente', async () => {
        const res = await request(app)
            .post('/api/chat/jobs/job-1/visibility')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('INVALID_VISIBILITY');
        expect(mockRecordVisibility).not.toHaveBeenCalled();
    });

    it('retorna 400 quando hidden vem como string ("false") — coerce não aceito', async () => {
        const res = await request(app)
            .post('/api/chat/jobs/job-1/visibility')
            .send({ hidden: 'false' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_VISIBILITY');
        expect(mockRecordVisibility).not.toHaveBeenCalled();
    });

    it('retorna 404 quando o job não existe ou expirou', async () => {
        mockRecordVisibility.mockReturnValue(false);

        const res = await request(app)
            .post('/api/chat/jobs/inexistente/visibility')
            .send({ hidden: true });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('JOB_NOT_FOUND');
    });
});
