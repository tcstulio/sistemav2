import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Order } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useOrders = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Order[]>(['orders']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Order>('orders');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['orders'], fromDb);
                }
            } catch (e) {
                console.error("[useOrders] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['orders'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('orders', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Order>('orders');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'orders', lastModified);

                if (delta.length > 0) {
                    console.log(`[Orders] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Order[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        total_ttc: Number(raw.total_ttc),
                        statut: String(raw.statut) as any,
                        date: raw.datec ? new Date(raw.datec).getTime() : 0, // Date creation
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        socid: raw.fk_soc ? String(raw.fk_soc) : '',
                        // In lightweight sync we might miss some relation extensions. 
                        // If critical, we should add socid to custom_sync.php SELECT
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('orders', mappedDelta);

                    const updatedLocal = await dbService.getAll<Order>('orders');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useOrders] Sync Error", e);
                const local = await dbService.getAll<Order>('orders');
                return local.length > 0 ? local : DolibarrService.fetchOrders(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false
    });
};
