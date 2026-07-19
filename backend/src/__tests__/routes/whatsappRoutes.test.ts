import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

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

vi.mock('express-rate-limit', () => ({
    default: (_config?: any) => (_req: any, _res: any, next: any) => next(),
}));

import whatsappRoutes from '../../routes/whatsappRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/whatsapp', whatsappRoutes);
    return app;
}

describe('whatsappRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/whatsapp/webhook', () => {
        it('returns 200 with event in standard envelope', async () => {
            const res = await request(app)
                .post('/api/whatsapp/webhook')
                .send({ message: 'test' });

            expect(res.status).toBe(200);
            // Envelope padrão (#1568): { success, data }
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('received');
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

    describe('GET /api/whatsapp/check-number/:number (#1568)', () => {
        it('returns 200 with valid BR number', async () => {
            const res = await request(app).get('/api/whatsapp/check-number/5511999999999');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.isRegistered).toBe(true);
            expect(res.body.data.chatId).toBe('5511999999999@c.us');
            // Número é normalizado na resposta.
            expect(res.body.data.number).toBe('5511999999999');
        });

        it('returns 400 when number has invalid format (abc)', async () => {
            const res = await request(app).get('/api/whatsapp/check-number/abc');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when DDI is not allowed', async () => {
            // 99 não é DDI permitido.
            const res = await request(app).get('/api/whatsapp/check-number/9912345678');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when session is not connected', async () => {
            mockSessionService.getClient.mockReturnValueOnce(null);
            const res = await request(app).get('/api/whatsapp/check-number/5511999999999');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('SESSION_NOT_FOUND');
        });
    });

    describe('POST /api/whatsapp/send (#1568 — sendSchema)', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ to: '5511999999999', message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe('msg-1');
            // O destinatário chega ao provider normalizado e formatado como chatId.
            expect(mockChannelRouter.sendWhatsApp).toHaveBeenCalledWith(
                '5511999999999@c.us',
                expect.any(String),
                expect.any(String)
            );
        });

        it('returns 400 when missing `to`', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when `to` has invalid phone format', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ to: 'abc', message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when missing `message`', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ to: '5511999999999' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    describe('POST /api/whatsapp/send-bulk (#1568)', () => {
        it('returns 200 sending to multiple valid recipients', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send-bulk')
                .send({
                    recipients: ['5511999999999', '5511988888888'],
                    message: 'Hello'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.total).toBe(2);
            expect(res.body.data.succeeded).toBe(2);
            expect(res.body.data.failed).toBe(0);
            expect(mockChannelRouter.sendWhatsApp).toHaveBeenCalledTimes(2);
        });

        it('returns 400 when recipients is empty', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send-bulk')
                .send({ recipients: [], message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when any recipient is invalid', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send-bulk')
                .send({ recipients: ['abc'], message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when message is missing', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send-bulk')
                .send({ recipients: ['5511999999999'] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    describe('POST /api/whatsapp/template (#1568)', () => {
        it('returns 200 validating payload without recipient', async () => {
            const res = await request(app)
                .post('/api/whatsapp/template')
                .send({
                    name: 'welcome',
                    language: 'pt_BR',
                    components: [{ type: 'body', parameters: [] }]
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.validated).toBe(true);
        });

        it('returns 200 sending template to valid recipient', async () => {
            const res = await request(app)
                .post('/api/whatsapp/template')
                .send({
                    name: 'welcome',
                    language: 'pt_BR',
                    components: [],
                    to: '5511999999999'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.template.name).toBe('welcome');
            expect(mockChannelRouter.sendWhatsApp).toHaveBeenCalledWith(
                '5511999999999@c.us',
                expect.any(String),
                expect.any(String)
            );
        });

        it('returns 400 when name is missing', async () => {
            const res = await request(app)
                .post('/api/whatsapp/template')
                .send({ language: 'pt_BR', components: [] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when components is missing', async () => {
            const res = await request(app)
                .post('/api/whatsapp/template')
                .send({ name: 'welcome', language: 'pt_BR' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
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
