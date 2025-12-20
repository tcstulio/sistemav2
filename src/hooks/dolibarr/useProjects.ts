import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Project } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useProjects = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Project[]>(['projects']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Project>('projects');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['projects'], fromDb);
                }
            } catch (e) {
                console.error("[useProjects] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['projects'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('projects', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Project>('projects');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'projects', lastModified);

                if (delta.length > 0) {
                    console.log(`[Projects] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Project[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        title: raw.title,
                        statut: String(raw.statut) as '0' | '1' | '2',
                        progress: Number(raw.progress) || 0,
                        socid: raw.socid ? String(raw.socid) : '',
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        date_start: raw.date_start ? new Date(raw.date_start).getTime() : 0,
                        date_end: raw.date_end ? new Date(raw.date_end).getTime() : 0,
                        budget_amount: Number(raw.budget_amount) || 0
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('projects', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<Project>('projects');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useProjects] Sync Error", e);
                const local = await dbService.getAll<Project>('projects');
                return local.length > 0 ? local : DolibarrService.fetchProjects(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
