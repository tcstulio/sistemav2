import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, BOM } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useBOMs = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<BOM[]>(['boms']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<BOM>('boms');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['boms'], fromDb);
                }
            } catch (e) {
                console.error("[useBOMs] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['boms'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('boms', 'date_modification');

                // 2. Local
                // Note: Changing store from 'bomList' to 'boms' for consistency
                const localData = await dbService.getAll<BOM>('boms');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'boms', lastModified);

                if (delta.length > 0) {
                    console.log(`[BOMs] Found ${delta.length} new/updated items.`);
                    const mappedDelta: BOM[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        label: raw.label,
                        description: raw.description,
                        duration: Number(raw.duration || 0),
                        efficiency: Number(raw.efficiency || 1),
                        qty: Number(raw.qty || 1),
                        status: '1', // Default distinct status if not provided
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        bom_lines: [] // Delta sync shallow doesn't give lines usually
                    }));

                    await dbService.upsertAll('boms', mappedDelta);
                    const updatedLocal = await dbService.getAll<BOM>('boms');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.length > 0 ? localData : DolibarrService.fetchList(config, 'bom/bom') as Promise<BOM[]>;

            } catch (e) {
                console.error("[useBOMs] Sync Error", e);
                const local = await dbService.getAll<BOM>('boms');
                return local.length > 0 ? local : DolibarrService.fetchList(config, 'bom/bom') as Promise<BOM[]>;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 60 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
