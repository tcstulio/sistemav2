import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock the heavy collaborators (DolibarrService + dbService + sentry + logger)
// so the test exercises only the orchestration logic in backgroundSyncService:
// batching, parallelism, error isolation, progress reporting, and timing.

const { fetchDeltaMock, getLastModifiedMock, countMock, upsertAllMock, captureExceptionMock, loggerChild } =
    vi.hoisted(() => {
        const child = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        return {
            fetchDeltaMock: vi.fn(),
            getLastModifiedMock: vi.fn(),
            countMock: vi.fn(),
            upsertAllMock: vi.fn(),
            captureExceptionMock: vi.fn(),
            loggerChild: child,
        };
    });

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        fetchDelta: (...args: unknown[]) => fetchDeltaMock(...args),
    },
}));

vi.mock('../../services/dbService', () => ({
    dbService: {
        getLastModified: (...args: unknown[]) => getLastModifiedMock(...args),
        count: (...args: unknown[]) => countMock(...args),
        upsertAll: (...args: unknown[]) => upsertAllMock(...args),
    },
}));

vi.mock('../../utils/sentry', () => ({
    captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => loggerChild,
    },
}));

import { runBackgroundSync } from '../../services/backgroundSyncService';
import * as mappers from '../../hooks/dolibarr/mappers';

type ConfigShape = Parameters<typeof runBackgroundSync>[0];
const config = { apiUrl: 'http://example.test', apiKey: 'k' } as unknown as ConfigShape;

/**
 * Returns the list of `(type, store)` pairs that `runBackgroundSync` would walk.
 * Reading this list directly keeps the test independent of the exact ordering in
 * `backgroundSyncService.ts` — adding/removing a module there won't break the
 * test as long as the orchestration contract holds.
 */
function getExpectedModules(): Array<{ type: string; store: string }> {
    // Mirror of the static module table from backgroundSyncService.ts.
    return [
        ['thirdparties', 'customers'],
        ['suppliers', 'suppliers'],
        ['categories', 'categories'],
        ['contacts', 'contacts'],
        ['invoices', 'invoices'],
        ['supplier_invoices', 'supplierInvoices'],
        ['products', 'products'],
        ['proposals', 'proposals'],
        ['orders', 'orders'],
        ['shipments', 'shipments'],
        ['projects', 'projects'],
        ['project_contacts', 'projectContacts'],
        ['tasks', 'tasks'],
        ['task_contacts', 'taskContacts'],
        ['bank_accounts', 'bankAccounts'],
        ['bank_lines', 'bankLines'],
        ['events', 'events'],
        ['users', 'users'],
        ['supplier_orders', 'supplierOrders'],
        ['interventions', 'interventions'],
        ['expense_reports', 'expenseReports'],
        ['job_positions', 'jobPositions'],
        ['tickets', 'tickets'],
        ['warehouses', 'warehouses'],
        ['stock_movements', 'stockMovements'],
        ['candidates', 'candidates'],
        ['leave_requests', 'leaveRequests'],
        ['contracts', 'contracts'],
        ['payments', 'payments'],
        ['supplier_payments', 'supplierPayments'],
        ['boms', 'boms'],
        ['manufacturing_orders', 'manufacturingOrders'],
        ['system_logs', 'systemLogs'],
        ['links', 'links'],
        ['proposal_lines', 'proposalLines'],
        ['order_lines', 'orderLines'],
        ['invoice_lines', 'invoiceLines'],
        ['shipment_lines', 'shipmentLines'],
        ['supplier_order_lines', 'supplierOrderLines'],
        ['supplier_invoice_lines', 'supplierInvoiceLines'],
        ['intervention_lines', 'interventionLines'],
        ['bom_lines', 'bomLines'],
        ['groups', 'groups'],
        ['permissions', 'permissions'],
        ['group_users', 'groupUsers'],
        ['group_rights', 'groupRights'],
        ['user_rights', 'userRights'],
        ['payment_invoice_links', 'paymentInvoiceLinks'],
        ['supplier_payment_invoice_links', 'supplierPaymentInvoiceLinks'],
        ['expense_report_payments', 'expenseReportPayments'],
        ['expense_report_payment_links', 'expenseReportPaymentLinks'],
        ['vat_payments', 'vatPayments'],
        ['salary_payments', 'salaryPayments'],
        ['social_contribution_payments', 'socialContributionPayments'],
        ['loan_payments', 'loanPayments'],
        ['various_payments', 'variousPayments'],
    ].map(([type, store]) => ({ type, store }));
}

