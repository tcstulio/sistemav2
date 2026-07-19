import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// NÃO mockamos `express-rate-limit` neste arquivo — queremos exercitar o
// comportamento real dos limiters definidos em
// `middleware/whatsappRateLimiters.ts`. O companion `whatsappRoutes.test.ts`
// mocka para focar em contrato; aqui validamos que 10+1 e 300+1 → 429.

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));

const mockSocketService = vi.hoisted(() => ({ emit: vi.fn() }));

const mockSessionService = vi.hoisted(() => ({
    getClient: vi.fn(() => ({ isRegisteredUser: vi.fn(async () => true) })),
    getAllSessions: vi.fn(() => []),
    getStatus: vi.fn(async () => 'connected'),
    startSession: vi.fn(async () => ({ success: true })),
    deleteSession: vi.fn(async () => ({})),
    getScreenshot: vi.fn(async () => null),
    getProfile: vi.fn(async () => ({})),
}));

const mockChannelRouter = vi.hoisted(() => ({
    getDefaultSessionId: vi.fn(() => 'default'),
    getWhatsAppProvider: vi.fn(() => 'legacy'),
    sendWhatsApp: vi.fn(async () => ({ success: true, messageId: 'm', provider: 'legacy' })),
}));

const mockStoreService = vi.hoisted(() => ({
    getSessionSettings: vi.fn(() => ({})),
    getChatSettings: vi.fn(() => ({})),
    getUserSettings: vi.fn(() => ({})),
    formatMessageWithSignature: vi.fn((t: string) => t),
    updateLastResponder: vi.fn(),
    getAssignment: vi.fn(() => null),
}));

const mockMessageService = vi.hoisted(() => ({
    getChats: vi.fn(() => []),
    getMessages: vi.fn(() => []),
    getMessageMedia: vi.fn(() => null),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/legacy/sessionService', () => ({
    sessionService: mockSessionService,
}));

vi.mock('../../services/socketService', () => ({
    socketService: mockSocketService,
}));

vi.mock('../../services/channelRouter', () => ({
    channelRouter: mockChannelRouter,
}));

vi.mock('../../services/storeService', () => ({
    storeService: mockStoreService,
}));

vi.mock('../../services/legacy/messageService', () => ({
    messageService: mockMessageService,
}));

vi.mock('../../services/moltbotGateway', () => ({ moltbotGateway: {} }));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
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
    app.use(express.json());
    // `server.ts` usa `app.set('trust proxy', 1)` — replicamos para que cada
    // teste tenha seu próprio bucket no limiter via X-Forwarded-For distinto.
    app.set('trust proxy', 1);
    app.use('/api/whatsapp', whatsappRoutes);
    return app;
}

// IPs distintos por teste — os limiters são singletons (mesmo módulo
// compartilhado entre testes), então cada `it()` precisa de seu próprio bucket.
const IP_CHECK = '198.51.100.11';
const IP_CHECK_ISOLATION = '198.51.100.12';
const IP_WEBHOOK = '198.51.100.21';
const IP_WEBHOOK_OTHER = '198.51.100.99';

describe('WhatsApp rate limiters (#1568)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('configuração (contrato exportado)', () => {
        it('whatsappCheckLimiter: 10 req/min (mais restritivo que o geral)', () => {
            expect(WHATSAPP_CHECK_LIMIT_WINDOW_MS).toBe(60 * 1000);
            expect(WHATSAPP_CHECK_LIMIT_MAX).toBe(10);
        });

        it('webhookLimiter: 300 req/min (teto alto para webhook público)', () => {
            expect(WHATSAPP_WEBHOOK_LIMIT_WINDOW_MS).toBe(60 * 1000);
            expect(WHATSAPP_WEBHOOK_LIMIT_MAX).toBe(300);
        });
    });

    describe('GET /api/whatsapp/check-number/:number — 10/min por IP', () => {
        it('permite 10 requests e bloqueia a 11ª com 429', async () => {
            const validNumber = '5511999999999';
            for (let i = 0; i < WHATSAPP_CHECK_LIMIT_MAX; i++) {
                const res = await request(app)
                    .get(`/api/whatsapp/check-number/${validNumber}`)
                    .set('X-Forwarded-For', IP_CHECK);
                expect(res.status, `request #${i + 1} deveria passar`).not.toBe(429);
            }
            // 11ª request excede o limite → 429.
            const blocked = await request(app)
                .get(`/api/whatsapp/check-number/${validNumber}`)
                .set('X-Forwarded-For', IP_CHECK);
            expect(blocked.status).toBe(429);
            // Envelope de erro padrão.
            expect(blocked.body.success).toBe(false);
            expect(blocked.body.error.code).toBe('RATE_LIMIT');
        }, 15000);

        it('IP distinto tem bucket independente', async () => {
            // Satura IP_CHECK_ISOLATION com 10 requests.
            const validNumber = '5511999999999';
            for (let i = 0; i < WHATSAPP_CHECK_LIMIT_MAX; i++) {
                await request(app)
                    .get(`/api/whatsapp/check-number/${validNumber}`)
                    .set('X-Forwarded-For', IP_CHECK_ISOLATION);
            }
            // IP novo ainda passa.
            const other = await request(app)
                .get(`/api/whatsapp/check-number/${validNumber}`)
                .set('X-Forwarded-For', '203.0.113.77');
            expect(other.status).toBe(200);
        }, 15000);
    });

    describe('POST /api/whatsapp/webhook — 300/min por IP', () => {
        it('permite 300 requests e bloqueia a 301ª com 429', async () => {
            for (let i = 0; i < WHATSAPP_WEBHOOK_LIMIT_MAX; i++) {
                const res = await request(app)
                    .post('/api/whatsapp/webhook')
                    .set('X-Forwarded-For', IP_WEBHOOK)
                    .send({ msg: i });
                // Qualquer coisa que não seja 429 é "passou pelo limiter".
                // (Pode ser 200 mesmo se o handler rodar.)
                if (res.status === 429) {
                    throw new Error(`request #${i + 1} não deveria ser bloqueada`);
                }
            }
            // 301ª request excede o limite → 429.
            const blocked = await request(app)
                .post('/api/whatsapp/webhook')
                .set('X-Forwarded-For', IP_WEBHOOK)
                .send({ msg: 'overflow' });
            expect(blocked.status).toBe(429);
            expect(blocked.body.success).toBe(false);
            expect(blocked.body.error.code).toBe('RATE_LIMIT');
        }, 60000);

        it('IP distinto não compartilha bucket com o saturado', async () => {
            // IP_WEBHOOK já está saturado pelo teste acima (mesmo módulo singleton),
            // mas um IP novo precisa continuar funcionando.
            const other = await request(app)
                .post('/api/whatsapp/webhook')
                .set('X-Forwarded-For', IP_WEBHOOK_OTHER)
                .send({ ok: true });
            expect(other.status).toBe(200);
        }, 10000);
    });
});
