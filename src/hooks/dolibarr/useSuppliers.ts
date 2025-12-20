import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, ThirdParty } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useSuppliers = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<ThirdParty[]>(['suppliers']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<ThirdParty>('suppliers');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['suppliers'], fromDb);
                }
            } catch (e) {
                console.error("[useSuppliers] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['suppliers'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('suppliers', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<ThirdParty>('suppliers');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'suppliers', lastModified);

                if (delta.length > 0) {
                    console.log(`[Suppliers] Found ${delta.length} new/updated items.`);

                    const mappedDelta: ThirdParty[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        name: raw.name,
                        name_alias: raw.name_alias,
                        code_client: raw.code_client,
                        email: raw.email,
                        phone: raw.phone,
                        client: String(raw.client),
                        status: raw.status,
                        fournisseur: String(raw.fournisseur),
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        // Defaults
                        address: '',
                        zip: '',
                        town: '',
                        state_id: '',
                        country_id: '',
                        tva_intra: ''
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('suppliers', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<ThirdParty>('suppliers');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useSuppliers] Sync Error", e);
                const local = await dbService.getAll<ThirdParty>('suppliers');
                return local.length > 0 ? local : DolibarrService.fetchSuppliers(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
