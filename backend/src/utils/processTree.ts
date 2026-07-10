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
        // Enumeração falhou (Get-Process trava sob carga). BACKSTOP sem-enumeração: mata todo o
        // image name via taskkill /IM. Quebra o ciclo vicioso (órfão → carga → enum falha → órfão).
        // Só seguro se não houver excludePids a preservar (no kill do próprio run, não há).
        if (skip.size <= 1) {
            await killByImageName(imageName.endsWith('.exe') ? imageName : `${imageName}.exe`);
            return { killed: [], errors: [`enum falhou (${String(e?.message || e).slice(0, 100)}) → backstop taskkill /IM`], confirmedGone: true, discriminated: false };
        }
        return { killed: [], errors: [`enum falhou: ${String(e?.message || e).slice(0, 150)}`], confirmedGone: false, discriminated: false };
    }
    if (pids.length === 0) return { killed: [], errors, confirmedGone: true, discriminated: true };

    const cls = await tryGetCommandLines(pids);
    let targets: number[];
    let discriminated: boolean;
    if (cls) {
        // Mata se a CommandLine casa um needle OU se está vazia/desconhecida. O WMI às vezes
        // devolve CommandLine vazia p/ um processo sob carga; sem isto, o órfão escaparia da
        // discriminação e sobreviveria (foi o que aconteceu no teste cumulativo throttled). Como
        // é um opencode.exe vivo no momento do sweep (pré/pós run do TaskRunner), errar p/ matar é
        // seguro — só pouparíamos um opencode com CommandLine CONHECIDA e que não casa nenhum needle.
        targets = pids.filter((p) => { const cl = cls.get(p); return !cl || needles.some((n) => cl.includes(n)); });
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

/**
 * Seleciona os chromes a matar por perfil (needle no --user-data-dir) — MODO ESTRITO, o INVERSO
 * do killOpencodeOrphans: chrome é o navegador PESSOAL do usuário, então na dúvida NÃO mata.
 * Só entra na lista quem tem CommandLine CONHECIDA contendo o needle do perfil; CommandLine
 * vazia/indisponível NÃO mata (no opencode é o contrário — lá over-matar é seguro).
 * Puro/testável.
 */
export function pickChromeProfileTargets(
    pids: number[],
    cls: Map<number, string> | null,
    profileNeedle: string,
): number[] {
    if (!cls) return []; // WMI indisponível → sem discriminação → nada (estrito)
    const targets: number[] = [];
    for (const pid of pids) {
        const cl = cls.get(pid);
        if (cl && cl.includes(profileNeedle)) targets.push(pid);
    }
    return targets;
}

/**
 * Mata SOMENTE os chromes cujo CommandLine contém o diretório de perfil dado (ex.:
 * `.wwebjs_auth\session-v4_1747`). Defesa ATIVA contra chrome zumbi segurando o SingletonLock
 * do perfil do WhatsApp (incidentes 2026-06-25 e 2026-07-07): no Windows o restart do nodemon
 * NÃO entrega sinal (o gracefulShutdown nunca roda) e os chromes do puppeteer sobrevivem ao
 * backend — o próximo boot falha o initialize() para sempre. Chamar ANTES de abrir a sessão:
 * quem estiver segurando o perfil que VAMOS abrir é zumbi por definição.
 * ESTRITO por design (falha de enum/WMI ou CommandLine vazia → não mata nada): over-kill aqui
 * atingiria o navegador pessoal do usuário. Nunca lança.
 */
export async function killChromesByProfile(profileNeedle: string): Promise<{ killed: number[]; errors: string[] }> {
    const errors: string[] = [];
    let pids: number[] = [];
    try {
        pids = (await listPidsByName('chrome')).filter((p) => p !== process.pid);
    } catch (e: any) {
        return { killed: [], errors: [`enum falhou: ${String(e?.message || e).slice(0, 120)} — nada morto (estrito)`] };
    }
    if (!pids.length) return { killed: [], errors };
    const cls = await tryGetCommandLines(pids);
    if (!cls) return { killed: [], errors: ['CommandLine indisponível — nada morto (estrito)'] };
    const targets = pickChromeProfileTargets(pids, cls, profileNeedle);
    const killed: number[] = [];
    for (const pid of targets) {
        const r = await killTree(pid);
        if (r.ok && !r.alreadyDead) killed.push(pid);
        else if (!r.ok) errors.push(`pid ${pid}: ${r.signal}`);
    }
    return { killed, errors };
}

/**
 * Mata (árvore) TODOS os processos com o image name dado, SEM enumeração: `taskkill /F /T /IM`
 * no Windows, `pkill` no Unix. É o BACKSTOP para quando a varredura por enumeração
 * (Get-Process/WMI) FALHA sob carga — foi o que vimos no #335: órfãos acumulavam, o sistema
 * ficava pesado, o `Get-Process` passava a falhar e o reaping não matava nada → ciclo vicioso.
 * NÃO discrimina por CommandLine (mata todo opencode), então use só no timeout/kill do PRÓPRIO
 * run (a serialização garante que o alvo é o run que está morrendo + eventuais órfãos). Nunca lança.
 */
export async function killByImageName(imageName: string): Promise<void> {
    try {
        if (process.platform === 'win32') {
            const safe = imageName.replace(/[^\w.-]/g, '');
            await execAsync(`taskkill /F /T /IM ${safe}`, { windowsHide: true, timeout: 15000 });
        } else {
            const base = imageName.replace(/\.exe$/i, '').replace(/[^\w.-]/g, '');
            await execAsync(`pkill -9 -x ${base}`, { timeout: 15000 });
        }
    } catch { /* taskkill/pkill saem !=0 quando não há processo — ok */ }
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
