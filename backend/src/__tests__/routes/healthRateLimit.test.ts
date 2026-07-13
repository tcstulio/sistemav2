import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// NÃO mockamos express-rate-limit aqui — queremos testar o comportamento real do limiter
// configurado em middleware/healthRateLimiter.ts (sem isso, ninguém garante que 60+1 → 429).

const mockCheckAll = vi.hoisted(() => vi.fn());

vi.mock('../../services/healthCheckService', () => ({
    checkAll: mockCheckAll,
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import healthRoutes from '../../routes/health';
import { healthLimiter, HEALTH_LIMIT_MAX, HEALTH_LIMIT_WINDOW_MS } from '../../middleware/healthRateLimiter';

function createApp() {
    const app = express();
    // O server.ts usa `app.set('trust proxy', 1)` — replicamos aqui para que req.ip
    // respeite X-Forwarded-For e cada teste consiga ter SEU PRÓPRIO bucket do limiter.
    app.set('trust proxy', 1);
    app.use('/health', healthLimiter, healthRoutes);
    return app;
}

function okReport() {
    return {
        status: 'ok',
        checks: {
            dolibarr: { status: 'ok', latencyMs: 10 },
            whatsapp: { status: 'ok', session: 'connected' },
            bancoInter: { status: 'not_configured' },
            bancoItau: { status: 'not_configured' },
            scheduler: { status: 'ok' },
        },
        timestamp: '2026-01-15T10:35:00Z',
    };
}

// IP distinto por teste — healthLimiter é singleton (mesmo módulo compartilhado entre
// testes), então cada `it()` precisa de seu próprio bucket ou o teste de 60+1 consome
// o budget dos vizinhos.
const TEST_IP_1 = '203.0.113.10';
const TEST_IP_2 = '203.0.113.20';
const TEST_IP_3 = '203.0.113.30';

describe('GET /health rate limiter (#1415)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockCheckAll.mockResolvedValue(okReport());
        app = createApp();
    });

    it('expõe a config esperada: 60 req/min (#1415)', () => {
        // Constantes exportadas são o contrato público do limiter. Se alguém afrouxar
        // o limite (max=200) sem perceber o fan-out externo, este teste falha imediatamente.
        expect(HEALTH_LIMIT_WINDOW_MS).toBe(60 * 1000);
        expect(HEALTH_LIMIT_MAX).toBe(60);
    });

    it('permite até HEALTH_LIMIT_MAX requests dentro da janela e bloqueia com 429 a partir da seguinte', async () => {
        // O rate limiter usa o IP do request — o supertest envia sempre o mesmo, então
        // todas as requests contam para o mesmo bucket. Após HEALTH_LIMIT_MAX sucessos
        // a próxima deve retornar 429 com a mensagem configurada.
        for (let i = 0; i < HEALTH_LIMIT_MAX; i++) {
            const res = await request(app)
                .get('/health')
                .set('X-Forwarded-For', TEST_IP_1);
            expect(res.status, `request #${i + 1} deveria passar`).toBe(200);
        }
        const blocked = await request(app)
            .get('/health')
            .set('X-Forwarded-For', TEST_IP_1);
        expect(blocked.status).toBe(429);
        expect(blocked.body).toHaveProperty('error');
    }, 15000);

    it('headers de RateLimit estão presentes (standardHeaders=true) para clientes respeitarem o limite', async () => {
        const res = await request(app)
            .get('/health')
            .set('X-Forwarded-For', TEST_IP_2);
        expect(res.status).toBe(200);
        // standardHeaders=true emite `RateLimit-*` (RFC draft). Confirma que está ligado
        // (se alguém desligar, monitoramento/graceful-degradation do cliente piora).
        const hasRateLimitHeaders =
            res.headers['ratelimit-limit'] !== undefined ||
            res.headers['ratelimit-remaining'] !== undefined;
        expect(hasRateLimitHeaders).toBe(true);
    });

    it('IP distinto tem bucket independente — não compartilha contador', async () => {
        // Garante que o limiter é POR-IP (não global). Saturar TEST_IP_3 não deve
        // afetar um IP novo. Isto é o que protege o caso de múltiplos clientes atrás
        // de NAT/proxy legítimo (cada um tem seu limite).
        // Saturar TEST_IP_3 com 60 reqs
        for (let i = 0; i < HEALTH_LIMIT_MAX; i++) {
            const res = await request(app)
                .get('/health')
                .set('X-Forwarded-For', TEST_IP_3);
            expect(res.status, `saturation #${i + 1}`).toBe(200);
        }
        // IP diferente ainda passa
        const other = await request(app)
            .get('/health')
            .set('X-Forwarded-For', '198.51.100.99');
        expect(other.status).toBe(200);
        // IP saturado bloqueia
        const blocked = await request(app)
            .get('/health')
            .set('X-Forwarded-For', TEST_IP_3);
        expect(blocked.status).toBe(429);
    }, 15000);
});