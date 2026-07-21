import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../middleware/errorHandler';
import { config } from '../../config/env';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockSessionService = vi.hoisted(() => ({
    getAllSessions: vi.fn(() => []),
    getStatus: vi.fn(() => 'connected'),
    startSession: vi.fn(() => ({ success: true })),
    deleteSession: vi.fn(() => ({})),
    getClient: vi.fn(() => ({ isRegisteredUser: vi.fn(() => true) })),
    getScreenshot: vi.fn(() => Buffer.from('png')),
    getProfile: vi.fn(() => ({})),
    setProfilePicture: vi.fn(() => true),
    deleteProfilePicture: vi.fn(() => true),
    setDisplayName: vi.fn(() => true),
    setAbout: vi.fn(() => true),
    setPresence: vi.fn(),
}));

const mockMessageService = vi.hoisted(() => ({
    getChats: vi.fn(() => []),
    getMessages: vi.fn(() => []),
    getMessageMedia: vi.fn(() => null),
}));

const mockStoreService = vi.hoisted(() => ({
    getSessionSettings: vi.fn(() => ({})),
    updateSessionSettings: vi.fn(),
    getChatSettings: vi.fn(() => ({})),
    updateChatSettings: vi.fn(),
    getUserSettings: vi.fn(() => ({})),
    updateUserSettings: vi.fn(),
    formatMessageWithSignature: vi.fn((text) => text),
    updateLastResponder: vi.fn(),
    getAssignment: vi.fn(() => null),
    assignConversation: vi.fn(),
}));

const mockSocketService = vi.hoisted(() => ({
    emit: vi.fn(),
}));

const mockChannelRouter = vi.hoisted(() => ({
    sendWhatsApp: vi.fn(() => ({ success: true, messageId: 'msg-1', timestamp: Date.now(), provider: 'legacy' })),
    sendWhatsAppFile: vi.fn(() => ({ success: true, messageId: 'msg-1', provider: 'legacy' })),
    sendWhatsAppVoice: vi.fn(() => ({ success: true, messageId: 'msg-1', provider: 'legacy' })),
    getDefaultSessionId: vi.fn(() => 'default'),
    getWhatsAppProvider: vi.fn(() => 'legacy'),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/legacy/sessionService', () => ({
    sessionService: mockSessionService,
}));

vi.mock('../../services/legacy/messageService', () => ({
    messageService: mockMessageService,
}));

vi.mock('../../services/storeService', () => ({
    storeService: mockStoreService,
}));

vi.mock('../../services/socketService', () => ({
    socketService: mockSocketService,
}));

