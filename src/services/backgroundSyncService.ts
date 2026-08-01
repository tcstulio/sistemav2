/**
 * Background Sync Service
 *
 * Fetches all delta sync data for all modules in the background,
 * independent of which pages/components are mounted.
 * This ensures the IndexedDB has complete data for the sync monitor.
 *
 * #1040 — Modules are executed in parallel batches (default 5) using
 * `Promise.allSettled` semantics so a failure in one module never blocks
 * the others. Batch size is configurable via VITE_SYNC_BATCH_SIZE.
 */

import { DolibarrConfig } from '../types';
import { DolibarrService } from './dolibarrService';
import { dbService } from './dbService';
import * as mappers from '../hooks/dolibarr/mappers';
import { logger } from '../utils/logger';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';
import { captureException } from '../utils/sentry';

const log = logger.child('BackgroundSync');

// Module definitions for background sync
//
// Race-condition note (#1040): each entry writes to its OWN IndexedDB store, and
// `dbService.upsertAll` opens a per-call transaction scoped to that single store.
// IndexedDB allows transactions over distinct stores to run concurrently, so the
// default parallel execution is safe. If a future module ever shares a store with
// another, the conflict would only manifest inside the same transaction scope —
// and since each `upsertAll` already wraps its own writes, no extra coordination
// is needed as long as two modules don't open overlapping read+write transactions
// against the same store. Today, none do.
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
 * Parses the configured batch size from `VITE_SYNC_BATCH_SIZE`. Falls back to 5
 * when the env var is missing or invalid. The accepted range is `[1, 50]` —
 * anything outside is clamped to keep the Dolibarr API from being hammered with
 * thousands of concurrent requests.
 */
function getSyncBatchSize(): number {
    const env = (import.meta as unknown as { env?: { VITE_SYNC_BATCH_SIZE?: string } }).env;
    const raw = env?.VITE_SYNC_BATCH_SIZE;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 5;
    return Math.min(50, Math.max(1, Math.floor(parsed)));
}

export interface BackgroundSyncProgress {
    processed: number;
    total: number;
    currentModule: string;
}

export interface BackgroundSyncOptions {
    signal?: AbortSignal;
    onProgress?: (progress: BackgroundSyncProgress) => void;
    batchSize?: number;
}

export interface BackgroundSyncResult {
    synced: number;
    errors: string[];
    changes: Record<string, unknown[]>;
    durationMs: number;
}

/**
 * Result of syncing a single module. Errors are caught inside `syncOneModule`
 * and returned as a discriminated union so the parallel runner can collect
 * per-module outcomes without letting one failure short-circuit the batch
 * (`Promise.allSettled` semantics).
 */
type SyncOutcome =
    | { status: 'ok'; module: string; store: string; synced: number; mappedData: unknown[] }
    | { status: 'skipped'; module: string; store: string }
    | { status: 'error'; module: string; store: string; error: Error };

async function syncOneModule(
    config: DolibarrConfig,
    module: typeof SYNC_MODULES[number],
    signal: AbortSignal | undefined
): Promise<SyncOutcome> {
    if (signal?.aborted) {
        return { status: 'skipped', module: module.type, store: module.store };
    }

    try {
        // 1. Get watermark for this store
        const lastModified = await dbService.getLastModified(module.store, 'date_modification');

        const itemCount = await dbService.count(module.store);
        if (lastModified === 0 && itemCount > 0) {
            log.debug(`Skipping ${module.type} (has ${itemCount} items but no tms tracking)`);
            return { status: 'skipped', module: module.type, store: module.store };
        }

        // Add 1s when watermark exists to skip the boundary record
        // Convert to Unix seconds since PHP/SQL expects seconds for tms
        const watermarkMs = lastModified > 0 ? lastModified + 1000 : 0;
        const watermarkUnix = watermarkMs > 0 ? Math.floor(watermarkMs / 1000) : 0;
        log.debug(`${module.type}: watermark=${watermarkUnix} (Unix)`);

        // 2. Fetch delta from API
        const delta = await DolibarrService.fetchDelta(config, module.type, watermarkUnix);

        if (delta.length === 0) {
            return { status: 'ok', module: module.type, store: module.store, synced: 0, mappedData: [] };
        }

        // 3. Map data (use type assertion to handle varied return types)
        const mappedData = delta.map((item: unknown) => module.mapFn(item as Record<string, unknown>));

        // 4. Upsert to IndexedDB
        await dbService.upsertAll(module.store, mappedData);

        log.debug(`${module.type}: Synced ${delta.length} records to ${module.store}`);
        return { status: 'ok', module: module.type, store: module.store, synced: delta.length, mappedData };
    } catch (error) {
        const err: Error = error instanceof Error
            ? error
            : new Error(String((error as { message?: unknown })?.message ?? 'Unknown error'));
        // Report to Sentry when configured; never throws — Sentry is a no-op
        // when DSN is missing. Defensive try/catch keeps the sync loop running
        // even if a future Sentry integration misbehaves.
        try {
            captureException(err, { module: module.type, store: module.store });
        } catch {
            // ignore — Sentry failures must never break the sync loop.
        }
        log.error(`Error syncing ${module.type}: ${err.message}`);
        return { status: 'error', module: module.type, store: module.store, error: err };
    }
}

