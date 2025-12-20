import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DolibarrConfig } from '../types';
import { DolibarrService } from '../services/dolibarrService';

interface UseDolibarrDataProps {
    config: DolibarrConfig | null;
    canAccess: (module: string) => boolean;
    isSyncPaused: boolean;
}

export const useDolibarrData = ({ config, canAccess, isSyncPaused }: UseDolibarrDataProps) => {
    const [isLoading, setIsLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    // Updated refreshData: Invalidate Data Cache
    const refreshData = useCallback(async (options: { forceFull?: boolean, limit?: number, page?: number, query?: string } = {}) => {
        if (!config || isSyncPaused) return;

        setIsSyncing(true);
        setError(null);

        try {
            console.log(`[DolibarrData] Refresh Requested`);

            // Note: We don't fetch data here anymore. Individual hooks manage their own fetching.
            // We just invalidate queries to trigger re-fetches in active components.

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['customers'] }),
                queryClient.invalidateQueries({ queryKey: ['invoices'] }),
                queryClient.invalidateQueries({ queryKey: ['products'] }),
                queryClient.invalidateQueries({ queryKey: ['orders'] }),
                queryClient.invalidateQueries({ queryKey: ['projects'] }),
                queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
                queryClient.invalidateQueries({ queryKey: ['proposals'] }),
                queryClient.invalidateQueries({ queryKey: ['tasks'] }),
                queryClient.invalidateQueries({ queryKey: ['users'] }),
                queryClient.invalidateQueries({ queryKey: ['warehouses'] }),
                queryClient.invalidateQueries({ queryKey: ['interventions'] }),
                queryClient.invalidateQueries({ queryKey: ['tickets'] }),
                queryClient.invalidateQueries({ queryKey: ['bankAccounts'] }),
                queryClient.invalidateQueries({ queryKey: ['events'] }),
                queryClient.invalidateQueries({ queryKey: ['shipments'] }),
                queryClient.invalidateQueries({ queryKey: ['contracts'] }),
                queryClient.invalidateQueries({ queryKey: ['stockMovements'] }),
                queryClient.invalidateQueries({ queryKey: ['expenseReports'] }),
                queryClient.invalidateQueries({ queryKey: ['jobPositions'] }),
                queryClient.invalidateQueries({ queryKey: ['candidates'] }),
                queryClient.invalidateQueries({ queryKey: ['leaveRequests'] }),
                queryClient.invalidateQueries({ queryKey: ['contacts'] }),
                queryClient.invalidateQueries({ queryKey: ['categories'] }),
                queryClient.invalidateQueries({ queryKey: ['boms'] }),
                queryClient.invalidateQueries({ queryKey: ['manufacturingOrders'] }),
                queryClient.invalidateQueries({ queryKey: ['supplierInvoices'] }),
                queryClient.invalidateQueries({ queryKey: ['supplierOrders'] }),
                queryClient.invalidateQueries({ queryKey: ['bankLines'] }),
            ]);

            // Setup Modules might still be centrally fetched if needed for UI toggles, or moved to a hook
            // For now, we assume modules are static or loaded elsewhere.

        } catch (e) {
            console.error("Sync Error", e);
            setError((e as Error).message || "Unknown Fetch Error");
        } finally {
            setIsSyncing(false);
        }
    }, [config, isSyncPaused, queryClient]);

    return {
        isLoading,
        isSyncing,
        error,
        refreshData
    };
};

