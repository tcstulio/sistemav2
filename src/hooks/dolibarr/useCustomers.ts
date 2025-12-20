import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, ThirdParty } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useCustomers = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<ThirdParty[]>(['customers']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<ThirdParty>('customers');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['customers'], fromDb);
                }
            } catch (e) {
                console.error("[useCustomers] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['customers'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Get Watermark (Last Modified)
                // We use 'tms' (Timestamp) as the modification proxy for ThirdParties
                const lastModified = await dbService.getLastModified('customers', 'date_modification');

                // 2. Load Local Data (for fallback or merging)
                const localData = await dbService.getAll<ThirdParty>('customers');

                // 3. Fetch Delta
                const delta = await DolibarrService.fetchDelta(config, 'thirdparties', lastModified);

                if (delta.length > 0) {
                    console.log(`[Customers] Found ${delta.length} new/updated items.`);

                    // Map Raw PHP Data -> ThirdParty Type
                    const mappedDelta: ThirdParty[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        name: raw.name,
                        name_alias: raw.name_alias,
                        code_client: raw.code_client,
                        email: raw.email,
                        phone: raw.phone,
                        address: raw.address || '',
                        zip: raw.zip || '',
                        town: raw.town || '',
                        client: String(raw.client),
                        status: raw.status,
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        fournisseur: String(raw.fournisseur) || '0',
                    }));

                    // 4. UPSERT
                    await dbService.upsertAll('customers', mappedDelta);

                    // 5. Return Updated List
                    const updatedLocal = await dbService.getAll<ThirdParty>('customers');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useCustomers] Sync Error", e);
                // Fallback to simple full fetch if delta fails? 
                // Or just return what we have to avoid breaking.
                const local = await dbService.getAll<ThirdParty>('customers');
                if (local.length === 0) {
                    // If empty, maybe try full fetch as last resort
                    return DolibarrService.fetchCustomers(config);
                }
                return local;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false
    });
};
