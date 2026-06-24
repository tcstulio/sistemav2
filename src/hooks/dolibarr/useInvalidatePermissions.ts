import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { dbService } from '../../services/dbService';
import { useDolibarr } from '../../context/DolibarrContext';

// Stores IndexedDB (storeName) e queryKeys dos hooks de grupos/direitos.
const STORES = ['groups', 'groupUsers', 'permissions', 'groupRights', 'userRights'];
const QUERY_KEYS = ['groups', 'group_users', 'permissions', 'group_rights', 'user_rights'];

/**
 * Invalida o cache de grupos/membros/direitos após uma escrita.
 *
 * Necessário porque o delta-sync usa `WHERE rowid > watermark` (dateField:'id'), então
 * **remoções nunca são detectadas** — a linha some no Dolibarr mas permanece no IndexedDB, e um
 * simples refetch roda o mesmo delta. Limpar as stores zera o watermark → o próximo fetch faz
 * full re-sync e reflete remoções; depois invalidamos as queries para forçar o refetch.
 */
export function useInvalidatePermissions() {
    const queryClient = useQueryClient();
    const { refreshCurrentUser, refreshPreviewTarget } = useDolibarr();
    return useCallback(async () => {
        await dbService.clearStores(STORES);
        await Promise.all(QUERY_KEYS.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
        // Reflete a mudança no canAccess/canDo do usuário logado e no "Ver como" sem relogar.
        await Promise.all([refreshCurrentUser(), refreshPreviewTarget()]);
    }, [queryClient, refreshCurrentUser, refreshPreviewTarget]);
}
