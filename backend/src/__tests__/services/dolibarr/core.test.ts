import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockAxios, mockHttpsAgent, mockFsExistsSync, mockFsReadFileSync, mockConfig } = vi.hoisted(() => {
    const fn = vi.fn() as any;
    fn.get = vi.fn();
    fn.isAxiosError = vi.fn();
    return {
        mockAxios: fn,
        mockHttpsAgent: vi.fn(),
        mockFsExistsSync: vi.fn().mockReturnValue(false),
        mockFsReadFileSync: vi.fn().mockReturnValue(Buffer.from('cert')),
        mockConfig: {
            dolibarrUrl: 'https://test.dolibarr.com/api/index.php/',
            dolibarrKey: 'test-api-key-1234567890',
            dolibarrBypassCookie: 'test_cookie=1',
        },
    };
});

vi.mock('axios', () => ({
    default: mockAxios,
}));

vi.mock('https', () => ({
    default: { Agent: mockHttpsAgent },
}));

vi.mock('fs', () => ({
    default: { existsSync: mockFsExistsSync, readFileSync: mockFsReadFileSync },
}));

vi.mock('../../../config/env', () => ({
    config: mockConfig,
}));

import {
    DolibarrServiceBase,
    sanitizeForSqlFilter,
    buildSqlFilter,
    buildLikeFilter,
} from '../../../services/dolibarr/core';

describe('sanitizeForSqlFilter', () => {
    it('strips special characters from string', () => {
        expect(sanitizeForSqlFilter("test'value;\"bad\\%_\r\n\t")).toBe('testvaluebad');
    });

    it('returns empty string for non-string input', () => {
        expect(sanitizeForSqlFilter(123 as any)).toBe('');
    });

    it('returns empty string for null', () => {
        expect(sanitizeForSqlFilter(null as any)).toBe('');
    });
});

describe('buildSqlFilter', () => {
    it('builds correct SQL filter', () => {
        expect(buildSqlFilter('t.field', ':=', 'value')).toBe("t.field::=:'value'");
    });

    it('sanitizes the value', () => {
        expect(buildSqlFilter('t.field', '=', "val'ue")).toBe("t.field:=:'value'");
    });
});

describe('buildLikeFilter', () => {
    it('builds correct LIKE filter', () => {
        expect(buildLikeFilter('t.field', 'value')).toBe("t.field:like:'%value%'");
    });

    it('sanitizes the value', () => {
        expect(buildLikeFilter('t.field', "val%ue")).toBe("t.field:like:'%value%'");
    });
});

