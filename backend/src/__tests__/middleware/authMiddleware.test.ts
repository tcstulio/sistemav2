import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Module from 'module';

vi.useFakeTimers();

const originalAdminKey = process.env.ADMIN_KEY;
process.env.ADMIN_KEY = 'test-admin-key-123';

const { mockDolibarrService } = vi.hoisted(() => ({
    mockDolibarrService: {
        getUserByKey: vi.fn(),
        verifyAdminStatus: vi.fn(),
    },
}));

vi.mock('../../config/env', () => ({
    config: {
        adminKey: 'test-admin-key-123',
    },
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
    }),
}));

import { Request, Response, NextFunction } from 'express';

let originalLoad: any;

beforeAll(() => {
    originalLoad = Module._load;
    Module._load = function (request: string, parent: any, isMain: boolean) {
        if (typeof request === 'string' && request.includes('dolibarrService')) {
            return { dolibarrService: mockDolibarrService };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
});

afterAll(() => {
    Module._load = originalLoad;
    if (originalAdminKey === undefined) {
        delete process.env.ADMIN_KEY;
    } else {
        process.env.ADMIN_KEY = originalAdminKey;
    }
    vi.useRealTimers();
});

const {
    authMiddleware,
    requireAuth,
    requireDolibarrLogin,
    requireDolibarrAdmin,
    requireRole,
    getAuthCacheMetrics,
} = await import('../../middleware/authMiddleware');

function mockRes() {
    const res = {
        statusCode: 200,
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    return res;
}

function mockNext(): NextFunction {
    return vi.fn();
}

function mockReq(overrides: Record<string, any> = {}): Request {
    return {
        headers: {},
        query: {},
        cookies: {},
        method: 'GET',
        path: '/test',
        ...overrides,
    } as unknown as Request;
}

describe('authMiddleware', () => {
    it('calls next() when valid admin key is provided', () => {
        const req = mockReq({ headers: { 'x-admin-key': 'test-admin-key-123' } });
        const res = mockRes();
        const next = mockNext();

        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when x-admin-key header is missing', () => {
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        authMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'INVALID_ADMIN_KEY',
                message: 'Forbidden: Invalid or missing Admin Key.',
            },
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when x-admin-key is wrong', () => {
        const req = mockReq({ headers: { 'x-admin-key': 'wrong-key' } });
        const res = mockRes();
        const next = mockNext();

        authMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'INVALID_ADMIN_KEY',
                message: 'Forbidden: Invalid or missing Admin Key.',
            },
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when x-admin-key is empty string', () => {
        const req = mockReq({ headers: { 'x-admin-key': '' } });
        const res = mockRes();
        const next = mockNext();

        authMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('keeps requireAuth compatible with requireDolibarrLogin', () => {
        expect(requireAuth).toBe(requireDolibarrLogin);
    });

    it('throws during module loading when ADMIN_KEY is missing', async () => {
        delete process.env.ADMIN_KEY;
        vi.resetModules();

        try {
            await expect(import('../../middleware/authMiddleware')).rejects.toThrow(
                'ADMIN_KEY não configurada — defina a variável de ambiente antes de iniciar o servidor'
            );
        } finally {
            process.env.ADMIN_KEY = 'test-admin-key-123';
        }
    });
});

describe('requireDolibarrLogin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 when no API key is provided at all', async () => {
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'AUTHENTICATION_REQUIRED',
                message: 'Authentication Required: You must be logged in to Dolibarr.',
            },
        });
    });

    it('reads API key from dolapikey header', async () => {
        const user = { id: 1, name: 'Test' };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req = mockReq({ headers: { dolapikey: 'key-from-dolapikey' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledWith('key-from-dolapikey');
        expect(next).toHaveBeenCalled();
        expect((req as any).user).toEqual(user);
    });

    it('reads API key from DOLAPIKEY header', async () => {
        const user = { id: 2, name: 'Test2' };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req = mockReq({ headers: { DOLAPIKEY: 'key-from-DOLAPIKEY' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledWith('key-from-DOLAPIKEY');
        expect(next).toHaveBeenCalled();
    });

    it('reads API key from query DOLAPIKEY', async () => {
        const user = { id: 3 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req = mockReq({ query: { DOLAPIKEY: 'query-dolapikey' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledWith('query-dolapikey');
        expect(next).toHaveBeenCalled();
    });

    it('reads API key from query dolapikey', async () => {
        const user = { id: 4 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req = mockReq({ query: { dolapikey: 'query-dolapikey-lower' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledWith('query-dolapikey-lower');
    });

    it('reads API key from query apiKey', async () => {
        const user = { id: 5 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req = mockReq({ query: { apiKey: 'query-apikey' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledWith('query-apikey');
    });

    it('reads API key from Bearer token in authorization header', async () => {
        const user = { id: 6 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req = mockReq({ headers: { authorization: 'Bearer my-bearer-token' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledWith('my-bearer-token');
        expect(next).toHaveBeenCalled();
    });

    it('does not read Bearer token when authorization header does not start with Bearer', async () => {
        const req = mockReq({ headers: { authorization: 'Basic abc123' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('reads API key from cookies.dolapikey', async () => {
        const user = { id: 7 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req = mockReq({ cookies: { dolapikey: 'cookie-key' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledWith('cookie-key');
        expect(next).toHaveBeenCalled();
    });

    it('returns 401 when user is null from dolibarrService', async () => {
        mockDolibarrService.getUserByKey.mockResolvedValue(null);

        const req = mockReq({ headers: { dolapikey: 'invalid-key' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'INVALID_DOLIBARR_KEY',
                message: 'Authentication Failed: Invalid Dolibarr API Key or User not found.',
            },
        });
    });

    it('returns 401 when dolibarrService throws an error', async () => {
        mockDolibarrService.getUserByKey.mockRejectedValue(new Error('Service down'));

        const req = mockReq({ headers: { dolapikey: 'some-key' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'AUTHENTICATION_SERVICE_ERROR',
                message: 'Authentication Service Error',
            },
        });
    });

    it('uses cache on subsequent calls with the same key', async () => {
        const user = { id: 10, name: 'Cached' };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req1 = mockReq({ headers: { dolapikey: 'cache-test-key' } });
        const res1 = mockRes();
        const next1 = mockNext();

        await requireDolibarrLogin(req1, res1, next1);
        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledTimes(1);
        expect(next1).toHaveBeenCalled();

        const req2 = mockReq({ headers: { dolapikey: 'cache-test-key' } });
        const res2 = mockRes();
        const next2 = mockNext();

        await requireDolibarrLogin(req2, res2, next2);
        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledTimes(1);
        expect(next2).toHaveBeenCalled();
        expect((req2 as any).user).toEqual(user);
    });

    it('exposes cache hit, miss, and size metrics', async () => {
        const before = getAuthCacheMetrics();
        mockDolibarrService.getUserByKey.mockResolvedValue({ id: 30 });

        await requireDolibarrLogin(
            mockReq({ headers: { dolapikey: 'metrics-cache-key' } }),
            mockRes(),
            mockNext()
        );
        await requireDolibarrLogin(
            mockReq({ headers: { dolapikey: 'metrics-cache-key' } }),
            mockRes(),
            mockNext()
        );

        const after = getAuthCacheMetrics();
        expect(after.auth_cache_misses).toBe(before.auth_cache_misses + 1);
        expect(after.auth_cache_hits).toBe(before.auth_cache_hits + 1);
        expect(after.auth_cache_size).toBeGreaterThan(0);
        expect(after.auth_cache_size).toBeLessThanOrEqual(500);
    });

    it('expires cached entries after exactly ten minutes', async () => {
        mockDolibarrService.getUserByKey.mockResolvedValue({ id: 31 });
        const makeRequest = () => requireDolibarrLogin(
            mockReq({ headers: { dolapikey: 'ten-minute-cache-key' } }),
            mockRes(),
            mockNext()
        );

        await makeRequest();
        vi.advanceTimersByTime(10 * 60 * 1000);
        await makeRequest();

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledTimes(2);
    });

    it('evicts the least recently used entry and never exceeds 500 entries', async () => {
        vi.advanceTimersByTime(10 * 60 * 1000);
        vi.clearAllMocks();
        mockDolibarrService.getUserByKey.mockImplementation(async (key: string) => ({ key }));
        const authenticate = (key: string) => requireDolibarrLogin(
            mockReq({ headers: { dolapikey: key } }),
            mockRes(),
            mockNext()
        );

        for (let index = 0; index < 500; index += 1) {
            await authenticate(`lru-cache-key-${index}`);
        }

        await authenticate('lru-cache-key-0');
        await authenticate('lru-cache-key-500');
        await authenticate('lru-cache-key-0');

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledTimes(501);
        expect(getAuthCacheMetrics().auth_cache_size).toBe(500);

        await authenticate('lru-cache-key-1');

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledTimes(502);
        expect(getAuthCacheMetrics().auth_cache_size).toBe(500);
    });

    it('falls through to fetch when old cache format (number) is expired', async () => {
        const user = { id: 11 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req1 = mockReq({ headers: { dolapikey: 'old-cache-key' } });
        const res1 = mockRes();
        const next1 = mockNext();
        await requireDolibarrLogin(req1, res1, next1);

        expect(next1).toHaveBeenCalled();
    });

    it('falls through to fetch when cached entry is expired (object with past expiry)', async () => {
        const user = { id: 12 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req1 = mockReq({ headers: { dolapikey: 'expiring-key' } });
        const res1 = mockRes();
        const next1 = mockNext();
        await requireDolibarrLogin(req1, res1, next1);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledTimes(1);

        const originalDateNow = Date.now;
        const cachedTime = Date.now();
        Date.now = vi.fn(() => cachedTime + 11 * 60 * 1000) as any;

        const req2 = mockReq({ headers: { dolapikey: 'expiring-key' } });
        const res2 = mockRes();
        const next2 = mockNext();
        await requireDolibarrLogin(req2, res2, next2);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledTimes(2);

        Date.now = originalDateNow;
    });

    it('falls through to fetch when cached number entry is not expired but no user object', async () => {
        const user = { id: 13 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req1 = mockReq({ headers: { dolapikey: 'number-cache-key' } });
        const res1 = mockRes();
        const next1 = mockNext();
        await requireDolibarrLogin(req1, res1, next1);
        expect(next1).toHaveBeenCalled();
    });

    it('handles req.cookies being undefined', async () => {
        const user = { id: 14 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req = mockReq({ headers: { dolapikey: 'cookie-undef' }, cookies: undefined });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('cache cleanup interval removes expired entries', async () => {
        const user = { id: 20 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req1 = mockReq({ headers: { dolapikey: 'cleanup-key' } });
        const res1 = mockRes();
        const next1 = mockNext();
        await requireDolibarrLogin(req1, res1, next1);
        expect(next1).toHaveBeenCalled();
        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(11 * 60 * 1000);

        mockDolibarrService.getUserByKey.mockResolvedValue({ id: 20 });
        const req2 = mockReq({ headers: { dolapikey: 'cleanup-key' } });
        const res2 = mockRes();
        const next2 = mockNext();
        await requireDolibarrLogin(req2, res2, next2);
        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledTimes(2);
    });

    it('cache cleanup handles number format entries', async () => {
        const user = { id: 23 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const req1 = mockReq({ headers: { dolapikey: 'real-cache-key' } });
        const res1 = mockRes();
        const next1 = mockNext();
        await requireDolibarrLogin(req1, res1, next1);
        expect(next1).toHaveBeenCalled();

        const origEntries = Map.prototype.entries;
        Map.prototype.entries = function () {
            const real = origEntries.call(this);
            const all = [...real];
            all.push(['number-entry', Date.now() - 100000]);
            return all[Symbol.iterator]();
        };

        vi.advanceTimersByTime(5 * 60 * 1000);

        Map.prototype.entries = origEntries;
    });

    it('falls through when cached number entry is not expired', async () => {
        const user = { id: 21 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const origHas = Map.prototype.has;
        const origGet = Map.prototype.get;

        Map.prototype.has = function (key: any) {
            if (key === 'old-number-format-key') return true;
            return origHas.call(this, key);
        };
        Map.prototype.get = function (key: any) {
            if (key === 'old-number-format-key') return Date.now() + 100000;
            return origGet.call(this, key);
        };

        const req = mockReq({ headers: { dolapikey: 'old-number-format-key' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledWith('old-number-format-key');
        expect(next).toHaveBeenCalled();

        Map.prototype.has = origHas;
        Map.prototype.get = origGet;
    });

    it('falls through when cached number entry is expired', async () => {
        const user = { id: 22 };
        mockDolibarrService.getUserByKey.mockResolvedValue(user);

        const origHas = Map.prototype.has;
        const origGet = Map.prototype.get;

        Map.prototype.has = function (key: any) {
            if (key === 'old-number-expired-key') return true;
            return origHas.call(this, key);
        };
        Map.prototype.get = function (key: any) {
            if (key === 'old-number-expired-key') return Date.now() - 100000;
            return origGet.call(this, key);
        };

        const req = mockReq({ headers: { dolapikey: 'old-number-expired-key' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrLogin(req, res, next);

        expect(mockDolibarrService.getUserByKey).toHaveBeenCalledWith('old-number-expired-key');
        expect(next).toHaveBeenCalled();

        Map.prototype.has = origHas;
        Map.prototype.get = origGet;
    });
});

describe('requireRole', () => {
    it('returns 403 when the authenticated user lacks the required role', () => {
        const req = mockReq({ user: { role: 'user' } });
        const res = mockRes();
        const next = mockNext();

        requireRole('admin')(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'INSUFFICIENT_ROLE',
                message: 'Access Denied: Insufficient role.',
            },
        });
        expect(next).not.toHaveBeenCalled();
    });

    it.each(['admin', 'manager'])('accepts the %s role from an allowed role list', (role) => {
        const req = mockReq({ user: { role } });
        const res = mockRes();
        const next = mockNext();

        requireRole(['admin', 'manager'])(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('recognizes Dolibarr admin flags as the admin role', () => {
        const req = mockReq({ user: { admin: '1' } });
        const res = mockRes();
        const next = mockNext();

        requireRole('admin')(req, res, next);

        expect(next).toHaveBeenCalledOnce();
    });

    it('accepts a role from the authenticated user roles array', () => {
        const req = mockReq({ user: { roles: ['user', 'manager'] } });
        const res = mockRes();
        const next = mockNext();

        requireRole('manager')(req, res, next);

        expect(next).toHaveBeenCalledOnce();
    });
});

describe('requireDolibarrAdmin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 when no key is provided', async () => {
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'ADMIN_AUTHENTICATION_REQUIRED',
                message: 'Authentication Required: Admin Access Only.',
            },
        });
    });

    it('allows system admin key via dolapikey header', async () => {
        const req = mockReq({ headers: { dolapikey: 'test-admin-key-123' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('allows system admin key via x-admin-key header', async () => {
        const req = mockReq({ headers: { 'x-admin-key': 'test-admin-key-123' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('allows system admin key via DOLAPIKEY header', async () => {
        const req = mockReq({ headers: { DOLAPIKEY: 'test-admin-key-123' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('allows system admin key via httpOnly cookie admin_key (#33)', async () => {
        const req = mockReq({ cookies: { admin_key: 'test-admin-key-123' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('allows system admin key via query DOLAPIKEY', async () => {
        const req = mockReq({ query: { DOLAPIKEY: 'test-admin-key-123' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('allows system admin key via Bearer token', async () => {
        const req = mockReq({ headers: { authorization: 'Bearer test-admin-key-123' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('allows admin user when verifyAdminStatus returns true', async () => {
        mockDolibarrService.verifyAdminStatus.mockResolvedValue(true);

        const req = mockReq({ headers: { dolapikey: 'admin-dolibarr-key' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(mockDolibarrService.verifyAdminStatus).toHaveBeenCalledWith('admin-dolibarr-key');
        expect(next).toHaveBeenCalled();
    });

    it('returns 403 when verifyAdminStatus returns false', async () => {
        mockDolibarrService.verifyAdminStatus.mockResolvedValue(false);

        const req = mockReq({ headers: { dolapikey: 'non-admin-key' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'ADMIN_ACCESS_DENIED',
                message: 'Access Denied: You must be an Administrator to perform this action.',
            },
        });
    });

    it('returns 500 when verifyAdminStatus throws', async () => {
        mockDolibarrService.verifyAdminStatus.mockRejectedValue(new Error('DB error'));

        const req = mockReq({ headers: { dolapikey: 'some-key' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'AUTH_VERIFICATION_ERROR',
                message: 'Auth Verification Error',
            },
        });
    });

    it('reads key from query dolapikey for admin check', async () => {
        mockDolibarrService.verifyAdminStatus.mockResolvedValue(true);

        const req = mockReq({ query: { dolapikey: 'admin-via-query' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(mockDolibarrService.verifyAdminStatus).toHaveBeenCalledWith('admin-via-query');
        expect(next).toHaveBeenCalled();
    });

    it('does not read Bearer token when authorization header lacks Bearer prefix', async () => {
        mockDolibarrService.verifyAdminStatus.mockResolvedValue(true);

        const req = mockReq({ headers: { authorization: 'Basic abc123', dolapikey: 'fallback-key' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(mockDolibarrService.verifyAdminStatus).toHaveBeenCalledWith('fallback-key');
    });

    it('uses Bearer token when no other key source is available', async () => {
        mockDolibarrService.verifyAdminStatus.mockResolvedValue(true);

        const req = mockReq({ headers: { authorization: 'Bearer admin-bearer' } });
        const res = mockRes();
        const next = mockNext();

        await requireDolibarrAdmin(req, res, next);

        expect(mockDolibarrService.verifyAdminStatus).toHaveBeenCalledWith('admin-bearer');
        expect(next).toHaveBeenCalled();
    });
});
