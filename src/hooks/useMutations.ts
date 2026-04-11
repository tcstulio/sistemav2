import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DolibarrService } from '../services/dolibarrService';
import { DolibarrConfig, ThirdParty } from '../types';

export const useCustomerMutations = (config: DolibarrConfig | null) => {
    const queryClient = useQueryClient();

    const createCustomer = useMutation({
        mutationFn: async (newCustomer: Partial<ThirdParty>) => {
            if (!config) throw new Error("No Configuration");
            const result = await DolibarrService.createThirdParty(config, newCustomer);
            return result as string; // createThirdParty returns ID string
        },
        onSuccess: () => {
            // Invalidate to trigger refetch of the list
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
        },
    });

    const updateCustomer = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Partial<ThirdParty> }) => {
            if (!config) throw new Error("No Configuration");
            const result = await DolibarrService.updateThirdParty(config, id, data);
            return result as ThirdParty;
        },
        onMutate: async ({ id, data }) => {
            // Cancel outgoing refetches so they don't overwrite our optimistic update
            await queryClient.cancelQueries({ queryKey: ['customers'] });

            // Snapshot the previous value
            const previousData = queryClient.getQueriesData({ queryKey: ['customers'] });

            // Optimistically update to the new value
            queryClient.setQueriesData({ queryKey: ['customers'] }, (oldData: ThirdParty[] | undefined) => {
                if (!oldData || !Array.isArray(oldData)) return oldData;
                return oldData.map(customer =>
                    customer.id === id ? { ...customer, ...data } : customer
                );
            });

            // Return context with the snapshotted value
            return { previousData };
        },
        onError: (err, newTodo, context) => {
            // Rollback on error
            if (context?.previousData) {
                context.previousData.forEach(([queryKey, data]) => {
                    queryClient.setQueryData(queryKey, data);
                });
            }
            toast.error("Erro na operação", { description: (err as Error).message });
        },
        onSettled: () => {
            // Always refetch after error or success to ensure data is in sync
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
        },
    });

    const deleteCustomer = useMutation({
        mutationFn: async (id: string) => {
            if (!config) throw new Error("No Configuration");
            await DolibarrService.deleteThirdParty(config, id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
        }
    });

    return { createCustomer, updateCustomer, deleteCustomer };
};

export const useSupplierMutations = (config: DolibarrConfig | null) => {
    const queryClient = useQueryClient();

    const createSupplier = useMutation({
        mutationFn: async (newSupplier: Partial<ThirdParty>) => {
            if (!config) throw new Error("No Configuration");
            // Ensure it's a supplier (fournisseur=1)
            const data = { ...newSupplier, fournisseur: '1' };
            const result = await DolibarrService.createThirdParty(config, data);
            return result as string;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
        },
    });

    const updateSupplier = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Partial<ThirdParty> }) => {
            if (!config) throw new Error("No Configuration");
            const result = await DolibarrService.updateThirdParty(config, id, data);
            return result as ThirdParty;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
        },
    });

    const deleteSupplier = useMutation({
        mutationFn: async (id: string) => {
            if (!config) throw new Error("No Configuration");
            await DolibarrService.deleteThirdParty(config, id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
        }
    });

    return { createSupplier, updateSupplier, deleteSupplier };
};

export const useInvoiceMutations = (config: DolibarrConfig | null) => {
    const queryClient = useQueryClient();

    const createInvoice = useMutation({
        mutationFn: async (newInvoice: any) => {
            if (!config) throw new Error("No Configuration");
            return DolibarrService.createInvoice(config, newInvoice);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
        },
    });

    const updateInvoice = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            if (!config) throw new Error("No Configuration");
            return DolibarrService.updateInvoice(config, id, data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
        },
    });

    return { createInvoice, updateInvoice };
};
