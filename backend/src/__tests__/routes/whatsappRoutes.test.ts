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

vi.mock('express-rate-limit', () => defaultFn => defaultFn);

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
        it('returns 200 with event', async () => {
            const res = await request(app)
                .post('/api/whatsapp/webhook')
                .send({ message: 'test' });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('received');
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

    describe('POST /api/whatsapp/send', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ chatId: '123', text: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 when missing fields', async () => {
            const res = await request(app)
                .post('/api/whatsapp/send')
                .send({ chatId: '123' });

            expect(res.status).toBe(400);
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
