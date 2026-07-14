import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useQuotationProgress,
    emptyQuotationProgress,
    QUOTATION_PROGRESS_KEY,
} from '../../hooks/useQuotationProgress';

describe('useQuotationProgress (#1416)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('inicia com savedProgress=null quando localStorage vazio', () => {
        const { result } = renderHook(() => useQuotationProgress());
        expect(result.current.savedProgress).toBeNull();
    });

    it('carrega savedProgress do localStorage na montagem', () => {
        const seeded = {
            productIdsByRef: { 'NOTE-I7': 'prod-123' },
            supplierIdsByName: { Kabum: 'sup-456' },
            processedOfferIds: ['o1'],
        };
        localStorage.setItem(QUOTATION_PROGRESS_KEY, JSON.stringify(seeded));

        const { result } = renderHook(() => useQuotationProgress());

        expect(result.current.savedProgress).toEqual(seeded);
    });

    it('persistProgress grava em localStorage e atualiza o estado', () => {
        const { result } = renderHook(() => useQuotationProgress());
        const progress = {
            productIdsByRef: { 'A': 'prod-A' },
            supplierIdsByName: { 'Loja': 'sup-Loja' },
            processedOfferIds: ['o1'],
        };

        act(() => result.current.persistProgress(progress));

        expect(result.current.savedProgress).toEqual(progress);
        expect(localStorage.getItem(QUOTATION_PROGRESS_KEY)).toBe(JSON.stringify(progress));
    });

    it('persistProgress com progresso vazio limpa o localStorage', () => {
        // 1) semeia com progresso não-vazio
        const seeded = {
            productIdsByRef: { 'A': 'prod-A' },
            supplierIdsByName: {},
            processedOfferIds: [],
        };
        localStorage.setItem(QUOTATION_PROGRESS_KEY, JSON.stringify(seeded));

        const { result } = renderHook(() => useQuotationProgress());
        expect(result.current.savedProgress).toEqual(seeded);

        // 2) persiste vazio → deve limpar (caso de sucesso que não criou nada,
        // ou limpar manual para forçar nova execução).
        act(() => result.current.persistProgress(emptyQuotationProgress()));

        expect(result.current.savedProgress).toBeNull();
        expect(localStorage.getItem(QUOTATION_PROGRESS_KEY)).toBeNull();
    });

    it('persistProgress ignora progresso vazio mesmo sem ter nada prévio', () => {
        const { result } = renderHook(() => useQuotationProgress());

        act(() => result.current.persistProgress(emptyQuotationProgress()));

        expect(result.current.savedProgress).toBeNull();
        expect(localStorage.getItem(QUOTATION_PROGRESS_KEY)).toBeNull();
    });

    it('clearSavedProgress remove do localStorage e zera o estado', () => {
        const seeded = {
            productIdsByRef: { 'X': 'prod-X' },
            supplierIdsByName: { 'Y': 'sup-Y' },
            processedOfferIds: ['oz'],
        };
        localStorage.setItem(QUOTATION_PROGRESS_KEY, JSON.stringify(seeded));

        const { result } = renderHook(() => useQuotationProgress());
        expect(result.current.savedProgress).toEqual(seeded);

        act(() => result.current.clearSavedProgress());

        expect(result.current.savedProgress).toBeNull();
        expect(localStorage.getItem(QUOTATION_PROGRESS_KEY)).toBeNull();
    });

    it('emptyQuotationProgress devolve um objeto vazio (não compartilhado)', () => {
        const a = emptyQuotationProgress();
        const b = emptyQuotationProgress();
        expect(a).toEqual(b);
        expect(a).not.toBe(b); // não compartilha referência
        a.productIdsByRef['X'] = '1';
        expect(b.productIdsByRef['X']).toBeUndefined();
    });

    it('tolerância a JSON corrompido no localStorage (cai em null)', () => {
        localStorage.setItem(QUOTATION_PROGRESS_KEY, '{not valid json');

        const { result } = renderHook(() => useQuotationProgress());
        expect(result.current.savedProgress).toBeNull();
    });
});