describe('DolibarrServiceBase', () => {
    let service: DolibarrServiceBase;
    let origNodeEnv: string | undefined;
    let origCaCert: string | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFsExistsSync.mockReturnValue(false);
        origNodeEnv = process.env.NODE_ENV;
        origCaCert = process.env.DOLIBARR_CA_CERT;
        delete process.env.DOLIBARR_CA_CERT;
        process.env.NODE_ENV = 'test';
        service = new DolibarrServiceBase();
    });

    afterEach(() => {
        process.env.NODE_ENV = origNodeEnv;
        process.env.DOLIBARR_CA_CERT = origCaCert;
    });

    describe('constructor', () => {
        it('creates httpsAgent with rejectUnauthorized false in non-production', () => {
            expect(mockHttpsAgent).toHaveBeenCalledWith({ rejectUnauthorized: false });
        });

        it('creates httpsAgent with rejectUnauthorized true in production', () => {
            process.env.NODE_ENV = 'production';
            delete process.env.DOLIBARR_CA_CERT;
            const svc = new DolibarrServiceBase();
            expect(mockHttpsAgent).toHaveBeenCalledWith({ rejectUnauthorized: true });
        });

        it('loads CA cert in production when cert file exists', () => {
            process.env.NODE_ENV = 'production';
            process.env.DOLIBARR_CA_CERT = '/path/to/cert.pem';
            mockFsExistsSync.mockReturnValue(true);
            mockFsReadFileSync.mockReturnValue(Buffer.from('cert-data'));
            const svc = new DolibarrServiceBase();
            expect(mockHttpsAgent).toHaveBeenCalledWith({
                rejectUnauthorized: true,
                ca: Buffer.from('cert-data'),
            });
        });

        it('skips CA cert when file does not exist in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.DOLIBARR_CA_CERT = '/path/to/cert.pem';
            mockFsExistsSync.mockReturnValue(false);
            const svc = new DolibarrServiceBase();
            expect(mockHttpsAgent).toHaveBeenCalledWith({ rejectUnauthorized: true });
        });

        it('skips CA cert when env var is not set', () => {
            process.env.NODE_ENV = 'production';
            delete process.env.DOLIBARR_CA_CERT;
            const svc = new DolibarrServiceBase();
            expect(mockHttpsAgent).toHaveBeenCalledWith({ rejectUnauthorized: true });
        });

        it('preserves trailing slash in URL', () => {
            mockConfig.dolibarrUrl = 'https://test.dolibarr.com/api/index.php/';
            const svc = new DolibarrServiceBase();
            expect((svc as any).baseUrl).toBe('https://test.dolibarr.com/api/index.php/');
            mockConfig.dolibarrUrl = 'https://test.dolibarr.com/api/index.php/';
        });

        it('appends trailing slash to URL if missing', () => {
            mockConfig.dolibarrUrl = 'https://test.dolibarr.com/api/index.php';
            const svc = new DolibarrServiceBase();
            expect((svc as any).baseUrl).toBe('https://test.dolibarr.com/api/index.php/');
            mockConfig.dolibarrUrl = 'https://test.dolibarr.com/api/index.php/';
        });
    });

    describe('getHeaders', () => {
        it('uses apiKey when no userKey provided', () => {
            const headers = (service as any).getHeaders();
            expect(headers['DOLAPIKEY']).toBe('test-api-key-1234567890');
        });

        it('uses userKey when provided', () => {
            const headers = (service as any).getHeaders('custom-key');
            expect(headers['DOLAPIKEY']).toBe('custom-key');
        });

        it('includes default cookie when bypass cookie not set', () => {
            const orig = mockConfig.dolibarrBypassCookie;
            mockConfig.dolibarrBypassCookie = '';
            const headers = (service as any).getHeaders();
            expect(headers['Cookie']).toBe('humans_21909=1');
            mockConfig.dolibarrBypassCookie = orig;
        });

        it('uses configured bypass cookie', () => {
            const headers = (service as any).getHeaders();
            expect(headers['Cookie']).toBe('test_cookie=1');
        });
    });

    describe('sanitizePath', () => {
        it('removes leading slash', () => {
            expect((service as any).sanitizePath('/invoices')).toBe('invoices');
        });

        it('keeps path without leading slash', () => {
            expect((service as any).sanitizePath('invoices')).toBe('invoices');
        });
    });

    describe('requestWithAuth', () => {
        it('throws 401 when no userKey provided', async () => {
            await expect(
                (service as any).requestWithAuth('GET', 'https://test.com/api', null, undefined)
            ).rejects.toEqual({
                message: 'Authentication Required: No API Key provided.',
                status: 401,
                details: { code: 401, message: 'Authentication Required' },
            });
        });

        it('returns response data on success', async () => {
            mockAxios.mockResolvedValue({ data: { id: 1 } });
            const result = await (service as any).requestWithAuth(
                'POST',
                'https://test.dolibarr.com/api/index.php/invoices',
                { socid: 1 },
                'valid-user-key-12345678'
            );
            expect(result).toEqual({ id: 1 });
        });

        it('throws on axios error with response', async () => {
            mockAxios.isAxiosError.mockReturnValue(true);
            mockAxios.mockRejectedValue({
                response: {
                    status: 400,
                    data: { error: { message: 'Bad Request' } },
                },
                message: 'Request failed',
            });

            await expect(
                (service as any).requestWithAuth('POST', 'https://test.dolibarr.com/api/index.php/invoices', {}, 'valid-key-1234567890')
            ).rejects.toEqual({
                message: 'Bad Request',
                status: 400,
                details: { error: { message: 'Bad Request' } },
            });
        });

        it('throws with axios message when no error message in response data', async () => {
            mockAxios.isAxiosError.mockReturnValue(true);
            mockAxios.mockRejectedValue({
                response: {
                    status: 500,
                    data: {},
                },
                message: 'Internal Server Error',
            });

            await expect(
                (service as any).requestWithAuth('POST', 'https://test.dolibarr.com/api/index.php/invoices', {}, 'valid-key-1234567890')
            ).rejects.toEqual(
                expect.objectContaining({
                    message: 'Internal Server Error',
                    status: 500,
                })
            );
        });

        it('throws "No response received" when axios error has request but no response', async () => {
            mockAxios.isAxiosError.mockReturnValue(true);
            mockAxios.mockRejectedValue({
                request: {},
                message: 'timeout',
            });

            await expect(
                (service as any).requestWithAuth('POST', 'https://test.dolibarr.com/api/index.php/invoices', {}, 'valid-key-1234567890')
            ).rejects.toEqual(
                expect.objectContaining({
                    message: 'No response received from Dolibarr',
                    status: 500,
                })
            );
        });

        it('throws with axios message when no request and no response', async () => {
            mockAxios.isAxiosError.mockReturnValue(true);
            mockAxios.mockRejectedValue({
                message: 'Network setup error',
            });

            await expect(
                (service as any).requestWithAuth('POST', 'https://test.dolibarr.com/api/index.php/invoices', {}, 'valid-key-1234567890')
            ).rejects.toEqual(
                expect.objectContaining({
                    message: 'Network setup error',
                    status: 500,
                })
            );
        });

        it('handles generic Error instances', async () => {
            mockAxios.isAxiosError.mockReturnValue(false);
            mockAxios.mockRejectedValue(new Error('something broke'));

            await expect(
                (service as any).requestWithAuth('POST', 'https://test.dolibarr.com/api/index.php/invoices', {}, 'valid-key-1234567890')
            ).rejects.toEqual(
                expect.objectContaining({
                    message: 'something broke',
                    status: 500,
                })
            );
        });

        it('handles non-Error throws with default message', async () => {
            mockAxios.isAxiosError.mockReturnValue(false);
            mockAxios.mockRejectedValue('string error');

            await expect(
                (service as any).requestWithAuth('POST', 'https://test.dolibarr.com/api/index.php/invoices', {}, 'valid-key-1234567890')
            ).rejects.toEqual(
                expect.objectContaining({
                    message: expect.stringContaining('Dolibarr Error'),
                    status: 500,
                    details: null,
                })
            );
        });
    });

    describe('validateApiKey', () => {
        it('returns true for valid key', async () => {
            mockAxios.get.mockResolvedValue({ status: 200 });
            const result = await service.validateApiKey('valid-key-1234567890');
            expect(result).toBe(true);
        });

        it('returns false on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('network error'));
            const result = await service.validateApiKey('valid-key-1234567890');
            expect(result).toBe(false);
        });
    });

    describe('login', () => {
        it('returns success data on successful login', async () => {
            const successData = { token: 'abc', entity: '1', message: 'ok' };
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: { success: successData },
            });
            const result = await service.login('admin', 'password');
            expect(result).toEqual(successData);
        });

        it('throws when response has no success field', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: { error: { message: 'Invalid credentials' } },
            });
            await expect(service.login('admin', 'wrong')).rejects.toThrow('Invalid credentials');
        });

        it('throws default message when no error message in response', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: {},
            });
            await expect(service.login('admin', 'wrong')).rejects.toThrow('Falha no login (200)');
        });

        it('throws on network exception', async () => {
            mockAxios.get.mockRejectedValue(new Error('Connection refused'));
            await expect(service.login('admin', 'pass')).rejects.toThrow('Connection refused');
        });

        it('throws default error message when exception has no message', async () => {
            mockAxios.get.mockRejectedValue({ message: '' });
            await expect(service.login('admin', 'pass')).rejects.toThrow('Erro de conexão com Dolibarr');
        });
    });

    describe('verifyAdminStatus', () => {
        it('returns true when status is 200', async () => {
            mockAxios.get.mockResolvedValue({ status: 200 });
            const result = await service.verifyAdminStatus('valid-key-1234567890');
            expect(result).toBe(true);
        });

        it('returns false when error has response', async () => {
            mockAxios.get.mockRejectedValue({ response: { status: 403 } });
            const result = await service.verifyAdminStatus('valid-key-1234567890');
            expect(result).toBe(false);
        });

        it('returns false when error has no response', async () => {
            mockAxios.get.mockRejectedValue(new Error('network error'));
            const result = await service.verifyAdminStatus('valid-key-1234567890');
            expect(result).toBe(false);
        });
    });

    describe('getUserByKey', () => {
        it('returns null for empty apiKey', async () => {
            const result = await service.getUserByKey('');
            expect(result).toBeNull();
        });

        it('returns null for short apiKey', async () => {
            const result = await service.getUserByKey('short');
            expect(result).toBeNull();
        });

        it('returns null for apiKey with invalid characters', async () => {
            const result = await service.getUserByKey('invalid!key@12345678');
            expect(result).toBeNull();
        });

        it('returns user from users/info endpoint', async () => {
            const userData = { id: 1, login: 'admin' };
            mockAxios.get.mockResolvedValue({ status: 200, data: userData });
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toEqual(userData);
        });

        it('returns user from users/myself when users/info fails', async () => {
            const userData = { id: 2, login: 'user' };
            mockAxios.get
                .mockRejectedValueOnce(new Error('not found'))
                .mockResolvedValueOnce({ status: 200, data: userData });
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toEqual(userData);
        });

        it('falls through when endpoint returns data without id', async () => {
            mockAxios.get
                .mockResolvedValueOnce({ status: 200, data: { no_id: true } })
                .mockResolvedValueOnce({ status: 200, data: { no_id: true } })
                .mockResolvedValueOnce({
                    status: 200,
                    data: [{ api_key: 'valid-key-1234567890ab', id: 3 }],
                });
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toEqual({ api_key: 'valid-key-1234567890ab', id: 3 });
        });

        it('returns exact match from SQL fallback', async () => {
            mockAxios.get
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({
                    status: 200,
                    data: [
                        { api_key: 'other', id: 1 },
                        { api_key: 'valid-key-1234567890ab', id: 2 },
                    ],
                });
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toEqual({ api_key: 'valid-key-1234567890ab', id: 2 });
        });

        it('returns first item from SQL fallback when no exact match', async () => {
            mockAxios.get
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({
                    status: 200,
                    data: [{ api_key: 'different', id: 5 }],
                });
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toEqual({ api_key: 'different', id: 5 });
        });

        it('returns null when SQL fallback returns empty array', async () => {
            mockAxios.get
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({ status: 200, data: [] });
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toBeNull();
        });

        it('returns null when SQL fallback returns non-array', async () => {
            mockAxios.get
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({ status: 200, data: 'not an array' });
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toBeNull();
        });

        it('returns null when SQL fallback throws', async () => {
            mockAxios.get
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockRejectedValueOnce(new Error('sql error'));
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toBeNull();
        });

        it('returns null when all methods fail', async () => {
            mockAxios.get
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({ status: 200, data: {} })
                .mockResolvedValueOnce({ status: 200, data: null });
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toBeNull();
        });

        it('returns null on unexpected error in outer try', async () => {
            (service as any).getHeaders = undefined;
            const result = await service.getUserByKey('valid-key-1234567890ab');
            expect(result).toBeNull();
        });
    });

    describe('proxyRequest', () => {
        it('uses key from headers (case-insensitive)', async () => {
            mockAxios.mockResolvedValue({
                status: 200,
                data: { result: 'ok' },
                headers: { 'content-type': 'application/json' },
            });

            const result = await service.proxyRequest(
                'GET',
                '/invoices',
                null,
                {},
                { DOLAPIKEY: 'header-key' }
            );

            expect(result.status).toBe(200);
            expect(mockAxios).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: expect.objectContaining({ DOLAPIKEY: 'header-key' }),
                })
            );
        });

        it('uses key from query when no header key', async () => {
            mockAxios.mockResolvedValue({
                status: 200,
                data: { result: 'ok' },
                headers: {},
            });

            await service.proxyRequest('GET', '/invoices', null, { DOLAPIKEY: 'query-key' }, {});

            expect(mockAxios).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: expect.objectContaining({ DOLAPIKEY: 'query-key' }),
                })
            );
        });

        it('works without any key', async () => {
            mockAxios.mockResolvedValue({
                status: 200,
                data: {},
                headers: {},
            });

            const result = await service.proxyRequest('GET', '/test', null, {}, {});
            expect(result.status).toBe(200);
        });

        it('handles axios error with response', async () => {
            mockAxios.isAxiosError.mockReturnValue(true);
            mockAxios.mockRejectedValue({
                response: {
                    status: 403,
                    data: { error: 'Forbidden' },
                    headers: { 'x-error': 'true' },
                },
            });

            const result = await service.proxyRequest('GET', '/test', null, {}, {});
            expect(result.status).toBe(403);
            expect(result.data).toEqual({ error: 'Forbidden' });
        });

        it('handles non-axios error', async () => {
            mockAxios.isAxiosError.mockReturnValue(false);
            mockAxios.mockRejectedValue(new Error('timeout'));

            const result = await service.proxyRequest('GET', '/test', null, {}, {});
            expect(result.status).toBe(500);
            expect(result.data.message).toBe('timeout');
        });

        it('passes query params and body through', async () => {
            mockAxios.mockResolvedValue({ status: 200, data: {}, headers: {} });

            await service.proxyRequest(
                'POST',
                '/test',
                { field: 'value' },
                { page: 1 },
                { dolapikey: 'mykey' }
            );

            expect(mockAxios).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST',
                    params: { page: 1 },
                    data: { field: 'value' },
                })
            );
        });

        it('removes leading slash from path', async () => {
            mockAxios.mockResolvedValue({ status: 200, data: {}, headers: {} });

            await service.proxyRequest('GET', '/mypath', null, {}, { DOLAPIKEY: 'k' });

            expect(mockAxios).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: expect.not.stringContaining('//mypath'),
                })
            );
        });
    });

    describe('proxyCustomSync', () => {
        it('strips /api/index.php from URL', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {}, headers: {} });

            await service.proxyCustomSync({ type: 'sync' }, { DOLAPIKEY: 'key' });

            expect(mockAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('custom_sync.php'),
                expect.anything()
            );
        });

        it('strips trailing slash from URL', async () => {
            mockConfig.dolibarrUrl = 'https://test.dolibarr.com/';
            mockAxios.get.mockResolvedValue({ status: 200, data: {}, headers: {} });

            await service.proxyCustomSync({ type: 'sync' }, {});

            const calledUrl = mockAxios.get.mock.calls[0][0] as string;
            expect(calledUrl).toBe('https://test.dolibarr.com/custom_sync.php');

            mockConfig.dolibarrUrl = 'https://test.dolibarr.com/api/index.php/';
        });

        it('handles URL without /api/index.php', async () => {
            mockConfig.dolibarrUrl = 'https://other.dolibarr.com';
            mockAxios.get.mockResolvedValue({ status: 200, data: {}, headers: {} });

            await service.proxyCustomSync({ type: 'sync' }, {});

            const calledUrl = mockAxios.get.mock.calls[0][0] as string;
            expect(calledUrl).toBe('https://other.dolibarr.com/custom_sync.php');

            mockConfig.dolibarrUrl = 'https://test.dolibarr.com/api/index.php/';
        });

        it('uses key from headers', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {}, headers: {} });

            await service.proxyCustomSync({ type: 'sync' }, { DOLAPIKEY: 'hdr-key' });

            expect(mockAxios.get).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    headers: expect.objectContaining({ DOLAPIKEY: 'hdr-key' }),
                })
            );
        });

        it('uses key from query when no header key', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {}, headers: {} });

            await service.proxyCustomSync({ type: 'sync', DOLAPIKEY: 'q-key' }, {});

            expect(mockAxios.get).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    headers: expect.objectContaining({ DOLAPIKEY: 'q-key' }),
                })
            );
        });

        it('transfers key from header to query params when query lacks it', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {}, headers: {} });

            const query: any = { type: 'sync' };
            await service.proxyCustomSync(query, { DOLAPIKEY: 'transferred-key' });

            expect(query.DOLAPIKEY).toBe('transferred-key');
        });

        it('does not overwrite query DOLAPIKEY when already set', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {}, headers: {} });

            const query: any = { type: 'sync', DOLAPIKEY: 'original' };
            await service.proxyCustomSync(query, { DOLAPIKEY: 'from-header' });

            expect(query.DOLAPIKEY).toBe('original');
        });

        it('handles axios error with response', async () => {
            mockAxios.isAxiosError.mockReturnValue(true);
            mockAxios.get.mockRejectedValue({
                response: {
                    status: 500,
                    data: { error: 'Server Error' },
                    headers: {},
                },
            });

            const result = await service.proxyCustomSync({}, {});
            expect(result.status).toBe(500);
            expect(result.data).toEqual({ error: 'Server Error' });
        });

        it('handles non-axios error', async () => {
            mockAxios.isAxiosError.mockReturnValue(false);
            mockAxios.get.mockRejectedValue(new Error('network failure'));

            const result = await service.proxyCustomSync({}, {});
            expect(result.status).toBe(500);
            expect(result.data.error).toBe('Custom Sync Proxy Error');
        });

        it('returns success response correctly', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: { records: [1, 2, 3] },
                headers: { 'x-total': '3' },
            });

            const result = await service.proxyCustomSync({ type: 'sync' }, { DOLAPIKEY: 'k' });
            expect(result.status).toBe(200);
            expect(result.data).toEqual({ records: [1, 2, 3] });
            expect(result.headers).toEqual({ 'x-total': '3' });
        });
    });
});
