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
import { logger } from '../utils/logger';

const log = logger.child('BackgroundSync');

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
    { type: 'project_contacts', store: 'projectContacts', mapFn: mappers.mapProjectContact },
    { type: 'tasks', store: 'tasks', mapFn: mappers.mapTask },
    { type: 'task_contacts', store: 'taskContacts', mapFn: mappers.mapTaskContact },
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

    // Groups & Members
    { type: 'groups', store: 'groups', mapFn: mappers.mapUserGroup },
    { type: 'permissions', store: 'permissions', mapFn: mappers.mapPermission },
    { type: 'group_users', store: 'groupUsers', mapFn: mappers.mapGroupUser },
    { type: 'group_rights', store: 'groupRights', mapFn: mappers.mapGroupRight },
    { type: 'user_rights', store: 'userRights', mapFn: mappers.mapUserRight },

    // Additional Payment Types & Links
    { type: 'payment_invoice_links', store: 'paymentInvoiceLinks', mapFn: mappers.mapPaymentInvoiceLink },
    { type: 'supplier_payment_invoice_links', store: 'supplierPaymentInvoiceLinks', mapFn: mappers.mapSupplierPaymentInvoiceLink },
    { type: 'expense_report_payments', store: 'expenseReportPayments', mapFn: mappers.mapExpenseReportPayment },
    { type: 'expense_report_payment_links', store: 'expenseReportPaymentLinks', mapFn: mappers.mapExpenseReportPaymentLink },
    { type: 'vat_payments', store: 'vatPayments', mapFn: mappers.mapVATPayment },
    { type: 'salary_payments', store: 'salaryPayments', mapFn: mappers.mapSalaryPayment },
    { type: 'social_contribution_payments', store: 'socialContributionPayments', mapFn: mappers.mapSocialContributionPayment },
    { type: 'loan_payments', store: 'loanPayments', mapFn: mappers.mapLoanPayment },
    { type: 'various_payments', store: 'variousPayments', mapFn: mappers.mapVariousPayment },
];

/**
 * Execute background sync for all modules
 */
export async function runBackgroundSync(config: DolibarrConfig, signal?: AbortSignal): Promise<{ synced: number; errors: string[]; changes: Record<string, any[]> }> {
    const errors: string[] = [];
    const changes: Record<string, any[]> = {};
    let synced = 0;

    log.debug(`Starting full background sync for ${SYNC_MODULES.length} modules...`);

    for (const module of SYNC_MODULES) {
        // Check if sync was cancelled
        if (signal?.aborted) {
            log.debug('Background sync aborted');
            break;
        }

        try {
            // 1. Get watermark for this store
            const lastModified = await dbService.getLastModified(module.store, 'date_modification');
            // Add 1s when watermark exists to skip the boundary record
            // Convert to Unix seconds since PHP/SQL expects seconds for tms
            const watermarkMs = lastModified > 0 ? lastModified + 1000 : 0;
            const watermarkUnix = watermarkMs > 0 ? Math.floor(watermarkMs / 1000) : 0;
            log.debug(`${module.type}: watermark=${watermarkUnix} (Unix)`);

            // 2. Fetch delta from API
            const delta = await DolibarrService.fetchDelta(config, module.type, watermarkUnix);

            if (delta.length > 0) {
                // 3. Map data (use type assertion to handle varied return types)
                const mappedData = delta.map((item: any) => module.mapFn(item));

                // 4. Upsert to IndexedDB
                await dbService.upsertAll(module.store, mappedData);
                synced += delta.length;

                // 5. Record changes
                changes[module.store] = mappedData;

                log.debug(`${module.type}: Synced ${delta.length} records to ${module.store}`);
            } else {
                // console.log(`[BackgroundSync] ⏭️ ${module.type}: No new data (delta empty)`);
            }
        } catch (error: any) {
            const errorMsg = `${module.type}: ${error.message || 'Unknown error'}`;
            errors.push(errorMsg);
            log.error(`Error syncing ${module.type}: ${error.message || error}`);
        }
    }

    log.info(`Complete. Synced ${synced} records total.`);
    if (errors.length > 0) {
        log.warn('Errors encountered', errors);
    }

    return { synced, errors, changes };
}

export const backgroundSyncService = {
    runBackgroundSync
};
