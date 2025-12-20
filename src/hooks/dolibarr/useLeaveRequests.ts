import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, LeaveRequest } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useLeaveRequests = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<LeaveRequest[]>(['leaveRequests']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<LeaveRequest>('leaveRequests');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['leaveRequests'], fromDb);
                }
            } catch (e) {
                console.error("[useLeaveRequests] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['leaveRequests'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('leaveRequests', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<LeaveRequest>('leaveRequests');

                // 3. Delta
                // Use 'leave_requests' to match custom_sync.php
                const delta = await DolibarrService.fetchDelta(config, 'leave_requests', lastModified);

                if (delta.length > 0) {
                    console.log(`[LeaveRequests] Found ${delta.length} new/updated items.`);
                    const mappedDelta: LeaveRequest[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        type: raw.type ? String(raw.type) : undefined,
                        date_debut: raw.date_debut ? new Date(raw.date_debut).getTime() : 0,
                        date_fin: raw.date_fin ? new Date(raw.date_fin).getTime() : 0,
                        description: raw.description,
                        fk_user: String(raw.fk_user),
                        statut: String(raw.statut) as any,
                        date_create: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    await dbService.upsertAll('leaveRequests', mappedDelta);
                    const updatedLocal = await dbService.getAll<LeaveRequest>('leaveRequests');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.length > 0 ? localData : DolibarrService.fetchList(config, 'holiday') as Promise<LeaveRequest[]>;

            } catch (e) {
                console.error("[useLeaveRequests] Sync Error", e);
                const local = await dbService.getAll<LeaveRequest>('leaveRequests');
                return local.length > 0 ? local : DolibarrService.fetchList(config, 'holiday') as Promise<LeaveRequest[]>;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
