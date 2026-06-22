import { AppView } from '../types';

/**
 * Determines the application view and ID for navigation based on entity type and ID.
 * @param elementType - The type of the entity (e.g., 'facture', 'projet').
 * @param elementId - The ID of the entity.
 * @param extraData - Optional extra data (e.g., society ID) to help with routing.
 * @returns Object with view and id, or null if custom navigation is not supported.
 */
export const getEntityLink = (
    elementType: string | undefined,
    elementId: string | number | undefined,
    extraData?: { socid?: string | number }
): { view: AppView; id: string } | null => {
    if (!elementType || !elementId) return null;

    const id = String(elementId);

    // Normalize element type to lowercase for consistent matching
    const normalizedType = elementType.toLowerCase();

    switch (normalizedType) {
        // Projects
        case 'projet':
        case 'project':
            return { view: 'projects', id };

        // Tasks
        case 'task':
        case 'projet_task':
            return { view: 'tasks', id };

        // Tickets
        case 'ticket':
            return { view: 'tickets', id };

        // Proposals (Customer)
        case 'propal':
        case 'comm/propal':
        case 'proposal':
            return { view: 'proposals', id };

        // Supplier Proposals
        case 'supplier_proposal':
        case 'supplier_propal':
            return { view: 'supplier_proposals', id };

        // Orders
        case 'commande':
        case 'order':
            return { view: 'orders', id };

        // Invoices (Customer)
        case 'facture':
        case 'invoice':
            return { view: 'invoices', id };

        // Supplier Invoices
        case 'facture_fourn':
        case 'supplier_invoice':
            return { view: 'supplier_invoices', id };

        // Contracts
        case 'contrat':
        case 'contract':
            return { view: 'contracts', id };

        // Customers / Third Parties
        case 'societe':
        case 'company':
        case 'thirdparty':
        case 'customer':
            return { view: 'customers', id };

        // Suppliers
        case 'supplier':
        case 'fournisseur':
            return { view: 'suppliers', id };

        // Interventions
        case 'intervention':
        case 'ficheinter':
            return { view: 'interventions', id };

        // Shipments
        case 'shipment':
        case 'expedition':
            return { view: 'shipments', id };

        // Payments (Customer)
        case 'payment':
        case 'paiement':
            return { view: 'payments', id };

        // Supplier Payments
        case 'supplier_payment':
        case 'paiement_fourn':
            return { view: 'supplier_payments', id };

        // Products
        case 'product':
        case 'produit':
            return { view: 'products', id };

        // Services
        case 'service':
            return { view: 'services', id };

        // Users / HR
        case 'user':
        case 'utilisateur':
            return { view: 'hr', id };

        // Venues / Partnerships
        case 'venue':
        case 'partnership':
            return { view: 'venues', id };

        // Agenda Events
        case 'agenda':
        case 'agenda_event':
        case 'actioncomm':
            return { view: 'agenda', id };

        // Bank Accounts
        case 'bank':
        case 'bank_account':
            return { view: 'bank_accounts', id };

        // Tax Payments
        case 'tax_payment':
        case 'chargesociales':
            return { view: 'tax_payments', id };

        // Salary Payments
        case 'salary_payment':
        case 'salary':
            return { view: 'salary_payments', id };

        // Expense Reports
        case 'expense_report':
        case 'expensereport':
            return { view: 'expense_report_payments', id };

        default:
            // Fallback for society if present (e.g. contact linked to society)
            if (extraData?.socid) {
                return { view: 'customers', id: String(extraData.socid) };
            }
            return null;
    }
};

/**
 * Returns true when the given elementType has a mapped navigation destination
 * (i.e. getEntityLink would return non-null for a valid fk_element).
 * Used to determine whether a feed item should appear as clickable.
 */
export const hasEntityLink = (elementType: string | undefined): boolean => {
    if (!elementType) return false;
    const t = elementType.toLowerCase();
    return [
        'projet', 'project',
        'task', 'projet_task',
        'ticket',
        'propal', 'comm/propal', 'proposal',
        'supplier_proposal', 'supplier_propal',
        'commande', 'order',
        'facture', 'invoice',
        'facture_fourn', 'supplier_invoice',
        'contrat', 'contract',
        'societe', 'company', 'thirdparty', 'customer',
        'supplier', 'fournisseur',
        'intervention', 'ficheinter',
        'shipment', 'expedition',
        'payment', 'paiement',
        'supplier_payment', 'paiement_fourn',
        'product', 'produit',
        'service',
        'user', 'utilisateur',
        'venue', 'partnership',
        'agenda', 'agenda_event', 'actioncomm',
        'bank', 'bank_account',
        'tax_payment', 'chargesociales',
        'salary_payment', 'salary',
        'expense_report', 'expensereport',
    ].includes(t);
};
