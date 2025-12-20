import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, StockMovement } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useStockMovements = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<StockMovement[]>(['stockMovements']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<StockMovement>('stockMovements');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['stockMovements'], fromDb);
                }
            } catch (e) {
                console.error("[useStockMovements] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['stockMovements'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('stockMovements', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<StockMovement>('stockMovements');

                // 3. Delta
                // Use 'stock_movements' to match custom_sync.php
                const delta = await DolibarrService.fetchDelta(config, 'stock_movements', lastModified);

                if (delta.length > 0) {
                    console.log(`[StockMovements] Found ${delta.length} new/updated items.`);
                    const mappedDelta: StockMovement[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        product_id: String(raw.fk_product),
                        warehouse_id: String(raw.fk_entrepot),
                        qty: Number(raw.value),
                        label: raw.label,
                        date_creation: raw.datem ? new Date(raw.datem).getTime() : 0, // datem is movement date
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        type: raw.type_mouvement
                    }));

                    await dbService.upsertAll('stockMovements', mappedDelta);
                    const updatedLocal = await dbService.getAll<StockMovement>('stockMovements');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.length > 0 ? localData : DolibarrService.fetchStockMovements(config);

            } catch (e) {
                console.error("[useStockMovements] Sync Error", e);
                const local = await dbService.getAll<StockMovement>('stockMovements');
                return local.length > 0 ? local : DolibarrService.fetchStockMovements(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 2 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
