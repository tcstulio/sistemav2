import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, BankAccount } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useBankAccounts = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<BankAccount[]>(['bankAccounts']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<BankAccount>('bankAccounts');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['bankAccounts'], fromDb);
                }
            } catch (e) {
                console.error("[useBankAccounts] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['bankAccounts'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('bankAccounts', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<BankAccount>('bankAccounts');

                // 3. Delta
                // Use 'bank_accounts' to match custom_sync.php
                const delta = await DolibarrService.fetchDelta(config, 'bank_accounts', lastModified);

                if (delta.length > 0) {
                    console.log(`[BankAccounts] Found ${delta.length} new/updated items.`);
                    const mappedDelta: BankAccount[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        label: raw.label,
                        bank: raw.bank,
                        number: raw.number,
                        currency_code: raw.currency_code,
                        solde: Number(raw.solde || 0), // Note: custom_sync might not return dynamic balance
                        status: String(raw.status) === '0' ? '0' : '1',
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('bankAccounts', mappedDelta);

                    const updatedLocal = await dbService.getAll<BankAccount>('bankAccounts');
                    return updatedLocal;
                }

                return localData.length > 0 ? localData : DolibarrService.fetchBankAccounts(config);

            } catch (e) {
                console.error("[useBankAccounts] Sync Error", e);
                const local = await dbService.getAll<BankAccount>('bankAccounts');
                return local.length > 0 ? local : DolibarrService.fetchBankAccounts(config);
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
    });
};
