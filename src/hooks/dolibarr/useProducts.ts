import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Product } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useProducts = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Product[]>(['products']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Product>('products');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['products'], fromDb);
                }
            } catch (e) {
                console.error("[useProducts] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['products'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('products', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Product>('products');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'products', lastModified);

                if (delta.length > 0) {
                    console.log(`[Products] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Product[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        label: raw.label,
                        description: raw.description,
                        type: String(raw.type) as '0' | '1',
                        price: Number(raw.price),
                        stock_reel: Number(raw.stock),
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('products', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<Product>('products');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useProducts] Sync Error", e);
                const local = await dbService.getAll<Product>('products');
                return local.length > 0 ? local : DolibarrService.fetchProducts(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
