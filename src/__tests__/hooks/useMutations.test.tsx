import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as useMutations from '../../hooks/useMutations';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createThirdParty: vi.fn(),
        updateThirdParty: vi.fn(),
        deleteThirdParty: vi.fn(),
        createInvoice: vi.fn(),
        updateInvoice: vi.fn(),
    },
}));

vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

import { useCustomerMutations, useSupplierMutations, useInvoiceMutations } from '../../hooks/useMutations';
import { renderHook, WrapperComponent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DolibarrConfig } from '../../types';

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return ({ children }: any) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

describe('useMutations', () => {
    const mockConfig: DolibarrConfig = {
        apiUrl: 'https://test.dolibarr.com',
        apiKey: 'test-key',
        themeColor: 'indigo',
        darkMode: false,
    };

    describe('useCustomerMutations', () => {
        it('returns createCustomer, updateCustomer, deleteCustomer', () => {
            const { result } = renderHook(() => useCustomerMutations(mockConfig), { wrapper: createWrapper() });
            expect(result.current.createCustomer).toBeDefined();
            expect(result.current.updateCustomer).toBeDefined();
            expect(result.current.deleteCustomer).toBeDefined();
        });

        it('throws error when config is null', async () => {
            const { result } = renderHook(() => useCustomerMutations(null), { wrapper: createWrapper() });
            let error: Error | null = null;
            try {
                await result.current.createCustomer.mutateAsync({ name: 'Test' });
            } catch (e) {
                error = e as Error;
            }
            expect(error?.message).toBe('No Configuration');
        });
    });

    describe('useSupplierMutations', () => {
        it('returns createSupplier, updateSupplier, deleteSupplier', () => {
            const { result } = renderHook(() => useSupplierMutations(mockConfig), { wrapper: createWrapper() });
            expect(result.current.createSupplier).toBeDefined();
            expect(result.current.updateSupplier).toBeDefined();
            expect(result.current.deleteSupplier).toBeDefined();
        });
    });

    describe('useInvoiceMutations', () => {
        it('returns createInvoice, updateInvoice', () => {
            const { result } = renderHook(() => useInvoiceMutations(mockConfig), { wrapper: createWrapper() });
            expect(result.current.createInvoice).toBeDefined();
            expect(result.current.updateInvoice).toBeDefined();
        });
    });
});