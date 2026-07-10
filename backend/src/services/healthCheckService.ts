/**
 * Health Check Service (#1042)
 *
 * Verifica o status real de todas as dependências críticas do backend em paralelo,
 * com timeout por check (5s) e timeout global (10s). Expõe `checkAll()` que retorna
 * um HealthReport estruturado usado pela rota /health.
 *
 * Design:
 *  - Cada check roda em paralelo (Promise.all) → latência total ≈ max(checks).
 *  - Cada check é envolvido por um timeout de CHECK_TIMEOUT_MS.
 *  - O conjunto inteiro é envolvido por um timeout global de GLOBAL_TIMEOUT_MS
 *    (Promise.race com timer) — mesmo que uma dependência trave ignorando seu timeout,
 *    o endpoint sempre responde em ≤10s.
 *  - Checks default usam os services singletons do app; todos são injetáveis (deps)
 *    para facilitar testes unitários sem rede/certificados.
 */

import axios from 'axios';
import https from 'https';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const log = logger.child('HealthCheckService');

// =====================================
// Types
// =====================================

export type DependencyStatus = 'ok' | 'down' | 'degraded' | 'stuck' | 'not_configured';

export interface BaseCheck {
    status: DependencyStatus;
    latencyMs?: number;
    error?: string;
}

export interface WhatsappCheckResult extends BaseCheck {
    session?: string;
}

export interface SchedulerCheckResult extends BaseCheck {
    lastRun?: string;
}

export interface HealthChecks {
    dolibarr: BaseCheck;
    whatsapp: WhatsappCheckResult;
    bancoInter: BaseCheck;
    bancoItau: BaseCheck;
    scheduler: SchedulerCheckResult;
}

export type OverallStatus = 'ok' | 'degraded' | 'down';

export interface HealthReport {
    status: OverallStatus;
    checks: HealthChecks;
    timestamp: string;
}

/** Funções de check injetáveis (defaults usam os services reais do app). */
export interface HealthCheckDeps {
    checkDolibarr: () => Promise<BaseCheck>;
    checkWhatsapp: () => Promise<WhatsappCheckResult>;
    checkBancoInter: () => Promise<BaseCheck>;
    checkBancoItau: () => Promise<BaseCheck>;
    checkScheduler: () => Promise<SchedulerCheckResult>;
}

// =====================================
// Constants
// =====================================

/** Timeout por dependência (ms). */
export const CHECK_TIMEOUT_MS = 5000;
/** Timeout global do checkAll (ms) — o endpoint sempre responde em ≤ este valor. */
export const GLOBAL_TIMEOUT_MS = 10000;
/** Um worker cujo último tick foi há mais que isto é considerado "stuck". */
export const SCHEDULER_STUCK_MS = 5 * 60 * 1000; // 5 min

// =====================================
// Helpers
// =====================================

/**
 * Envolve uma promise com um timeout rejeitável. O timer é sempre limpo (finally),
 * evitando timers órfãos segurando o event loop.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
        // .unref() para não segurar o processo em shutdown gracioso.
        if (timer && typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

/** Mede o tempo (ms) de execução de uma função async. */
async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
    const start = Date.now();
    const result = await fn();
    return { result, latencyMs: Date.now() - start };
}

/**
 * Executa um check envolvendo-o no timeout por-dependência. Qualquer erro vira um
 * check `down` estruturado (nunca lança), para que um check falho não derrube os demais.
 */
async function safeCheck<T extends BaseCheck>(fn: () => Promise<T>): Promise<T> {
    try {
        return await withTimeout(fn(), CHECK_TIMEOUT_MS, 'check');
    } catch (e: any) {
        return { status: 'down', error: e?.message || 'unknown error' } as T;
    }
}

// =====================================
// Default checks (services reais do app)
// =====================================

/**
 * Dolibarr: GET {DOLIBARR_URL}/status com timeout, validando HTTP 200.
 * Usa o mesmo DOLAPIKEY e política SSL (rejectUnauthorized em produção) do dolibarrService.
 */
