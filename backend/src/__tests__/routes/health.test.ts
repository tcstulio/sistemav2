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

    it('mantém "dependencies" como alias de "checks" (#1415) — não quebra consumidores legados', async () => {
        // O smoke.spec.ts e outros consumidores antigos esperam `body.dependencies`.
        // A rota agora expõe ambos os campos apontando para o MESMO objeto.
        mockCheckAll.mockResolvedValue(report('ok'));
        const res = await request(app).get('/health');

        expect(res.body).toHaveProperty('checks');
        expect(res.body).toHaveProperty('dependencies');
        expect(res.body.dependencies).toEqual(res.body.checks);
        // Spot-check: cada chave das checks deve aparecer em dependencies
        expect(res.body.dependencies.dolibarr).toEqual(res.body.checks.dolibarr);
        expect(res.body.dependencies.whatsapp).toEqual(res.body.checks.whatsapp);
        expect(res.body.dependencies.scheduler).toEqual(res.body.checks.scheduler);
    });

    it('responde 503 quando status === "down"', async () => {
        mockCheckAll.mockResolvedValue(report('down'));
        const res = await request(app).get('/health');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('down');
    });

    it('responde 200 quando status === "degraded" no default (#1415: HEALTH_FAIL_ON_DEGRADED não definido)', async () => {
        // #1415: default agora é "degraded → 200" para não flapear uptime monitor / smoke
        // quando uma dependência não-crítica (WhatsApp, banco opcional, scheduler) cai.
        delete process.env.HEALTH_FAIL_ON_DEGRADED;
        mockCheckAll.mockResolvedValue(report('degraded'));
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('degraded');
    });

    it('responde 503 quando status === "degraded" e HEALTH_FAIL_ON_DEGRADED=true (override explícito)', async () => {
        // Escape hatch: ambientes que preferem alerta conservador (CI rígido) podem
        // forçar 503 em degraded com HEALTH_FAIL_ON_DEGRADED=true.
        process.env.HEALTH_FAIL_ON_DEGRADED = 'true';
        mockCheckAll.mockResolvedValue(report('degraded'));
        const res = await request(app).get('/health');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('degraded');
    });

    it('"false" continua equivalendo a default (200 em degraded) — aceito por compat (#1415)', async () => {
        // Antes: HEALTH_FAIL_ON_DEGRADED !== 'false' → fail. Agora: === 'true' → fail.
        // "false" continua significando "não falhe em degraded" (200).
        process.env.HEALTH_FAIL_ON_DEGRADED = 'false';
        mockCheckAll.mockResolvedValue(report('degraded'));
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('degraded');
    });

    it('propaga o report mesmo quando um check está down (bancoItau) (#1415: HTTP=200, body intacto)', async () => {
        // #1415: o agregado está 'degraded' (apenas bancoItau down, não-crítico) → HTTP 200.
        // A asserção central é que o body carrega o status REAL da dependência (down/timeout)
        // mesmo com HTTP 200, pra que um monitor que parsear o body ainda acuse o problema.
        const degraded = report('degraded');
        degraded.checks.bancoItau = { status: 'down', error: 'timeout' };
        mockCheckAll.mockResolvedValue(degraded);
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('degraded');
        expect(res.body.checks.bancoItau).toEqual({ status: 'down', error: 'timeout' });
        // Alias também reflete o status real
        expect(res.body.dependencies.bancoItau).toEqual({ status: 'down', error: 'timeout' });
    });
});
