import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockSvc = vi.hoisted(() => ({
    query: vi.fn(async () => ({ events: [{ id: 'e1', source: 'agent' }], total: 1, sources: ['agent', 'notification'] })),
}));
const mockAllowed = vi.hoisted(() => vi.fn(() => ['agent', 'notification']));

vi.mock('../../services/systemEventsService', () => ({
    systemEventsService: mockSvc,
    getAllowedSources: mockAllowed,
}));
vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: (req: any, _res: any, next: any) => { req.user = { id: '1', login: 'admin', admin: '1', firstname: 'Ada', lastname: 'Min' }; next(); },
}));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import systemEventsRoutes from '../../routes/systemEventsRoutes';

const app = express();
app.use(express.json());
app.use('/api/system-events', systemEventsRoutes);

describe('systemEventsRoutes (#519)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('GET / retorna {events,total,sources} e resolve o usuário (admin)', async () => {
        const res = await request(app).get('/api/system-events');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ total: 1 });
        expect(res.body.events).toHaveLength(1);
        const arg = mockSvc.query.mock.calls[0][0];
        expect(arg.user).toMatchObject({ id: '1', isAdmin: true, name: 'Ada Min' });
    });

    it('GET / repassa sources (csv→array) e filtros', async () => {
        await request(app).get('/api/system-events?sources=agent,audit&type=task_failed&limit=10&offset=5');
        const arg = mockSvc.query.mock.calls[0][0];
        expect(arg.sources).toEqual(['agent', 'audit']);
        expect(arg.type).toBe('task_failed');
        expect(arg.limit).toBe(10);
        expect(arg.offset).toBe(5);
    });

    it('GET / com limit inválido (>200) → 400', async () => {
        const res = await request(app).get('/api/system-events?limit=999');
        expect(res.status).toBe(400);
        expect(mockSvc.query).not.toHaveBeenCalled();
    });

    it('GET /sources retorna as fontes permitidas', async () => {
        const res = await request(app).get('/api/system-events/sources');
        expect(res.status).toBe(200);
        expect(res.body.sources).toEqual(['agent', 'notification']);
    });
});
