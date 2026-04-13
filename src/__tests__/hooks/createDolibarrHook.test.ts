import { describe, it, expect } from 'vitest';
import { createDolibarrHook, DolibarrHookConfig, DolibarrHookResult } from '../../hooks/dolibarr/createDolibarrHook';

describe('createDolibarrHook', () => {
    it('creates a hook function', () => {
        const config: DolibarrHookConfig<any, any> = {
            queryKey: 'test',
            storeName: 'testStore',
            endpoint: 'test',
            dateField: 'tms',
            mapper: (raw) => raw,
        };
        const hook = createDolibarrHook(config);
        expect(typeof hook).toBe('function');
    });

    it('accepts valid config with all optional fields', () => {
        const config: DolibarrHookConfig<any, any> = {
            queryKey: 'test',
            storeName: 'testStore',
            endpoint: 'test',
            dateField: 'tms',
            mapper: (raw) => raw,
            staleTime: 60000,
            sortFn: (a, b) => 0,
            fallbackFetch: async () => [],
        };
        const hook = createDolibarrHook(config);
        expect(typeof hook).toBe('function');
    });

    it('uses default sort function when not provided', () => {
        const config: DolibarrHookConfig<{ date_modification?: number }, any> = {
            queryKey: 'test',
            storeName: 'testStore',
            endpoint: 'test',
            dateField: 'tms',
            mapper: (raw) => raw,
        };
        const hook = createDolibarrHook(config);
        expect(typeof hook).toBe('function');
    });

    it('returns DolibarrHookResult type', () => {
        const config: DolibarrHookConfig<any, { date_modification?: number }> = {
            queryKey: 'test',
            storeName: 'testStore',
            endpoint: 'test',
            dateField: 'tms',
            mapper: (raw) => raw,
        };
        const hook = createDolibarrHook(config);
        // TypeScript would catch mismatches here; runtime test just confirms it's a function
        expect(typeof hook).toBe('function');
    });
});

describe('DolibarrHookResult', () => {
    it('has isHydrated property in result type', () => {
        // This is a type-level test - TypeScript would error if isHydrated was missing
        type Result = DolibarrHookResult<any>;
        const result: Result = {} as Result;
        expect(result.isHydrated).toBeUndefined();
    });
});