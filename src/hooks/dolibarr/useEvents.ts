import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, AgendaEvent } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useEvents = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<AgendaEvent[]>(['events']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<AgendaEvent>('events');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['events'], fromDb);
                }
            } catch (e) {
                console.error("[useEvents] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['events'],
        queryFn: async () => {
            if (!config) return [];
            try {
                // 1. Get Last Modified timestamp from local DB (Watermark)
                const lastModified = await dbService.getLastModified('events', 'date_modification');

                // 2. Get current local data before fetching delta
                const localData = await dbService.getAll<AgendaEvent>('events');

                // 3. FETCH DELTA from Server (Modified after watermark)
                const delta = await DolibarrService.fetchDelta(config, 'events', lastModified);

                if (delta.length > 0) {
                    console.log(`[Events] Found ${delta.length} new/updated items.`);

                    // Map Custom Sync raw fields to AgendaEvent
                    const mappedDelta: AgendaEvent[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref || `EV-${raw.id}`,
                        label: raw.label,
                        description: raw.description || raw.note,
                        date_start: raw.date_start ? new Date(raw.date_start).getTime() : 0,
                        date_end: raw.date_end ? new Date(raw.date_end).getTime() : 0,
                        percentage: raw.percentage ? Number(raw.percentage) : 0,
                        type_code: raw.type_code || 'AC_OTH',
                        fk_user_author: raw.fk_user_author ? String(raw.fk_user_author) : undefined,
                        socid: raw.socid ? String(raw.socid) : undefined,
                        project_id: raw.project_id ? String(raw.project_id) : undefined,
                        location: raw.location || '',
                        elementtype: raw.elementtype,
                        fk_element: raw.fk_element ? String(raw.fk_element) : undefined,
                        fulldayevent: raw.fulldayevent === '1' || raw.fulldayevent === 1,
                        priority: raw.priority ? Number(raw.priority) : undefined,
                        transparency: raw.transparency ? Number(raw.transparency) : undefined,
                        date_c: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    // 4. UPSERT Delta to Local DB
                    await dbService.upsertAll('events', mappedDelta);

                    // 5. RELOAD from DB to get merged result
                    const updatedLocalData = await dbService.getAll<AgendaEvent>('events');
                    return updatedLocalData.sort((a, b) => b.date_start - a.date_start);
                } else {
                    console.log(`[Events] No updates found.`);
                    return localData.sort((a, b) => b.date_start - a.date_start);
                }
            } catch (e) {
                console.error("[useEvents] Sync Failed, falling back to local cache", e);
                return dbService.getAll<AgendaEvent>('events');
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false
    });
};
