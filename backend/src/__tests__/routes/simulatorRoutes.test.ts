import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: '1', login: 'testuser', admin: '1' };
    next();
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
    logger: {
        child: () => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        }),
    },
}));

const mockSimulatorStore = vi.hoisted(() => ({
    list: vi.fn(() => []),
    create: vi.fn((s: any) => s),
    update: vi.fn((id: string, updates: any) => ({ id, name: 'Updated', date: 2000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'A' }, ...updates })),
    delete: vi.fn(() => true),
    getById: vi.fn(() => undefined),
}));

vi.mock('../../services/simulatorStore', () => ({
    simulatorStore: mockSimulatorStore,
}));

import simulatorRoutes from '../../routes/simulatorRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/simulator', simulatorRoutes);
    return app;
}

const validSnapshot = {
    id: '1000',
    name: 'Cenário Teste',
    date: 1700000000000,
    data: { foo: 'bar' },
    summary: { revenue: 10000, profit: 500, modelLabel: 'Modelo A' }
};

describe('simulatorRoutes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/simulator/simulations', () => {
        it('returns empty list when no simulations exist', async () => {
            mockSimulatorStore.list.mockReturnValue([]);
            const res = await request(createApp()).get('/api/simulator/simulations');
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('returns the list of simulations', async () => {
            mockSimulatorStore.list.mockReturnValue([validSnapshot]);
            const res = await request(createApp()).get('/api/simulator/simulations');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].name).toBe('Cenário Teste');
        });

        it('returns 500 when store throws', async () => {
            mockSimulatorStore.list.mockImplementation(() => { throw new Error('disk error'); });
            const res = await request(createApp()).get('/api/simulator/simulations');
            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/simulator/simulations', () => {
        it('creates a simulation and returns 201', async () => {
            mockSimulatorStore.create.mockReturnValue(validSnapshot);
            const res = await request(createApp())
                .post('/api/simulator/simulations')
                .send(validSnapshot);
            expect(res.status).toBe(201);
            expect(res.body.id).toBe('1000');
            expect(mockSimulatorStore.create).toHaveBeenCalledWith(validSnapshot);
        });

        it('returns 400 for missing required fields', async () => {
            const res = await request(createApp())
                .post('/api/simulator/simulations')
                .send({ name: 'Missing fields' });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation Error');
        });

        it('returns 400 for invalid payload (empty name)', async () => {
            const res = await request(createApp())
                .post('/api/simulator/simulations')
                .send({ ...validSnapshot, name: '' });
            expect(res.status).toBe(400);
        });

        it('returns 500 when store throws on create', async () => {
            mockSimulatorStore.create.mockImplementation(() => { throw new Error('write fail'); });
            const res = await request(createApp())
                .post('/api/simulator/simulations')
                .send(validSnapshot);
            expect(res.status).toBe(500);
        });
    });

    describe('PUT /api/simulator/simulations/:id', () => {
        it('updates a simulation and returns 200', async () => {
            const updated = { ...validSnapshot, name: 'Novo Nome' };
            mockSimulatorStore.update.mockReturnValue(updated);
            const res = await request(createApp())
                .put('/api/simulator/simulations/1000')
                .send({ name: 'Novo Nome' });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe('Novo Nome');
        });

        it('returns 404 when simulation not found', async () => {
            mockSimulatorStore.update.mockReturnValue(null);
            const res = await request(createApp())
                .put('/api/simulator/simulations/999')
                .send({ name: 'X' });
            expect(res.status).toBe(404);
        });

        it('returns 400 for empty body', async () => {
            const res = await request(createApp())
                .put('/api/simulator/simulations/1000')
                .send({});
            expect(res.status).toBe(400);
        });

        it('returns 400 for invalid name (empty string)', async () => {
            const res = await request(createApp())
                .put('/api/simulator/simulations/1000')
                .send({ name: '' });
            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /api/simulator/simulations/:id', () => {
        it('deletes a simulation and returns 204', async () => {
            mockSimulatorStore.delete.mockReturnValue(true);
            const res = await request(createApp())
                .delete('/api/simulator/simulations/1000');
            expect(res.status).toBe(204);
            expect(mockSimulatorStore.delete).toHaveBeenCalledWith('1000');
        });

        it('returns 404 when simulation not found', async () => {
            mockSimulatorStore.delete.mockReturnValue(false);
            const res = await request(createApp())
                .delete('/api/simulator/simulations/999');
            expect(res.status).toBe(404);
        });

        it('returns 500 when store throws on delete', async () => {
            mockSimulatorStore.delete.mockImplementation(() => { throw new Error('io error'); });
            const res = await request(createApp())
                .delete('/api/simulator/simulations/1000');
            expect(res.status).toBe(500);
        });
    });
});
