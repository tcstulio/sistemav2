import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Auth middleware mock — default passa (next). Testes de auth trocam p/ 401.
const mockRequireDolibarrLogin = vi.hoisted(() =>
    vi.fn((_req: any, _res: any, next: any) => next())
);
const mockRequireDolibarrAdmin = vi.hoisted(() =>
    vi.fn((_req: any, _res: any, next: any) => next())
);

const mockTaskRunnerService = vi.hoisted(() => ({
    syncTasks: vi.fn(),
    syncWithGitHub: vi.fn().mockResolvedValue({ reconciled: [] }),
    getTask: vi.fn(),
    getDiff: vi.fn().mockResolvedValue(''),
}));

const mockScreenshotService = vi.hoisted(() => ({
    getScreenshotPath: vi.fn(() => '/tmp/nope.png'),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));

vi.mock('../../services/taskRunnerService', () => ({
    taskRunnerService: mockTaskRunnerService,
}));

vi.mock('../../services/screenshotService', () => ({
    screenshotService: mockScreenshotService,
}));

// toTaskListItem fica REAL (modulo puro, sem side-effects) — exercita a transformacao de verdade.
import taskRoutes from '../../routes/taskRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/tasks', taskRoutes);
    return app;
}

/** Task minima p/ alimentar o mock do store (campos relevantes p/ a projecao enxuta). */
const makeStoredTask = (overrides: Record<string, any> = {}) => ({
    issueNumber: 1,
    title: 'Task de teste',
    body: 'corpo da task',
    labels: [],
    status: 'pending',
    feedbackHistory: [],
    events: [],
    updatedAt: '2024-01-01T00:00:00.000Z',
    phase: 'done',
    attempts: [],
    kind: 'task',
    ...overrides,
});

describe('taskRoutes — listagem enxuta (#1179)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequireDolibarrLogin.mockImplementation((_req: any, _res: any, next: any) => next());
        mockRequireDolibarrAdmin.mockImplementation((_req: any, _res: any, next: any) => next());
        mockTaskRunnerService.syncWithGitHub.mockResolvedValue({ reconciled: [] });
        app = createApp();
    });

    it('GET /api/tasks aplica requireDolibarrLogin', async () => {
        mockTaskRunnerService.syncTasks.mockResolvedValue([]);
        const res = await request(app).get('/api/tasks');
        expect(res.status).toBe(200);
        expect(mockRequireDolibarrLogin).toHaveBeenCalled();
    });

    it('GET /api/tasks devolve 401 quando o middleware de login bloqueia', async () => {
        mockRequireDolibarrLogin.mockImplementation((_req: any, res: any) =>
            res.status(401).json({ error: 'unauthorized' })
        );
        mockTaskRunnerService.syncTasks.mockResolvedValue([]);
        const res = await request(app).get('/api/tasks');
        expect(res.status).toBe(401);
        expect(mockTaskRunnerService.syncTasks).not.toHaveBeenCalled();
    });

    it('GET /api/tasks NAO devolve o array `events` e inclui `eventsCount`', async () => {
        const events = [
            { ts: '2024-01-01T00:00:00.000Z', type: 'task_started', message: 'inicio' },
            { ts: '2024-01-01T00:01:00.000Z', type: 'pr_created', message: 'pr' },
        ];
        mockTaskRunnerService.syncTasks.mockResolvedValue([
            makeStoredTask({ issueNumber: 10, events }),
            makeStoredTask({ issueNumber: 11, events: [] }),
        ]);

        const res = await request(app).get('/api/tasks');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(2);
        for (const item of res.body) {
            expect(item).not.toHaveProperty('events');
            expect(item).toHaveProperty('eventsCount');
        }
        expect(res.body[0].eventsCount).toBe(2);
        expect(res.body[1].eventsCount).toBe(0);
    });

    it('GET /api/tasks trunca `body` (~500) e `judgeReview` (~300) na listagem', async () => {
        const longBody = 'b'.repeat(2000);
        const longReview = 'r'.repeat(2000);
        mockTaskRunnerService.syncTasks.mockResolvedValue([
            makeStoredTask({ issueNumber: 20, body: longBody, judgeReview: longReview }),
        ]);

        const res = await request(app).get('/api/tasks');

        expect(res.status).toBe(200);
        const item = res.body[0];
        // truncados + reticencias
        expect(item.body.length).toBeLessThanOrEqual(500 + 1);
        expect(item.body.endsWith('…')).toBe(true);
        expect(item.judgeReview.length).toBeLessThanOrEqual(300 + 1);
        expect(item.judgeReview.endsWith('…')).toBe(true);
    });

    it('GET /api/tasks preserva `body`/`judgeReview` curtos sem truncar', async () => {
        mockTaskRunnerService.syncTasks.mockResolvedValue([
            makeStoredTask({ issueNumber: 21, body: 'curto', judgeReview: 'ok' }),
        ]);

        const res = await request(app).get('/api/tasks');

        expect(res.status).toBe(200);
        expect(res.body[0].body).toBe('curto');
        expect(res.body[0].judgeReview).toBe('ok');
    });
});

describe('taskRoutes — GET /api/tasks/:issueNumber/events (#1179)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequireDolibarrLogin.mockImplementation((_req: any, _res: any, next: any) => next());
        app = createApp();
    });

    it('devolve a timeline completa de UMA task (ordenada por ts)', async () => {
        const events = [
            { ts: '2024-01-01T00:02:00.000Z', type: 'pr_created', message: 'segundo' },
            { ts: '2024-01-01T00:00:00.000Z', type: 'task_started', message: 'primeiro' },
        ];
        mockTaskRunnerService.getTask.mockReturnValue(makeStoredTask({ issueNumber: 30, events }));

        const res = await request(app).get('/api/tasks/30/events');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('events');
        expect(Array.isArray(res.body.events)).toBe(true);
        expect(res.body.events).toHaveLength(2);
        // ordenado por ts ascendente
        expect(res.body.events[0].message).toBe('primeiro');
        expect(res.body.events[1].message).toBe('segundo');
    });

    it('aplica requireDolibarrLogin', async () => {
        mockTaskRunnerService.getTask.mockReturnValue(makeStoredTask({ issueNumber: 31 }));
        await request(app).get('/api/tasks/31/events');
        expect(mockRequireDolibarrLogin).toHaveBeenCalled();
    });

    it('devolve 404 quando a task nao existe', async () => {
        mockTaskRunnerService.getTask.mockReturnValue(null);

        const res = await request(app).get('/api/tasks/9999/events');

        expect(res.status).toBe(404);
    });
});
