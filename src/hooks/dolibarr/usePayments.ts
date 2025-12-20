import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Payment } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const usePayments = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Payment[]>(['payments']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Payment>('payments');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['payments'], fromDb);
                }
            } catch (e) {
                console.error("[usePayments] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['payments'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('payments', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<Payment>('payments');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'payments', lastModified);

                if (delta.length > 0) {
                    console.log(`[Payments] Found ${delta.length} new/updated items.`);
                    const mappedDelta: Payment[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        date_payment: raw.date_payment ? new Date(raw.date_payment).getTime() : 0,
                        amount: parseFloat(raw.amount || '0'),
                        fk_bank: String(raw.fk_bank || ''),
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    await dbService.upsertAll('payments', mappedDelta);
                    const updatedLocal = await dbService.getAll<Payment>('payments');
                    return updatedLocal.sort((a, b) => (b.date_payment || 0) - (a.date_payment || 0));
                }

                return localData.length > 0 ? localData.sort((a, b) => (b.date_payment || 0) - (a.date_payment || 0)) : [];

            } catch (e) {
                console.error("[usePayments] Sync Error", e);
                const local = await dbService.getAll<Payment>('payments');
                return local;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
