import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock do healthCheckService para controlar o report em cada cenário.
const mockCheckAll = vi.hoisted(() => vi.fn());

vi.mock('../../services/healthCheckService', () => ({
    checkAll: mockCheckAll,
    httpStatusFor: (report: { status: string }, failOnDegraded = true): number => {
        if (report.status === 'down') return 503;
        if (report.status === 'degraded' && failOnDegraded) return 503;
        return 200;
    },
    healthCheckService: { checkAll: mockCheckAll },
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mock do config com objeto mutável para controlar healthFailOnDegraded por teste.
const mockConfig = vi.hoisted(() => ({ healthFailOnDegraded: true }));
vi.mock('../../config/env', () => ({ config: mockConfig }));

import healthRoutes from '../../routes/health';

function createApp() {
    const app = express();
    app.use('/health', healthRoutes);
    return app;
}

describe('GET /health', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockConfig.healthFailOnDegraded = true;
        app = createApp();
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

    it('responde 503 quando status === "degraded" e healthFailOnDegraded é true (default)', async () => {
        mockConfig.healthFailOnDegraded = true;
        mockCheckAll.mockResolvedValue(report('degraded'));
        const res = await request(app).get('/health');
        expect(res.status).toBe(503);
    });

    it('responde 200 quando status === "degraded" e healthFailOnDegraded é false', async () => {
        mockConfig.healthFailOnDegraded = false;
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
