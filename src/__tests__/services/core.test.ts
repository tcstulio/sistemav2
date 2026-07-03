import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));

vi.mock('../../services/dbService', () => ({
    dbService: {
        add: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        open: vi.fn().mockResolvedValue({})
    },
}));

vi.mock('../../config', () => ({
    config: { API_BASE_URL: 'http://localhost:3001' },
}));

import * as core from '../../services/api/core';
import { dbService } from '../../services/dbService';

describe('API Core', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbService.dbPromise = null;
    });

    describe('generateUUID', () => {
        it('generates a valid UUID format', () => {
            const uuid = core.generateUUID();
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            expect(uuid).toMatch(uuidRegex);
        });

        it('uses crypto.randomUUID when available', () => {
            const crypto = global.crypto;
            if (crypto && typeof crypto.randomUUID === 'function') {
                const uuid = core.generateUUID();
                expect(uuid).toBeDefined();
            }
        });
    });

    describe('getHeaders', () => {
        it('returns headers with API key', () => {
            const headers = core.getHeaders('test-api-key');
            expect(headers).toEqual({
                'DOLAPIKEY': 'test-api-key',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            });
        });

        it('trims whitespace from API key', () => {
            const headers = core.getHeaders('  test-key  ');
            expect(headers['DOLAPIKEY']).toBe('test-key');
        });

        it('returns empty key if not provided', () => {
            const headers = core.getHeaders('');
            expect(headers['DOLAPIKEY']).toBe('');
        });
    });

    describe('sanitizeUrl', () => {
        it('returns empty string for legacy support', () => {
            expect(core.sanitizeUrl('http://example.com')).toBe('');
        });
    });

    describe('request', () => {
        it('makes successful GET request', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                json: () => Promise.resolve({ data: 'test' })
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.request('/test');

            expect(mockFetch).toHaveBeenCalled();
            expect(result).toEqual({ data: 'test' });
        });

        it('throws error on non-OK response', async () => {
            const mockResponse = {
                ok: false,
                status: 404,
                json: () => Promise.resolve({ error: 'Not found' }),
                text: () => Promise.resolve('Not found')
            };
            mockFetch.mockResolvedValue(mockResponse);

            // request() filtra de propósito textos crus de proxy ("not found"/"unauthorized"/
            // "forbidden") e mantém a mensagem estruturada por status — ver core.ts ~L100.
            await expect(core.request('/test')).rejects.toThrow('Erro Proxy HTTP 404');
        });

        it('logs error to dbService on failure', async () => {
            const mockResponse = {
                ok: false,
                status: 500,
                json: () => Promise.resolve({ error: 'Server error' }),
                text: () => Promise.resolve('Server error')
            };
            mockFetch.mockResolvedValue(mockResponse);

            await expect(core.request('/test')).rejects.toThrow();
            expect(dbService.add).toHaveBeenCalled();
        });

        it('returns null for 204 No Content', async () => {
            const mockResponse = {
                ok: true,
                status: 204
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.request('/test');

            expect(result).toBeNull();
        });

        it('logs successful non-GET requests to api_logs', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                json: () => Promise.resolve({ success: true })
            };
            mockFetch.mockResolvedValue(mockResponse);

            await core.request('/test', { method: 'POST', body: JSON.stringify({ test: true }) });

            expect(dbService.add).toHaveBeenCalledWith('api_logs', expect.objectContaining({
                type: 'DOLIBARR_API',
                status: 'success'
            }));
        });

        it('#951: redige base64 (imagem/áudio) no request_body do api_logs', async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
            const bigBase64 = 'A'.repeat(50000); // simula uma imagem base64
            await core.request('/chat', { method: 'POST', body: JSON.stringify({ msg: 'oi', images: [bigBase64] }) });

            const call = (dbService.add as any).mock.calls.find((c: any[]) => c[0] === 'api_logs');
            const logged = String(call[1].request_body);
            expect(logged).not.toContain(bigBase64);      // o base64 NÃO foi salvo
            expect(logged).toContain('omitido');           // virou placeholder
            expect(logged).toContain('oi');                // campos pequenos preservados
            expect(logged.length).toBeLessThan(5000);      // e limitado
        });
    });

    describe('fetchPage', () => {
        it('fetches paginated data', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve([{ id: '1' }, { id: '2' }])
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.fetchPage({ apiUrl: '', apiKey: 'test' } as any, 'customers', 0, 50);

            expect(result).toEqual([{ id: '1' }, { id: '2' }]);
        });

        it('returns empty array on error', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));

            await expect(core.fetchPage({ apiUrl: '', apiKey: 'test' } as any, 'customers', 0, 50)).rejects.toThrow();
        });
    });

    describe('fetchList', () => {
        it('fetches all items with pagination', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve([{ id: '1' }, { id: '2' }])
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.fetchList({ apiUrl: '', apiKey: 'test' } as any, 'customers');

            expect(Array.isArray(result)).toBe(true);
        });

        it('respects user limit', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve([{ id: '1' }])
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.fetchList({ apiUrl: '', apiKey: 'test', apiLimit: 1 } as any, 'customers');

            expect(result.length).toBeLessThanOrEqual(1);
        });

        it('handles 404 gracefully', async () => {
            const error = new Error('404');
            error.message = '404';
            mockFetch.mockRejectedValue(error);

            const result = await core.fetchList({ apiUrl: '', apiKey: 'test' } as any, 'nonexistent');

            expect(result).toEqual([]);
        });
    });

    describe('fetchDelta', () => {
        it('fetches delta updates', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve([{ id: '1', date_modification: 1000 }])
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.fetchDelta({ apiUrl: '', apiKey: 'test' } as any, 'customers', 0);

            expect(Array.isArray(result)).toBe(true);
        });

        it('handles paginated response format', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    data: [{ id: '1' }],
                    pagination: { has_more: false }
                })
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.fetchDelta({ apiUrl: '', apiKey: 'test' } as any, 'customers', 0);

            expect(result).toEqual([{ id: '1' }]);
        });

        it('rethrows on error instead of masking it (#559)', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));

            await expect(
                core.fetchDelta({ apiUrl: '', apiKey: 'test' } as any, 'customers', 0)
            ).rejects.toThrow('Network error');
        });

        it('rethrows on 404 so the hook fallback can activate (#559)', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
                json: () => Promise.resolve({ error: 'Not found' }),
                text: () => Promise.resolve('Not found'),
            });

            await expect(
                core.fetchDelta({ apiUrl: '', apiKey: 'test' } as any, 'supplier_invoices', 0)
            ).rejects.toThrow();
        });
    });

    describe('checkConnection', () => {
        it('returns company data on successful auth check', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ name: 'Test Company' })
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.checkConnection('', 'test-key');

            expect(result).toEqual({ name: 'Test Company' });
        });

        it('throws error on 404', async () => {
            const mockResponse = {
                ok: false,
                status: 404,
                text: () => Promise.resolve('Not found')
            };
            mockFetch.mockResolvedValue(mockResponse);

            await expect(core.checkConnection('', 'test-key')).rejects.toThrow('404');
        });

        it('throws error on 401/403 with appropriate message', async () => {
            const mockResponse = {
                ok: false,
                status: 401,
                text: () => Promise.resolve('Unauthorized')
            };
            mockFetch.mockResolvedValue(mockResponse);

            await expect(core.checkConnection('', 'test-key')).rejects.toThrow('Erro Proxy HTTP 401');
        });
    });

    describe('fetchCurrentUser', () => {
        it('fetches current user with permissions', async () => {
            const mockUsersResponse = {
                ok: true,
                json: () => Promise.resolve([{ id: '1', login: 'test' }])
            };
            const mockUserResponse = {
                ok: true,
                json: () => Promise.resolve({ id: '1', login: 'test', permissions: [] })
            };
            mockFetch
                .mockResolvedValueOnce(mockUsersResponse)
                .mockResolvedValueOnce(mockUserResponse);

            const result = await core.fetchCurrentUser({ apiUrl: '', apiKey: 'test' } as any, 'test');

            expect(result).toEqual({ id: '1', login: 'test', permissions: [] });
        });

        it('returns null when no users found', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve([])
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.fetchCurrentUser({ apiUrl: '', apiKey: 'test' } as any);

            expect(result).toBeNull();
        });
    });

    describe('login', () => {
        it('logs in successfully with API key', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: () => Promise.resolve({ token: 'abc', apiKey: 'key123' })
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.login('test', 'password');

            expect(result.token).toBe('abc');
        });

        it('throws error on failed login', async () => {
            const mockResponse = {
                ok: false,
                status: 401,
                headers: { get: () => 'application/json' },
                json: () => Promise.resolve({ error: 'Invalid credentials' })
            };
            mockFetch.mockResolvedValue(mockResponse);

            await expect(core.login('test', 'wrong')).rejects.toThrow('Invalid credentials');
        });

        it('handles non-JSON response', async () => {
            const mockResponse = {
                ok: false,
                status: 500,
                headers: { get: () => 'text/html' },
                text: () => Promise.resolve('Server Error')
            };
            mockFetch.mockResolvedValue(mockResponse);

            await expect(core.login('test', 'password')).rejects.toThrow();
        });
    });

    describe('updateUser', () => {
        it('updates user data', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ success: true })
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.updateUser({ apiUrl: '', apiKey: 'test' } as any, '1', { name: 'Test' });

            expect(result).toEqual({ success: true });
        });
    });

    describe('createUser', () => {
        it('creates a new user', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ id: '1' })
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.createUser({ apiUrl: '', apiKey: 'test' } as any, { login: 'new' });

            expect(result).toEqual({ id: '1' });
        });
    });

    describe('deleteUser', () => {
        it('deletes a user', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ success: true })
            };
            mockFetch.mockResolvedValue(mockResponse);

            await core.deleteUser({ apiUrl: '', apiKey: 'test' } as any, '1');

            expect(mockFetch).toHaveBeenCalled();
        });
    });

    describe('createCategory', () => {
        it('creates a category', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ id: '1' })
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.createCategory({ apiUrl: '', apiKey: 'test' } as any, { label: 'New' });

            expect(result).toEqual({ id: '1' });
        });
    });

    describe('deleteCategory', () => {
        it('deletes a category', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ success: true })
            };
            mockFetch.mockResolvedValue(mockResponse);

            await core.deleteCategory({ apiUrl: '', apiKey: 'test' } as any, '1');

            expect(mockFetch).toHaveBeenCalled();
        });
    });

    describe('fetchCategories', () => {
        it('fetches categories with unlimited limit', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve([{ id: '1', label: 'Cat1', type: 0, description: 'desc' }])
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.fetchCategories({ apiUrl: '', apiKey: 'test', apiLimit: 100 } as any);

            expect(result).toHaveLength(1);
            expect(result[0].label).toBe('Cat1');
        });

        it('returns empty array on error', async () => {
            mockFetch.mockRejectedValue(new Error('Failed'));

            const result = await core.fetchCategories({ apiUrl: '', apiKey: 'test' } as any);

            expect(result).toEqual([]);
        });
    });

    describe('fetchSetupModules', () => {
        it('fetches setup modules', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve([{ name: 'module1' }])
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.fetchSetupModules({ apiUrl: '', apiKey: 'test' } as any);

            expect(result).toEqual([{ name: 'module1' }]);
        });

        it('returns empty array on 403', async () => {
            const error = new Error('403');
            mockFetch.mockRejectedValue(error);

            const result = await core.fetchSetupModules({ apiUrl: '', apiKey: 'test' } as any);

            expect(result).toEqual([]);
        });
    });

    describe('getCompanyInfo', () => {
        it('fetches company info', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ name: 'Company' })
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.getCompanyInfo({ apiUrl: '', apiKey: 'test' } as any);

            expect(result).toEqual({ name: 'Company' });
        });
    });

    describe('fetchDictionary', () => {
        it('fetches dictionary entries', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve([{ id: '1', label: 'Entry' }])
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.fetchDictionary({ apiUrl: '', apiKey: 'test' } as any, 'currencies');

            expect(result).toEqual([{ id: '1', label: 'Entry' }]);
        });

        it('returns empty array on error', async () => {
            mockFetch.mockRejectedValue(new Error('Failed'));

            const result = await core.fetchDictionary({ apiUrl: '', apiKey: 'test' } as any, 'currencies');

            expect(result).toEqual([]);
        });
    });

    describe('updateObject', () => {
        it('updates an object', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({ success: true })
            };
            mockFetch.mockResolvedValue(mockResponse);

            const result = await core.updateObject({ apiUrl: '', apiKey: 'test' } as any, 'invoices', '1', { amount: 100 });

            expect(result).toEqual({ success: true });
        });
    });

    describe('getDocumentBlob', () => {
        it('returns a Blob when the PDF exists', async () => {
            const blob = new Blob(['%PDF'], { type: 'application/pdf' });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: { get: () => 'application/pdf' },
                blob: () => Promise.resolve(blob),
            });

            const result = await core.getDocumentBlob('invoice', '42');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:3001/api/documents/invoice/42/pdf',
                { credentials: 'include' }
            );
            expect(result).toBe(blob);
        });

        it('throws an error when response is not ok', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                headers: { get: () => null },
                blob: () => Promise.resolve(new Blob()),
            });

            await expect(core.getDocumentBlob('invoice', '42')).rejects.toThrow(
                'PDF não disponível para este documento'
            );
        });

        it('throws an error when Content-Type is not PDF', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: { get: () => 'text/html' },
                blob: () => Promise.resolve(new Blob(['<html>'], { type: 'text/html' })),
            });

            await expect(core.getDocumentBlob('proposal', '5')).rejects.toThrow(
                'PDF não disponível para este documento'
            );
        });
    });

    describe('downloadDocument', () => {
        it('triggers browser download via anchor click', async () => {
            const blob = new Blob(['%PDF'], { type: 'application/pdf' });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: { get: () => 'application/pdf' },
                blob: () => Promise.resolve(blob),
            });

            const objectUrl = 'blob:http://localhost/test-123';
            const createObjectURL = vi.fn().mockReturnValue(objectUrl);
            const revokeObjectURL = vi.fn();
            Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
            Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });

            const clickMock = vi.fn();
            const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
            const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
            const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
                href: '',
                download: '',
                click: clickMock,
                remove: vi.fn(),
            } as any);

            await core.downloadDocument('order', 99);

            expect(createObjectURL).toHaveBeenCalledWith(blob);
            expect(clickMock).toHaveBeenCalled();

            createElementSpy.mockRestore();
            appendChildSpy.mockRestore();
            removeChildSpy.mockRestore();
        });

        it('propagates error when PDF is not available', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                headers: { get: () => null },
                blob: () => Promise.resolve(new Blob()),
            });

            await expect(core.downloadDocument('invoice', '1')).rejects.toThrow(
                'PDF não disponível para este documento'
            );
        });
    });
});
