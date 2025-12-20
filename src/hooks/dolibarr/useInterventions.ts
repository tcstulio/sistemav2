import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Intervention } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useInterventions = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Intervention[]>(['interventions']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Intervention>('interventions');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['interventions'], fromDb);
                }
            } catch (e) {
                console.error("[useInterventions] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['interventions'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('interventions', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Intervention>('interventions');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'interventions', lastModified);

                if (delta.length > 0) {
                    console.log(`[Interventions] Found ${delta.length} new/updated items.`);
                    const mappedDelta: Intervention[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        socid: raw.socid ? String(raw.socid) : '',
                        project_id: raw.project_id ? String(raw.project_id) : undefined,
                        date: raw.date ? new Date(raw.date).getTime() : 0,
                        date_creation: raw.date_creation ? new Date(raw.date_creation).getTime() : 0,
                        description: raw.description,
                        statut: String(raw.statut) as any,
                        fk_user_author: raw.fk_user_author ? String(raw.fk_user_author) : undefined,
                        duration: Number(raw.duration) || 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    await dbService.upsertAll('interventions', mappedDelta);
                    const updatedLocal = await dbService.getAll<Intervention>('interventions');
                    return updatedLocal;
                }

                return localData.length > 0 ? localData : DolibarrService.fetchInterventions(config);

            } catch (e) {
                console.error("[useInterventions] Sync Error", e);
                const local = await dbService.getAll<Intervention>('interventions');
                return local.length > 0 ? local : DolibarrService.fetchInterventions(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
    });
};
