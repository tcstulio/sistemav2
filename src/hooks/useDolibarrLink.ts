import { useCallback } from 'react';
import { DolibarrConfig } from '../types';
import { logger } from '../utils/logger';

const log = logger.child('DolibarrLink');

// URL web do Dolibarr (para os deep-links). Quando a apiUrl é o proxy/relativa (ex.: atrás do
// backend ou de um túnel), não dá pra derivar a raiz dela — usamos VITE_DOLIBARR_URL ou o
// domínio de produção como fallback, evitando que o link resolva contra a origem do webapp (404).
const DOLIBARR_WEB_URL = ((import.meta as any)?.env?.VITE_DOLIBARR_URL || 'https://sistema.coolgroove.com.br').replace(/\/+$/, '');

export const useDolibarrLink = (config: DolibarrConfig | null) => {
    const getLink = useCallback((module: string, id: string, ref?: string) => {
        if (!config || !id) return '#';

        // Se a apiUrl for absoluta (http[s]), deriva a raiz dela; senão, usa o DOLIBARR_WEB_URL.
        const raw = (config.apiUrl || '').trim();
        const baseUrl = /^https?:\/\//i.test(raw)
            ? raw.replace(/\/api\/index\.php\/?$/, '').replace(/\/+$/, '')
            : DOLIBARR_WEB_URL;

        switch (module) {
            case 'invoice':
            case 'invoices':
            case 'facture':
                return `${baseUrl}/compta/facture/card.php?facid=${id}`;

            case 'proposal':
            case 'proposals':
            case 'propale':
                return `${baseUrl}/comm/propal/card.php?id=${id}`;

            case 'order':
            case 'orders':
            case 'commande':
                return `${baseUrl}/commande/card.php?id=${id}`;

            case 'project':
            case 'projects':
            case 'projet':
                return `${baseUrl}/projet/card.php?id=${id}`;

            case 'task':
            case 'tasks':
                // Tasks often need project ID context, but ID is unique enough usually
                return `${baseUrl}/projet/tasks/task.php?id=${id}&withproject=1`;

            case 'intervention':
            case 'interventions':
            case 'ficheinter':
                return `${baseUrl}/fichinter/card.php?id=${id}`;

            case 'ticket':
            case 'tickets':
                return `${baseUrl}/ticket/card.php?track_id=${ref || ''}&id=${id}`;

            case 'customer':
            case 'supplier':
            case 'thirdparty':
            case 'societe':
                return `${baseUrl}/societe/card.php?socid=${id}`;

            case 'product':
            case 'products':
                return `${baseUrl}/product/card.php?id=${id}`;

            case 'user':
            case 'users':
                return `${baseUrl}/user/card.php?id=${id}`;

            case 'agenda':
            case 'event':
            case 'action':
                return `${baseUrl}/comm/action/card.php?id=${id}`;

            case 'contract':
            case 'contracts':
            case 'contrat':
                return `${baseUrl}/contrat/card.php?id=${id}`;

            case 'shipping':
            case 'shipment':
            case 'expedition':
                return `${baseUrl}/expedition/card.php?id=${id}`;

            case 'expensereport':
            case 'expense':
            case 'deplacement':
                return `${baseUrl}/compta/deplacement/card.php?id=${id}`;

            default:
                log.warn(`Unknown module: ${module}`);
                return '#';
        }
    }, [config]);

    const openLink = useCallback((module: string, id: string, ref?: string) => {
        const url = getLink(module, id, ref);
        if (url && url !== '#') {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }, [getLink]);

    return { getLink, openLink };
};
