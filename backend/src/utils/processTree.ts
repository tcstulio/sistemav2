import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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

/**
 * Lista os PIDs cujos comandos contêm `needle` (substring LITERAL, não regex).
 * Windows: Get-CimInstance Win32_Process (exclui o próprio powershell da consulta,
 * que naturalmente contém o needle no script). Unix: `ps -eo pid,args`.
 * `excludePids` remove PIDs conhecidos (ex.: o run vivo atual). Nunca lança — em
 * qualquer erro retorna [].
 */
export async function findProcessesByCommandLine(needle: string, excludePids: number[] = []): Promise<number[]> {
    const skip = new Set([process.pid, ...excludePids]);
    if (process.platform === 'win32') {
        const safe = needle.replace(/'/g, "''"); // escapa aspas simples p/ string PS
        const script =
            `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${safe}*' ` +
            `-and $_.Name -ne 'powershell.exe' } | Select-Object -ExpandProperty ProcessId`;
        try {
            const { stdout } = await execFileAsync(
                'powershell',
                ['-NoProfile', '-NonInteractive', '-Command', script],
                { windowsHide: true, timeout: 15000 },
            );
            return stdout.split(/\r?\n/)
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => Number.isFinite(n) && n > 0 && !skip.has(n));
        } catch {
            return [];
        }
    }
    try {
        const { stdout } = await execAsync('ps -eo pid,args', { timeout: 15000 });
        const out: number[] = [];
        for (const line of stdout.split('\n')) {
            if (!line.includes(needle)) continue;
            const pid = parseInt(line.trim().split(/\s+/)[0], 10);
            if (Number.isFinite(pid) && pid > 0 && !skip.has(pid)) out.push(pid);
        }
        return out;
    } catch {
        return [];
    }
}

/**
 * Mata (árvore inteira) todos os processos cujo comando contém `needle`.
 * Usado para varrer opencode ÓRFÃO do TaskRunner: no Windows, um restart do backend
 * (nodemon) NÃO reapeia os filhos — o opencode sobrevive segurando o lock de git do
 * projeto, e a próxima task colide. Varrer por linha de comando pega o órfão mesmo
 * sem PID em memória. Idempotente; nunca lança.
 *
 * BARREIRA pós-kill: `taskkill /F` retorna ANTES de o SO finalizar a árvore e soltar os
 * file handles (ex.: o index.lock do snapshot). Por isso, após matar, re-varre até a lista
 * esvaziar (ou timeout curto) — só então é seguro limpar locks e spawnar o novo opencode.
 */
export async function killProcessesByCommandLine(
    needle: string,
    excludePids: number[] = [],
): Promise<{ killed: number[]; errors: string[]; confirmedGone: boolean }> {
    const killed: number[] = [];
    const errors: string[] = [];
    const pids = await findProcessesByCommandLine(needle, excludePids);
    for (const pid of pids) {
        const r = await killTree(pid);
        // Unix: PIDs vindos de varredura nem sempre são líderes de grupo (o líder bash já
        // morreu no caso órfão), então o process.kill(-pid) do killTree pode dar ESRCH.
        // Reforça matando o PID direto.
        if (process.platform !== 'win32') { try { process.kill(pid, 'SIGKILL'); } catch { /* já morto */ } }
        if (r.ok && !r.alreadyDead) killed.push(pid);
        else if (!r.ok) errors.push(`pid ${pid}: ${r.signal}`);
    }
    if (pids.length === 0) return { killed, errors, confirmedGone: true };
    let remaining = await findProcessesByCommandLine(needle, excludePids);
    for (let i = 0; i < 30 && remaining.length; i++) {
        await new Promise((r) => setTimeout(r, 100));
        remaining = await findProcessesByCommandLine(needle, excludePids);
    }
    return { killed, errors, confirmedGone: remaining.length === 0 };
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
