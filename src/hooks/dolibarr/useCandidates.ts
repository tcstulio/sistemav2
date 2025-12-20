import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Candidate } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useCandidates = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Candidate[]>(['candidates']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Candidate>('candidates');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['candidates'], fromDb);
                }
            } catch (e) {
                console.error("[useCandidates] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['candidates'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('candidates', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Candidate>('candidates');

                // 3. Delta
                // Use 'candidates' to match custom_sync.php
                const delta = await DolibarrService.fetchDelta(config, 'candidates', lastModified);

                if (delta.length > 0) {
                    console.log(`[Candidates] Found ${delta.length} new/updated items.`);
                    const mappedDelta: Candidate[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        firstname: raw.firstname,
                        lastname: raw.lastname,
                        email: raw.email,
                        phone: raw.phone,
                        date_birth: raw.date_birth ? new Date(raw.date_birth).getTime() : undefined,
                        status: String(raw.status),
                        fk_job_position: raw.fk_job_position ? String(raw.fk_job_position) : '',
                        note_public: raw.note_public,
                        date_c: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    await dbService.upsertAll('candidates', mappedDelta);
                    const updatedLocal = await dbService.getAll<Candidate>('candidates');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.length > 0 ? localData : DolibarrService.fetchList(config, 'recruitments/candidature') as Promise<Candidate[]>;

            } catch (e) {
                console.error("[useCandidates] Sync Error", e);
                const local = await dbService.getAll<Candidate>('candidates');
                return local.length > 0 ? local : DolibarrService.fetchList(config, 'recruitments/candidature') as Promise<Candidate[]>;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