async function defaultCheckDolibarr(): Promise<BaseCheck> {
    const base = (config.dolibarrUrl || '').replace(/\/+$/, '');
    const url = `${base}/status`;
    const isProduction = process.env.NODE_ENV === 'production';
    const httpsAgent = new https.Agent({ rejectUnauthorized: isProduction });

    try {
        const { result: res, latencyMs } = await timed(() =>
            axios.get(url, {
                timeout: CHECK_TIMEOUT_MS,
                headers: {
                    DOLAPIKEY: config.dolibarrKey,
                    Accept: 'application/json',
                },
                httpsAgent,
                validateStatus: (s) => s < 500, // não lançar em 4xx; checamos status explicitamente
            }),
        );
        if (res.status === 200) return { status: 'ok', latencyMs };
        return { status: 'down', latencyMs, error: `HTTP ${res.status}` };
    } catch (e: any) {
        // info-level apenas (não logar stack traces em produção)
        log.info(`Dolibarr health check failed: ${e?.message || e}`);
        return { status: 'down', error: e?.code || e?.message || 'request failed' };
    }
}

/**
 * WhatsApp: consulta o sessionService existente → connected/disconnected/not_configured.
 * 'WORKING' = sessão conectada; qualquer outro estado = degradado.
 */
async function defaultCheckWhatsapp(): Promise<WhatsappCheckResult> {
    // Lazy import para não carregar whatsapp-web.js no import do módulo.
    const { sessionService } = await import('./legacy/sessionService');
    const sessions: Array<{ id: string; status: string }> = sessionService.getAllSessions();
    if (sessions.length === 0) return { status: 'not_configured' };
    const connected = sessions.some((s) => s.status === 'WORKING');
    return connected
        ? { status: 'ok', session: 'connected' }
        : { status: 'degraded', session: 'disconnected' };
}

/** Um banco é "configurado" se há clientId no store cifrado OU no .env. */
async function isBankConfigured(storeKey: 'inter' | 'itau', envClientId: string): Promise<boolean> {
    try {
        const { bankingCredentialsStore } = await import('./bankingCredentialsStore');
        if (bankingCredentialsStore.getClientId(storeKey)) return true;
    } catch {
        // store indisponível — cai p/ .env
    }
    return !!envClientId;
}

/**
 * Banco Inter: se não configurado → not_configured; caso contrário verifica isReady()
 * (init mTLS+OAuth bem-sucedida). "GET /health ou similar (se configurado)" — a API Inter
 * não expõe /health público (exige mTLS), então a prontidão do client é o sinal real.
 */
async function defaultCheckBancoInter(): Promise<BaseCheck> {
    if (!(await isBankConfigured('inter', config.interClientId))) return { status: 'not_configured' };
    const { interApiService } = await import('./interApiService');
    const { result: ready, latencyMs } = await timed(async () => interApiService.isReady());
    return ready
        ? { status: 'ok', latencyMs }
        : { status: 'down', latencyMs, error: 'not initialized' };
}

/** Banco Itaú: mesmo critério do Inter. */
async function defaultCheckBancoItau(): Promise<BaseCheck> {
    if (!(await isBankConfigured('itau', config.itauClientId))) return { status: 'not_configured' };
    const { itauApiService } = await import('./itauApiService');
    const { result: ready, latencyMs } = await timed(async () => itauApiService.isReady());
    return ready
        ? { status: 'ok', latencyMs }
        : { status: 'down', latencyMs, error: 'not initialized' };
}

/**
 * Scheduler worker: se o worker não está rodando → down; se rodando mas o último tick
 * foi há > SCHEDULER_STUCK_MS → stuck; senão ok (com lastRun ISO).
 */
