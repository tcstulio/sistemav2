import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from '../../middleware/errorHandler';

const mockDolibarrService = vi.hoisted(() => ({
    login: vi.fn(),
    getUserByKey: vi.fn(),
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: mockDolibarrService,
}));

vi.mock('../../config/env', async (orig) => {
    const actual = await (orig() as Promise<any>);
    return { ...actual, config: { ...actual.config, adminKey: 'test-admin-key' } };
});

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

const mockLoginLimiter = vi.hoisted(() => {
    const attempts = new Map<string, number>();
    const middleware = vi.fn((req: any, res: any, next: any) => {
        const identifier = String(req.body?.email || req.body?.login || req.body?.username || 'anon').toLowerCase();
        const key = `${req.ip}:${identifier}`;
        const count = (attempts.get(key) || 0) + 1;
        attempts.set(key, count);
        if (count > 5) {
            return res.status(429).json({ success: false, error: { code: 'RATE_LIMIT', message: 'Too many login attempts' } });
        }
        return next();
    });
    return { middleware, reset: () => attempts.clear() };
});

vi.mock('../../middleware/rateLimit', () => ({
    rateLimiters: {
        login: mockLoginLimiter.middleware,
        ai: (req: any, res: any, next: any) => next(),
        default: (req: any, res: any, next: any) => next(),
    },
}));

import authRoutes from '../../routes/authRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api', authRoutes);
    app.use(errorHandler);
    return app;
}

describe('authRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLoginLimiter.reset();
        app = createApp();
    });

    describe('POST /api/login', () => {
        it('returns 200 with user data and a secure httpOnly cookie without exposing the token', async () => {
            mockDolibarrService.login.mockResolvedValue({
                token: 'test-token-123',
                message: 'Login successful',
            });
            mockDolibarrService.getUserByKey.mockResolvedValue({ id: 1, login: 'admin', admin: '1', email: 'admin@example.com' });

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'password123' });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: true, data: { user: { id: 1, login: 'admin', admin: '1' } } });
            expect(res.body).not.toHaveProperty('apiKey');
            expect(JSON.stringify(res.body)).not.toContain('test-token-123');
            const cookie = (res.headers['set-cookie'] as unknown as string[])?.[0] || '';
            expect(cookie).toContain('auth_token=');
            expect(cookie).toContain('HttpOnly');
            expect(cookie).toContain('Secure');
            expect(cookie).toContain('SameSite=Strict');
            expect(cookie).toContain('Path=/');
            expect(cookie).toContain('Max-Age=86400');
        });

        it('returns 400 when login field is missing', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when password field is missing', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when both email and password are empty strings', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ login: '', password: '' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when login has fewer than 3 characters', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ login: 'ab', password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockDolibarrService.login).not.toHaveBeenCalled();
        });

        it('returns 400 when password has fewer than 6 characters', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: '12345' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockDolibarrService.login).not.toHaveBeenCalled();
        });

        it('returns 401 when credentials are invalid', async () => {
            mockDolibarrService.login.mockRejectedValue(new Error('Invalid credentials'));

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'wrongpassword' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toEqual({
                code: 'AUTHENTICATION_FAILED',
                message: 'Invalid credentials',
            });
        });

        it('returns 401 when dolibarrService throws unexpected error', async () => {
            mockDolibarrService.login.mockRejectedValue(new Error('Database connection failed'));

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'password123' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });

        it('returns the standard 429 envelope on the sixth attempt for the same login', async () => {
            mockDolibarrService.login.mockRejectedValue(new Error('Invalid credentials'));

            for (let attempt = 0; attempt < 5; attempt++) {
                await request(app)
                    .post('/api/login')
                    .send({ login: 'rate-limited@example.com', password: 'wrongpassword' });
            }

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'rate-limited@example.com', password: 'wrongpassword' });

            expect(res.status).toBe(429);
            expect(res.body).toMatchObject({
                success: false,
                error: {
                    code: 'RATE_LIMIT',
                    message: expect.any(String),
                },
            });
        });
    });

    describe('POST /api/logout', () => {
        it('returns 200 and clears the secure httpOnly cookie', async () => {
            const res = await request(app)
                .post('/api/logout');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Logged out');
            const cookie = (res.headers['set-cookie'] as unknown as string[])?.[0] || '';
            expect(cookie).toContain('auth_token=;');
            expect(cookie).toContain('HttpOnly');
            expect(cookie).toContain('Secure');
            expect(cookie).toContain('SameSite=Strict');
            expect(cookie).toContain('Path=/');
        });
    });

    describe('Admin console auth via cookie (#33)', () => {
        it('admin-login sets an httpOnly admin_key cookie with the correct key', async () => {
            const res = await request(app)
                .post('/api/admin-login')
                .send({ adminKey: 'test-admin-key' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const cookie = (res.headers['set-cookie'] as unknown as string[])?.[0] || '';
            expect(cookie).toContain('admin_key=');
            expect(cookie).toContain('HttpOnly');
        });

        it('admin-login rejects a wrong key with 401 and no cookie', async () => {
            const res = await request(app)
                .post('/api/admin-login')
                .send({ adminKey: 'wrong' });

            expect(res.status).toBe(401);
            expect(res.headers['set-cookie']).toBeUndefined();
        });

        it('admin-login validates the payload (400 when missing)', async () => {
            const res = await request(app).post('/api/admin-login').send({});
            expect(res.status).toBe(400);
        });

        it('admin-check returns authenticated:true with a valid cookie', async () => {
            const res = await request(app)
                .get('/api/admin-check')
                .set('Cookie', 'admin_key=test-admin-key');
            expect(res.status).toBe(200);
            expect(res.body.authenticated).toBe(true);
        });

        it('admin-check returns authenticated:false without a cookie', async () => {
            const res = await request(app).get('/api/admin-check');
            expect(res.status).toBe(200);
            expect(res.body.authenticated).toBe(false);
        });

        it('admin-logout clears the admin_key cookie', async () => {
            const res = await request(app).post('/api/admin-logout');
            expect(res.status).toBe(200);
            expect(res.headers['set-cookie']).toBeDefined();
        });
    });
});
