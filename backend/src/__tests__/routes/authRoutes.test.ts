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
        const ip = String(req.ip || 'unknown');
        const count = (attempts.get(ip) || 0) + 1;
        attempts.set(ip, count);
        if (count > 5) {
            return res.status(429).json({
                success: false,
                error: { code: 'RATE_LIMIT', message: 'Too many login attempts' },
            });
        }
        return next();
    });
    return { middleware, reset: () => attempts.clear() };
});

vi.mock('../../middleware/rateLimitFactory', () => ({
    loginLimiter: mockLoginLimiter.middleware,
}));

import authRoutes from '../../routes/authRoutes';

function createApp() {
    const app = express();
    app.set('trust proxy', true);
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

    describe('POST /api/login (#1329 httpOnly cookie + rate limit 5/15min)', () => {
        it('returns 200 with user data and a secure httpOnly cookie without exposing the apiKey (#1329)', async () => {
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
            // #1329 AC: Body JSON NÃO contém mais o campo `apiKey` em texto plano. O token é
            // entregue APENAS via cookie httpOnly (Set-Cookie). A chave crua do Dolibarr também
            // nunca vaza — ela só fica no cofre server-side (proto_session).
            expect(res.body.apiKey).toBeUndefined();
            expect(JSON.stringify(res.body)).not.toContain('test-token-123');
            const cookie = (res.headers['set-cookie'] as unknown as string[])?.[0] || '';
            expect(cookie).toContain('auth_token=');
            expect(cookie).toContain('HttpOnly');
            expect(cookie).toContain('Secure');
            expect(cookie).toContain('SameSite=Strict');
            expect(cookie).toContain('Path=/');
            // #1329 AC: Max-Age=86400 (24h)
            expect(cookie).toContain('Max-Age=86400');
        });

        it('does not leak the raw Dolibarr token in the JSON body or Set-Cookie (#1329)', async () => {
            mockDolibarrService.login.mockResolvedValue({
                token: 'super-secret-raw-dolibarr-key',
                message: 'Login successful',
            });
            mockDolibarrService.getUserByKey.mockResolvedValue({ id: 1, login: 'admin', admin: '1' });

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'password123' });

            expect(res.status).toBe(200);
            const whole = JSON.stringify(res.body) + JSON.stringify(res.headers);
            expect(whole).not.toContain('super-secret-raw-dolibarr-key');
        });

        it('returns 400 when login is shorter than 3 characters (#1329 Zod validation)', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ login: 'ab', password: 'password123' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when password is shorter than 6 characters (#1329 Zod validation)', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: '12345' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when both login and password are empty strings', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ login: '', password: '' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
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

        it('returns 401 with AUTHENTICATION_FAILED code when credentials are invalid', async () => {
            mockDolibarrService.login.mockRejectedValue(new Error('Invalid credentials'));

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'wrongpassword123' });

            expect(res.status).toBe(401);
            expect(res.body).toMatchObject({ success: false, error: { code: 'AUTHENTICATION_FAILED' } });
        });

        it('returns 401 when dolibarrService throws unexpected error', async () => {
            mockDolibarrService.login.mockRejectedValue(new Error('Database connection failed'));

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'password123' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });

        it('returns 401 envelope even when userData fetch fails', async () => {
            mockDolibarrService.login.mockResolvedValue({
                token: 'test-token-123',
                message: 'Login successful',
            });
            mockDolibarrService.getUserByKey.mockRejectedValue(new Error('user lookup failed'));

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'admin', password: 'password123' });

            expect(res.status).toBe(200);
            expect(res.body.data.user).toBeNull();
        });

        it('returns the standard 429 envelope on the sixth attempt from the same IP', async () => {
            mockDolibarrService.login.mockRejectedValue(new Error('Invalid credentials'));

            for (let attempt = 0; attempt < 5; attempt++) {
                await request(app)
                    .post('/api/login')
                    .send({ login: 'rate-limited', password: 'wrongpassword' });
            }

            const res = await request(app)
                .post('/api/login')
                .send({ login: 'rate-limited', password: 'wrongpassword' });

            expect(res.status).toBe(429);
            expect(res.body).toMatchObject({
                success: false,
                error: { code: 'RATE_LIMIT' },
            });
            expect(res.body.error.message).toBeTypeOf('string');
        });
    });

    describe('POST /api/logout', () => {
        it('returns 200 and clears the secure httpOnly auth_token cookie', async () => {
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

        it('also clears the legacy apiKey cookie (#1329 migration — no dangling session)', async () => {
            const res = await request(app)
                .post('/api/logout');

            expect(res.status).toBe(200);
            const cookies = (res.headers['set-cookie'] as unknown as string[]) || [];
            const joined = cookies.join('\n');
            expect(joined).toContain('auth_token=;');
            expect(joined).toContain('apiKey=;');
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