async function defaultCheckScheduler(): Promise<SchedulerCheckResult> {
    const { schedulerService } = await import('./schedulerService');
    if (!schedulerService.isRunning) {
        return { status: 'down', error: 'worker stopped' };
    }
    const lastRunMs: number | null = schedulerService.lastRunAt;
    // Worker acabou de iniciar e ainda não deu nenhum tick → considerado ok.
    if (lastRunMs == null) return { status: 'ok' };
    const lastRun = new Date(lastRunMs).toISOString();
    const stale = Date.now() - lastRunMs > SCHEDULER_STUCK_MS;
    return stale
        ? { status: 'stuck', lastRun, error: `last run > ${SCHEDULER_STUCK_MS / 60000}min ago` }
        : { status: 'ok', lastRun };
}

/** Deps padrão apontando para os services reais do app. */
const defaultDeps: HealthCheckDeps = {
    checkDolibarr: defaultCheckDolibarr,
    checkWhatsapp: defaultCheckWhatsapp,
    checkBancoInter: defaultCheckBancoInter,
    checkBancoItau: defaultCheckBancoItau,
    checkScheduler: defaultCheckScheduler,
};

// =====================================
// Overall status computation
// =====================================

/**
 * Calcula o status agregado:
 *  - Dolibarr/WhatsApp down (críticos) → 'down'
 *  - qualquer outro check down/stuck/degraded → 'degraded'
 *  - caso contrário → 'ok'
 *  not_configured NÃO conta como falha (dependência opcional/desligada).
 */
export function computeOverallStatus(checks: HealthChecks): OverallStatus {
    const criticalDown = checks.dolibarr.status === 'down' || checks.whatsapp.status === 'down';
    if (criticalDown) return 'down';

    const issueStatuses: DependencyStatus[] = ['down', 'stuck', 'degraded'];
    const hasIssue = (Object.values(checks) as BaseCheck[]).some((c) =>
        issueStatuses.includes(c.status),
    );
    return hasIssue ? 'degraded' : 'ok';
}

/**
 * Mapeia um HealthReport para o HTTP status code apropriado.
 *  - 503 quando "down" (sempre) ou "degraded" (se failOnDegraded=true, default).
 *  - 200 caso contrário.
 */
export function httpStatusFor(report: Pick<HealthReport, 'status'>, failOnDegraded = true): number {
    if (report.status === 'down') return 503;
    if (report.status === 'degraded' && failOnDegraded) return 503;
    return 200;
}

// =====================================
// Public API
// =====================================

/**
 * Executa todos os checks em paralelo e retorna um HealthReport.
 * Sempre resolve (nunca rejeita) dentro do timeout global.
 *
 * @param deps checks opcionais para injeção (testes).
 */
export async function checkAll(deps?: Partial<HealthCheckDeps>): Promise<HealthReport> {
    const d: HealthCheckDeps = { ...defaultDeps, ...deps };

    const runAll = async (): Promise<HealthChecks> => {
        const [dolibarr, whatsapp, bancoInter, bancoItau, scheduler] = await Promise.all([
            safeCheck(d.checkDolibarr),
            safeCheck(d.checkWhatsapp),
            safeCheck(d.checkBancoInter),
            safeCheck(d.checkBancoItau),
            safeCheck(d.checkScheduler),
        ]);
        return { dolibarr, whatsapp, bancoInter, bancoItau, scheduler };
    };

    let checks: HealthChecks;
    try {
        checks = await withTimeout(runAll(), GLOBAL_TIMEOUT_MS, 'global');
    } catch {
        // Timeout global: marca tudo como down (algum check ignorou seu próprio timeout).
        log.info('Health check global timeout reached — marking all as down');
        const down: BaseCheck = { status: 'down', error: 'global timeout' };
        checks = {
            dolibarr: { ...down },
            whatsapp: { status: 'down', session: 'unknown', error: 'global timeout' },
            bancoInter: { ...down },
            bancoItau: { ...down },
            scheduler: { status: 'down', error: 'global timeout' },
        };
    }

    return {
        status: computeOverallStatus(checks),
        checks,
        timestamp: new Date().toISOString(),
    };
}

export const healthCheckService = { checkAll, computeOverallStatus };
