/**
 * Background Sync Service
 * 
 * Fetches all delta sync data for all modules in the background,
 * independent of which pages/components are mounted.
 * This ensures the IndexedDB has complete data for the sync monitor.
 */

import { DolibarrConfig } from '../types';
import { DolibarrService } from './dolibarrService';
import { dbService } from './dbService';

// Module definitions for background sync
const SYNC_MODULES = [
    { type: 'thirdparties', store: 'customers', mapFn: mapCustomer },
    { type: 'suppliers', store: 'suppliers', mapFn: mapSupplier },
    { type: 'categories', store: 'categories', mapFn: mapCategory },
    { type: 'contacts', store: 'contacts', mapFn: mapContact },
    { type: 'invoices', store: 'invoices', mapFn: mapInvoice },
    { type: 'supplier_invoices', store: 'supplierInvoices', mapFn: mapSupplierInvoice },
    { type: 'products', store: 'products', mapFn: mapProduct },
    { type: 'proposals', store: 'proposals', mapFn: mapProposal },
    { type: 'orders', store: 'orders', mapFn: mapOrder },
    { type: 'shipments', store: 'shipments', mapFn: mapShipment },
    { type: 'projects', store: 'projects', mapFn: mapProject },
    { type: 'tasks', store: 'tasks', mapFn: mapTask },
    { type: 'bank_accounts', store: 'bankAccounts', mapFn: mapBankAccount },
    { type: 'bank_lines', store: 'bankLines', mapFn: mapBankLine },
    { type: 'events', store: 'events', mapFn: mapEvent },
    { type: 'users', store: 'users', mapFn: mapUser },
    { type: 'supplier_orders', store: 'supplierOrders', mapFn: mapSupplierOrder },
    { type: 'interventions', store: 'interventions', mapFn: mapIntervention },
    { type: 'expense_reports', store: 'expenseReports', mapFn: mapExpenseReport },
    { type: 'job_positions', store: 'jobPositions', mapFn: mapJobPosition },
    { type: 'tickets', store: 'tickets', mapFn: mapTicket },
    { type: 'warehouses', store: 'warehouses', mapFn: mapWarehouse },
    { type: 'stock_movements', store: 'stockMovements', mapFn: mapStockMovement },
    { type: 'candidates', store: 'candidates', mapFn: mapCandidate },
    { type: 'leave_requests', store: 'leaveRequests', mapFn: mapLeaveRequest },
    { type: 'contracts', store: 'contracts', mapFn: mapContract },
    { type: 'payments', store: 'payments', mapFn: mapPayment },
    { type: 'supplier_payments', store: 'supplierPayments', mapFn: mapSupplierPayment },
    { type: 'boms', store: 'boms', mapFn: mapBOM },
    { type: 'manufacturing_orders', store: 'manufacturingOrders', mapFn: mapManufacturingOrder },
];

// Mapping functions - Convert raw API data to typed objects
function mapCustomer(raw: any) {
    return {
        id: String(raw.id),
        name: raw.name,
        name_alias: raw.name_alias,
        code_client: raw.code_client,
        email: raw.email,
        phone: raw.phone,
        address: raw.address,
        zip: raw.zip,
        town: raw.town,
        client: raw.client,
        fournisseur: raw.fournisseur,
        code_fournisseur: raw.code_fournisseur,
        status: raw.status,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
        datec: raw.datec ? new Date(raw.datec).getTime() : 0,
    };
}

function mapSupplier(raw: any) {
    return {
        id: String(raw.id),
        name: raw.name,
        name_alias: raw.name_alias,
        code_client: raw.code_client,
        code_fournisseur: raw.code_fournisseur,
        email: raw.email,
        phone: raw.phone,
        client: raw.client,
        fournisseur: raw.fournisseur,
        status: raw.status,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
        datec: raw.datec ? new Date(raw.datec).getTime() : 0,
    };
}

