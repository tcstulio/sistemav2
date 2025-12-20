import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, DolibarrUser } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useUsers = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<DolibarrUser[]>(['users']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<DolibarrUser>('users');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['users'], fromDb);
                }
            } catch (e) {
                console.error("[useUsers] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['users'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('users', 'date_modification'); // We need to ensure we save tms in db

                // 2. Local
                const localData = await dbService.getAll<DolibarrUser>('users');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'users', lastModified);

                if (delta.length > 0) {
                    console.log(`[Users] Found ${delta.length} new/updated items.`);

                    const mappedDelta: DolibarrUser[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        login: raw.login,
                        firstname: raw.firstname,
                        lastname: raw.lastname,
                        email: raw.email,
                        job: raw.job,
                        photo: raw.photo,
                        admin: raw.admin, // 1 or 0
                        statut: String(raw.statut) as '0' | '1',
                        phone_mobile: raw.phone_mobile,
                        // Delta sync usually lacks full rights structure, so we might lose it if we overwrite.
                        // Ideally we should merge with existing if rights are missing or fetch full if needed.
                        // For listing purposes, rights are often not critical in list view.
                        // We will keep rights undefined effectively, or we could merge from local if ID exists.
                        // But dbService.upsertAll overwrites.
                        // Strategy: We won't fetch rights here. This is lighter.
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('users', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<DolibarrUser>('users');
                    return updatedLocal;
                }

                return localData;

            } catch (e) {
                console.error("[useUsers] Sync Error", e);
                const local = await dbService.getAll<DolibarrUser>('users');
                if (local.length === 0) {
                    return DolibarrService.fetchUsers(config);
                }
                return local;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 30 * 60 * 1000,
    });
};
