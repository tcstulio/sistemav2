import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Contract } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useContracts = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Contract[]>(['contracts']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Contract>('contracts');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['contracts'], fromDb);
                }
            } catch (e) {
                console.error("[useContracts] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['contracts'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('contracts', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Contract>('contracts');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'contracts', lastModified);

                if (delta.length > 0) {
                    console.log(`[Contracts] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Contract[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        date_contrat: raw.date_contrat ? new Date(raw.date_contrat).getTime() : 0,
                        date_fin_validite: raw.date_fin_validite ? new Date(raw.date_fin_validite).getTime() : undefined,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        statut: String(raw.statut) as any,
                        socid: raw.socid ? String(raw.socid) : '',
                        project_id: raw.project_id ? String(raw.project_id) : undefined,
                        note_public: raw.note_public,
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('contracts', mappedDelta);

                    const updatedLocal = await dbService.getAll<Contract>('contracts');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useContracts] Sync Error", e);
                const local = await dbService.getAll<Contract>('contracts');
                return local.length > 0 ? local : DolibarrService.fetchContracts(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
