/**
 * Generic Dolibarr Hook Factory
 * 
 * This factory creates React Query hooks for Dolibarr entities with:
 * - IndexedDB hydration for instant loading
 * - Delta sync for efficient updates
 * - Automatic data mapping
 * - Error handling with fallback
 * 
 * Usage:
 *   export const useCustomers = createDolibarrHook(customersConfig);
 * 
 * This replaces ~3000 lines of duplicated code across 32 hooks.
 */

import { useQuery, useQueryClient, UseQueryResult } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig } from '../../types';
import { useEffect, useState, useRef } from 'react';
import { logger } from '../../utils/logger';
import { notifyError } from '../../utils/notifyError';

const log = logger.child('DolibarrHook');

// ============ Types ============

/**
 * Configuration for a Dolibarr entity hook
 */
export interface DolibarrHookConfig<TRaw, TEntity> {
    /** Query key for React Query cache (e.g., 'customers', 'invoices') */
    queryKey: string;

    /** IndexedDB store name */
    storeName: string;

    /** Dolibarr API endpoint for delta sync (e.g., 'thirdparties', 'invoices') */
    endpoint: string;

    /** Field name for date comparison in delta sync */
    dateField: string;

    /** Function to map raw API/DB data to typed entity */
    mapper: (raw: TRaw) => TEntity;

    /** Optional fallback fetch function if delta sync fails */
    fallbackFetch?: (config: DolibarrConfig) => Promise<TEntity[]>;

    /** Optional sort function for results */
    sortFn?: (a: TEntity, b: TEntity) => number;

    /** Stale time in ms (default: 5 minutes) */
    staleTime?: number;
}

/**
 * Extended return type with additional metadata
 */
export type DolibarrHookResult<TEntity> = UseQueryResult<TEntity[], Error> & {
    /** Whether data has been hydrated from IndexedDB */
    isHydrated: boolean;
};

// ============ Default Sort ============

const defaultSort = <T extends { date_modification?: number }>(a: T, b: T): number => {
    return (b.date_modification || 0) - (a.date_modification || 0);
};

// ============ Factory Function ============

/**
 * Creates a React Query hook for a Dolibarr entity
 * 
 * @param config Configuration for the hook
 * @returns A hook function that fetches and syncs the entity
 */
export function createDolibarrHook<TRaw, TEntity extends { date_modification?: number }>(
    config: DolibarrHookConfig<TRaw, TEntity>
) {
    const {
        queryKey,
        storeName,
        endpoint,
        dateField,
        mapper,
        fallbackFetch,
        sortFn = defaultSort,
        staleTime = 5 * 60 * 1000, // 5 minutes default
    } = config;

    /**
     * Hook for fetching and syncing Dolibarr entity data
     * 
     * @param dolibarrConfig Dolibarr API configuration
     * @param enabled Whether the query should be enabled
     */
    return function useDolibarrEntity(
        dolibarrConfig: DolibarrConfig | null,
        enabled: boolean = true
    ): DolibarrHookResult<TEntity> {
        const queryClient = useQueryClient();
        const [isHydrated, setIsHydrated] = useState(false);
        const hydrationAttempted = useRef(false);

        // Hydrate from IndexedDB on mount
        useEffect(() => {
            if (hydrationAttempted.current) return;
            hydrationAttempted.current = true;

            const hydrateFromDb = async () => {
                // Check if already cached in React Query
                const cached = queryClient.getQueryData<TEntity[]>([queryKey]);
                if (cached && cached.length > 0) {
                    setIsHydrated(true);
                    return;
                }

                try {
                    // Load from IndexedDB
                    const fromDb = await dbService.getAll<TEntity>(storeName);
                    if (fromDb && fromDb.length > 0) {
                        queryClient.setQueryData([queryKey], fromDb);
                    }
                } catch (error) {
                    log.error(`Failed to hydrate ${queryKey} from IndexedDB`, error);
                } finally {
                    setIsHydrated(true);
                }
            };

            hydrateFromDb();
        }, [queryClient]);

        // Main query
        const queryResult = useQuery({
            queryKey: [queryKey],
            queryFn: async (): Promise<TEntity[]> => {
                if (!dolibarrConfig) return [];

                try {
                    // Step 1: Get watermark (last modification date)
                    const lastModified = await dbService.getLastModified(storeName, dateField);

                    // Step 2: Load current local data
                    const localData = await dbService.getAll<TEntity>(storeName);

                    // Step 3: Fetch delta from Dolibarr
                    const delta = await DolibarrService.fetchDelta(dolibarrConfig, endpoint, lastModified);

                    if (delta.length > 0) {
                        log.debug(`Found ${delta.length} new/updated items for ${queryKey}`);

                        // Step 4: Map raw data to typed entities
                        const mappedDelta: TEntity[] = delta.map((raw: TRaw) => mapper(raw));

                        // Step 5: Upsert to IndexedDB
                        await dbService.upsertAll(storeName, mappedDelta);

                        // Step 6: Return updated list
                        const updatedLocal = await dbService.getAll<TEntity>(storeName);
                        return updatedLocal.sort(sortFn);
                    }

                    // No changes, return local data
                    return localData.sort(sortFn);

                } catch (error) {
                    log.error(`Sync error for ${queryKey}`, error);

                    // Fallback: try to return local data (silent degrade)
                    const localData = await dbService.getAll<TEntity>(storeName);

                    if (localData.length > 0) {
                        return localData.sort(sortFn);
                    }

                    // Last resort: try full fetch if fallback is provided.
                    // #559: o custom_sync.php pode nao reconhecer o tipo (404); o fallback
                    // REST (ex.: `supplierinvoices`) devolve os dados e a tela segue funcional.
                    if (fallbackFetch && dolibarrConfig) {
                        try {
                            log.debug(`Attempting full fetch fallback for ${queryKey}`);
                            return await fallbackFetch(dolibarrConfig);
                        } catch (fallbackError) {
                            log.error(`Fallback also failed for ${queryKey}`, fallbackError);
                        }
                    }

                    // Nada a exibir e nenhuma fonte funcionando: sinaliza a falha ao usuario
                    // em vez de esconder o endpoint quebrado de forma definitiva (#559).
                    // O `notifyError` deduplica por contexto (id estavel), evitando pilha de toasts.
                    notifyError(`Sincronização de ${queryKey}`, error);
                    return [];
                }
            },
            enabled: !!dolibarrConfig && enabled && isHydrated,
            staleTime,
            refetchOnWindowFocus: false,
        });

        // Extend query result with hydration state
        return {
            ...queryResult,
            isHydrated,
        } as DolibarrHookResult<TEntity>;
    };
}

// ============ Type Helper ============

/**
 * Helper type for extracting entity type from a hook
 */
export type EntityFromHook<T> = T extends (...args: any[]) => DolibarrHookResult<infer E> ? E : never;
