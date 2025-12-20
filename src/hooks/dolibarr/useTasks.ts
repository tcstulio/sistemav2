import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Task } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useTasks = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Task[]>(['tasks']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Task>('tasks');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['tasks'], fromDb);
                }
            } catch (e) {
                console.error("[useTasks] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['tasks'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('tasks', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Task>('tasks');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'tasks', lastModified);

                if (delta.length > 0) {
                    console.log(`[Tasks] Found ${delta.length} new/updated items.`);

                    const mappedDelta: Task[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        label: raw.label,
                        description: raw.description,
                        project_id: raw.project_id ? String(raw.project_id) : '',
                        date_start: raw.date_start ? new Date(raw.date_start).getTime() : 0,
                        date_end: raw.date_end ? new Date(raw.date_end).getTime() : 0,
                        progress: Number(raw.progress) || 0,
                        planned_workload: Number(raw.planned_workload) || 0,
                        duration_effective: Number(raw.duration_effective) || 0,
                        fk_user_assign: raw.fk_user_assign ? String(raw.fk_user_assign) : undefined,
                        fk_user_creat: raw.fk_user_creat ? String(raw.fk_user_creat) : undefined,
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('tasks', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<Task>('tasks');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useTasks] Sync Error", e);
                const local = await dbService.getAll<Task>('tasks');
                return local.length > 0 ? local : DolibarrService.fetchTasks(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
