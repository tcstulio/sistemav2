import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { dbService } from '../../services/dbService';
import { DolibarrConfig, SupplierInvoice } from '../../types';
import { useEffect, useState, useRef } from 'react';

export const useSupplierInvoices = (config: DolibarrConfig | null, enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isHydrated, setIsHydrated] = useState(false);
    const hydrationAttempted = useRef(false);

    useEffect(() => {
        if (hydrationAttempted.current) return;
        hydrationAttempted.current = true;

        const loadFromDb = async () => {
            const cached = queryClient.getQueryData<SupplierInvoice[]>(['supplierInvoices']);
            if (cached) {
                setIsHydrated(true);
                return;
            }

            try {
                const fromDb = await dbService.getAll<SupplierInvoice>('supplierInvoices');
                if (fromDb && fromDb.length > 0) {
                    queryClient.setQueryData(['supplierInvoices'], fromDb);
                }
            } catch (e) {
                console.error("[useSupplierInvoices] Failed to hydrate", e);
            } finally {
                setIsHydrated(true);
            }
        };
        loadFromDb();
    }, [queryClient]);

    return useQuery({
        queryKey: ['supplierInvoices'],
        queryFn: async () => {
            if (!config) return [];

            try {
                // 1. Watermark
                const lastModified = await dbService.getLastModified('supplierInvoices', 'date_modification');

                // 2. Local
                const localData = await dbService.getAll<SupplierInvoice>('supplierInvoices');

                // 3. Delta
                const delta = await DolibarrService.fetchDelta(config, 'supplier_invoices', lastModified);

                if (delta.length > 0) {
                    console.log(`[SupplierInvoices] Found ${delta.length} new/updated items.`);

                    const mappedDelta: SupplierInvoice[] = delta.map((raw: any) => ({
                        id: String(raw.id),
                        ref: raw.ref,
                        socid: String(raw.fk_soc || ''),
                        date: raw.date_invoice ? new Date(raw.date_invoice).getTime() : 0,
                        total_ttc: Number(raw.total_ttc),
                        statut: String(raw.statut) as '0' | '1' | '2',
                        paye: String(raw.paye) as '0' | '1',
                        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
                    }));

                    // 4. Upsert
                    await dbService.upsertAll('supplierInvoices', mappedDelta);

                    // 5. Return updated
                    const updatedLocal = await dbService.getAll<SupplierInvoice>('supplierInvoices');
                    return updatedLocal.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));
                }

                return localData.sort((a, b) => (b.date_modification || 0) - (a.date_modification || 0));

            } catch (e) {
                console.error("[useSupplierInvoices] Sync Error", e);
                const local = await dbService.getAll<SupplierInvoice>('supplierInvoices');
                if (local.length === 0) {
                    return DolibarrService.fetchSupplierInvoices(config);
                }
                return local;
            }
        },
        enabled: !!config && enabled && isHydrated,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
};
