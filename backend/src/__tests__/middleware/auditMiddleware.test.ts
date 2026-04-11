import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockAuditLog } = vi.hoisted(() => ({
    mockAuditLog: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../../utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(() => mockAuditLog),
    },
}));

import { auditMiddleware, audit } from '../../middleware/auditMiddleware';

function mockRes() {
    const res: any = {
        statusCode: 200,
        send: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    };
    return res;
}

function mockReq(overrides: Record<string, any> = {}): any {
    return {
        method: 'GET',
        path: '/api/test',
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
        headers: { 'user-agent': 'test-agent' },
        body: {},
        query: {},
        params: {},
        ...overrides,
    };
}

function setupAndGetLogEntry(reqOverrides: Record<string, any> = {}, statusCode = 400) {
    const req = mockReq(reqOverrides);
    const res = mockRes();
    res.statusCode = statusCode;
    const next = vi.fn();

    auditMiddleware(req, res, next);

    vi.spyOn(Date, 'now').mockReturnValue(1000010);
    res.send('response');

    if (statusCode >= 500) {
        return { req, res, logCall: mockAuditLog.error.mock.calls[0] };
    } else if (statusCode >= 400) {
        return { req, res, logCall: mockAuditLog.warn.mock.calls[0] };
    } else {
        return { req, res, logCall: mockAuditLog.info.mock.calls[0] };
    }
}

