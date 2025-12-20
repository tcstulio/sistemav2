import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, ExpenseReport } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useExpenseReports = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<ExpenseReport[]>(['expenseReports']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<ExpenseReport>('expenseReports');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['expenseReports'], fromDb);
                }
            } catch (e) {
                console.error("[useExpenseReports] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['expenseReports'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('expenseReports', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<ExpenseReport>('expenseReports');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'expense_reports', lastModified);

                if (delta.length > 0) {
                    console.log(`[ExpenseReports] Found ${delta.length} new/updated items.`);
                    const mappedDelta: ExpenseReport[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        fk_user_author: String(raw.fk_user_author),
                        total_ttc: Number(raw.total_ttc),
                        date_debut: raw.date_debut ? new Date(raw.date_debut).getTime() : 0,
                        date_fin: raw.date_fin ? new Date(raw.date_fin).getTime() : 0,
                        statut: String(raw.statut),
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    await dbService.upsertAll('expenseReports', mappedDelta);
                    const updatedLocal = await dbService.getAll<ExpenseReport>('expenseReports');
                    return updatedLocal;
                }

                return localData.length > 0 ? localData : DolibarrService.fetchExpenseReports(config);

            } catch (e) {
                console.error("[useExpenseReports] Sync Error", e);
                const local = await dbService.getAll<ExpenseReport>('expenseReports');
                return local.length > 0 ? local : DolibarrService.fetchExpenseReports(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
    });
};
