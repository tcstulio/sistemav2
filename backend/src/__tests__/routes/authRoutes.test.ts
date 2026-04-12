import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockDolibarrService = vi.hoisted(() => ({
    login: vi.fn(),
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: mockDolibarrService,
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
    default: vi.fn(() => (req: any, res: any, next: any) => next()),
}));

import authRoutes from '../../routes/authRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', authRoutes);
    return app;
}

describe('authRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/login', () => {
        it('returns 200 with token on successful login', async () => {
            mockDolibarrService.login.mockResolvedValue({
                token: 'test-token-123',
                message: 'Login successful',
            });

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'password123' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.apiKey).toBe('test-token-123');
            expect(res.headers['set-cookie']).toBeDefined();
        });

        it('returns 400 when login field is missing', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation Error');
        });

        it('returns 400 when password field is missing', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation Error');
        });

        it('returns 400 when both login and password are empty strings', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ login: '', password: '' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation Error');
        });

        it('returns 401 when credentials are invalid', async () => {
            mockDolibarrService.login.mockRejectedValue(new Error('Invalid credentials'));

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'wrongpassword' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe('Invalid credentials');
        });

        it('returns 401 when dolibarrService throws unexpected error', async () => {
            mockDolibarrService.login.mockRejectedValue(new Error('Database connection failed'));

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'password123' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });
    });

    describe('POST /api/logout', () => {
        it('returns 200 and clears cookie', async () => {
            const res = await request(app)
                .post('/api/logout');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Logged out');
            expect(res.headers['set-cookie']).toBeDefined();
        });
    });
});
