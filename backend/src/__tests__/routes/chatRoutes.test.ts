import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: '1', login: 'ana', firstname: 'Ana', lastname: 'Silva', admin: '1' };
    next();
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../middleware/errorHandler', async () => {
    const actual: any = await vi.importActual('../../middleware/errorHandler');
    return { ...actual };
});

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// jobState REAL (em memória) — exercita o caminho completo do endpoint.
import { jobState } from '../../agent/jobState';

// aiJobService mockado: controlamos get() para 404/ok/expired.
const mockAiJobGet = vi.hoisted(() => vi.fn(() => ({ ok: true, job: { id: 'job-1' }, queueAhead: 0 })));
vi.mock('../../services/aiJobService', () => ({
    aiJobService: { get: mockAiJobGet },
}));

// userNotifyPrefsStore mockado: spy mutável.
const mockPrefs = vi.hoisted(() => ({
    get: vi.fn(() => ({ optedOut: false })),
    setOptOut: vi.fn((uid: string, optedOut: boolean) => ({ optedOut })),
}));
vi.mock('../../services/userNotifyPrefsStore', () => ({
    userNotifyPrefsStore: { get: mockPrefs.get, setOptOut: mockPrefs.setOptOut },
}));

import chatRoutes from '../../routes/chatRoutes';
import { errorHandler } from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/chat', chatRoutes);
    app.use(errorHandler);
    return app;
}

describe('chatRoutes (#1578)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        jobState._clearAllForTests();
        mockAiJobGet.mockImplementation(() => ({ ok: true, job: { id: 'job-1' }, queueAhead: 0 }));
        mockPrefs.get.mockImplementation(() => ({ optedOut: false }));
        mockPrefs.setOptOut.mockImplementation((_uid: string, optedOut: boolean) => ({ optedOut }));
        app = createApp();
    });

    describe('POST /api/chat/jobs/:id/visibility', () => {
        it('200 quando job existe — seta tabHidden=true no jobState', async () => {
            const res = await request(app)
                .post('/api/chat/jobs/job-1/visibility')
                .send({ tabHidden: true });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: { jobId: 'job-1', tabHidden: true } });
            expect(jobState.get('job-1')).toBeDefined();
            expect(jobState.get('job-1')!.tabHidden).toBe(true);
        });

        it('cria o jobState sob demanda (init automático quando ausente)', async () => {
            await request(app)
                .post('/api/chat/jobs/job-fresh/visibility')
                .send({ tabHidden: false });
            expect(jobState.get('job-fresh')).toBeDefined();
            expect(jobState.get('job-fresh')!.tabHidden).toBe(false);
        });

        it('idempotente — segunda chamada sobrescreve o estado', async () => {
            await request(app).post('/api/chat/jobs/job-idem/visibility').send({ tabHidden: true });
            await request(app).post('/api/chat/jobs/job-idem/visibility').send({ tabHidden: false });
            expect(jobState.get('job-idem')!.tabHidden).toBe(false);
        });

        it('preserva userId/label já setados por init anterior (overlay)', async () => {
            jobState.init('job-merge', { userId: 'u1', label: 'chat' });
            await request(app).post('/api/chat/jobs/job-merge/visibility').send({ tabHidden: true });
            const state = jobState.get('job-merge');
            expect(state!.userId).toBe('u1');
            expect(state!.label).toBe('chat');
            expect(state!.tabHidden).toBe(true);
        });

        it('400 quando body não tem tabHidden', async () => {
            const res = await request(app)
                .post('/api/chat/jobs/job-1/visibility')
                .send({});
            expect(res.status).toBe(400);
        });

        it('400 quando tabHidden não é boolean', async () => {
            const res = await request(app)
                .post('/api/chat/jobs/job-1/visibility')
                .send({ tabHidden: 'yes' });
            expect(res.status).toBe(400);
        });

        it('404 JOB_NOT_FOUND quando job não existe', async () => {
            mockAiJobGet.mockImplementationOnce(() => ({ ok: false, reason: 'missing' }));
            const res = await request(app)
                .post('/api/chat/jobs/job-x/visibility')
                .send({ tabHidden: true });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('JOB_NOT_FOUND');
        });

        it('404 JOB_EXPIRED quando job expirou', async () => {
            mockAiJobGet.mockImplementationOnce(() => ({ ok: false, reason: 'expired' }));
            const res = await request(app)
                .post('/api/chat/jobs/job-old/visibility')
                .send({ tabHidden: true });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('JOB_EXPIRED');
        });
    });

    describe('GET /api/chat/notify-prefs', () => {
        it('200 — devolve prefs do usuário corrente', async () => {
            mockPrefs.get.mockImplementationOnce(() => ({ optedOut: false }));
            const res = await request(app).get('/api/chat/notify-prefs');
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ optedOut: false });
            expect(mockPrefs.get).toHaveBeenCalledWith('1'); // req.user.id do mock
        });

        it('200 — devolve optedOut=true quando já opt-out', async () => {
            mockPrefs.get.mockImplementationOnce(() => ({ optedOut: true }));
            const res = await request(app).get('/api/chat/notify-prefs');
            expect(res.body.data).toEqual({ optedOut: true });
        });
    });

    describe('PUT /api/chat/notify-prefs', () => {
        it('200 — define optedOut=true', async () => {
            const res = await request(app)
                .put('/api/chat/notify-prefs')
                .send({ optedOut: true });
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ optedOut: true });
            expect(mockPrefs.setOptOut).toHaveBeenCalledWith('1', true);
        });

        it('200 — define optedOut=false (reativa)', async () => {
            const res = await request(app)
                .put('/api/chat/notify-prefs')
                .send({ optedOut: false });
            expect(res.body.data).toEqual({ optedOut: false });
            expect(mockPrefs.setOptOut).toHaveBeenCalledWith('1', false);
        });

        it('400 quando body não tem optedOut', async () => {
            const res = await request(app)
                .put('/api/chat/notify-prefs')
                .send({});
            expect(res.status).toBe(400);
        });

        it('400 quando optedOut não é boolean', async () => {
            const res = await request(app)
                .put('/api/chat/notify-prefs')
                .send({ optedOut: 'sim' });
            expect(res.status).toBe(400);
        });
    });
});
