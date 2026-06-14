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
 * Lista os PIDs de processos com o image name `imageName` (com ou sem `.exe`).
 * RÁPIDO (~400ms): Get-Process (toolhelp) no Windows, pgrep no Unix — NÃO usa WMI, pois
 * `Get-CimInstance Win32_Process` custa 5-9s nesta máquina (overhead fixo do provider, mesmo
 * direcionado a poucos PIDs) e estourava o timeout sob carga → a varredura achava "nada" e os
 * órfãos sobreviviam (2ª fase do bug #335, pega só no canário ao vivo). LANÇA em falha de query.
 */
export async function listPidsByName(imageName: string): Promise<number[]> {
    const base = imageName.replace(/\.exe$/i, '');
    if (process.platform === 'win32') {
        const { stdout } = await execFileAsync(
            'powershell',
            ['-NoProfile', '-NonInteractive', '-Command',
                // `exit 0`: Get-Process -Name sai com código 1 quando não há match (mesmo com
                // SilentlyContinue) → execFile rejeitaria. Força exit 0 (sem match = lista vazia).
                `Get-Process -Name '${base.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0`],
            { windowsHide: true, timeout: 15000 },
        );
        return stdout.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
    }
    try {
        const { stdout } = await execAsync(`pgrep -x ${base.replace(/[^\w.-]/g, '')}`, { timeout: 15000 });
        return stdout.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
    } catch { return []; } // pgrep sai com 1 quando não encontra
}

/** Lê a CommandLine de PIDs específicos. Retorna null se a query falhar (NÃO confundir com vazio). */
async function tryGetCommandLines(pids: number[]): Promise<Map<number, string> | null> {
    if (pids.length === 0) return new Map();
    if (process.platform === 'win32') {
        const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ');
        try {
            const { stdout } = await execFileAsync(
                'powershell',
                ['-NoProfile', '-NonInteractive', '-Command',
                    `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }; exit 0`],
                { windowsHide: true, timeout: 20000 },
            );
            const m = new Map<number, string>();
            for (const line of stdout.split(/\r?\n/)) {
                const i = line.indexOf('\t');
                if (i <= 0) continue;
                const pid = parseInt(line.slice(0, i), 10);
                if (Number.isFinite(pid)) m.set(pid, line.slice(i + 1));
            }
            return m;
        } catch { return null; }
    }
    try {
        const { stdout } = await execAsync('ps -eo pid,args', { timeout: 15000 });
        const m = new Map<number, string>();
        for (const line of stdout.split('\n')) {
            const t = line.trim(); const sp = t.indexOf(' ');
            const pid = parseInt(sp > 0 ? t.slice(0, sp) : t, 10);
            if (pids.includes(pid)) m.set(pid, sp > 0 ? t.slice(sp + 1) : '');
        }
        return m;
    } catch { return null; }
}

/**
 * Mata (árvore) os processos `imageName` ÓRFÃOS do TaskRunner. Estratégia:
 * 1) enumera por NOME (rápido, sem WMI);
 * 2) discrimina pela CommandLine conter QUALQUER `needle` — p/ não matar um opencode manual do
 *    usuário em OUTRO projeto. Se a leitura da CommandLine falhar (WMI lento/indisponível), faz
 *    FALLBACK matando todos os candidatos do nome: pré-spawn é mais seguro over-matar opencode
 *    do que deixar um órfão segurando o lock do projectID (a 2ª fase do bug #335).
 * 3) barreira pós-kill via isAlive (instantânea) — `taskkill /F` retorna antes de o SO finalizar
 *    a árvore e soltar os handles (ex.: index.lock do snapshot).
 * Nunca lança internamente; em falha total de enumeração reporta confirmedGone=false.
 */
export async function killOpencodeOrphans(
    imageName: string,
    needles: string[],
    excludePids: number[] = [],
): Promise<{ killed: number[]; errors: string[]; confirmedGone: boolean; discriminated: boolean }> {
    const skip = new Set([process.pid, ...excludePids]);
    const errors: string[] = [];
    let pids: number[];
    try {
        pids = (await listPidsByName(imageName)).filter((p) => !skip.has(p));
    } catch (e: any) {
        return { killed: [], errors: [`enum falhou: ${String(e?.message || e).slice(0, 150)}`], confirmedGone: false, discriminated: false };
    }
    if (pids.length === 0) return { killed: [], errors, confirmedGone: true, discriminated: true };

    const cls = await tryGetCommandLines(pids);
    let targets: number[];
    let discriminated: boolean;
    if (cls) {
        targets = pids.filter((p) => { const cl = cls.get(p) || ''; return needles.some((n) => cl.includes(n)); });
        discriminated = true;
    } else {
        targets = pids; // WMI indisponível → over-kill seguro pré-spawn
        discriminated = false;
        errors.push('CommandLine indisponível — fallback: matando todos os candidatos do nome');
    }

    const killed: number[] = [];
    for (const pid of targets) {
        const r = await killTree(pid);
        // Unix: PID de varredura nem sempre é líder de grupo (o bash líder já morreu no caso
        // órfão), então o process.kill(-pid) do killTree pode dar ESRCH. Reforça o PID direto.
        if (process.platform !== 'win32') { try { process.kill(pid, 'SIGKILL'); } catch { /* já morto */ } }
        if (r.ok && !r.alreadyDead) killed.push(pid);
        else if (!r.ok) errors.push(`pid ${pid}: ${r.signal}`);
    }
    let alive = targets.filter((p) => isAlive(p));
    for (let i = 0; i < 30 && alive.length; i++) {
        await new Promise((r) => setTimeout(r, 100));
        alive = targets.filter((p) => isAlive(p));
    }
    return { killed, errors, confirmedGone: alive.length === 0, discriminated };
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
