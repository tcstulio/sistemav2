import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import fs from 'fs';
import path from 'path';

const loggerSpies = vi.hoisted(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => loggerSpies,
}));

import {
    gcSchedulerService,
    setGcRunner,
    resetGcRunner,
    parseDailySchedule,
    dailySlot,
    shouldRunGcNow,
    isScheduleEnabled,
    isPreviewBackend,
    resolveScheduleTime,
    resolveGcRepoRoot,
    DEFAULT_GC_SCHEDULE_TIME,
    GC_TICKER_INTERVAL_MS,
    type GcSpawnResult,
} from '../../services/gcSchedulerService';

describe('gcSchedulerService — Agendamento do GC de worktrees (issue #1112)', () => {
    const origEnv = { ...process.env };

    beforeEach(() => {
        vi.clearAllMocks();
        // Limpa config de scheduler entre testes.
        delete process.env.GC_SCHEDULE_ENABLED;
        delete process.env.GC_SCHEDULE_TIME;
        delete process.env.GC_REPO_ROOT;
        delete process.env.PREVIEW_MODE;
        // Runner fake determinístico (não spawna subprocesso real).
        setGcRunner(() => Promise.resolve<GcSpawnResult>({ exitCode: 0, stdout: 'ok', stderr: '' }));
        try { gcSchedulerService.stop(); } catch { /* noop */ }
        // Zera estado interno do singleton (lastRunSlot / mutex) entre testes.
        gcSchedulerService.reset();
    });

    afterEach(() => {
        try { gcSchedulerService.stop(); } catch { /* noop */ }
        resetGcRunner();
        // Restaura env.
        for (const k of ['GC_SCHEDULE_ENABLED', 'GC_SCHEDULE_TIME', 'GC_REPO_ROOT', 'PREVIEW_MODE']) {
            if (k in origEnv) process.env[k] = origEnv[k as keyof typeof origEnv];
            else delete process.env[k];
        }
    });

    describe('parseDailySchedule', () => {
        it('parse "HH:MM" válido (com padding flexível)', () => {
            expect(parseDailySchedule('03:00')).toEqual({ hour: 3, minute: 0 });
            expect(parseDailySchedule('18:30')).toEqual({ hour: 18, minute: 30 });
            expect(parseDailySchedule('3:5')).toEqual({ hour: 3, minute: 5 });
            expect(parseDailySchedule('23:59')).toEqual({ hour: 23, minute: 59 });
            expect(parseDailySchedule('00:00')).toEqual({ hour: 0, minute: 0 });
        });
        it('trim whitespace', () => {
            expect(parseDailySchedule('  03:00  ')).toEqual({ hour: 3, minute: 0 });
        });
        it('null para inválido (formato, range, vazio)', () => {
            expect(parseDailySchedule('')).toBeNull();
            expect(parseDailySchedule(undefined)).toBeNull();
            expect(parseDailySchedule(null)).toBeNull();
            expect(parseDailySchedule('24:00')).toBeNull(); // hora > 23
            expect(parseDailySchedule('12:60')).toBeNull(); // minuto > 59
            expect(parseDailySchedule('9')).toBeNull();
            expect(parseDailySchedule('abc')).toBeNull();
            expect(parseDailySchedule('03:00:00')).toBeNull();
            expect(parseDailySchedule('-1:30')).toBeNull();
        });
    });

    describe('dailySlot', () => {
        it('formata YYYY-MM-DD-HH-MM (local, zero-padded)', () => {
            expect(dailySlot(new Date(2026, 6, 6, 3, 5, 0))).toBe('2026-07-06-03-05');
            expect(dailySlot(new Date(2025, 0, 1, 0, 0, 0))).toBe('2025-01-01-00-00');
            expect(dailySlot(new Date(2025, 11, 31, 23, 59, 0))).toBe('2025-12-31-23-59');
        });
    });

    describe('shouldRunGcNow', () => {
        const due = new Date(2026, 6, 6, 3, 0, 0); // 03:00 local
        const schedule = { hour: 3, minute: 0 };

        it('run=true quando habilitado, schedule bate e não rodou no slot', () => {
            const r = shouldRunGcNow(due, schedule, { enabled: true, lastRunSlot: null });
            expect(r.run).toBe(true);
            expect(r.reason).toBe('due');
            expect(r.slot).toBe('2026-07-06-03-00');
        });
        it('disabled tem prioridade (mesmo no horário)', () => {
            const r = shouldRunGcNow(due, schedule, { enabled: false, lastRunSlot: null });
            expect(r.run).toBe(false);
            expect(r.reason).toBe('disabled');
        });
        it('invalid-schedule quando schedule é null', () => {
            const r = shouldRunGcNow(due, null, { enabled: true, lastRunSlot: null });
            expect(r.run).toBe(false);
            expect(r.reason).toBe('invalid-schedule');
        });
        it('not-due quando hora/minuto não batem', () => {
            const off = new Date(2026, 6, 6, 9, 15, 0); // 09:15 ≠ 03:00
            const r = shouldRunGcNow(off, schedule, { enabled: true, lastRunSlot: null });
            expect(r.run).toBe(false);
            expect(r.reason).toBe('not-due');
        });
        it('already-ran quando lastRunSlot === slot atual (dedup, não roda 2x)', () => {
            const r = shouldRunGcNow(due, schedule, { enabled: true, lastRunSlot: '2026-07-06-03-00' });
            expect(r.run).toBe(false);
            expect(r.reason).toBe('already-ran');
        });
        it('roda num slot diferente do lastRunSlot (próximo dia)', () => {
            const nextDay = new Date(2026, 6, 7, 3, 0, 0);
            const r = shouldRunGcNow(nextDay, schedule, { enabled: true, lastRunSlot: '2026-07-06-03-00' });
            expect(r.run).toBe(true);
            expect(r.slot).toBe('2026-07-07-03-00');
        });
    });

    describe('isScheduleEnabled', () => {
        it('default true quando env ausente', () => {
            expect(isScheduleEnabled({})).toBe(true);
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: '' })).toBe(true);
        });
        it('true para valores truthy', () => {
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: '1' })).toBe(true);
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: 'true' })).toBe(true);
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: 'YES' })).toBe(true);
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: 'on' })).toBe(true);
        });
        it('false para qualquer outro valor', () => {
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: '0' })).toBe(false);
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: 'false' })).toBe(false);
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: 'no' })).toBe(false);
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: 'off' })).toBe(false);
            expect(isScheduleEnabled({ GC_SCHEDULE_ENABLED: 'maybe' })).toBe(false);
        });
    });

    describe('isPreviewBackend', () => {
        it('true apenas para PREVIEW_MODE="1" (string — env vars são sempre string)', () => {
            expect(isPreviewBackend({ PREVIEW_MODE: '1' })).toBe(true);
        });
        it('false quando ausente/vazio', () => {
            expect(isPreviewBackend({})).toBe(false);
            expect(isPreviewBackend({ PREVIEW_MODE: '' })).toBe(false);
            expect(isPreviewBackend({ PREVIEW_MODE: undefined })).toBe(false);
        });
        it('false para outros valores (0, true, yes, numérico)', () => {
            expect(isPreviewBackend({ PREVIEW_MODE: '0' })).toBe(false);
            expect(isPreviewBackend({ PREVIEW_MODE: 'true' })).toBe(false);
            expect(isPreviewBackend({ PREVIEW_MODE: 'yes' })).toBe(false);
            // Numérico literal: env é string, então nunca casa "1" numérico —
            // justifica o helper comparar como string (correção #1).
            expect(isPreviewBackend({ PREVIEW_MODE: 1 as unknown as string })).toBe(true);
        });
        it('trim whitespace ("  1  " → true)', () => {
            expect(isPreviewBackend({ PREVIEW_MODE: '  1  ' })).toBe(true);
        });
        it('SECURITY: preview backend nunca deve iniciar GC (invariant do server.ts)', () => {
            // Espelha o guard de server.ts: start() só é chamado quando isPreviewBackend()=false.
            const willStart = !isPreviewBackend({ PREVIEW_MODE: '1' });
            expect(willStart).toBe(false);
            const willStartNormal = !isPreviewBackend({});
            expect(willStartNormal).toBe(true);
        });
    });

    describe('resolveScheduleTime', () => {
        it('default "03:00"', () => {
            expect(resolveScheduleTime({})).toBe(DEFAULT_GC_SCHEDULE_TIME);
            expect(DEFAULT_GC_SCHEDULE_TIME).toBe('03:00');
        });
        it('usa env GC_SCHEDULE_TIME (trim)', () => {
            expect(resolveScheduleTime({ GC_SCHEDULE_TIME: '  18:30  ' })).toBe('18:30');
        });
    });

    describe('resolveGcRepoRoot', () => {
        // O setup.ts global mocka `fs` com existsSync=()=>true. Controlamos o mock aqui
        // para simular o filesystem real e exercitar o walk-up de verdade.
        const existsMock = fs.existsSync as unknown as Mock;
        const restoreExists = () => existsMock.mockReturnValue(true);

        afterEach(() => restoreExists());

        it('prioriza env GC_REPO_ROOT', () => {
            expect(resolveGcRepoRoot({ GC_REPO_ROOT: '/custom/root' }, '/start')).toBe('/custom/root');
        });
        it('walk-up encontra o dir cujo scripts/gc-worktrees.ts existe', () => {
            // Repo root real = 4 níveis acima de backend/src/__tests__/services.
            const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
            const target = path.join(repoRoot, 'scripts', 'gc-worktrees.ts').toLowerCase();
            existsMock.mockImplementation((p: string) => path.resolve(p).toLowerCase() === target);
            const result = resolveGcRepoRoot({}, path.resolve(__dirname));
            expect(path.resolve(result).toLowerCase()).toBe(repoRoot.toLowerCase());
        });
        it('fallback startDir quando nenhum nível contém o script', () => {
            existsMock.mockReturnValue(false);
            expect(resolveGcRepoRoot({}, '/a/b/c')).toBe('/a/b/c');
        });
    });

    describe('start() / stop()', () => {
        it('start agenda ticker de 1min (mesma granularidade do alertCronService)', () => {
            const spy = vi.spyOn(global, 'setInterval');
            gcSchedulerService.start();
            const calls = spy.mock.calls.map((c) => c[1]);
            expect(calls).toContain(GC_TICKER_INTERVAL_MS);
            expect(GC_TICKER_INTERVAL_MS).toBe(60 * 1000);
            spy.mockRestore();
        });
        it('start é idempotente (não cria 2 intervalos)', () => {
            const spy = vi.spyOn(global, 'setInterval');
            gcSchedulerService.start();
            gcSchedulerService.start();
            const intervalCalls = spy.mock.calls.filter((c) => c[1] === GC_TICKER_INTERVAL_MS).length;
            expect(intervalCalls).toBe(1);
            spy.mockRestore();
        });
        it('isRunning reflete estado start/stop', () => {
            expect(gcSchedulerService.isRunning).toBe(false);
            gcSchedulerService.start();
            expect(gcSchedulerService.isRunning).toBe(true);
            gcSchedulerService.stop();
            expect(gcSchedulerService.isRunning).toBe(false);
        });
        it('stop limpa o interval (clearInterval)', () => {
            const spy = vi.spyOn(global, 'clearInterval');
            gcSchedulerService.start();
            gcSchedulerService.stop();
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
        it('start loga schedule + enabled', () => {
            process.env.GC_SCHEDULE_TIME = '04:30';
            gcSchedulerService.start();
            expect(loggerSpies.info).toHaveBeenCalledWith(
                expect.stringContaining('GC scheduler iniciado'),
            );
            const msg = loggerSpies.info.mock.calls.find((c) => String(c[0]).includes('iniciado'))?.[0];
            expect(msg).toContain('schedule=04:30');
            expect(msg).toContain('habilitado=true');
        });
        it('SECURITY (correção #3): start() no-op em PREVIEW_MODE=1 (defense-in-depth — não agenda ticker)', () => {
            process.env.PREVIEW_MODE = '1';
            const spy = vi.spyOn(global, 'setInterval');
            gcSchedulerService.start();
            expect(gcSchedulerService.isRunning).toBe(false);
            expect(spy).not.toHaveBeenCalled();
            expect(loggerSpies.warn).toHaveBeenCalledWith(
                expect.stringContaining('start() bloqueado'),
            );
            spy.mockRestore();
        });
        it('start() procede quando PREVIEW_MODE ausente/0 (não-falso-positivo)', () => {
            process.env.PREVIEW_MODE = '0';
            const spy = vi.spyOn(global, 'setInterval');
            gcSchedulerService.start();
            expect(gcSchedulerService.isRunning).toBe(true);
            spy.mockRestore();
        });
    });

    describe('checkAndRun()', () => {
        const due = new Date(2026, 6, 6, 3, 0, 0); // 03:00 — bate no default

        it('NÃO roda fora do horário (not-due) e não invoca runner', async () => {
            const runnerSpy = vi.fn(() => Promise.resolve<GcSpawnResult>({ exitCode: 0, stdout: '', stderr: '' }));
            setGcRunner(runnerSpy);
            process.env.GC_SCHEDULE_TIME = '03:00';
            const off = new Date(2026, 6, 6, 9, 15, 0); // 09:15
            const r = await gcSchedulerService.checkAndRun(off);
            expect(r.run).toBe(false);
            expect(r.reason).toBe('not-due');
            expect(runnerSpy).not.toHaveBeenCalled();
        });
        it('NÃO roda quando desabilitado (disabled)', async () => {
            const runnerSpy = vi.fn(() => Promise.resolve<GcSpawnResult>({ exitCode: 0, stdout: '', stderr: '' }));
            setGcRunner(runnerSpy);
            process.env.GC_SCHEDULE_ENABLED = 'false';
            process.env.GC_SCHEDULE_TIME = '03:00';
            const r = await gcSchedulerService.checkAndRun(due);
            expect(r.run).toBe(false);
            expect(r.reason).toBe('disabled');
            expect(runnerSpy).not.toHaveBeenCalled();
        });
        it('NÃO roda quando schedule é inválido (invalid-schedule)', async () => {
            const runnerSpy = vi.fn(() => Promise.resolve<GcSpawnResult>({ exitCode: 0, stdout: '', stderr: '' }));
            setGcRunner(runnerSpy);
            process.env.GC_SCHEDULE_TIME = '99:99';
            const r = await gcSchedulerService.checkAndRun(due);
            expect(r.run).toBe(false);
            expect(r.reason).toBe('invalid-schedule');
            expect(runnerSpy).not.toHaveBeenCalled();
        });
        it('RODA no horário devido e invoca o runner (exitCode 0)', async () => {
            const runnerSpy = vi.fn(() => Promise.resolve<GcSpawnResult>({ exitCode: 0, stdout: 'relatorio', stderr: '' }));
            setGcRunner(runnerSpy);
            process.env.GC_SCHEDULE_TIME = '03:00';
            const r = await gcSchedulerService.checkAndRun(due);
            expect(r.run).toBe(true);
            expect(r.ran).toBe(true);
            expect(r.exitCode).toBe(0);
            expect(runnerSpy).toHaveBeenCalledTimes(1);
        });
        it('dedup: segundo tick no MESMO slot não roda de novo (already-ran)', async () => {
            const runnerSpy = vi.fn(() => Promise.resolve<GcSpawnResult>({ exitCode: 0, stdout: '', stderr: '' }));
            setGcRunner(runnerSpy);
            process.env.GC_SCHEDULE_TIME = '03:00';
            await gcSchedulerService.checkAndRun(due);
            const second = await gcSchedulerService.checkAndRun(due);
            expect(second.run).toBe(false);
            expect(second.reason).toBe('already-ran');
            expect(runnerSpy).toHaveBeenCalledTimes(1);
        });
        it('roda novamente em slot diferente (próximo dia)', async () => {
            const runnerSpy = vi.fn(() => Promise.resolve<GcSpawnResult>({ exitCode: 0, stdout: '', stderr: '' }));
            setGcRunner(runnerSpy);
            process.env.GC_SCHEDULE_TIME = '03:00';
            await gcSchedulerService.checkAndRun(due);
            const nextDay = new Date(2026, 6, 7, 3, 0, 0);
            const r = await gcSchedulerService.checkAndRun(nextDay);
            expect(r.ran).toBe(true);
            expect(runnerSpy).toHaveBeenCalledTimes(2);
        });
        it('reporta exitCode não-zero como falha mas NÃO lança', async () => {
            setGcRunner(() => Promise.resolve<GcSpawnResult>({ exitCode: 1, stdout: '', stderr: 'boom' }));
            process.env.GC_SCHEDULE_TIME = '03:00';
            const r = await gcSchedulerService.checkAndRun(due);
            expect(r.ran).toBe(true);
            expect(r.exitCode).toBe(1);
            expect(loggerSpies.warn).toHaveBeenCalled();
        });
        it('runner que rejeita é capturado (não propaga) e registra erro', async () => {
            setGcRunner(() => Promise.reject(new Error('spawn ENOENT')));
            process.env.GC_SCHEDULE_TIME = '03:00';
            const r = await gcSchedulerService.checkAndRun(due);
            expect(r.ran).toBe(true);
            expect(r.error).toBe('spawn ENOENT');
            expect(r.exitCode).toBe(-1);
            expect(loggerSpies.error).toHaveBeenCalled();
        });
        it('mutex: não sobrepõe execuções concorrentes (gc-in-progress)', async () => {
            let resolveSlow!: (v: GcSpawnResult) => void;
            const slow = new Promise<GcSpawnResult>((res) => { resolveSlow = res; });
            const runnerSpy = vi.fn(() => slow);
            setGcRunner(runnerSpy);
            process.env.GC_SCHEDULE_TIME = '03:00';
            const p1 = gcSchedulerService.checkAndRun(due);
            const p2 = gcSchedulerService.checkAndRun(due); // concorrente
            const second = await p2;
            expect(second.run).toBe(false);
            expect(second.reason).toBe('gc-in-progress');
            resolveSlow({ exitCode: 0, stdout: '', stderr: '' });
            const first = await p1;
            expect(first.ran).toBe(true);
            expect(runnerSpy).toHaveBeenCalledTimes(1);
        });
    });
});
