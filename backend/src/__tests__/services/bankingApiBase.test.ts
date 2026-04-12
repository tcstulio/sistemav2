import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockHttpsAgent, mockFsExistsSync, mockFsReadFileSync, mockAxiosCreate, mockAxiosPost } = vi.hoisted(() => {
    const mockHttpsAgent = vi.fn(function() { return {}; });
    const mockFsExistsSync = vi.fn();
    const mockFsReadFileSync = vi.fn();
    const mockAxiosCreate = vi.fn();
    const mockAxiosPost = vi.fn();
    return { mockHttpsAgent, mockFsExistsSync, mockFsReadFileSync, mockAxiosCreate, mockAxiosPost };
});

vi.mock('https', () => ({
    default: { Agent: mockHttpsAgent },
    Agent: mockHttpsAgent,
}));

vi.mock('fs', () => ({
    default: { existsSync: mockFsExistsSync, readFileSync: mockFsReadFileSync },
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
}));

vi.mock('axios', async () => {
    const actual = await vi.importActual<typeof import('axios')>('axios');
    return {
        default: { ...actual, create: mockAxiosCreate, post: mockAxiosPost },
        create: mockAxiosCreate,
        post: mockAxiosPost,
    };
});

import { BankingApiBase } from '../../services/banking/bankingApiBase';

class TestBankingApi extends BankingApiBase {
    constructor(
        private clientId = 'test-id',
        private clientSecret = 'test-secret',
        private sandbox = false
    ) {
        super();
    }

    protected getBankName() { return 'TestBank'; }
    protected getClientId() { return this.clientId; }
    protected getClientSecret() { return this.clientSecret; }
    protected getCertPath() { return './certs/test.crt'; }
    protected getKeyPath() { return './certs/test.key'; }
    protected isSandbox() { return this.sandbox; }
    protected getUrls() {
        return {
            production: { auth: 'https://auth.test.com/token', api: 'https://api.test.com' },
            sandbox: { auth: 'https://sandbox-auth.test.com/token', api: 'https://sandbox-api.test.com' },
        };
    }
    protected getScopes() { return 'read write'; }
    protected mapBalance(r: any) { return { available: r.available, total: r.available }; }
    protected mapTransaction(r: any) { return { id: r.id, date: new Date(), description: r.desc, amount: r.amount, type: r.amount >= 0 ? 'credit' : 'debit' } as any; }
    async getBalance() { return this.request('GET', '/balance'); }
    async getStatement() { return this.request('GET', '/statement'); }
    async testInit() { return this.initialize(); }
    async testRequest<T>(method: any, path: string, data?: any) { return this.request<T>(method, path, data); }
    async testRequestBinary(method: any, path: string) { return this.requestBinary(method, path); }
    async testGetToken() { return this.getAccessToken(); }
    async testStatus() { return this.getStatus(); }
}