describe('auditMiddleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(Date, 'now').mockReturnValue(1000000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('skips /health path', () => {
        const req = mockReq({ path: '/health' });
        const res = mockRes();
        const next = vi.fn();

        auditMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.send).not.toHaveBeenCalled();
    });

    it('skips /favicon.ico path', () => {
        const req = mockReq({ path: '/favicon.ico' });
        const res = mockRes();
        const next = vi.fn();

        auditMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('skips /api/whatsapp/qr path', () => {
        const req = mockReq({ path: '/api/whatsapp/qr' });
        const res = mockRes();
        const next = vi.fn();

        auditMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('skips paths that start with skip paths', () => {
        const req = mockReq({ path: '/health/detail' });
        const res = mockRes();
        const next = vi.fn();

        auditMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('does not skip non-skip paths', () => {
        const req = mockReq({ path: '/api/users' });
        const res = mockRes();
        const next = vi.fn();

        auditMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('logs 2xx responses as info', () => {
        const req = mockReq({ path: '/api/users' });
        const res = mockRes();
        res.statusCode = 200;
        const next = vi.fn();

        auditMiddleware(req, res, next);

        vi.spyOn(Date, 'now').mockReturnValue(1000100);
        res.send('ok');

        expect(mockAuditLog.info).toHaveBeenCalled();
        expect(mockAuditLog.info.mock.calls[0][0]).toContain('GET /api/users [200]');
    });

    it('logs 4xx responses as warn', () => {
        const req = mockReq({ path: '/api/users' });
        const res = mockRes();
        res.statusCode = 404;
        const next = vi.fn();

        auditMiddleware(req, res, next);

        vi.spyOn(Date, 'now').mockReturnValue(1000100);
        res.send('not found');

        expect(mockAuditLog.warn).toHaveBeenCalled();
        expect(mockAuditLog.warn.mock.calls[0][0]).toContain('GET /api/users [404]');
    });

    it('logs 5xx responses as error', () => {
        const req = mockReq({ path: '/api/users' });
        const res = mockRes();
        res.statusCode = 500;
        const next = vi.fn();

        auditMiddleware(req, res, next);

        vi.spyOn(Date, 'now').mockReturnValue(1000100);
        res.send('error');

        expect(mockAuditLog.error).toHaveBeenCalled();
        expect(mockAuditLog.error.mock.calls[0][0]).toContain('GET /api/users [500]');
    });

    it('logs method, path, status code, and duration', () => {
        const req = mockReq({ path: '/api/data', method: 'POST' });
        const res = mockRes();
        res.statusCode = 201;
        const next = vi.fn();

        auditMiddleware(req, res, next);

        vi.spyOn(Date, 'now').mockReturnValue(1000050);
        res.send('created');

        expect(mockAuditLog.info.mock.calls[0][0]).toContain('POST /api/data [201] 50ms');
    });

    it('redacts sensitive fields in POST body', () => {
        const { logCall } = setupAndGetLogEntry({
            method: 'POST',
            path: '/api/login',
            body: {
                username: 'admin',
                password: 'secret123',
                token: 'abc',
                normalField: 'visible',
            },
        }, 400);

        const entry = logCall[1];
        expect(entry.requestBody.password).toBe('[REDACTED]');
        expect(entry.requestBody.token).toBe('[REDACTED]');
        expect(entry.requestBody.username).toBe('admin');
        expect(entry.requestBody.normalField).toBe('visible');
    });

    it('does not log body for GET requests', () => {
        const { logCall } = setupAndGetLogEntry({
            method: 'GET',
            path: '/api/data',
            body: { data: 'test' },
        }, 400);

        const entry = logCall[1];
        expect(entry.requestBody).toBeUndefined();
    });

    it('logs body for PUT requests', () => {
        const { logCall } = setupAndGetLogEntry({
            method: 'PUT',
            path: '/api/data',
            body: { name: 'updated' },
        }, 400);

        expect(logCall[1].requestBody).toEqual({ name: 'updated' });
    });

    it('logs body for PATCH requests', () => {
        const { logCall } = setupAndGetLogEntry({
            method: 'PATCH',
            path: '/api/data',
            body: { name: 'patched' },
        }, 400);

        expect(logCall[1].requestBody).toEqual({ name: 'patched' });
    });

    it('logs body for DELETE requests', () => {
        const { logCall } = setupAndGetLogEntry({
            method: 'DELETE',
            path: '/api/data/1',
            body: { reason: 'cleanup' },
        }, 400);

        expect(logCall[1].requestBody).toEqual({ reason: 'cleanup' });
    });

    it('extracts userId from Bearer token', () => {
        const { logCall } = setupAndGetLogEntry({
            path: '/api/data',
            headers: { authorization: 'Bearer my-token', 'user-agent': 'test' },
        }, 400);

        expect(logCall[1].userId).toBe('jwt-user');
    });

    it('extracts userId from dolapikey header', () => {
        const { logCall } = setupAndGetLogEntry({
            path: '/api/data',
            headers: { dolapikey: 'longapikey12345', 'user-agent': 'test' },
        }, 400);

        expect(logCall[1].userId).toBe('apikey-longapik...');
    });

    it('returns undefined userId when no auth present', () => {
        const { logCall } = setupAndGetLogEntry({ path: '/api/data' }, 400);

        expect(logCall[1].userId).toBeUndefined();
    });

    it('uses connection.remoteAddress when ip is not available', () => {
        const { logCall } = setupAndGetLogEntry({ path: '/api/data', ip: undefined, connection: { remoteAddress: '10.0.0.1' } }, 400);

        expect(logCall[1].ip).toBe('10.0.0.1');
    });

    it('uses unknown when neither ip nor remoteAddress available', () => {
        const { logCall } = setupAndGetLogEntry({ path: '/api/data', ip: undefined, connection: { remoteAddress: undefined } }, 400);

        expect(logCall[1].ip).toBe('unknown');
    });

    it('uses unknown user-agent when not provided', () => {
        const { logCall } = setupAndGetLogEntry({ path: '/api/data', headers: {} }, 400);

        expect(logCall[1].userAgent).toBe('unknown');
    });
});

describe('redactSensitive (via auditMiddleware)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(Date, 'now').mockReturnValue(1000000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('redacts all SENSITIVE_FIELDS', () => {
        const body: Record<string, any> = {
            password: 'secret',
            senha: 'secreta',
            apiKey: 'key123',
            api_key: 'key456',
            token: 'tok',
            secret: 'sec',
            authorization: 'auth',
            cookie: 'ck',
            cpf: '12345678901',
            cnpj: '12345678901234',
            credit_card: '4111',
            card_number: '4111',
            normal: 'visible',
        };

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body }, 400);

        const rb = logCall[1].requestBody;
        expect(rb.password).toBe('[REDACTED]');
        expect(rb.senha).toBe('[REDACTED]');
        expect(rb.apiKey).toBe('key123');
        expect(rb.api_key).toBe('[REDACTED]');
        expect(rb.token).toBe('[REDACTED]');
        expect(rb.secret).toBe('[REDACTED]');
        expect(rb.authorization).toBe('[REDACTED]');
        expect(rb.cookie).toBe('[REDACTED]');
        expect(rb.cpf).toBe('[REDACTED]');
        expect(rb.cnpj).toBe('[REDACTED]');
        expect(rb.credit_card).toBe('[REDACTED]');
        expect(rb.card_number).toBe('[REDACTED]');
        expect(rb.normal).toBe('visible');
    });

    it('handles nested objects recursively', () => {
        const body = {
            user: {
                name: 'John',
                credentials: {
                    password: 'secret',
                },
            },
        };

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body }, 400);

        const entry = logCall[1];
        expect(entry.requestBody.user.name).toBe('John');
        expect(entry.requestBody.user.credentials.password).toBe('[REDACTED]');
    });

    it('handles arrays', () => {
        const body = {
            items: [
                { name: 'item1', token: 'tok1' },
                { name: 'item2', token: 'tok2' },
            ],
        };

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body }, 400);

        const entry = logCall[1];
        expect(entry.requestBody.items[0].token).toBe('[REDACTED]');
        expect(entry.requestBody.items[1].token).toBe('[REDACTED]');
        expect(entry.requestBody.items[0].name).toBe('item1');
    });

    it('handles null values', () => {
        const body = { name: null, password: null };

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body }, 400);

        const entry = logCall[1];
        expect(entry.requestBody.name).toBe(null);
        expect(entry.requestBody.password).toBe('[REDACTED]');
    });

    it('handles undefined values', () => {
        const body = { name: undefined };

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body }, 400);

        const entry = logCall[1];
        expect(entry.requestBody.name).toBeUndefined();
    });

    it('handles arrays with null and undefined items', () => {
        const body = { items: [null, undefined, 'text', 42, true] };

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body }, 400);

        const entry = logCall[1];
        expect(entry.requestBody.items[0]).toBe(null);
        expect(entry.requestBody.items[1]).toBe(undefined);
        expect(entry.requestBody.items[2]).toBe('text');
        expect(entry.requestBody.items[3]).toBe(42);
        expect(entry.requestBody.items[4]).toBe(true);
    });

    it('handles max depth', () => {
        const deep: any = { name: 'level0' };
        let current = deep;
        for (let i = 1; i <= 12; i++) {
            current.child = { name: `level${i}` };
            current = current.child;
        }

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body: deep }, 400);

        let obj = logCall[1].requestBody;
        for (let i = 0; i < 11; i++) {
            obj = obj.child;
        }
        expect(obj).toBe('[MAX_DEPTH]');
    });

    it('handles string body values (returns string as-is)', () => {
        const body = { name: 'string value', password: 'secret' };

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body }, 400);

        const entry = logCall[1];
        expect(entry.requestBody.name).toBe('string value');
    });

    it('handles number and boolean values', () => {
        const body = { count: 42, active: true, password: 'secret' };

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body }, 400);

        const entry = logCall[1];
        expect(entry.requestBody.count).toBe(42);
        expect(entry.requestBody.active).toBe(true);
    });

    it('does not log body when body is empty/falsy', () => {
        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body: null }, 400);

        const entry = logCall[1];
        expect(entry.requestBody).toBeUndefined();
    });

    it('handles partial match on sensitive field names (case-insensitive)', () => {
        const body = { MyPassword: 'secret', AuthorizationToken: 'tok', ApiKeyData: 'key' };

        const { logCall } = setupAndGetLogEntry({ method: 'POST', path: '/api/test', body }, 400);

        const entry = logCall[1];
        expect(entry.requestBody.MyPassword).toBe('[REDACTED]');
        expect(entry.requestBody.AuthorizationToken).toBe('[REDACTED]');
        expect(entry.requestBody.ApiKeyData).toBe('key');
    });
});