/**
 * Execute background sync for all modules in parallel batches (#1040).
 *
 * - Modules run concurrently up to `batchSize` at a time (default 5, configurable
 *   via `VITE_SYNC_BATCH_SIZE` or the explicit `options.batchSize`).
 * - Per-module errors are isolated via `Promise.allSettled` semantics: one
 *   failure never blocks the remaining modules and is reported through
 *   `result.errors` and Sentry (when configured).
 * - Progress is emitted through `options.onProgress` after each module finishes
 *   (success, skip or error).
 * - The total elapsed time is measured and returned in `result.durationMs` and
 *   logged at info-level for before/after comparison.
 *
 * Abort behaviour: when `options.signal` aborts, in-flight modules complete but
 * queued ones are skipped. `result.errors` may still contain errors raised by
 * modules that started before the abort.
 */
export async function runBackgroundSync(
    config: DolibarrConfig,
    signalOrOptions?: AbortSignal | BackgroundSyncOptions
): Promise<BackgroundSyncResult> {
    const options: BackgroundSyncOptions = isAbortSignalLike(signalOrOptions)
        ? { signal: signalOrOptions }
        : signalOrOptions ?? {};

    const { signal, onProgress, batchSize } = options;
    const errors: string[] = [];
    const changes: Record<string, unknown[]> = {};
    let synced = 0;
    const totalModules = SYNC_MODULES.length;
    const effectiveBatchSize = batchSize ?? getSyncBatchSize();

    log.debug(`Starting full background sync for ${totalModules} modules (batchSize=${effectiveBatchSize})...`);

    const startedAt = now();

    // Bounded-concurrency runner. `mapWithConcurrency` itself guarantees at most
    // `effectiveBatchSize` modules in flight at any moment, so we don't need to
    // additionally slice the module list into batches — that would be redundant.
    let processed = 0;
    const outcomes = await mapWithConcurrency(SYNC_MODULES, effectiveBatchSize, async (mod) => {
        const outcome = await syncOneModule(config, mod, signal);
        processed += 1;
        onProgress?.({
            processed,
            total: totalModules,
            currentModule: mod.type,
        });
        return outcome;
    });

    for (const outcome of outcomes) {
        if (outcome.status === 'ok') {
            if (outcome.synced > 0) {
                synced += outcome.synced;
                changes[outcome.store] = outcome.mappedData;
            }
        } else if (outcome.status === 'error') {
            errors.push(`${outcome.module}: ${outcome.error.message || 'Unknown error'}`);
        }
        // 'skipped' modules contribute neither records nor errors.
    }

    const durationMs = Math.round(now() - startedAt);
    log.info(`Background sync complete in ${durationMs}ms. Synced ${synced} records across ${totalModules} modules.`);
    if (errors.length > 0) {
        log.warn(`Background sync errors (${errors.length})`, errors);
    }

    return { synced, errors, changes, durationMs };
}

function isAbortSignalLike(value: unknown): value is AbortSignal {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { aborted?: unknown; addEventListener?: unknown };
    return typeof candidate.aborted === 'boolean' && typeof candidate.addEventListener === 'function';
}

function now(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

export const backgroundSyncService = {
    runBackgroundSync
};
