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

    switch (elementType) {
        case 'projet':
        case 'project':
            return { view: 'projects', id };

        case 'ticket':
            return { view: 'tickets', id };

        case 'propal':
        case 'comm/propal':
            return { view: 'proposals', id };

        case 'commande':
        case 'order':
            return { view: 'orders', id };

        case 'facture':
        case 'invoice':
            return { view: 'invoices', id };

        case 'facture_fourn': // Supplier invoice
            return { view: 'supplier_invoices', id };

        case 'contrat':
        case 'contract':
            return { view: 'contracts', id };

        case 'societe':
        case 'company':
        case 'thirdparty':
            return { view: 'customers', id };

        case 'task':
            // Task navigation usually relies on Project ID if tasks are sub-views of projects?
            // Or if there is a global task view.
            // AgendaView mapped tasks to 'projects' with project_id.
            // Here we might only have task ID and elementtype 'task'.
            // If we don't have project context, we strictly can't navigate if the view depends on it.
            // But if there is a 'tasks' view:
            // "Clicking on a "Task" should lead to the task details" (Previous user conversation)
            return { view: 'tasks', id }; // Assuming a global task handler or similar exists/was added.

        default:
            // Fallback for society if present (e.g. contact linked to society)
            if (extraData?.socid) {
                return { view: 'customers', id: String(extraData.socid) };
            }
            return null;
    }
};
