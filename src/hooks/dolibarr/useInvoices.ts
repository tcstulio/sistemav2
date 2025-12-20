import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, Invoice } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useInvoices = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<Invoice[]>(['invoices']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<Invoice>('invoices');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['invoices'], fromDb);
                }
            } catch (e) {
                console.error("[useInvoices] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['invoices'],
        queryFn: async () => {
            if (!config) return [];

            // 1. Load Local
            const localData = await dbService.getAll<Invoice>('invoices');

            try {
                // 2. Get Watermark (date_modification)
                const lastModified = await dbService.getLastModified('invoices', 'date_modification');

                // 3. Fetch Delta
                const delta = await DolibarrService.fetchDelta(config, 'invoices', lastModified);

                if (delta.length > 0) {
                    console.log(`[Invoices] Found ${delta.length} new/updated items.`);

                    // Map raw PHP data to Invoice type
                    const mappedDelta: Invoice[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        total_ttc: Number(raw.total_ttc),
                        total_ht: raw.total_ht ? Number(raw.total_ht) : undefined,
                        total_tva: raw.total_tva ? Number(raw.total_tva) : undefined,
                        date: raw.date_invoice ? new Date(raw.date_invoice).getTime() : (raw.datec ? new Date(raw.datec).getTime() : 0),
                        statut: String(raw.statut) as '0' | '1' | '2',
                        socid: raw.fk_soc ? String(raw.fk_soc) : '',
                        paye: String(raw.paye) as '0' | '1',
                        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0
                    }));

                    // 4. Upsert
                    // Note: This lightweight sync might miss some details. 
                    // Ideally we should fetch full details for these IDs if needed, 
                    // but for lists this is sufficient.
                    await dbService.upsertAll('invoices', mappedDelta);

                    const updatedLocal = await dbService.getAll<Invoice>('invoices');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useInvoices] Sync error", e);
                return localData;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false // Safety against loops
    });
};
