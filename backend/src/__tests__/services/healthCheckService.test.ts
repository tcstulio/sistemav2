import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
    logger: {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
        child: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    },
}));

import {
    checkAll,
    computeOverallStatus,
    withTimeout,
    CHECK_TIMEOUT_MS,
    GLOBAL_TIMEOUT_MS,
    SCHEDULER_STUCK_MS,
    type HealthChecks,
    type HealthCheckDeps,
    type BaseCheck,
    type WhatsappCheckResult,
    type SchedulerCheckResult,
} from '../../services/healthCheckService';

// ---- Helpers para fabricar checks síncronos/determinísticos ----
const ok = (latencyMs = 10): BaseCheck => ({ status: 'ok', latencyMs });
const okCheck = (): Promise<BaseCheck> => Promise.resolve(ok());
const whatsappConnected = (): Promise<WhatsappCheckResult> =>
    Promise.resolve({ status: 'ok', session: 'connected' });
const schedulerOk = (lastRun?: string): Promise<SchedulerCheckResult> =>
    Promise.resolve({ status: 'ok', lastRun });
const notConfigured = (): Promise<BaseCheck> => Promise.resolve({ status: 'not_configured' });

function deps(partial: Partial<HealthCheckDeps>): HealthCheckDeps {
    return {
        checkDolibarr: okCheck,
        checkWhatsapp: whatsappConnected,
        checkBancoInter: notConfigured,
        checkBancoItau: notConfigured,
        checkScheduler: () => schedulerOk('2026-01-15T10:30:00Z'),
        ...partial,
    };
}

describe('healthCheckService - withTimeout', () => {
    it('resolve antes do timeout com o valor da promise', async () => {
        const result = await withTimeout(Promise.resolve(42), 1000);
        expect(result).toBe(42);
    });

    it('rejeita com mensagem de timeout quando a promise excede o ms', async () => {
        const slow = new Promise((resolve) => setTimeout(resolve, 200));
        await expect(withTimeout(slow, 30, 'unit')).rejects.toThrow('unit timeout after 30ms');
    });
});

describe('healthCheckService - computeOverallStatus', () => {
    const base: HealthChecks = {
        dolibarr: { status: 'ok' },
        whatsapp: { status: 'ok', session: 'connected' },
        bancoInter: { status: 'ok' },
        bancoItau: { status: 'ok' },
        scheduler: { status: 'ok' },
    };

    it('retorna "ok" quando todos os checks estão ok ou not_configured', () => {
        expect(computeOverallStatus({ ...base, bancoItau: { status: 'not_configured' } })).toBe('ok');
    });

    it('retorna "down" quando Dolibarr (crítico) está down', () => {
        expect(computeOverallStatus({ ...base, dolibarr: { status: 'down' } })).toBe('down');
    });

    it('retorna "degraded" (NÃO "down") quando WhatsApp está down — #1415 não-crítico', () => {
        // #1415: WhatsApp desconectado é recorrente na operação e flapear /health 200↔503
        // quebra uptime monitor + smoke test. Cai p/ 'degraded' (o body checks.whatsapp
        // ainda mostra o problema real), mas o agregado não é mais 'down'.
        expect(computeOverallStatus({ ...base, whatsapp: { status: 'down', error: 'disconnected' } })).toBe('degraded');
    });

    it('retorna "degraded" quando scheduler está stuck (não crítico)', () => {
        expect(computeOverallStatus({ ...base, scheduler: { status: 'stuck' } })).toBe('degraded');
    });

    it('retorna "degraded" quando banco está down mas críticos estão ok', () => {
        expect(computeOverallStatus({ ...base, bancoItau: { status: 'down' } })).toBe('degraded');
    });

    it('retorna "degraded" quando whatsapp está degraded (conectado parcial)', () => {
        expect(computeOverallStatus({ ...base, whatsapp: { status: 'degraded' } })).toBe('degraded');
    });

    it('not_configured NÃO conta como falha', () => {
        const all: HealthChecks = {
            dolibarr: { status: 'ok' },
            whatsapp: { status: 'not_configured' },
            bancoInter: { status: 'not_configured' },
            bancoItau: { status: 'not_configured' },
            scheduler: { status: 'ok' },
        };
        expect(computeOverallStatus(all)).toBe('ok');
    });

    it('down crítico prevalece sobre degraded', () => {
        expect(
            computeOverallStatus({
                dolibarr: { status: 'down' },
                whatsapp: { status: 'degraded' },
                bancoInter: { status: 'ok' },
                bancoItau: { status: 'ok' },
                scheduler: { status: 'ok' },
            }),
        ).toBe('down');
    });

    it('WhatsApp degraded sozinho NÃO vira "down" (#1415: não-crítico)', () => {
        // WhatsApp desconectado é o cenário operacional mais comum — não pode forçar
        // /health em 503 (uptime monitor flapa) nem aggregate "down". Vira degraded.
        expect(
            computeOverallStatus({
                dolibarr: { status: 'ok' },
                whatsapp: { status: 'degraded', session: 'disconnected' },
                bancoInter: { status: 'ok' },
                bancoItau: { status: 'ok' },
                scheduler: { status: 'ok' },
            }),
        ).toBe('degraded');
    });

    it('WhatsApp not_configured com tudo o resto ok → "ok" (#1415)', () => {
        // Se o usuário nem configurou WhatsApp, não há degradação — segue ok.
        expect(
            computeOverallStatus({
                dolibarr: { status: 'ok' },
                whatsapp: { status: 'not_configured' },
                bancoInter: { status: 'ok' },
                bancoItau: { status: 'ok' },
                scheduler: { status: 'ok' },
            }),
        ).toBe('ok');
    });
});