vi.mock('../../services/channelRouter', () => ({
    channelRouter: mockChannelRouter,
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

// #1568 — NÃO mockamos `express-rate-limit` aqui para os testes que precisam
// exercitar o limiter de verdade (whatsappRateLimit.test.ts). Nestes testes o mock
// continua presente porque os endpoints que tocam rate-limit NÃO são o alvo.
vi.mock('express-rate-limit', () => ({
    default: (_config?: any) => (_req: any, _res: any, next: any) => next(),
}));

import whatsappRoutes from '../../routes/whatsappRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/whatsapp', whatsappRoutes);
    app.use(errorHandler);
    return app;
}

describe('whatsappRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/whatsapp/webhook', () => {
        // #1568 — webhook agora responde via envelope padrao ({success, data}).
        // Mantemos a asserção original (status 200, evento "received") preservada
        // — apenas navegamos pela nova estrutura de envelope.
        it('returns 200 with event in standard envelope (#1568)', async () => {
            const res = await request(app)
                .post('/api/whatsapp/webhook')
                .send({ message: 'test' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('received');
        });

        it('keeps webhook signature validation when a secret is configured', async () => {
            const previousSecret = config.webhookSecret;
            config.webhookSecret = 'webhook-secret';

            try {
                const rejected = await request(app)
                    .post('/api/whatsapp/webhook')
                    .send({ message: 'test' });
                const accepted = await request(app)
                    .post('/api/whatsapp/webhook')
                    .set('x-webhook-signature', 'webhook-secret')
                    .send({ message: 'test' });

                expect(rejected.status).toBe(401);
                expect(rejected.body.error.code).toBe('UNAUTHORIZED');
                expect(accepted.status).toBe(200);
            } finally {
                config.webhookSecret = previousSecret;
            }
        });
    });

    describe('GET /api/whatsapp/sessions', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/whatsapp/sessions');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/whatsapp/status', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/whatsapp/status');

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/whatsapp/send (#1568)', () => {
        // #1568 — schema mudou de { chatId, text } para { to: phoneSchema, message, mediaUrl? }.
        // Teste adaptado mantendo a asserção equivalente: 200 + success:true com payload válido.
        // Demais caminhos (to inválido, normalize) cobertos nos describes abaixo.
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ to: '5511987654321', message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        // #1568 — AC explicito: POST /send sem `to` ou com `to` inválido retorna 400.
        it('returns 400 when `to` is missing entirely (#1568 AC)', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        // #1568 — AC explicito: POST /send sem `to` ou com `to` inválido retorna 400.
        it('returns 400 when `to` is invalid (non-digits) (#1568 AC)', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ to: 'abc', message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        // #1568 — AC explicito (complementar): POST /send com `to` curto demais → 400.
        it('returns 400 when `to` is too short', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ to: '123', message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        // #1568 — asserção adaptada: o "missing fields" agora testa o NOVO
        // contrato. Antes faltava `text`; agora faltando `message` (mantendo `to`).
        it('returns 400 when missing required fields (no message)', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ to: '5511987654321' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        // #1568 — `message` vazio viola min(1) → 400.
        it('returns 400 when `message` is empty', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ to: '5511987654321', message: '' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        // #1568 — normalização #1568: número com máscara deve ser limpo ANTES de
        // montar chatId. Confirma que o canal envia para o chatId digits-only.
        it('normalizes `to` (strips non-digits) before sending (#1568)', async () => {
            mockChannelRouter.sendWhatsApp.mockClear();
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ to: '+55 (11) 98765-4321', message: 'Hi' });

            expect(res.status).toBe(200);
            expect(mockChannelRouter.sendWhatsApp).toHaveBeenCalledWith(
                '5511987654321@c.us',
                'Hi',
                expect.any(String)
            );
        });
    });

    describe('POST /api/whatsapp/send-bulk (#1568)', () => {
        it('returns 200 and dispatches to each recipient', async () => {
            mockChannelRouter.sendWhatsApp.mockClear();
            const res = await request(app)
                .post('/api/whatsapp/send-bulk')
                .send({
                    recipients: ['5511987654321', '5521987654321'],
                    message: 'Bulk hi',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.sent).toHaveLength(2);
            expect(res.body.data.failed).toHaveLength(0);
            expect(res.body.meta.total).toBe(2);
            expect(mockChannelRouter.sendWhatsApp).toHaveBeenCalledTimes(2);
        });

        it('returns 400 when recipients is empty', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send-bulk')
                .send({ recipients: [], message: 'x' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when a recipient is not a valid phone', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send-bulk')
                .send({ recipients: ['abc'], message: 'x' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when recipients exceeds 100', async () => {
            const recipients = Array.from({ length: 101 }, (_, i) =>
                `55119${String(i).padStart(7, '0')}`
            );
            const res = await request(app)
                .post('/api/whatsapp/send-bulk')
                .send({ recipients, message: 'x' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('collects per-recipient failures without aborting the batch', async () => {
            mockChannelRouter.sendWhatsApp
                .mockResolvedValueOnce({
                    success: false,
                    messageId: undefined,
                    timestamp: 0,
                    provider: 'legacy',
                    error: 'rejected',
                } as any)
                .mockResolvedValueOnce({
                    success: true,
                    messageId: 'ok-1',
                    timestamp: 0,
                    provider: 'legacy',
                } as any);

            const res = await request(app)
                .post('/api/whatsapp/send-bulk')
                .send({ recipients: ['5511987654321', '5521987654321'], message: 'hi' });

            expect(res.status).toBe(200);
            expect(res.body.data.sent).toHaveLength(1);
            expect(res.body.data.failed).toHaveLength(1);
            expect(res.body.data.failed[0].error).toBe('rejected');
        });
    });

    describe('POST /api/whatsapp/template (#1568)', () => {
        it('returns 200 with valid template payload (no `to`)', async () => {
            const res = await request(app)
                .post('/api/whatsapp/template')
                .send({
                    name: 'welcome',
                    language: 'pt_BR',
                    components: [{ type: 'body', parameters: [{ type: 'text', text: 'Oi' }] }],
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('welcome');
            expect(res.body.data.language).toBe('pt_BR');
        });

        it('returns 200 with optional `to` as valid phone (normalizes chatId)', async () => {
            const res = await request(app)
                .post('/api/whatsapp/template')
                .send({
                    to: '5511987654321',
                    name: 'welcome',
                    language: 'pt_BR',
                    components: [],
                });

            expect(res.status).toBe(200);
            expect(res.body.data.chatId).toBe('5511987654321@c.us');
        });

        it('returns 400 when missing required fields', async () => {
            const res = await request(app)
                .post('/api/whatsapp/template')
                .send({ name: 'welcome' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when `to` is invalid', async () => {
            const res = await request(app)
                .post('/api/whatsapp/template')
                .send({ to: 'not-a-phone', name: 'welcome', language: 'pt_BR', components: [] });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    describe('GET /api/whatsapp/check-number/:number (#1568)', () => {
        // #1568 — defesa contra enumeração: o handler chama `client.isRegisteredUser`
        // passando o chatId normalizado.
        it('returns 200 with isRegistered for a valid phone', async () => {
            mockSessionService.getClient.mockReturnValue({
                isRegisteredUser: vi.fn().mockResolvedValue(true),
            } as any);

            const res = await request(app).get('/api/whatsapp/check-number/5511987654321');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.number).toBe('5511987654321');
            expect(res.body.data.chatId).toBe('5511987654321@c.us');
            expect(res.body.data.isRegistered).toBe(true);
        });

        // #1568 — AC explicito: /check-number/abc retorna 400 (formato inválido).
        it('returns 400 (VALIDATION_ERROR) for non-numeric input (#1568 AC)', async () => {
            const res = await request(app).get('/api/whatsapp/check-number/abc');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 for too-short number (<10 digits)', async () => {
            const res = await request(app).get('/api/whatsapp/check-number/12345');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 for too-long number (>13 digits)', async () => {
            const res = await request(app).get('/api/whatsapp/check-number/55119888877771234');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 for unknown DDI (10 digits but unsupported prefix)', async () => {
            const res = await request(app).get('/api/whatsapp/check-number/9999888888');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        // #1568 — normalização: entrada com máscara deve virar digits-only antes
        // de chegar no `isRegisteredUser`. Confirma que o `chatId` resolvido não
        // carrega parênteses/espaços.
        it('normalizes number (strips non-digits) before checking', async () => {
            const fakeClient = {
                isRegisteredUser: vi.fn().mockResolvedValue(true),
            };
            mockSessionService.getClient.mockReturnValue(fakeClient as any);

            const res = await request(app).get('/api/whatsapp/check-number/%2B55%20(11)%2098888-7777');

            expect(res.status).toBe(200);
            expect(res.body.data.number).toBe('5511988887777');
            expect(res.body.data.chatId).toBe('5511988887777@c.us');
            expect(fakeClient.isRegisteredUser).toHaveBeenCalledWith('5511988887777@c.us');
        });
    });



    describe('POST /api/whatsapp/settings/session', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/whatsapp/settings/session')
                .send({ sessionId: 'default', name: 'Test Session' });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing sessionId', async () => {
            const res = await request(app)
                .post('/api/whatsapp/settings/session')
                .send({ name: 'Test' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/whatsapp/settings/chat', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/whatsapp/settings/chat')
                .send({ chatId: '123', autoReplyEnabled: false });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing chatId', async () => {
            const res = await request(app)
                .post('/api/whatsapp/settings/chat')
                .send({ autoReplyEnabled: false });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/whatsapp/assign', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/whatsapp/assign')
                .send({ chatId: '123', userId: 'user-1' });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing chatId', async () => {
            const res = await request(app)
                .post('/api/whatsapp/assign')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/whatsapp/conversations', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/whatsapp/conversations');

            expect(res.status).toBe(200);
        });
    });
});
