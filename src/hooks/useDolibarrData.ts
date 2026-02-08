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
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    // Updated refreshData: Invalidate Data Cache
    const refreshData = useCallback(async (options: { forceFull?: boolean, limit?: number, page?: number, query?: string } = {}) => {
        if (!config || isSyncPaused) return;

        setIsSyncing(true);
        setError(null);

        try {
            // Invalidate all active queries in a single call
            // React Query will only re-fetch queries that are currently observed by mounted components
            await queryClient.invalidateQueries();
        } catch (e) {
            // Sync error
            setError((e as Error).message || "Unknown Fetch Error");
        } finally {
            setIsSyncing(false);
        }
    }, [config, isSyncPaused, queryClient]);

    return {
        isLoading: isSyncing, // Alias for backwards compatibility
        isSyncing,
        error,
        refreshData
    };
};

