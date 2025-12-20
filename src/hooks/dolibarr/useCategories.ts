import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Category } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useCategories = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Category[]>(['categories']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Category>('categories');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['categories'], fromDb);
                }
            } catch (e) {
                console.error("[useCategories] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                // Categories might be mixed (product/supplier), but we'll store them in one store for now
                const lastModified = await dbService.getLastModified('categories', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Category>('categories');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'categories', lastModified);

                if (delta.length > 0) {
                    console.log(`[Categories] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Category[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        label: raw.label,
                        type: raw.type,
                        description: raw.description,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    await dbService.upsertAll('categories', mappedDelta);
                    const updatedLocal = await dbService.getAll<Category>('categories');
                    return updatedLocal;
                }

                return localData.length > 0 ? localData : DolibarrService.fetchCategories(config);

            } catch (e) {
                console.error("[useCategories] Sync Error", e);
                const local = await dbService.getAll<Category>('categories');
                return local.length > 0 ? local : DolibarrService.fetchCategories(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 60 * 60 * 1000,
    });
};
