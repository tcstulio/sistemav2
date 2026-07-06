import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';

const log = createLogger('GcScheduler');

/**
 * Scheduler do GC de Worktrees (issue #1112) — implementa o "cron do backend" da seção
 * de Agendamento da spec. Nasce do incidente 2026-07-06 (110 worktrees órfãos).
 *
 * Padrão IDÊNTICO ao alertCronService (issue #491): setInterval de 1min + avaliação
 * por-tick + dedup por slot (minuto-alvo), SEM node-cron. Resiliente a restarts e a
 * mudanças de config (horário relido a cada tick via env).
 *
 * O GC em si roda em SUBPROCESSO ISOLADO (scripts/gc-worktrees.ts via `npm run gc:worktrees`
 * ou `npx tsx`): um crash/falha no GC NUNCA derruba o backend. O runner é injetável
 * (setGcRunner) para testes determinísticos sem spawn real.
 *
 * Config (env):
 *  - GC_SCHEDULE_ENABLED  (default: true)  — liga/desliga o agendamento sem tocar o ticker.
 *  - GC_SCHEDULE_TIME     (default: "03:00") — horário diário (HH:MM, 24h, local) do disparo.
 *  - GC_REPO_ROOT         (opcional)        — repo root onde scripts/gc-worktrees.ts vive.
 */

export interface DailySchedule {
    hour: number; // 0-23
    minute: number; // 0-59
}

export const DEFAULT_GC_SCHEDULE_TIME = '03:00';
/** Ticker de 1min (mesma granularidade do alertCronService). */
export const GC_TICKER_INTERVAL_MS = 60 * 1000;
/** Guarda o runner injetável p/ testes. Default spawna o subprocesso isolado. */
let gcRunner: () => Promise<GcSpawnResult> = defaultGcRunner;

export interface GcSpawnResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface ShouldRunResult {
    run: boolean;
    reason: string;
    slot: string;
}

export interface CheckAndRunResult extends ShouldRunResult {
    ran?: boolean;
    exitCode?: number;
    durationMs?: number;
    error?: string;
}

/** True se o env NÃO desabilitou explicitamente o scheduler (default: habilitado). */
export function isScheduleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const v = (env.GC_SCHEDULE_ENABLED ?? '').toString().toLowerCase().trim();
    if (v === '') return true;
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Resolve o horário diário configurado (default "03:00"). */
export function resolveScheduleTime(env: NodeJS.ProcessEnv = process.env): string {
    return (env.GC_SCHEDULE_TIME ?? DEFAULT_GC_SCHEDULE_TIME).toString().trim();
}

/** Parse "HH:MM" (24h, padding flexível: "3:5" → 03:05). null se inválido. */
export function parseDailySchedule(input: string | undefined | null): DailySchedule | null {
    if (!input) return null;
    const m = input.trim().match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return null;
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 0 || hour > 23) return null;
    if (minute < 0 || minute > 59) return null;
    return { hour, minute };
}

/**
 * Slot diário (YYYY-MM-DD-HH-MM, horário LOCAL). Dedup: o GC só roda UMA vez por
 * slot-alvo, mesmo se o backend restartar dentro do minuto ou o ticker disparar 2x.
 */
