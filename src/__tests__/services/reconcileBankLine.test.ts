/**
 * Tests for reconcileBankLine service method (#630)
 *
 * Verifies that the function:
 * - calls POST /api/banking/reconcile/toggle with correct body and headers
 * - returns true on success (success: true from backend)
 * - throws on non-ok HTTP response
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch before importing the module under test
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch: any = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// hrAdmin imports logger — provide minimal mock
vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));

// hrAdmin imports core which imports dbService and config
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

import { reconcileBankLine } from '../../services/api/hrAdmin';

const MOCK_CONFIG = { apiUrl: 'http://dolibarr', apiKey: 'secret-key', themeColor: 'indigo', darkMode: false };

function makeResponse(body: object, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
}

describe('reconcileBankLine — #630 persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls POST /api/banking/reconcile/toggle with correct body when reconciling', async () => {
        mockFetch.mockResolvedValue(makeResponse({ success: true }));

        const result = await reconcileBankLine(MOCK_CONFIG, 'acc1', 'line1', true);

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/banking/reconcile/toggle',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ accountId: 'acc1', lineId: 'line1', reconciled: true }),
            })
        );
        expect(result).toBe(true);
    });

    it('calls with reconciled=false when un-reconciling', async () => {
        mockFetch.mockResolvedValue(makeResponse({ success: true }));

        await reconcileBankLine(MOCK_CONFIG, 'acc1', 'line1', false);

        const call = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(call[1]?.body as string);
        expect(body.reconciled).toBe(false);
    });

    it('sends DOLAPIKEY header with config.apiKey', async () => {
        mockFetch.mockResolvedValue(makeResponse({ success: true }));

        await reconcileBankLine(MOCK_CONFIG, 'acc1', 'line1', true);

        const call = mockFetch.mock.calls[0] as [string, RequestInit];
        expect((call[1]?.headers as Record<string, string>)['DOLAPIKEY']).toBe('secret-key');
    });

    it('returns false when backend returns success:false', async () => {
        mockFetch.mockResolvedValue(makeResponse({ success: false }));
        const result = await reconcileBankLine(MOCK_CONFIG, 'acc1', 'line1', true);
        expect(result).toBe(false);
    });

    it('throws on non-ok HTTP response', async () => {
        mockFetch.mockResolvedValue(makeResponse({ error: 'Internal Server Error' }, false, 500));

        await expect(reconcileBankLine(MOCK_CONFIG, 'acc1', 'line1', true)).rejects.toThrow(
            /falha ao persistir/i
        );
    });
});
