import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, ManufacturingOrder } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useManufacturingOrders = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<ManufacturingOrder[]>(['manufacturingOrders']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<ManufacturingOrder>('manufacturingOrders');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['manufacturingOrders'], fromDb);
                }
            } catch (e) {
                console.error("[useManufacturingOrders] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['manufacturingOrders'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('manufacturingOrders', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<ManufacturingOrder>('manufacturingOrders');

                // 3. Delta
                // Use 'manufacturing_orders' to match custom_sync.php
                const delta = await DolibarrService.fetchDelta(config, 'manufacturing_orders', lastModified);

                if (delta.length > 0) {
                    console.log(`[ManufacturingOrders] Found ${delta.length} new/updated items.`);
                    const mappedDelta: ManufacturingOrder[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        label: raw.label,
                        project_id: raw.project_id ? String(raw.project_id) : undefined,
                        status: String(raw.status) as any,
                        date_start: raw.date_start ? new Date(raw.date_start).getTime() : undefined,
                        date_end: raw.date_end ? new Date(raw.date_end).getTime() : undefined,
                        product_to_produce_id: raw.product_to_produce_id ? String(raw.product_to_produce_id) : '',
                        qty: Number(raw.qty) || 1,
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    await dbService.upsertAll('manufacturingOrders', mappedDelta);
                    const updatedLocal = await dbService.getAll<ManufacturingOrder>('manufacturingOrders');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.length > 0 ? localData : DolibarrService.fetchList(config, 'mrp/mo') as Promise<ManufacturingOrder[]>;

            } catch (e) {
                console.error("[useManufacturingOrders] Sync Error", e);
                const local = await dbService.getAll<ManufacturingOrder>('manufacturingOrders');
                return local.length > 0 ? local : DolibarrService.fetchList(config, 'mrp/mo') as Promise<ManufacturingOrder[]>;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
