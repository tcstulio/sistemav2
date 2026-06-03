import { useQuery } from '@tanstack/react-query';
import { DolibarrService } from '../../services/dolibarrService';
import { DolibarrConfig, DolibarrModule } from '../../types';

export const useModules = (config: DolibarrConfig | null) => {
    return useQuery({
        queryKey: ['setupModules'],
        queryFn: async (): Promise<DolibarrModule[]> => {
            if (!config) return [];
            return DolibarrService.fetchSetupModules(config);
        },
        enabled: !!config,
        staleTime: 60 * 60 * 1000, // Cache for 1 hour
    });
};