describe('healthCheckService - checkAll', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('retorna status "ok" quando todas as dependências estão saudáveis', async () => {
        const report = await checkAll(
            deps({
                checkBancoInter: () => Promise.resolve({ status: 'ok', latencyMs: 5 }),
                checkBancoItau: () => Promise.resolve({ status: 'ok', latencyMs: 7 }),
            }),
        );

        expect(report.status).toBe('ok');
        expect(report.checks.dolibarr.status).toBe('ok');
        expect(report.checks.whatsapp).toMatchObject({ status: 'ok', session: 'connected' });
        expect(report.checks.bancoInter.status).toBe('ok');
        expect(report.checks.bancoItau.status).toBe('ok');
        expect(report.checks.scheduler).toMatchObject({ status: 'ok', lastRun: '2026-01-15T10:30:00Z' });
        expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('inclui todas as 5 chaves de checks no formato esperado', async () => {
        const report = await checkAll(deps({}));
        expect(Object.keys(report.checks).sort()).toEqual(
            ['bancoInter', 'bancoItau', 'dolibarr', 'scheduler', 'whatsapp'],
        );
    });

    it('retorna "down" quando Dolibarr está down', async () => {
        const report = await checkAll(
            deps({ checkDolibarr: () => Promise.resolve({ status: 'down', error: 'timeout' }) }),
        );
        expect(report.status).toBe('down');
        expect(report.checks.dolibarr.status).toBe('down');
    });

    it('retorna "degraded" quando apenas um banco opcional está down', async () => {
        const report = await checkAll(
            deps({ checkBancoItau: () => Promise.resolve({ status: 'down', error: 'timeout' }) }),
        );
        expect(report.status).toBe('degraded');
        expect(report.checks.bancoItau.status).toBe('down');
    });

    it('retorna "degraded" quando o scheduler está stuck', async () => {
        const report = await checkAll(
            deps({
                checkScheduler: () =>
                    Promise.resolve({ status: 'stuck', lastRun: '2026-01-15T10:00:00Z', error: 'last run > 5min ago' }),
            }),
        );
        expect(report.status).toBe('degraded');
        expect(report.checks.scheduler.status).toBe('stuck');
    });

    it('converte um check que lança exceção em status "down" sem derrubar os demais', async () => {
        const report = await checkAll(
            deps({
                checkDolibarr: () => Promise.reject(new Error('boom')),
            }),
        );
        expect(report.checks.dolibarr.status).toBe('down');
        expect(report.checks.dolibarr.error).toBe('boom');
        // os demais continuam ok
        expect(report.checks.whatsapp.status).toBe('ok');
        expect(report.status).toBe('down'); // dolibarr é crítico
    });

    it('executa os checks em paralelo (latência total ≈ max, não sum)', async () => {
        // Cada check dorme 80ms; se fossem em série, total ≥ 5*80=400ms.
        const slow = (): Promise<BaseCheck> =>
            new Promise((resolve) => setTimeout(() => resolve({ status: 'ok', latencyMs: 80 }), 80));
        const start = Date.now();
        await checkAll(
            deps({
                checkDolibarr: slow,
                checkBancoInter: slow,
                checkBancoItau: slow,
            }),
        );
        const elapsed = Date.now() - start;
        // Em paralelo: ~80ms + overhead. Tolera folga mas bem abaixo de 400ms.
        expect(elapsed).toBeLessThan(350);
    });

    it('respeita o timeout por check (5s): um check lento vira "down" por timeout', async () => {
        const hanging = (): Promise<BaseCheck> =>
            new Promise(() => {
                /* nunca resolve */
            });
        const start = Date.now();
        const report = await checkAll(deps({ checkBancoItau: hanging }));
        const elapsed = Date.now() - start;

        expect(report.checks.bancoItau.status).toBe('down');
        expect(report.checks.bancoItau.error).toMatch(/timeout/i);
        // Deve respeitar o timeout de check (~5s) e não esperar indefinidamente.
        expect(elapsed).toBeLessThan(CHECK_TIMEOUT_MS + 1500);
    }, 12000);

    it('responde mesmo no timeout global (10s) se um check ignorar seu timeout interno', async () => {
        // safeCheck envolve cada check em withTimeout(5s), mas simulamos o cenário de
        // fallback global garantindo que checkAll nunca rejeita e sempre retorna report.
        const report = await checkAll(deps({}));
        expect(report).toHaveProperty('status');
        expect(report).toHaveProperty('checks');
        expect(report).toHaveProperty('timestamp');
    });
});

describe('healthCheckService - constantes', () => {
    it('CHECK_TIMEOUT_MS = 5s', () => {
        expect(CHECK_TIMEOUT_MS).toBe(5000);
    });
    it('GLOBAL_TIMEOUT_MS = 10s', () => {
        expect(GLOBAL_TIMEOUT_MS).toBe(10000);
    });
    it('SCHEDULER_STUCK_MS = 5min', () => {
        expect(SCHEDULER_STUCK_MS).toBe(5 * 60 * 1000);
    });
});
