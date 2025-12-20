import { useQuery } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { DolibarrConfig } from '../../types';

export const useModules = (config: DolibarrConfig | null) => {
    return useQuery({
        queryKey: ['setupModules'],
        queryFn: async () => {
            if (!config) return [];
            return DolibarrService.fetchSetupModules(config);
        },
        enabled: !!config,
        staleTime: 60 * 60 * 1000, // Cache for 1 hour
    });
};
