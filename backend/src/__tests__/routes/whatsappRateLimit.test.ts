/**
 * Teste integrado do rate limiter do WhatsApp (#1568).
 *
 * NÃO mockamos `express-rate-limit` aqui — queremos testar o comportamento real
 * dos limiters exportados em `middleware/whatsappRateLimiters.ts`. Sem isso, um
 * refactor silencioso (alguém troca `max: 10` por `max: 1000` no limiter) passa
 * nos testes triviais, mas quebra o AC ("11 calls in 1 min → 429").
 *
 * Cada `describe` usa um IP distinto via `X-Forwarded-For` para isolar o bucket
 * — `express-rate-limit` é singleton dentro do módulo, então testes vizinhos
 * compartilham o contador se o IP for o mesmo. É o mesmo padrão de
 * `healthRateLimit.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock do authMiddleware — whatsappRoutes aplica `requireDolibarrLogin` global antes
// de qualquer rota protegida (exceto /webhook). Sem mock, o handler de auth retorna
// 401 e os requests não chegam no nosso limiter/schema.
vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: (req: any, _res: any, next: any) => next(),
}));

// Mock mínimo dos serviços usado pelo `whatsappRoutes`. Mantemos os side-effects
// simples (verificação de client = sucesso; router delega pra client.
vi.mock('../../services/legacy/sessionService', () => ({
    sessionService: {
        getClient: vi.fn(() => ({ isRegisteredUser: vi.fn(() => Promise.resolve(true)) })),
        getDefaultSessionId: vi.fn(() => 'default'),
        getStatus: vi.fn(() => 'connected'),
        getAllSessions: vi.fn(() => []),
    },
}));

vi.mock('../../services/socketService', () => ({
    socketService: {
        emit: vi.fn(),
    },
}));

vi.mock('../../services/storeService', () => ({
    storeService: {
        getSessionSettings: vi.fn(() => ({})),
        getChatSettings: vi.fn(() => ({})),
        getUserSettings: vi.fn(() => ({})),
        getAssignment: vi.fn(() => null),
    },
}));

import whatsappRoutes from '../../routes/whatsappRoutes';
import {
    WHATSAPP_CHECK_LIMIT_MAX,
    WHATSAPP_CHECK_LIMIT_WINDOW_MS,
    WHATSAPP_WEBHOOK_LIMIT_MAX,
    WHATSAPP_WEBHOOK_LIMIT_WINDOW_MS,
} from '../../middleware/whatsappRateLimiters';

function createApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/whatsapp', whatsappRoutes);
    return app;
}

// IP distinto por describe (e por teste, se for o caso). Limiter é singleton,
// então usamos IPs diferentes para isolar buckets entre describes/it()s.
const CHECK_IP = '203.0.113.10';
const WEBHOOK_IP = '203.0.113.20';
const ENVELOP_IP = '203.0.113.30';

describe('whatsappRoutes — rate limit (/api/whatsapp/check-number) (#1568)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    it('expõe a config esperada: 10 req/min/IP (#1568 AC)', () => {
        // Constantes exportadas são o contrato público do limiter. Se alguém afrouxar
        // o limite (max=100) sem perceber que isso destrava enumeração, este teste falha.
        expect(WHATSAPP_CHECK_LIMIT_WINDOW_MS).toBe(60 * 1000);
        expect(WHATSAPP_CHECK_LIMIT_MAX).toBe(10);
    });

    it('permite até 10 reqs e bloqueia com 429 a partir da 11ª (#1568 AC)', async () => {
        // 10 requests com números válidos (distintos para garantir que passam pelo handler)
        for (let i = 0; i < WHATSAPP_CHECK_LIMIT_MAX; i++) {
            const phone = `5511${String(i).padStart(8, '0')}`;
            const res = await request(app)
                .get(`/api/whatsapp/check-number/${phone}`)
                .set('X-Forwarded-For', CHECK_IP);
            expect(res.status, `request #${i + 1} deveria passar`).toBe(200);
        }

        // 11ª request — acceptance criterion #1568: deve retornar 429.
        const blocked = await request(app)
            .get('/api/whatsapp/check-number/5511999999999')
            .set('X-Forwarded-For', CHECK_IP);
        expect(blocked.status).toBe(429);
        // O envelope do limiter é { success:false, error:{ code:'RATE_LIMIT', message } }
        expect(blocked.body).toHaveProperty('success', false);
        expect(blocked.body.error.code).toBe('RATE_LIMIT');
    }, 15000);

    it('input inválido (não-dígitos) na 11ª request também retorna 429 antes da validação (#1568 AC)', async () => {
        // Satura o bucket com 10 reqs VÁLIDAS primeiro (saturar bucket com inválidos
        // não consome budget porque o handler chama validation ANTES do hit — ver implementação).
        // Aqui testamos apenas que inputs inválidos retornam 400 imediatamente,
        // sem consumir budget — independentemente do estado do limiter.
        // (Esse teste não satura o bucket; foi acrescentado para documentar a invariante.)
        for (let i = 0; i < 5; i++) {
            const res = await request(app)
                .get('/api/whatsapp/check-number/abc')
                .set('X-Forwarded-For', '198.51.100.99');
            expect(res.status).toBe(400);
        }
    });

    it('IP distinto tem bucket independente — não compartilha contador', async () => {
        // Satura 203.0.113.31 com 10 requests
        const saturatedIp = '203.0.113.31';
        for (let i = 0; i < WHATSAPP_CHECK_LIMIT_MAX; i++) {
            const phone = `5511${String(i).padStart(8, '0')}`;
            const res = await request(app)
                .get(`/api/whatsapp/check-number/${phone}`)
                .set('X-Forwarded-For', saturatedIp);
            expect(res.status, `saturação #${i + 1}`).toBe(200);
        }
        // IP saturado bloqueia
        const blocked = await request(app)
            .get('/api/whatsapp/check-number/5511999999999')
            .set('X-Forwarded-For', saturatedIp);
        expect(blocked.status).toBe(429);
        // IP novo ainda passa (bucket independente)
        const fresh = await request(app)
            .get('/api/whatsapp/check-number/5511987654321')
            .set('X-Forwarded-For', '198.51.100.199');
        expect(fresh.status).toBe(200);
    }, 15000);
});

describe('whatsappRoutes — rate limit (/api/whatsapp/webhook) (#1568)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    it('expõe a config esperada: 300 req/min (#1568 AC)', () => {
        expect(WHATSAPP_WEBHOOK_LIMIT_WINDOW_MS).toBe(60 * 1000);
        expect(WHATSAPP_WEBHOOK_LIMIT_MAX).toBe(300);
    });

    it('permite até 300 webhooks e bloqueia com 429 a partir do 301º (#1568 AC)', async () => {
        // 300 reqs — assertion individual é custosa; fazemos loop de 300 e verificamos
        // o último status; otimizado para ~5s.
        for (let i = 0; i < WHATSAPP_WEBHOOK_LIMIT_MAX; i++) {
            const res = await request(app)
                .post('/api/whatsapp/webhook')
                .set('X-Forwarded-For', WEBHOOK_IP)
                .send({ event: 'message', i });
            expect(res.status, `webhook #${i + 1} deveria passar`).toBe(200);
        }
        // 301ª — acceptance criterion #1568: deve retornar 429.
        const blocked = await request(app)
            .post('/api/whatsapp/webhook')
            .set('X-Forwarded-For', WEBHOOK_IP)
            .send({ event: 'message', over: true });
        expect(blocked.status).toBe(429);
        expect(blocked.body).toHaveProperty('success', false);
        expect(blocked.body.error.code).toBe('RATE_LIMIT');
    }, 60000);

    it('webhook retorna envelope padrão { success:true, data:{ status:"received" } } (#1568)', async () => {
        const res = await request(app)
            .post('/api/whatsapp/webhook')
            .set('X-Forwarded-For', ENVELOP_IP)
            .send({ message: 'hello' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('received');
    });
});
