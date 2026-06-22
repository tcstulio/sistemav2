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

import * as operations from '../../services/api/operations';
import { dbService } from '../../services/dbService';

const buildOkResponse = (data: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
});

const config = { apiUrl: '', apiKey: 'test-key' } as any;

describe('operations.updateIntervention', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbService.dbPromise = null;
    });

    it('is exported as a function', () => {
        expect(typeof operations.updateIntervention).toBe('function');
    });

    it('does a PUT to the backend custom route /api/dolibarr/interventions/:id', async () => {
        mockFetch.mockResolvedValue(buildOkResponse({ success: true }));

        await operations.updateIntervention(config, '123', {
            socid: '10',
            fk_project: '5',
            date: 1717200000,
            description: 'ajuste',
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toContain('/api/dolibarr/interventions/123');
        expect(init?.method).toBe('PUT');
        expect(init?.headers).toMatchObject({
            DOLAPIKEY: 'test-key',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init?.body)).toEqual({
            socid: '10',
            fk_project: '5',
            date: 1717200000,
            description: 'ajuste',
        });
    });

    it('returns the JSON response from the backend', async () => {
        mockFetch.mockResolvedValue(buildOkResponse({ id: '123', updated: true }));

        const result = await operations.updateIntervention(config, '123', { description: 'x' });

        expect(result).toEqual({ id: '123', updated: true });
    });

    it('throws on HTTP failure', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'boom' }),
            text: () => Promise.resolve('boom'),
        });

        await expect(
            operations.updateIntervention(config, '123', { description: 'x' })
        ).rejects.toThrow();
    });

    it('accepts a string date per the InterventionUpdatePayload contract', async () => {
        mockFetch.mockResolvedValue(buildOkResponse({ success: true }));

        await operations.updateIntervention(config, '9', { date: '2024-06-01' });

        const [, init] = mockFetch.mock.calls[0];
        expect(JSON.parse(init?.body)).toEqual({ date: '2024-06-01' });
    });
});
