import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, RecruitmentJobPosition } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useJobPositions = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<RecruitmentJobPosition[]>(['jobPositions']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<RecruitmentJobPosition>('jobPositions');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['jobPositions'], fromDb);
                }
            } catch (e) {
                console.error("[useJobPositions] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['jobPositions'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('jobPositions', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<RecruitmentJobPosition>('jobPositions');

                // 3. Delta
                // Use 'job_positions' to match custom_sync.php
                const delta = await DolibarrService.fetchDelta(config, 'job_positions', lastModified);

                if (delta.length > 0) {
                    console.log(`[JobPositions] Found ${delta.length} new/updated items.`);
                    const mappedDelta: RecruitmentJobPosition[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        label: raw.label,
                        description: raw.description,
                        qty: 1, // Default, not in sync
                        status: String(raw.status),
                        rem_min: Number(raw.rem_min || 0),
                        rem_max: Number(raw.rem_max || 0),
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    await dbService.upsertAll('jobPositions', mappedDelta);
                    const updatedLocal = await dbService.getAll<RecruitmentJobPosition>('jobPositions');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.length > 0 ? localData : DolibarrService.fetchList(config, 'recruitments/jobposition') as Promise<RecruitmentJobPosition[]>;

            } catch (e) {
                console.error("[useJobPositions] Sync Error", e);
                const local = await dbService.getAll<RecruitmentJobPosition>('jobPositions');
                return local.length > 0 ? local : DolibarrService.fetchList(config, 'recruitments/jobposition') as Promise<RecruitmentJobPosition[]>;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 60 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
