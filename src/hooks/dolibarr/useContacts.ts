import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Contact } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useContacts = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Contact[]>(['contacts']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Contact>('contacts');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['contacts'], fromDb);
                }
            } catch (e) {
                console.error("[useContacts] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['contacts'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('contacts', 'date_modification');

                // 2. Local Data
                const localData = await dbService.getAll<Contact>('contacts');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'contacts', lastModified);

                if (delta.length > 0) {
                    console.log(`[Contacts] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Contact[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        socid: String(raw.fk_soc || ''),
                        lastname: raw.lastname,
                        firstname: raw.firstname,
                        email: raw.email,
                        phone_mobile: raw.phone_mobile,
                        poste: raw.position,
                        statut: String(raw.statut) as '0' | '1',
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        array_options: raw.array_options
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('contacts', mappedDelta);

                    // 5. Return updated list
                    const updatedLocal = await dbService.getAll<Contact>('contacts');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useContacts] Sync Error", e);
                const local = await dbService.getAll<Contact>('contacts');
                if (local.length === 0) {
                    return DolibarrService.fetchContacts(config);
                }
                return local;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 15 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
