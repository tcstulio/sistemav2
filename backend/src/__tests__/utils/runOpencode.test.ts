import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mocks devem ser declarados ANTES do import do módulo sob teste (hoisting do vi.mock).
vi.mock('child_process', () => ({
    spawn: vi.fn(),
}));

vi.mock('pidusage', () => ({
    default: vi.fn(),
}));

vi.mock('../../utils/processTree', () => ({
    killTree: vi.fn(),
    killByImageName: vi.fn(),
    listPidsByName: vi.fn(),
    killOpencodeOrphans: vi.fn(),
    isAlive: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
    logger: { child: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) },
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    default: { child: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) },
}));

import { spawn } from 'child_process';
import { runOpencode, KILL_GRACE_MS } from '../../utils/runOpencode';
import { killTree, killByImageName, listPidsByName, killOpencodeOrphans } from '../../utils/processTree';
import { OPENCODE_ORPHAN_NEEDLES } from '../../utils/gcWorktrees';

/** Filho fake: EventEmitter com pid + streams stdout/stderr. Controlamos quando 'exit' dispara. */
class FakeChild extends EventEmitter {
    pid = 12345;
    stdout = new EventEmitter();
    stderr = new EventEmitter();
}

function makeTask(overrides: Partial<{ childPid: number; killRequested: boolean }> = {}) {
    return { childPid: undefined as number | undefined, killRequested: false, ...overrides };
}

describe('runOpencode — robustez do kill (#644)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // kill "falha": resolve ok=false (nunca mata de fato) — reproduz o "Command failed" do taskkill.
        vi.mocked(killTree).mockResolvedValue({ ok: false, signal: 'taskkill failed: Command failed', durationMs: 10, alreadyDead: false });
        vi.mocked(killByImageName).mockResolvedValue(undefined);
        vi.mocked(killOpencodeOrphans).mockResolvedValue({ killed: [], errors: [], confirmedGone: true, discriminated: true });
        vi.mocked(listPidsByName).mockResolvedValue([]);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('NAO trava a promise quando o kill falha e o filho nunca emite exit (settle forçado após grace)', async () => {
        const child = new FakeChild();
        vi.mocked(spawn).mockReturnValue(child as any);
        const task = makeTask();

        const p = runOpencode('opencode run "..."', '/cwd', task, 60_000);
        p.catch(() => { /* evita unhandled rejection enquanto aguardamos o force-settle */ });
        await vi.advanceTimersByTimeAsync(0); // flush do setup do spawn

        // Cancelamento solicitado (como killTask faria).
        task.killRequested = true;
        // watcher (500ms) detecta o kill -> tenta matar + agenda o forceKillTimer.
        await vi.advanceTimersByTimeAsync(600);
        expect(killTree).toHaveBeenCalledWith(12345);
        // #kill-per-slot: backstop agora é por-needle (killOpencodeOrphans), NÃO o /IM cego (killByImageName).
        expect(killOpencodeOrphans).toHaveBeenCalledWith('opencode', OPENCODE_ORPHAN_NEEDLES);
        expect(killByImageName).not.toHaveBeenCalled();

        // kill falhou (mock) e NUNCA emitimos 'exit' (órfão vivo). A promise ainda NÃO settlou.
        let settled = false;
        p.then(() => { settled = true; }, () => { settled = true; });
        await vi.advanceTimersByTimeAsync(500);
        expect(settled).toBe(false);

        // Após a grace, o forceKillTimer settle a promise À FORÇA -> a cadeia é liberada.
        await vi.advanceTimersByTimeAsync(KILL_GRACE_MS + 100);
        expect(settled).toBe(true);
        await expect(p).rejects.toThrow(/liberando a cadeia|kill/i);
        // childPid limpo (não deixa rastro p/ um próximo kill mirar em PID reciclado).
        expect(task.childPid).toBeUndefined();
    });

    it('settla normalmente quando o kill bem-sucedido faz o filho emitir exit', async () => {
        const child = new FakeChild();
        vi.mocked(spawn).mockReturnValue(child as any);
        const task = makeTask();

        const p = runOpencode('opencode run "..."', '/cwd', task, 60_000);
        p.catch(() => { /* handler antecipado */ });
        await vi.advanceTimersByTimeAsync(0);

        task.killRequested = true;
        await vi.advanceTimersByTimeAsync(600); // watcher detecta kill
        // kill bem-sucedido: o filho emite 'exit' ANTES da grace.
        child.emit('exit', 1, 'SIGTERM');

        await expect(p).rejects.toThrow(/killed/i);
        expect(task.childPid).toBeUndefined();
    });

    it('resolve com code 0 quando o filho termina normalmente (sem kill)', async () => {
        const child = new FakeChild();
        vi.mocked(spawn).mockReturnValue(child as any);
        const task = makeTask();

        const p = runOpencode('opencode run "..."', '/cwd', task, 60_000);
        await vi.advanceTimersByTimeAsync(0);
        child.stdout.emit('data', Buffer.from('done'));
        child.emit('exit', 0, null);

        await expect(p).resolves.toBe('done');
    });

    it('timeout settle a promise mesmo sem kill nem exit (backstop de wall time)', async () => {
        const child = new FakeChild();
        vi.mocked(spawn).mockReturnValue(child as any);
        const task = makeTask();

        const p = runOpencode('opencode run "..."', '/cwd', task, 5_000);
        p.catch(() => { /* handler antecipado */ });
        await vi.advanceTimersByTimeAsync(0);
        // sem kill, sem exit -> killTimer dispara finish() no timeout.
        await vi.advanceTimersByTimeAsync(5_100);

        await expect(p).rejects.toThrow(/timeout/i);
        // #kill-per-slot: o backstop do timeout também é por-needle, não o /IM cego.
        expect(killTree).toHaveBeenCalledWith(12345);
        expect(killOpencodeOrphans).toHaveBeenCalledWith('opencode', OPENCODE_ORPHAN_NEEDLES);
        expect(killByImageName).not.toHaveBeenCalled();
    });

    it('não settle duas vezes (exit + forceKillTimer competindo)', async () => {
        const child = new FakeChild();
        vi.mocked(spawn).mockReturnValue(child as any);
        const task = makeTask();

        const p = runOpencode('opencode run "..."', '/cwd', task, 60_000);
        p.catch(() => { /* handler antecipado */ });
        await vi.advanceTimersByTimeAsync(0);

        task.killRequested = true;
        await vi.advanceTimersByTimeAsync(600); // watcher agenda forceKillTimer
        // O filho exita logo depois (kill funcionou com atraso)...
        child.emit('exit', 1, 'SIGTERM');
        // ...e depois avançamos passado a grace: o forceKillTimer NÃO deve rejeitar de novo.
        await vi.advanceTimersByTimeAsync(KILL_GRACE_MS + 100);

        // Resolveu uma única vez (rejeição pelo exit), sem lançar "already settled".
        await expect(p).rejects.toThrow(/killed/i);
    });
});