export function dailySlot(now: Date): string {
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${d}-${h}-${mi}`;
}

/**
 * Decide se o GC deve disparar AGORA. Dispara quando, todos simultaneamente:
 *  - enabled=true; schedule válido; hora:minuto atuais batem com o schedule;
 *  - ainda não rodou neste slot (lastRunSlot ≠ slot atual).
 * `now` é injetável p/ testes determinísticos (mesma convenção do alertCronService).
 */
export function shouldRunGcNow(
    now: Date,
    schedule: DailySchedule | null,
    opts: { enabled: boolean; lastRunSlot: string | null },
): ShouldRunResult {
    const slot = dailySlot(now);
    if (!opts.enabled) return { run: false, reason: 'disabled', slot };
    if (!schedule) return { run: false, reason: 'invalid-schedule', slot };
    if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) {
        return { run: false, reason: 'not-due', slot };
    }
    if (opts.lastRunSlot === slot) return { run: false, reason: 'already-ran', slot };
    return { run: true, reason: 'due', slot };
}

/**
 * Resolve o repo root (onde scripts/gc-worktrees.ts vive). Prioridade:
 *  1) env GC_REPO_ROOT; 2) walk-up procurando scripts/gc-worktrees.ts; 3) startDir.
 */
export function resolveGcRepoRoot(env: NodeJS.ProcessEnv = process.env, startDir: string = process.cwd()): string {
    if (env.GC_REPO_ROOT) return env.GC_REPO_ROOT.toString();
    let dir = startDir;
    for (let i = 0; i < 8; i++) {
        try {
            if (fs.existsSync(path.join(dir, 'scripts', 'gc-worktrees.ts'))) return dir;
        } catch { /* ignore */ }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return startDir;
}

/** Injeta um runner fake (testes). Retorna o anterior para restauração. */
export function setGcRunner(fn: () => Promise<GcSpawnResult>): () => Promise<GcSpawnResult> {
    const prev = gcRunner;
    gcRunner = fn;
    return prev;
}

/** Restaura o runner default (spawna o subprocesso real). */
export function resetGcRunner(): void {
    gcRunner = defaultGcRunner;
}

/**
 * Runner default: spawna o GC como subprocesso isolado. Isolamento é intencional —
 * um crash no GC jamais derruba o backend. windowsHide evita janelas piscando no Task
 * Scheduler/cron diário. npx tsx resolve o runner TS sem passo de build.
 */
function defaultGcRunner(): Promise<GcSpawnResult> {
    return new Promise((resolve) => {
        const repoRoot = resolveGcRepoRoot();
        const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'scripts/gc-worktrees.ts'], {
            cwd: repoRoot,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        child.on('error', (err: Error) => {
            resolve({ exitCode: -1, stdout, stderr: stderr + String(err) });
        });
        child.on('close', (code: number | null) => {
            resolve({ exitCode: code ?? -1, stdout, stderr });
        });
    });
}

class GcSchedulerService {
    private interval: NodeJS.Timeout | null = null;
    private running = false;
    private lastRunSlot: string | null = null;
    private gcInProgress = false;

    get isRunning(): boolean {
        return this.running;
    }

    /** Liga o ticker de 1min. Idempotente (re-entrar é no-op). Não bloqueia o boot. */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.interval = setInterval(() => {
            this.checkAndRun().catch((e) => log.error('gcScheduler tick falhou', e));
        }, GC_TICKER_INTERVAL_MS);
        // unref: o ticker NÃO deve manter o processo vivo (shutdown gracioso não trava).
        if (typeof this.interval.unref === 'function') this.interval.unref();
        log.info(`GC scheduler iniciado — schedule=${resolveScheduleTime()} (habilitado=${isScheduleEnabled()})`);
    }

    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.running = false;
        log.info('GC scheduler parado');
    }

    /** Apenas para testes: limpa estado interno (lastRunSlot / mutex). */
    reset(): void {
        this.lastRunSlot = null;
        this.gcInProgress = false;
    }

    /**
     * Avalia um tick: se devido e não-executado neste slot, dispara o GC (subprocesso).
     * `now` injetável p/ testes determinísticos. Mutex interno garante no-overlap.
     */
    async checkAndRun(now: Date = new Date()): Promise<CheckAndRunResult> {
        const schedule = parseDailySchedule(resolveScheduleTime());
        const decision = shouldRunGcNow(now, schedule, {
            enabled: isScheduleEnabled(),
            lastRunSlot: this.lastRunSlot,
        });
        if (!decision.run) return decision;
        // Mutex: nunca sobrepõe duas execuções do GC (tick anterior ainda rodando).
        // Importante: lastRunSlot só é marcado APÓS o runner (no finally) — assim um
        // tick concorrente que chega durante a execução vê gc-in-progress (mutex), não
        // already-ran, dando sinal correto de "ainda rodando".
        if (this.gcInProgress) {
            return { ...decision, run: false, reason: 'gc-in-progress', ran: false };
        }
        this.gcInProgress = true;
        const start = Date.now();
        try {
            const res = await gcRunner();
            const ok = res.exitCode === 0;
            log.info(`GC rodou — exitCode=${res.exitCode} ok=${ok} (${Date.now() - start}ms)`);
            if (!ok) {
                log.warn(`GC saiu com código ${res.exitCode}${res.stderr ? `: ${res.stderr.slice(0, 200)}` : ''}`);
            }
            return { ...decision, ran: true, exitCode: res.exitCode, durationMs: Date.now() - start };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            log.error('GC runner disparou exceção', e);
            return { ...decision, ran: true, exitCode: -1, durationMs: Date.now() - start, error: msg };
        } finally {
            // Marca o slot como rodado só após o runner resolver/rejeitar: dedup contra
            // ticks subsequentes no mesmo slot, sem mascarar o mutex durante a execução.
            this.lastRunSlot = decision.slot;
            this.gcInProgress = false;
        }
    }
}

export const gcSchedulerService = new GcSchedulerService();