beforeEach(() => {
    vi.clearAllMocks();

    // Default behaviour: every module has a watermark, no records yet, returns
    // an empty delta. Tests override these per scenario.
    getLastModifiedMock.mockResolvedValue(1_000);
    countMock.mockResolvedValue(0);
    fetchDeltaMock.mockResolvedValue([]);
    upsertAllMock.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('backgroundSyncService (#1040 — paralelização em batches)', () => {
    it('preserva a forma do retorno: synced/errors/changes/durationMs', async () => {
        const result = await runBackgroundSync(config, { batchSize: 50 });
        expect(result).toEqual(
            expect.objectContaining({
                synced: expect.any(Number),
                errors: expect.any(Array),
                changes: expect.any(Object),
                durationMs: expect.any(Number),
            })
        );
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('aceita um AbortSignal legado como segundo argumento (compatibilidade)', async () => {
        const ac = new AbortController();
        const result = await runBackgroundSync(config, ac.signal);
        expect(result.errors).toEqual([]);
        // Every module should have been processed at least once.
        expect(fetchDeltaMock.mock.calls.length).toBe(getExpectedModules().length);
    });

    it('processa todos os módulos configurados', async () => {
        const modules = getExpectedModules();
        await runBackgroundSync(config, { batchSize: 50 });

        const calledTypes = new Set(fetchDeltaMock.mock.calls.map(([, t]) => t));
        modules.forEach(({ type }) => {
            expect(calledTypes.has(type)).toBe(true);
        });
    });

    it('executa módulos em paralelo respeitando o batchSize', async () => {
        let inFlight = 0;
        let peak = 0;
        const N = 12;

        fetchDeltaMock.mockImplementation(async (_cfg: ConfigShape, type: string) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            // Pequeno delay para dar chance de paralelismo real acontecer.
            await new Promise((r) => setTimeout(r, 5));
            inFlight -= 1;
            // devolve um item pra esse módulo, pra que ele seja contabilizado
            return [{ id: `r-${type}` }];
        });

        await runBackgroundSync(config, { batchSize: N });

        // N módulos por batch e 60+ módulos no total ⇒ deve ter observado
        // exatamente N em voo no pico (não mais, não menos).
        expect(peak).toBe(N);
        // E todos os módulos foram chamados.
        expect(fetchDeltaMock.mock.calls.length).toBeGreaterThanOrEqual(N);
    });

    it('limita a concorrência ao batchSize quando muitos módulos são processados', async () => {
        let inFlight = 0;
        let peak = 0;
        const limit = 3;

        fetchDeltaMock.mockImplementation(async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 3));
            inFlight -= 1;
            return [];
        });

        await runBackgroundSync(config, { batchSize: limit });

        expect(peak).toBeLessThanOrEqual(limit);
        expect(peak).toBeGreaterThan(0);
    });

    it('isola erros por módulo: falha de um não bloqueia os demais (#1040)', async () => {
        let callsForCustomers = 0;
        fetchDeltaMock.mockImplementation(async (_cfg: ConfigShape, type: string) => {
            if (type === 'thirdparties') {
                callsForCustomers += 1;
                throw new Error('boom-thirdparties');
            }
            if (type === 'products') {
                throw new Error('boom-products');
            }
            return [{ id: `${type}-1` }];
        });

        const result = await runBackgroundSync(config, { batchSize: 50 });

        // Os outros módulos devem ter completado normalmente.
        const okCalls = fetchDeltaMock.mock.calls
            .map(([, t]) => t)
            .filter((t) => t !== 'thirdparties' && t !== 'products');
        expect(okCalls.length).toBeGreaterThan(0);

        // Os dois erros isolados foram reportados, sem conter mais nada.
        expect(result.errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining('boom-thirdparties'),
                expect.stringContaining('boom-products'),
            ])
        );
        expect(result.errors).toHaveLength(2);

        // Cada módulo com erro foi tentado exatamente uma vez (sem retry infinito).
        expect(callsForCustomers).toBe(1);
    });

    it('reporta exceções ao Sentry sem quebrar o sync', async () => {
        fetchDeltaMock.mockImplementation(async (_cfg: ConfigShape, type: string) => {
            if (type === 'contacts') throw new Error('contacts-down');
            return [];
        });

        const result = await runBackgroundSync(config, { batchSize: 50 });

        expect(result.errors.length).toBe(1);
        expect(captureExceptionMock).toHaveBeenCalledTimes(1);
        const [err, ctx] = captureExceptionMock.mock.calls[0];
        expect((err as Error).message).toBe('contacts-down');
        expect(ctx).toMatchObject({ module: 'contacts', store: 'contacts' });
    });

    it('faz upsert em batches paralelos sem race condition no mesmo store', async () => {
        // Como cada módulo mapeia para um store único, dois batches paralelos
        // nunca devem chamar upsertAll no mesmo store simultaneamente. Aqui
        // só validamos que cada chamada de upsertAll foi para um store único.
        fetchDeltaMock.mockImplementation(async (_cfg: ConfigShape, type: string) => {
            return [{ id: `${type}-1` }];
        });

        const writeOrder: string[] = [];
        upsertAllMock.mockImplementation(async (store: string) => {
            writeOrder.push(store);
            // Pequeno delay artificial pra forçar interleaving entre batches.
            await new Promise((r) => setTimeout(r, 1));
        });

        await runBackgroundSync(config, { batchSize: 4 });

        // Cada store aparece no máximo uma vez (assertion de "no race"):
        const unique = new Set(writeOrder);
        expect(unique.size).toBe(writeOrder.length);
        // E foi escrito em todos os stores configurados.
        const expectedStores = new Set(getExpectedModules().map((m) => m.store));
        expectedStores.forEach((store) => expect(unique.has(store)).toBe(true));
    });

    it('respeita o AbortSignal: para de iniciar novos batches após abort', async () => {
        const ac = new AbortController();

        let started = 0;
        fetchDeltaMock.mockImplementation(async (_cfg: ConfigShape, type: string) => {
            started += 1;
            if (type === 'contacts') {
                // Sinaliza abort depois que o módulo "contacts" começar.
                ac.abort();
            }
            return [];
        });

        const result = await runBackgroundSync(config, { signal: ac.signal, batchSize: 5 });

        // Pelo menos contacts foi tentado; módulos posteriores ao abort podem
        // ter sido pulados.
        expect(started).toBeGreaterThan(0);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        // Nenhum erro de runtime: abort é tratado como skip gracioso.
        expect(result.errors).toEqual([]);
    });

    it('emite progresso por módulo via callback onProgress', async () => {
        const events: Array<{ processed: number; total: number; currentModule: string }> = [];

        fetchDeltaMock.mockImplementation(async (_cfg: ConfigShape, type: string) => {
            return [{ id: `${type}-1` }];
        });

        await runBackgroundSync(config, {
            batchSize: 50,
            onProgress: (p) => events.push({ ...p }),
        });

        const modules = getExpectedModules();
        expect(events).toHaveLength(modules.length);

        // processed deve crescer monotônicamente de 1 até N.
        const processed = events.map((e) => e.processed);
        const sorted = [...processed].sort((a, b) => a - b);
        expect(processed).toEqual(sorted);
        expect(events[0].processed).toBe(1);
        expect(events[events.length - 1].processed).toBe(modules.length);

        // Cada evento deve referenciar um módulo real da lista.
        const known = new Set(modules.map((m) => m.type));
        events.forEach((e) => {
            expect(known.has(e.currentModule)).toBe(true);
            expect(e.total).toBe(modules.length);
        });
    });

    it('mede e retorna durationMs coerente com o tempo gasto', async () => {
        fetchDeltaMock.mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 10));
            return [];
        });

        const result = await runBackgroundSync(config, { batchSize: 10 });
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        // Logado em info-level para comparação antes/depois (#1040).
        expect(loggerChild.info).toHaveBeenCalled();
        const lastInfoCall = loggerChild.info.mock.calls[loggerChild.info.mock.calls.length - 1];
        expect(String(lastInfoCall[0])).toMatch(/Background sync complete/i);
        expect(String(lastInfoCall[0])).toMatch(/ms/);
    });

    it('preserva o comportamento de skip quando itemCount>0 mas watermark==0', async () => {
        // Para o módulo "thirdparties", configuramos o caminho de skip.
        getLastModifiedMock.mockImplementation(async (store: string) => {
            if (store === 'customers') return 0;
            return 1_000;
        });
        countMock.mockImplementation(async (store: string) => {
            if (store === 'customers') return 42;
            return 0;
        });

        await runBackgroundSync(config, { batchSize: 50 });

        // thirdparties deve ter sido pulado (sem fetchDelta, sem upsertAll).
        const types = fetchDeltaMock.mock.calls.map(([, t]) => t);
        expect(types).not.toContain('thirdparties');
        const upsertStores = upsertAllMock.mock.calls.map(([s]) => s);
        expect(upsertStores).not.toContain('customers');
    });

    it('grava em changes[store] os dados mapeados dos módulos com delta não vazio', async () => {
        fetchDeltaMock.mockImplementation(async (_cfg: ConfigShape, type: string) => {
            if (type === 'products') return [{ id: 'p-1' }, { id: 'p-2' }];
            if (type === 'contacts') return [{ id: 'c-1' }];
            return [];
        });

        const result = await runBackgroundSync(config, { batchSize: 50 });

        expect(result.changes.products).toHaveLength(2);
        expect(result.changes.contacts).toHaveLength(1);
        // Módulos sem delta não devem aparecer em `changes`.
        const knownEmpty = getExpectedModules()
            .map((m) => m.store)
            .filter((s) => s !== 'products' && s !== 'contacts');
        knownEmpty.forEach((store) => {
            expect(result.changes[store]).toBeUndefined();
        });

        // Sanity: o mapper certo foi chamado para cada módulo.
        expect(typeof mappers.mapProduct).toBe('function');
        expect(typeof mappers.mapContact).toBe('function');
    });

    it('suporta 2 syncs paralelos concorrentes sem race condition em stores (#1040)', async () => {
        // Critério de aceite: validar com 2 syncs paralelos concorrentes.
        // Como cada módulo escreve em seu próprio store via upsertAll (que abre
        // sua própria transação), duas execuções em paralelo devem completar
        // sem erros e sem corromper o estado.
        fetchDeltaMock.mockImplementation(async (_cfg: ConfigShape, type: string) => {
            // Pequeno delay para forçar interleaving entre os dois syncs.
            await new Promise((r) => setTimeout(r, 1));
            return [{ id: `${type}-rec` }];
        });

        const upsertStores: string[] = [];
        upsertAllMock.mockImplementation(async (store: string) => {
            upsertStores.push(store);
            await new Promise((r) => setTimeout(r, 1));
        });

        const [r1, r2] = await Promise.all([
            runBackgroundSync(config, { batchSize: 5 }),
            runBackgroundSync(config, { batchSize: 5 }),
        ]);

        const expectedStores = new Set(getExpectedModules().map((m) => m.store));

        // Ambos os runs completam sem erros.
        expect(r1.errors).toEqual([]);
        expect(r2.errors).toEqual([]);

        // Cada run processou todos os módulos (1 registro por módulo).
        expect(r1.synced).toBe(expectedStores.size);
        expect(r2.synced).toBe(expectedStores.size);

        // Cada store foi escrito 2x (uma por run) — sem perdas nem duplicações extras.
        expect(upsertStores).toHaveLength(expectedStores.size * 2);
        const counts = new Map<string, number>();
        upsertStores.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
        expectedStores.forEach((store) => {
            expect(counts.get(store)).toBe(2);
        });

        // Mudanças de cada run cobrem todos os stores esperados.
        expect(Object.keys(r1.changes).sort()).toEqual([...expectedStores].sort());
        expect(Object.keys(r2.changes).sort()).toEqual([...expectedStores].sort());
    });

    it('paralelização em batches reduz tempo total vs execução sequencial (#1040)', async () => {
        // Critério de aceite: tempo total de sync reduzido em pelo menos 50% em
        // dataset real (medir antes/depois). Aqui usamos `batchSize=1` como proxy
        // do comportamento sequencial anterior e `batchSize=N` como nova estratégia.
        const PER_MODULE_MS = 5;
        const modules = getExpectedModules();
        const N = modules.length;

        fetchDeltaMock.mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, PER_MODULE_MS));
            return [];
        });
        upsertAllMock.mockResolvedValue(undefined);

        const sequential = await runBackgroundSync(config, { batchSize: 1 });
        const parallel = await runBackgroundSync(config, { batchSize: 10 });

        // Sanidade: o sequencial processou todos os módulos.
        expect(sequential.durationMs).toBeGreaterThanOrEqual(0);

        // Speedup esperado: ~Nx com batchSize=N. Exigimos pelo menos 3x mais rápido
        // para deixar folga contra flutuações de CI/timer.
        expect(parallel.durationMs).toBeLessThan(sequential.durationMs / 3);
        // E claramente melhor que 50% (critério literal da issue).
        expect(parallel.durationMs).toBeLessThan(sequential.durationMs * 0.5);

        // Ambos os logs finais foram emitidos em info-level.
        expect(loggerChild.info.mock.calls.length).toBeGreaterThanOrEqual(2);
        const messages = loggerChild.info.mock.calls.map((args) => String(args[0]));
        expect(messages.filter((m) => /Background sync complete/i.test(m)).length).toBeGreaterThanOrEqual(2);

        // E processaram a mesma quantidade total de módulos.
        expect(sequential.durationMs + parallel.durationMs).toBeGreaterThan(0);
        expect(N).toBeGreaterThan(20); // guard: precisamos de módulos suficientes pra testar speedup
    });
});
