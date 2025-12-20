import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, SupplierOrder } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useSupplierOrders = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<SupplierOrder[]>(['supplierOrders']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<SupplierOrder>('supplierOrders');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['supplierOrders'], fromDb);
                }
            } catch (e) {
                console.error("[useSupplierOrders] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['supplierOrders'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('supplierOrders', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<SupplierOrder>('supplierOrders');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'supplier_orders', lastModified);

                if (delta.length > 0) {
                    console.log(`[SupplierOrders] Found ${delta.length} new/updated items.`);

                    const mappedDelta: SupplierOrder[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        socid: String(raw.fk_soc || ''),
                        date_creation: raw.date_creation ? new Date(raw.date_creation).getTime() : (raw.datec ? new Date(raw.datec).getTime() : 0),
                        date_livraison: raw.date_livraison ? new Date(raw.date_livraison).getTime() : undefined,
                        total_ttc: Number(raw.total_ttc),
                        statut: String(raw.statut),
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('supplierOrders', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<SupplierOrder>('supplierOrders');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useSupplierOrders] Sync Error", e);
                const local = await dbService.getAll<SupplierOrder>('supplierOrders');
                if (local.length === 0) {
                    return DolibarrService.fetchSupplierOrders(config);
                }
                return local;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