describe('audit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('login success logs info', () => {
        audit.login('user1', '127.0.0.1', true);
        expect(mockAuditLog.info).toHaveBeenCalledWith('LOGIN_SUCCESS user=user1 ip=127.0.0.1');
    });

    it('login failure logs warn', () => {
        audit.login('user1', '127.0.0.1', false);
        expect(mockAuditLog.warn).toHaveBeenCalledWith('LOGIN_FAILED user=user1 ip=127.0.0.1');
    });

    it('logout logs info', () => {
        audit.logout('user1');
        expect(mockAuditLog.info).toHaveBeenCalledWith('LOGOUT user=user1');
    });

    it('configChange logs info with redacted values', () => {
        audit.configChange('admin1', 'smtp_host', 'old-val', 'new-val');
        expect(mockAuditLog.info).toHaveBeenCalledWith(
            'CONFIG_CHANGE user=admin1 setting=smtp_host old=[REDACTED] new=[REDACTED]'
        );
    });

    it('paymentAttempt success logs info', () => {
        audit.paymentAttempt('user1', 100, 'pix', true);
        expect(mockAuditLog.info).toHaveBeenCalledWith('PAYMENT_SUCCESS user=user1 amount=100 type=pix');
    });

    it('paymentAttempt failure logs warn', () => {
        audit.paymentAttempt('user1', 100, 'boleto', false);
        expect(mockAuditLog.warn).toHaveBeenCalledWith('PAYMENT_FAILED user=user1 amount=100 type=boleto');
    });

    it('dataExport logs info', () => {
        audit.dataExport('user1', 'customers', 500);
        expect(mockAuditLog.info).toHaveBeenCalledWith('DATA_EXPORT user=user1 type=customers records=500');
    });

    it('permissionChange logs info', () => {
        audit.permissionChange('admin1', 'user2', 'admin', true);
        expect(mockAuditLog.info).toHaveBeenCalledWith(
            'PERMISSION_CHANGE admin=admin1 target=user2 permission=admin granted=true'
        );
    });

    it('suspiciousActivity logs warn', () => {
        audit.suspiciousActivity('10.0.0.1', 'brute force');
        expect(mockAuditLog.warn).toHaveBeenCalledWith('SUSPICIOUS_ACTIVITY ip=10.0.0.1 reason=brute force');
    });
});
