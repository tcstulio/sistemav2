/**
 * Tests for updateBankAccount service method (#629)
 *
 * Verifies that the function:
 * - calls PUT /bankaccounts/{id} with correct body and DOLAPIKEY header
 * - throws on non-ok HTTP response
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch: any = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

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
        open: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('../../config', () => ({
    config: { API_BASE_URL: '' },
}));

vi.mock('../../utils/reportContext', () => ({
    pushFailedRequest: vi.fn(),
}));

import { updateBankAccount } from '../../services/api/hrAdmin';

const MOCK_CONFIG = { apiUrl: 'http://dolibarr', apiKey: 'secret-key', themeColor: 'indigo', darkMode: false };

function makeResponse(body: object, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
}

describe('updateBankAccount — #629', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls PUT bankaccounts/{id} with correct URL and body', async () => {
        mockFetch.mockResolvedValue(makeResponse({}));

        await updateBankAccount(MOCK_CONFIG, '42', { label: 'Nova Conta', bank: 'Bradesco' });

        // sanitizeUrl() returns '' and request() proxies via /api/dolibarr/<path>
        // so the effective URL is /api/dolibarr/bankaccounts/42 (not the raw apiUrl).
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/dolibarr/bankaccounts/42',
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ label: 'Nova Conta', bank: 'Bradesco' }),
            })
        );
    });

    it('sends DOLAPIKEY header', async () => {
        mockFetch.mockResolvedValue(makeResponse({}));

        await updateBankAccount(MOCK_CONFIG, '42', { label: 'X' });

        const call = mockFetch.mock.calls[0] as [string, RequestInit];
        expect((call[1]?.headers as Record<string, string>)['DOLAPIKEY']).toBe('secret-key');
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockResolvedValue(makeResponse({ message: 'Not found' }, false, 404));

        await expect(updateBankAccount(MOCK_CONFIG, '999', { label: 'X' })).rejects.toThrow();
    });
});
