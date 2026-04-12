import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockCentrovibeStoreService = vi.hoisted(() => ({
    getData: vi.fn(() => ({ key: 'value' })),
    saveData: vi.fn(),
    getSchedule: vi.fn(() => []),
    saveSchedule: vi.fn(),
    getArtists: vi.fn(() => []),
    addArtist: vi.fn(() => ({ id: '1', name: 'Test Artist' })),
    updateArtist: vi.fn(() => ({ id: '1' })),
    deleteArtist: vi.fn(() => true),
    getCompetitors: vi.fn(() => []),
    addCompetitor: vi.fn(() => ({ id: '1' })),
    updateCompetitor: vi.fn(() => ({ id: '1' })),
    deleteCompetitor: vi.fn(() => true),
    getExternalEvents: vi.fn(() => []),
    addExternalEvent: vi.fn(() => ({ id: '1' })),
    updateExternalEvent: vi.fn(() => ({ id: '1' })),
    deleteExternalEvent: vi.fn(() => true),
}));

const mockEventScraperService = vi.hoisted(() => ({
    getStatus: vi.fn(() => ({ isRunning: false })),
    runScrape: vi.fn(),
}));

const mockAiService = vi.hoisted(() => ({
    generateReply: vi.fn(() => 'AI response'),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/centrovibeStoreService', () => ({
    centrovibeStoreService: mockCentrovibeStoreService,
}));

vi.mock('../../services/eventScraperService', () => ({
    eventScraperService: mockEventScraperService,
}));

vi.mock('../../services/aiService', () => ({
    aiService: mockAiService,
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

import centrovibeRoutes from '../../routes/centrovibeRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/centrovibe', centrovibeRoutes);
    return app;
}

describe('centrovibeRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('GET /api/centrovibe/data', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/centrovibe/data');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('key');
        });
    });

    describe('PUT /api/centrovibe/data', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .put('/api/centrovibe/data')
                .send({ key: 'newValue' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('GET /api/centrovibe/schedule', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/centrovibe/schedule');

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/centrovibe/ai/vibe-check', () => {
        it('returns 200 with valid genres', async () => {
            const res = await request(app)
                .post('/api/centrovibe/ai/vibe-check')
                .send({ genreA: 'Funk', genreB: 'Trap' });

            expect(res.status).toBe(200);
        });

        it('returns 400 when genres missing', async () => {
            const res = await request(app)
                .post('/api/centrovibe/ai/vibe-check')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/centrovibe/ai/advisor', () => {
        it('returns 200 with message', async () => {
            const res = await request(app)
                .post('/api/centrovibe/ai/advisor')
                .send({ message: 'Suggest a theme' });

            expect(res.status).toBe(200);
        });

        it('returns 400 when message missing', async () => {
            const res = await request(app)
                .post('/api/centrovibe/ai/advisor')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/centrovibe/scraper/run', () => {
        it('returns 202 when scrape started', async () => {
            const res = await request(app).post('/api/centrovibe/scraper/run');

            expect(res.status).toBe(202);
        });

        it('returns 409 when scrape already running', async () => {
            mockEventScraperService.getStatus.mockReturnValue({ isRunning: true });

            const res = await request(app).post('/api/centrovibe/scraper/run');

            expect(res.status).toBe(409);
        });
    });

    describe('GET /api/centrovibe/scraper/status', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/centrovibe/scraper/status');

            expect(res.status).toBe(200);
        });
    });
});
