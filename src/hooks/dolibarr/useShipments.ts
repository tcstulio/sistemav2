import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Shipment } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useShipments = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Shipment[]>(['shipments']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Shipment>('shipments');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['shipments'], fromDb);
                }
            } catch (e) {
                console.error("[useShipments] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['shipments'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('shipments', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Shipment>('shipments');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'shipments', lastModified);

                if (delta.length > 0) {
                    console.log(`[Shipments] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Shipment[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        socid: String(raw.fk_soc || ''),
                        fk_commande: raw.fk_commande ? String(raw.fk_commande) : undefined,
                        project_id: raw.fk_projet ? String(raw.fk_projet) : undefined,
                        date_creation: raw.date_creation ? new Date(raw.date_creation).getTime() : 0,
                        date_delivery: raw.date_delivery ? new Date(raw.date_delivery).getTime() : undefined,
                        status: String(raw.status),
                        tracking_number: raw.tracking_number,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('shipments', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<Shipment>('shipments');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useShipments] Sync Error", e);
                const local = await dbService.getAll<Shipment>('shipments');
                if (local.length === 0) {
                    return DolibarrService.fetchShipments(config);
                }
                return local;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
