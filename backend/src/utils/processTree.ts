import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Mata o processo `pid` e todos os seus filhos (process tree).
 * Cross-platform: usa `taskkill /F /T /PID` no Windows, signals Unix no resto.
 * Resolve mesmo se o processo ja estiver morto (idempotente).
 */
export async function killTree(pid: number): Promise<{ ok: boolean; signal: string; durationMs: number; alreadyDead: boolean }> {
    const start = Date.now();
    if (!Number.isFinite(pid) || pid <= 0) {
        return { ok: true, signal: 'noop (invalid pid)', durationMs: 0, alreadyDead: true };
    }

    if (process.platform === 'win32') {
        try {
            await execAsync(`taskkill /pid ${pid} /T /F`, { windowsHide: true, timeout: 10000 });
            return { ok: true, signal: 'taskkill /F /T', durationMs: Date.now() - start, alreadyDead: false };
        } catch (e: any) {
            // exit code 128 / "process not found" = ja morreu.
            const msg = String(e?.message || e);
            if (msg.includes('not found') || msg.includes('128') || msg.includes('Access is denied')) {
                return { ok: true, signal: 'taskkill (already dead)', durationMs: Date.now() - start, alreadyDead: true };
            }
            return { ok: false, signal: `taskkill failed: ${msg.substring(0, 200)}`, durationMs: Date.now() - start, alreadyDead: false };
        }
    }

    // Unix: assume que o pid e' o PGID (spawn com detached: true).
    try {
        process.kill(-pid, 'SIGTERM');
        for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 100));
            if (!isAlive(pid)) {
                return { ok: true, signal: 'SIGTERM', durationMs: Date.now() - start, alreadyDead: false };
            }
        }
        process.kill(-pid, 'SIGKILL');
        return { ok: true, signal: 'SIGKILL (escalated)', durationMs: Date.now() - start, alreadyDead: false };
    } catch (e: any) {
        if (e?.code === 'ESRCH') {
            return { ok: true, signal: 'SIGTERM (already dead)', durationMs: Date.now() - start, alreadyDead: true };
        }
        return { ok: false, signal: `SIGTERM failed: ${String(e?.message || e).substring(0, 200)}`, durationMs: Date.now() - start, alreadyDead: false };
    }
}

/** Verifica se o processo existe (signal 0 = ping). */
export function isAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e: any) {
        return e?.code === 'EPERM'; // existe, sem permissao de signal
    }
}
