import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));
vi.mock('../../utils/safeStorage', () => ({
    safeStorage: {
        getJSON: vi.fn().mockReturnValue({ apiKey: 'test-api-key' }),
    },
}));

import axios from 'axios';
import { getDunningDigest } from '../../services/dunningService';

describe('dunningService (#1404)', () => {
    const mockAxios = axios as unknown as {
        get: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('retorna o digest normalizado quando a API responde 200', async () => {
        mockAxios.get.mockResolvedValue({
            status: 200,
            data: {
                digest: { totalItems: 3, totalReady: 2, totalIncomplete: 1 },
                items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
            },
        });

        const resp = await getDunningDigest();
        expect(resp.digest.totalItems).toBe(3);
        expect(resp.digest.totalReady).toBe(2);
        expect(resp.digest.totalIncomplete).toBe(1);
        expect(resp.items).toHaveLength(3);
    });

    it('preserva zero explícito em totalItems (NÃO cai no fallback para items.length)', async () => {
        // Cenário: backend retorna totalItems=0 mas items=[] por algum motivo
        // (ex.: digest zerado por regra de negócio). Antes da correção
        // `Number(0) || items.length` mascarava o zero.
        mockAxios.get.mockResolvedValue({
            status: 200,
            data: {
                digest: { totalItems: 0, totalReady: 0, totalIncomplete: 0 },
                items: [],
            },
        });

        const resp = await getDunningDigest();
        expect(resp.digest.totalItems).toBe(0);
        expect(resp.digest.totalReady).toBe(0);
        expect(resp.digest.totalIncomplete).toBe(0);
    });

    it('cai no fallback items.length apenas quando totalItems está ausente/NaN', async () => {
        mockAxios.get.mockResolvedValue({
            status: 200,
            data: {
                // digest.totalItems propositalmente ausente
                digest: { totalReady: 1, totalIncomplete: 1 },
                items: [{ id: 'a' }, { id: 'b' }],
            },
        });

        const resp = await getDunningDigest();
        expect(resp.digest.totalItems).toBe(2); // fallback
        expect(resp.digest.totalReady).toBe(1);
        expect(resp.digest.totalIncomplete).toBe(1);
    });

    it('faz fallback em NaN quando o backend devolve garbage no digest', async () => {
        mockAxios.get.mockResolvedValue({
            status: 200,
            data: {
                digest: { totalItems: 'abc', totalReady: null, totalIncomplete: undefined },
                items: [{ id: 'a' }],
            },
        });

        const resp = await getDunningDigest();
        expect(resp.digest.totalItems).toBe(1); // fallback items.length
        expect(resp.digest.totalReady).toBe(0);
        expect(resp.digest.totalIncomplete).toBe(0);
    });

    it('devolve emptyResponse em 4xx (fail-soft, sem throw)', async () => {
        mockAxios.get.mockResolvedValue({
            status: 404,
            data: { error: 'not found' },
        });

        const resp = await getDunningDigest();
        expect(resp).toEqual({
            digest: { totalItems: 0, totalReady: 0, totalIncomplete: 0 },
            items: [],
        });
    });

    it('devolve emptyResponse em 401 (sessão expirada — não derruba a UI)', async () => {
        mockAxios.get.mockResolvedValue({
            status: 401,
            data: { error: 'unauthorized' },
        });

        const resp = await getDunningDigest();
        expect(resp.items).toEqual([]);
        expect(resp.digest.totalItems).toBe(0);
    });

    it('devolve emptyResponse em 5xx (fail-soft)', async () => {
        // validateStatus: s < 500 — ou seja, 5xx vai entrar no catch.
        mockAxios.get.mockRejectedValue(new Error('boom 500'));

        const resp = await getDunningDigest();
        expect(resp).toEqual({
            digest: { totalItems: 0, totalReady: 0, totalIncomplete: 0 },
            items: [],
        });
    });

    it('envia Bearer token do coolgroove_config', async () => {
        mockAxios.get.mockResolvedValue({
            status: 200,
            data: { digest: { totalItems: 0, totalReady: 0, totalIncomplete: 0 }, items: [] },
        });

        await getDunningDigest();
        expect(mockAxios.get).toHaveBeenCalledWith(
            '/api/dunning',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
            }),
        );
    });

    it('trata payload ausente como emptyResponse sem throw', async () => {
        mockAxios.get.mockResolvedValue({
            status: 200,
            data: null,
        });

        const resp = await getDunningDigest();
        expect(resp.items).toEqual([]);
        expect(resp.digest).toEqual({ totalItems: 0, totalReady: 0, totalIncomplete: 0 });
    });

    it('trata payload sem items como items vazio (sem throw)', async () => {
        mockAxios.get.mockResolvedValue({
            status: 200,
            data: { digest: { totalItems: 0, totalReady: 0, totalIncomplete: 0 } },
        });

        const resp = await getDunningDigest();
        expect(resp.items).toEqual([]);
    });
});
