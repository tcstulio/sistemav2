import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, BankLine } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useBankLines = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<BankLine[]>(['bankLines']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<BankLine>('bankLines');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['bankLines'], fromDb);
                }
            } catch (e) {
                console.error("[useBankLines] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['bankLines'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('bankLines', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<BankLine>('bankLines');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'bank_lines', lastModified);

                if (delta.length > 0) {
                    console.log(`[BankLines] Found ${delta.length} new/updated items.`);
                    const mappedDelta: BankLine[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        date_operation: raw.date_operation ? new Date(raw.date_operation).getTime() : 0,
                        date_value: raw.date_value ? new Date(raw.date_value).getTime() : undefined,
                        amount: parseFloat(raw.amount || '0'),
                        label: raw.label,
                        fk_account: String(raw.fk_account),
                        fk_bank: String(raw.fk_account), // fk_bank is same as fk_account for bank lines
                        reconciled: raw.num_releve ? true : false, // heuristic: if statement number exists, it is reconciled
                        // Actually Dolibarr uses 'rappro' field often, but custom_sync.php returns num_releve.
                        // Let's assume raw.num_releve being set implies reconciled, or check if 'reconciled' field is in custom_sync query?
                        // custom_sync query: SELECT ..., num_releve, ...
                        // In standard Dolibarr, 'rappro' is boolean-like. 'num_releve' is the statement ID.
                        // Let's stick to simple mapping. If num_releve is present, it's reconciled.
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('bankLines', mappedDelta);

                    const updatedLocal = await dbService.getAll<BankLine>('bankLines');
                    return updatedLocal.sort((a, b) => (b.date_operation || 0) - (a.date_operation || 0));
                }

                return localData.length > 0 ? localData.sort((a, b) => (b.date_operation || 0) - (a.date_operation || 0)) : [];
                // Note: Fallback to full fetch if really needed? DolibarrService.fetchBankLines is complex (loop).
                // If delta fails or empty local, we might want to trigger full sync?
                // But fetchBankLines requires accountIds.
                // Let's rely on Delta. If first run (localData empty), lastModified=0, Delta fetches all.

            } catch (e) {
                console.error("[useBankLines] Sync Error", e);
                const local = await dbService.getAll<BankLine>('bankLines');
                return local;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
