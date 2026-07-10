import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock do healthCheckService para controlar o report em cada cenário.
const mockCheckAll = vi.hoisted(() => vi.fn());

vi.mock('../../services/healthCheckService', () => ({
    checkAll: mockCheckAll,
    healthCheckService: { checkAll: mockCheckAll },
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import healthRoutes from '../../routes/health';

function createApp() {
    const app = express();
    app.use('/health', healthRoutes);
    return app;
}

describe('GET /health', () => {
    let app: express.Application;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    afterEach(() => {
        // restaura env modificado pelos testes
        for (const k of ['HEALTH_FAIL_ON_DEGRADED', 'NODE_ENV']) {
            if (k in originalEnv) process.env[k] = originalEnv[k];
            else delete process.env[k];
        }
    });

    function report(status: 'ok' | 'degraded' | 'down') {
        return {
            status,
            checks: {
                dolibarr: { status: 'ok', latencyMs: 10 },
                whatsapp: { status: 'ok', session: 'connected' },
                bancoInter: { status: 'ok', latencyMs: 5 },
                bancoItau: { status: 'ok', latencyMs: 7 },
                scheduler: { status: 'ok', lastRun: '2026-01-15T10:30:00Z' },
            },
            timestamp: '2026-01-15T10:35:00Z',
        };
    }

    it('responde 200 quando status === "ok" e inclui o corpo no formato esperado', async () => {
        mockCheckAll.mockResolvedValue(report('ok'));
        const res = await request(app).get('/health');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.server).toBe('CoolGroove Backend');
        expect(res.body.checks).toBeDefined();
        expect(res.body.checks.dolibarr).toEqual({ status: 'ok', latencyMs: 10 });
        expect(res.body.checks.whatsapp).toEqual({ status: 'ok', session: 'connected' });
        expect(res.body.checks.scheduler.lastRun).toBe('2026-01-15T10:30:00Z');
        expect(res.body.timestamp).toBe('2026-01-15T10:35:00Z');
        expect(res.body.memory).toBeDefined();
        expect(typeof res.body.uptime).toBe('number');
    });

    it('responde 503 quando status === "down"', async () => {
        mockCheckAll.mockResolvedValue(report('down'));
        const res = await request(app).get('/health');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('down');
    });

    it('responde 503 quando status === "degraded" e HEALTH_FAIL_ON_DEGRADED não é "false" (default)', async () => {
        delete process.env.HEALTH_FAIL_ON_DEGRADED;
        mockCheckAll.mockResolvedValue(report('degraded'));
        const res = await request(app).get('/health');
        expect(res.status).toBe(503);
    });

    it('responde 200 quando status === "degraded" e HEALTH_FAIL_ON_DEGRADED=false', async () => {
        process.env.HEALTH_FAIL_ON_DEGRADED = 'false';
        mockCheckAll.mockResolvedValue(report('degraded'));
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('degraded');
    });

    it('propaga o report mesmo quando um check está down (bancoItau)', async () => {
        const degraded = report('degraded');
        degraded.checks.bancoItau = { status: 'down', error: 'timeout' };
        mockCheckAll.mockResolvedValue(degraded);
        const res = await request(app).get('/health');
        expect(res.status).toBe(503);
        expect(res.body.checks.bancoItau).toEqual({ status: 'down', error: 'timeout' });
    });
});
