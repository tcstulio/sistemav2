import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Warehouse } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useWarehouses = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Warehouse[]>(['warehouses']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Warehouse>('warehouses');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['warehouses'], fromDb);
                }
            } catch (e) {
                console.error("[useWarehouses] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['warehouses'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('warehouses', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Warehouse>('warehouses');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'warehouses', lastModified);

                if (delta.length > 0) {
                    console.log(`[Warehouses] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Warehouse[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        label: raw.label,
                        description: raw.description,
                        statut: String(raw.status || raw.statut) as '0' | '1',
                        lieu: raw.lieu,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('warehouses', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<Warehouse>('warehouses');
                    return updatedLocal;
                }

                return localData;

            } catch (e) {
                console.error("[useWarehouses] Sync Error", e);
                const local = await dbService.getAll<Warehouse>('warehouses');
                if (local.length === 0) {
                    return DolibarrService.fetchWarehouses(config);
                }
                return local;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 10 * 60 * 1000,
    });
};
