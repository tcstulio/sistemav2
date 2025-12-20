import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Proposal } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useProposals = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Proposal[]>(['proposals']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Proposal>('proposals');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['proposals'], fromDb);
                }
            } catch (e) {
                console.error("[useProposals] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['proposals'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('proposals', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Proposal>('proposals');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'proposals', lastModified);

                if (delta.length > 0) {
                    console.log(`[Proposals] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Proposal[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        total_ttc: Number(raw.total_ttc),
                        date: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        statut: String(raw.statut) as any,
                        socid: raw.fk_soc ? String(raw.fk_soc) : '', // Mapped from custom_sync
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('proposals', mappedDelta);

                    const updatedLocal = await dbService.getAll<Proposal>('proposals');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useProposals] Sync Error", e);
                const local = await dbService.getAll<Proposal>('proposals');
                return local.length > 0 ? local : DolibarrService.fetchProposals(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false
    });
};
