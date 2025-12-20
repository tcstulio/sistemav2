import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Ticket } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useTickets = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Ticket[]>(['tickets']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Ticket>('tickets');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['tickets'], fromDb);
                }
            } catch (e) {
                console.error("[useTickets] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['tickets'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('tickets', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Ticket>('tickets');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'tickets', lastModified);

                if (delta.length > 0) {
                    console.log(`[Tickets] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Ticket[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        track_id: raw.track_id,
                        subject: raw.subject,
                        message: raw.message,
                        statut: raw.statut,
                        socid: raw.socid ? String(raw.socid) : '',
                        project_id: raw.project_id ? String(raw.project_id) : undefined,
                        date_c: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                        type_code: raw.type_code || '',
                        category_code: raw.category_code || '',
                        severity_code: raw.severity_code || '',
                        progress: raw.progress ? Number(raw.progress) : 0,
                        fk_user_assign: raw.fk_user_assign ? String(raw.fk_user_assign) : undefined,
                        origin_email: raw.origin_email
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('tickets', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<Ticket>('tickets');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useTickets] Sync Error", e);
                const local = await dbService.getAll<Ticket>('tickets');
                return local.length > 0 ? local : DolibarrService.fetchTickets(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