function mapCategory(raw: any) {
    return {
        id: String(raw.id),
        label: raw.label,
        type: raw.type,
        description: raw.description,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapContact(raw: any) {
    return {
        id: String(raw.id),
        lastname: raw.lastname,
        firstname: raw.firstname,
        email: raw.email,
        phone_work: raw.phone_work,
        phone_personal: raw.phone_personal,
        phone_mobile: raw.phone_mobile,
        position: raw.position,
        fk_soc: raw.fk_soc ? String(raw.fk_soc) : '',
        statut: raw.statut,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapInvoice(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        total_ht: parseFloat(raw.total_ht || '0'),
        total_ttc: parseFloat(raw.total_ttc || '0'),
        total_tva: parseFloat(raw.total_tva || '0'),
        statut: String(raw.statut),
        socid: raw.fk_soc ? String(raw.fk_soc) : '',
        date_invoice: raw.date_invoice ? new Date(raw.date_invoice).getTime() : 0,
        paye: raw.paye,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapSupplierInvoice(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        socid: raw.fk_soc ? String(raw.fk_soc) : '',
        date_invoice: raw.date_invoice ? new Date(raw.date_invoice).getTime() : 0,
        total_ttc: parseFloat(raw.total_ttc || '0'),
        statut: String(raw.statut),
        paye: raw.paye,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapProduct(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        label: raw.label,
        description: raw.description,
        type: raw.type,
        price: parseFloat(raw.price || '0'),
        stock: parseFloat(raw.stock || '0'),
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapProposal(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        total_ht: parseFloat(raw.total_ht || '0'),
        total_ttc: parseFloat(raw.total_ttc || '0'),
        total_tva: parseFloat(raw.total_tva || '0'),
        statut: String(raw.statut),
        socid: raw.fk_soc ? String(raw.fk_soc) : '',
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapOrder(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        total_ht: parseFloat(raw.total_ht || '0'),
        total_ttc: parseFloat(raw.total_ttc || '0'),
        total_tva: parseFloat(raw.total_tva || '0'),
        statut: String(raw.statut),
        socid: raw.fk_soc ? String(raw.fk_soc) : '',
        date_commande: raw.date_commande ? new Date(raw.date_commande).getTime() : 0,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapShipment(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        socid: raw.fk_soc ? String(raw.fk_soc) : '',
        fk_projet: raw.fk_projet ? String(raw.fk_projet) : undefined,
        fk_commande: raw.fk_commande ? String(raw.fk_commande) : undefined,
        date_creation: raw.date_creation ? new Date(raw.date_creation).getTime() : 0,
        date_delivery: raw.date_delivery ? new Date(raw.date_delivery).getTime() : undefined,
        status: raw.status,
        tracking_number: raw.tracking_number,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapProject(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        title: raw.title,
        statut: String(raw.statut),
        socid: raw.socid ? String(raw.socid) : '',
        date_start: raw.date_start ? new Date(raw.date_start).getTime() : undefined,
        date_end: raw.date_end ? new Date(raw.date_end).getTime() : undefined,
        budget_amount: parseFloat(raw.budget_amount || '0'),
        progress: parseFloat(raw.progress || '0'),
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapTask(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        label: raw.label,
        description: raw.description,
        date_start: raw.date_start ? new Date(raw.date_start).getTime() : undefined,
        date_end: raw.date_end ? new Date(raw.date_end).getTime() : undefined,
        progress: parseFloat(raw.progress || '0'),
        planned_workload: raw.planned_workload,
        duration_effective: raw.duration_effective,
        fk_user_assign: raw.fk_user_assign ? String(raw.fk_user_assign) : undefined,
        fk_user_creat: raw.fk_user_creat ? String(raw.fk_user_creat) : undefined,
        project_id: raw.project_id ? String(raw.project_id) : '',
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapBankAccount(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        label: raw.label,
        bank: raw.bank,
        number: raw.number,
        currency_code: raw.currency_code,
        status: raw.status,
        solde: parseFloat(raw.solde || '0'),
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapBankLine(raw: any) {
    return {
        id: String(raw.id),
        date_operation: raw.date_operation ? new Date(raw.date_operation).getTime() : 0,
        date_value: raw.date_value ? new Date(raw.date_value).getTime() : 0,
        amount: parseFloat(raw.amount || '0'),
        label: raw.label,
        fk_account: raw.fk_account ? String(raw.fk_account) : '',
        num_releve: raw.num_releve,
        fk_type: raw.fk_type,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapEvent(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        label: raw.label,
        description: raw.description,
        type_code: raw.type_code,
        date_start: raw.date_start ? new Date(raw.date_start).getTime() : 0,
        date_end: raw.date_end ? new Date(raw.date_end).getTime() : undefined,
        percentage: parseFloat(raw.percentage || '0'),
        fk_user_author: raw.fk_user_author ? String(raw.fk_user_author) : undefined,
        socid: raw.socid ? String(raw.socid) : undefined,
        project_id: raw.project_id ? String(raw.project_id) : undefined,
        location: raw.location,
        elementtype: raw.elementtype,
        fk_element: raw.fk_element ? String(raw.fk_element) : undefined,
        fulldayevent: raw.fulldayevent,
        priority: raw.priority,
        transparency: raw.transparency,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapUser(raw: any) {
    return {
        id: String(raw.id),
        login: raw.login,
        firstname: raw.firstname,
        lastname: raw.lastname,
        email: raw.email,
        job: raw.job,
        phone_mobile: raw.phone_mobile,
        photo: raw.photo,
        admin: raw.admin,
        statut: raw.statut,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapSupplierOrder(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        socid: raw.fk_soc ? String(raw.fk_soc) : '',
        date_creation: raw.date_creation ? new Date(raw.date_creation).getTime() : 0,
        date_livraison: raw.date_livraison ? new Date(raw.date_livraison).getTime() : undefined,
        total_ttc: parseFloat(raw.total_ttc || '0'),
        statut: String(raw.statut),
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapIntervention(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        socid: raw.socid ? String(raw.socid) : '',
        project_id: raw.project_id ? String(raw.project_id) : undefined,
        date: raw.date ? new Date(raw.date).getTime() : 0,
        date_creation: raw.date_creation ? new Date(raw.date_creation).getTime() : 0,
        duration: raw.duration,
        description: raw.description,
        statut: String(raw.statut),
        fk_user_author: raw.fk_user_author ? String(raw.fk_user_author) : undefined,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapExpenseReport(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        fk_user_author: raw.fk_user_author ? String(raw.fk_user_author) : '',
        total_ttc: parseFloat(raw.total_ttc || '0'),
        date_debut: raw.date_debut ? new Date(raw.date_debut).getTime() : 0,
        date_fin: raw.date_fin ? new Date(raw.date_fin).getTime() : 0,
        statut: String(raw.statut),
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapJobPosition(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        label: raw.label,
        description: raw.description,
        rem_min: raw.rem_min,
        rem_max: raw.rem_max,
        status: String(raw.status),
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapTicket(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        track_id: raw.track_id,
        subject: raw.subject,
        message: raw.message,
        type_code: raw.type_code,
        category_code: raw.category_code,
        severity_code: raw.severity_code,
        statut: String(raw.statut),
        progress: raw.progress,
        socid: raw.socid ? String(raw.socid) : undefined,
        project_id: raw.project_id ? String(raw.project_id) : undefined,
        fk_user_assign: raw.fk_user_assign ? String(raw.fk_user_assign) : undefined,
        origin_email: raw.origin_email,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapWarehouse(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        label: raw.label,
        description: raw.description,
        statut: raw.statut,
        lieu: raw.lieu,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapStockMovement(raw: any) {
    return {
        id: String(raw.id),
        datem: raw.datem ? new Date(raw.datem).getTime() : 0,
        fk_product: raw.fk_product ? String(raw.fk_product) : '',
        fk_entrepot: raw.fk_entrepot ? String(raw.fk_entrepot) : '',
        value: parseFloat(raw.value || '0'),
        type_mouvement: raw.type_mouvement,
        label: raw.label,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapCandidate(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        firstname: raw.firstname,
        lastname: raw.lastname,
        email: raw.email,
        phone: raw.phone,
        date_birth: raw.date_birth ? new Date(raw.date_birth).getTime() : undefined,
        status: String(raw.status),
        fk_job_position: raw.fk_job_position ? String(raw.fk_job_position) : '',
        note_public: raw.note_public,
        date_creation: raw.datec ? new Date(raw.datec).getTime() : 0,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapLeaveRequest(raw: any) {
    return {
        id: String(raw.id),
        type: raw.type,
        halfday: raw.halfday,
        date_debut: raw.date_debut ? new Date(raw.date_debut).getTime() : 0,
        date_fin: raw.date_fin ? new Date(raw.date_fin).getTime() : 0,
        description: raw.description,
        fk_user: raw.fk_user ? String(raw.fk_user) : '',
        statut: String(raw.statut),
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapContract(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        date_contrat: raw.date_contrat ? new Date(raw.date_contrat).getTime() : 0,
        date_fin_validite: raw.date_fin_validite ? new Date(raw.date_fin_validite).getTime() : undefined,
        statut: String(raw.statut),
        socid: raw.socid ? String(raw.socid) : '',
        project_id: raw.project_id ? String(raw.project_id) : undefined,
        note_public: raw.note_public,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapPayment(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        date_payment: raw.date_payment ? new Date(raw.date_payment).getTime() : 0,
        amount: parseFloat(raw.amount || '0'),
        fk_bank: raw.fk_bank ? String(raw.fk_bank) : '',
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapSupplierPayment(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        date_payment: raw.date_payment ? new Date(raw.date_payment).getTime() : 0,
        amount: parseFloat(raw.amount || '0'),
        fk_bank: raw.fk_bank ? String(raw.fk_bank) : '',
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapBOM(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        label: raw.label,
        description: raw.description,
        duration: raw.duration,
        efficiency: raw.efficiency,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

function mapManufacturingOrder(raw: any) {
    return {
        id: String(raw.id),
        ref: raw.ref,
        label: raw.label,
        status: raw.status,
        product_to_produce_id: raw.product_to_produce_id ? String(raw.product_to_produce_id) : undefined,
        qty: parseFloat(raw.qty || '0'),
        date_start: raw.date_start ? new Date(raw.date_start).getTime() : undefined,
        date_end: raw.date_end ? new Date(raw.date_end).getTime() : undefined,
        project_id: raw.project_id ? String(raw.project_id) : undefined,
        date_modification: raw.tms ? new Date(raw.tms).getTime() : 0,
    };
}

/**
 * Execute background sync for all modules
 */
export async function runBackgroundSync(config: DolibarrConfig): Promise<{ synced: number; errors: string[] }> {
    const errors: string[] = [];
    let synced = 0;

    console.log('[BackgroundSync] Starting full background sync for', SYNC_MODULES.length, 'modules...');

    for (const module of SYNC_MODULES) {
        try {
            // 1. Get watermark for this store
            const lastModified = await dbService.getLastModified(module.store, 'date_modification');
            console.log(`[BackgroundSync] ${module.type}: watermark=${lastModified}`);

            // 2. Fetch delta from API
            const delta = await DolibarrService.fetchDelta(config, module.type, lastModified);

            if (delta.length > 0) {
                // 3. Map data (use type assertion to handle varied return types)
                const mappedData = delta.map((item: any) => module.mapFn(item));

                // 4. Upsert to IndexedDB
                await dbService.upsertAll(module.store, mappedData);
                synced += delta.length;

                console.log(`[BackgroundSync] ✅ ${module.type}: Synced ${delta.length} records to ${module.store}`);
            } else {
                console.log(`[BackgroundSync] ⏭️ ${module.type}: No new data (delta empty)`);
            }
        } catch (error: any) {
            const errorMsg = `${module.type}: ${error.message || 'Unknown error'}`;
            errors.push(errorMsg);
            console.error(`[BackgroundSync] ❌ Error syncing ${module.type}:`, error.message || error);
        }
    }

    console.log(`[BackgroundSync] Complete. Synced ${synced} records total.`);
    if (errors.length > 0) {
        console.warn('[BackgroundSync] Errors encountered:', errors);
    }

    return { synced, errors };
}

export const backgroundSyncService = {
    runBackgroundSync
};
