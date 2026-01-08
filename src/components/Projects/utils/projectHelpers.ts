import { ThirdParty } from '../../../types/crm';
import { DolibarrUser } from '../../../types/common';

/**
 * Get customer name by socid
 */
export const getCustomerName = (socid: string, customers: ThirdParty[]): string => {
    const customer = customers.find(c => String(c.id) === String(socid));
    return customer ? customer.name : 'Cliente Desconhecido';
};

/**
 * Resolve user name by ID
 */
export const resolveUserName = (authorId: string | undefined, users: DolibarrUser[]): string => {
    if (!authorId || authorId === 'System') return 'Sistema';
    const user = users.find(u => String(u.id) === String(authorId));
    if (user) return `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login;
    if (!isNaN(Number(authorId))) return `Usuário ${authorId}`;
    return authorId;
};

/**
 * Format timestamp to date input value (yyyy-mm-dd)
 */
export const formatDateForInput = (timestamp: number): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
};

/**
 * Get status badge class and label
 */
export const getProjectStatusInfo = (status: string): { label: string; className: string } => {
    switch (status) {
        case '0':
            return {
                label: 'Rascunho',
                className: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
            };
        case '1':
            return {
                label: 'Aberto',
                className: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            };
        case '2':
            return {
                label: 'Fechado',
                className: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
            };
        default:
            return {
                label: 'Desconhecido',
                className: 'bg-slate-100'
            };
    }
};

/**
 * Calculate project financial summary
 */
export const calculateProjectFinancials = (
    invoices: { total_ttc: number }[],
    supplierInvoices: { total_ttc: number }[],
    expenses: { total_ttc: number }[]
): {
    totalInvoiced: number;
    totalCosts: number;
    margin: number;
} => {
    const totalInvoiced = invoices.reduce((acc, i) => acc + i.total_ttc, 0);
    const totalSupplierBills = supplierInvoices.reduce((acc, i) => acc + i.total_ttc, 0);
    const totalExpenses = expenses.reduce((acc, i) => acc + i.total_ttc, 0);
    const totalCosts = totalSupplierBills + totalExpenses;

    return {
        totalInvoiced,
        totalCosts,
        margin: totalInvoiced - totalCosts
    };
};

/**
 * Get linked IDs for a project from element_element links table
 */
export const getLinkedIds = (
    projectId: string,
    links: Array<{ sourcetype: string; sourceid: string; targettype: string; targetid: string }>,
    targetType: string
): Set<string> => {
    const ids = new Set<string>();
    links.forEach(link => {
        // Project is source, linked object is target
        if (link.sourcetype === 'project' && String(link.sourceid) === String(projectId) && link.targettype === targetType) {
            ids.add(String(link.targetid));
        }
        // Project is target, linked object is source
        if (link.targettype === 'project' && String(link.targetid) === String(projectId) && link.sourcetype === targetType) {
            ids.add(String(link.sourceid));
        }
    });
    return ids;
};