describe('BankingApiBase', () => {
    let bank: TestBankingApi;

    beforeEach(() => {
        bank = new TestBankingApi();
        vi.clearAllMocks();
        mockFsExistsSync.mockImplementation(() => true);
        mockFsReadFileSync.mockReturnValue(Buffer.from('cert-data'));
        mockHttpsAgent.mockImplementation(function() { return {}; });
        mockAxiosCreate.mockImplementation(function() {
            return {
                request: vi.fn().mockResolvedValue({ data: {} }),
                get: vi.fn(),
                post: vi.fn(),
                put: vi.fn(),
                delete: vi.fn(),
                patch: vi.fn(),
                interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
            };
        });
        mockAxiosPost.mockResolvedValue({ data: { access_token: 'token', expires_in: 3600 } });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('initialize', () => {
        it('returns false when credentials missing', async () => {
            const empty = new TestBankingApi('', '');
            expect(await empty.testInit()).toBe(false);
        });

        it('returns false when cert not found', async () => {
            mockFsExistsSync.mockImplementationOnce(() => false);
            expect(await bank.testInit()).toBe(false);
        });

        it('returns false when key not found', async () => {
            mockFsExistsSync.mockImplementationOnce(() => true).mockImplementationOnce(() => false);
            expect(await bank.testInit()).toBe(false);
        });

        it('initializes successfully with valid files', async () => {
            const result = await bank.testInit();
            expect(result).toBe(true);
            expect(bank.isReady()).toBe(true);
        });

        it('handles initialization error', async () => {
            mockFsExistsSync.mockImplementationOnce(function() { throw new Error('fs error'); });
            expect(await bank.testInit()).toBe(false);
        });

        it('initializes with sandbox URLs', async () => {
            const sandboxBank = new TestBankingApi('id', 'secret', true);
            const result = await sandboxBank.testInit();
            expect(result).toBe(true);
        });
    });

    describe('isReady', () => {
        it('returns false when not initialized', () => {
            expect(bank.isReady()).toBe(false);
        });
    });

    describe('getStatus', () => {
        it('returns status with no credentials', async () => {
            const empty = new TestBankingApi('', '');
            mockFsExistsSync.mockReturnValue(false);
            const status = await empty.testStatus();
            expect(status.hasCredentials).toBe(false);
            expect(status.hasCertificates).toBe(false);
            expect(status.tokenValid).toBe(false);
            expect(status.bankName).toBe('TestBank');
            expect(status.initialized).toBe(false);
        });

        it('returns status with valid token', async () => {
            await bank.testInit();
            (bank as any).tokenCache = { accessToken: 'tok', expiresAt: Date.now() + 99999 };
            const status = await bank.testStatus();
            expect(status.tokenValid).toBe(true);
            expect(status.hasCredentials).toBe(true);
            expect(status.hasCertificates).toBe(true);
        });
    });

    describe('getAccessToken', () => {
        it('returns cached token if valid', async () => {
            await bank.testInit();
            (bank as any).tokenCache = { accessToken: 'cached', expiresAt: Date.now() + 300000 };
            expect(await bank.testGetToken()).toBe('cached');
        });

        it('fetches new token when expired', async () => {
            await bank.testInit();
            (bank as any).tokenCache = { accessToken: null, expiresAt: 0 };
            mockAxiosPost.mockResolvedValue({ data: { access_token: 'new-token', expires_in: 3600 } });
            expect(await bank.testGetToken()).toBe('new-token');
        });

        it('throws on auth failure', async () => {
            await bank.testInit();
            (bank as any).tokenCache = { accessToken: null, expiresAt: 0 };
            mockAxiosPost.mockRejectedValue(new Error('auth failed'));
            await expect(bank.testGetToken()).rejects.toThrow('Falha na autenticação');
        });
    });

    describe('request', () => {
        it('makes authenticated request', async () => {
            await bank.testInit();
            (bank as any).tokenCache = { accessToken: 'tok', expiresAt: Date.now() + 99999 };
            const mockReq = vi.fn().mockResolvedValue({ data: { id: 1 } });
            (bank as any).axiosInstance = { request: mockReq };
            const result = await bank.testRequest('GET', '/test');
            expect(result).toEqual({ id: 1 });
            expect(mockReq).toHaveBeenCalledWith(expect.objectContaining({
                method: 'GET', url: '/test',
                headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
            }));
        });

        it('throws API error with title and detail', async () => {
            await bank.testInit();
            (bank as any).tokenCache = { accessToken: 'tok', expiresAt: Date.now() + 99999 };
            const mockReq = vi.fn().mockRejectedValue({
                response: { status: 400, data: { title: 'Bad Request', detail: 'Invalid param' } },
            });
            (bank as any).axiosInstance = { request: mockReq };
            await expect(bank.testRequest('POST', '/test')).rejects.toThrow('Bad Request: Invalid param');
        });

        it('throws raw error when no detail', async () => {
            await bank.testInit();
            (bank as any).tokenCache = { accessToken: 'tok', expiresAt: Date.now() + 99999 };
            const err = new Error('Network error');
            (err as any).response = { status: 500, data: {} };
            const mockReq = vi.fn().mockRejectedValue(err);
            (bank as any).axiosInstance = { request: mockReq };
            await expect(bank.testRequest('GET', '/test')).rejects.toThrow('Network error');
        });
    });

    describe('requestBinary', () => {
        it('returns buffer from binary response', async () => {
            await bank.testInit();
            (bank as any).tokenCache = { accessToken: 'tok', expiresAt: Date.now() + 99999 };
            const mockReq = vi.fn().mockResolvedValue({ data: Buffer.from('pdf-data') });
            (bank as any).axiosInstance = { request: mockReq };
            const result = await bank.testRequestBinary('GET', '/pdf');
            expect(Buffer.isBuffer(result)).toBe(true);
        });
    });

    describe('utility methods', () => {
        it('formatDate returns YYYY-MM-DD', () => {
            const d = new Date('2024-03-15T10:30:00Z');
            expect(bank.formatDate(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('formatDateTime returns ISO string', () => {
            const d = new Date('2024-03-15T10:30:00Z');
            expect(bank.formatDateTime(d)).toBe(d.toISOString());
        });

        it('generateTxId generates 26-char alphanumeric', () => {
            const id = bank.generateTxId();
            expect(id).toHaveLength(26);
            expect(id).toMatch(/^[A-Za-z0-9]+$/);
        });

        it('generateTxId respects custom length', () => {
            expect(bank.generateTxId(10)).toHaveLength(10);
        });

        it('parseValor handles string with comma', () => {
            expect(bank.parseValor('10,50')).toBe(10.5);
        });

        it('parseValor handles number', () => {
            expect(bank.parseValor(100)).toBe(100);
        });

        it('formatValor formats to 2 decimals', () => {
            expect(bank.formatValor(100)).toBe('100.00');
            expect(bank.formatValor(10.5)).toBe('10.50');
        });
    });
});