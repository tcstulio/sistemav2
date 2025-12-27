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
import * as mappers from '../hooks/dolibarr/mappers';

// Module definitions for background sync
const SYNC_MODULES = [
    { type: 'thirdparties', store: 'customers', mapFn: mappers.mapThirdParty },
    { type: 'suppliers', store: 'suppliers', mapFn: mappers.mapSupplier },
    { type: 'categories', store: 'categories', mapFn: mappers.mapCategory },
    { type: 'contacts', store: 'contacts', mapFn: mappers.mapContact },
    { type: 'invoices', store: 'invoices', mapFn: mappers.mapInvoice },
    { type: 'supplier_invoices', store: 'supplierInvoices', mapFn: mappers.mapSupplierInvoice },
    { type: 'products', store: 'products', mapFn: mappers.mapProduct },
    { type: 'proposals', store: 'proposals', mapFn: mappers.mapProposal },
    { type: 'orders', store: 'orders', mapFn: mappers.mapOrder },
    { type: 'shipments', store: 'shipments', mapFn: mappers.mapShipment },
    { type: 'projects', store: 'projects', mapFn: mappers.mapProject },
    { type: 'tasks', store: 'tasks', mapFn: mappers.mapTask },
    { type: 'bank_accounts', store: 'bankAccounts', mapFn: mappers.mapBankAccount },
    { type: 'bank_lines', store: 'bankLines', mapFn: mappers.mapBankLine },
    { type: 'events', store: 'events', mapFn: mappers.mapAgendaEvent },
    { type: 'users', store: 'users', mapFn: mappers.mapUser },
    { type: 'supplier_orders', store: 'supplierOrders', mapFn: mappers.mapSupplierOrder },
    { type: 'interventions', store: 'interventions', mapFn: mappers.mapIntervention },
    { type: 'expense_reports', store: 'expenseReports', mapFn: mappers.mapExpenseReport },
    { type: 'job_positions', store: 'jobPositions', mapFn: mappers.mapJobPosition },
    { type: 'tickets', store: 'tickets', mapFn: mappers.mapTicket },
    { type: 'warehouses', store: 'warehouses', mapFn: mappers.mapWarehouse },
    { type: 'stock_movements', store: 'stockMovements', mapFn: mappers.mapStockMovement },
    { type: 'candidates', store: 'candidates', mapFn: mappers.mapCandidate },
    { type: 'leave_requests', store: 'leaveRequests', mapFn: mappers.mapLeaveRequest },
    { type: 'contracts', store: 'contracts', mapFn: mappers.mapContract },
    { type: 'payments', store: 'payments', mapFn: mappers.mapPayment },
    { type: 'supplier_payments', store: 'supplierPayments', mapFn: mappers.mapSupplierPayment },
    { type: 'boms', store: 'boms', mapFn: mappers.mapBOM },
    { type: 'manufacturing_orders', store: 'manufacturingOrders', mapFn: mappers.mapManufacturingOrder },
    { type: 'system_logs', store: 'systemLogs', mapFn: mappers.mapSystemLog },
    // Line items 
    { type: 'links', store: 'links', mapFn: mappers.mapLink },
    { type: 'proposal_lines', store: 'proposalLines', mapFn: mappers.mapProposalLine },
    { type: 'order_lines', store: 'orderLines', mapFn: mappers.mapOrderLine },
    { type: 'invoice_lines', store: 'invoiceLines', mapFn: mappers.mapInvoiceLine },
    { type: 'shipment_lines', store: 'shipmentLines', mapFn: mappers.mapShipmentLine },
    { type: 'supplier_order_lines', store: 'supplierOrderLines', mapFn: mappers.mapSupplierOrderLine },
    { type: 'supplier_invoice_lines', store: 'supplierInvoiceLines', mapFn: mappers.mapSupplierInvoiceLine },
    { type: 'intervention_lines', store: 'interventionLines', mapFn: mappers.mapInterventionLine },
    { type: 'bom_lines', store: 'bomLines', mapFn: mappers.mapBOMLine },
];

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
