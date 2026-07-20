import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import pidusage from 'pidusage';
import { killTree, killOpencodeOrphans, listPidsByName } from './processTree';
import { OPENCODE_ORPHAN_NEEDLES } from './gcWorktrees';
import { logger } from './logger';

const log = logger.child('TaskRunner');

// Grace após um kill ser solicitado: se o processo filho NÃO emitir 'exit' neste
// intervalo (kill da árvore FALHOU / opencode órfão vivo), a promise é FORÇADA a
// settle. Sem isto, um kill falho deixa a promise pendurada para sempre e congela
// TODA a execChain (pendingExecs preso) — a fila inteira trava (#644).
// Configurável via env (default 10s): curto o suficiente p/ não travar a fila,
// longo o suficiente p/ um kill bem-sucedido fazer efeito e o 'exit' disparar.
export const KILL_GRACE_MS = (Number(process.env.TASKRUNNER_KILL_GRACE_MS) || 10_000);

/** Amostra de CPU/memória coletada via pidusage a cada 2s durante o opencode. */
export interface CpuMemSample {
    ts: string;
    cpuPercent: number;
    rssMb: number;
}

/**
 * Contrato MÍNIMO que runOpencode precisa da task. O `Task` real do taskRunnerService
 * satisfaz isto estruturalmente (childPid + killRequested), mantendo o util isolado e
 * testável sem depender do serviço completo.
 */
export interface RunOpencodeTask {
    childPid?: number;
    killRequested?: boolean;
}

// O opencode lançado via cmd.exe TRAVA no repo grande (ele aninha tsc/vitest no cmd.exe e
// fica ~15min até o timeout); no git-bash roda normal (<5min). Por isso o opencode — e só
// ele — vai por aqui. `-lc` carrega o profile p/ ter o PATH do npm global (onde está o bin).
export function resolveBash(): string {
    if (process.platform !== 'win32') return 'bash';
    const candidates = [
        process.env.TASKRUNNER_BASH,
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ].filter(Boolean) as string[];
    return candidates.find((p) => fs.existsSync(p)) || 'bash';
}

const GIT_BASH = resolveBash();

/**
 * Roda o opencode com tracking de PID e observador de kill (issue #304).
 * - Salva childPid na task para que killTask consiga localizar o processo.
 * - Polling a cada 500ms: se task.killRequested virar true, mata a arvore e rejeita.
 * - No Unix usa detached:true para criar novo process group (necessario p/ kill -pid).
 * - onSample (issue #305): a cada 2s amostra CPU/memória via pidusage (cross-platform).
 *
 * ROBUSTEZ (#644): quando um kill é solicitado, após KILL_GRACE_MS sem o filho emitir
 * 'exit' (kill da árvore falhou — ex.: taskkill "Command failed" no Windows — ou o
 * opencode virou órfão vivo), a promise é settle À FORÇA. Isto garante que a execChain
 * SEMPRE avance: pendingExecs é decrementado e o autoPlayNext dispara, mesmo diante de
 * um kill/exec falho. Sem este backstop, a fila inteira congelava até um restart.
 */
export function runOpencode(
    command: string,
    cwd: string,
    task: RunOpencodeTask,
    timeoutMs: number,
    onSample?: (sample: CpuMemSample) => void,
    // #parallel (red-team Fable P0): getter dos needles das OUTRAS runs VIVAS. Os backstops deste util
    // (kill/timeout) chamam killOpencodeOrphans SEM discriminar slot — com 2 coders, matariam o vizinho
    // (o coder do outro slot casa RUN_MARKER_PREFIX). Passando os protectNeedles, o backstop poupa os
    // vizinhos vivos e mata só o órfão DESTE run. É um GETTER (não valor): resolvido no instante do
    // backstop (cancel/timeout pode disparar muito depois do dispatch, com o conjunto de runs mudado).
    // Em serial não é passado → protect vazio → comportamento byte-idêntico ao de hoje.
    opts?: { protectNeedles?: () => string[] },
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child: ChildProcess = spawn(GIT_BASH, ['-lc', command], {
            cwd,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        task.childPid = child.pid;

        let stdout = '';
        let stderr = '';
        let killed = false;
        // Guarda contra settle duplo (exit + forceKillTimer + killTimer podem competir).
        let settled = false;
        let forceKillTimer: NodeJS.Timeout | null = null;
        child.stdout?.on('data', (b) => { stdout += b.toString(); });
        child.stderr?.on('data', (b) => { stderr += b.toString(); });

        const finish = (err?: Error) => {
            if (settled) return;
            settled = true;
            clearInterval(watcher);
            if (sampler) clearInterval(sampler);
            clearTimeout(killTimer);
            if (forceKillTimer) clearTimeout(forceKillTimer);
            if (task.childPid === child.pid) task.childPid = undefined;
            if (err) reject(err);
            else resolve(stdout);
        };

        const watcher = setInterval(() => {
            if (task.killRequested && !killed) {
                killed = true;
                const pid = child.pid;
                if (pid) {
                    killTree(pid).catch(() => { /* logged inside */ });
                }
                // Backstop de órfão (árvore do bash quebrada): mata o opencode DESTA run por needle,
                // sem atingir um opencode manual/vizinho. killTree(child.pid) já cobre o caminho normal
                // (taskkill /T é recursivo); aqui pegamos o órfão. #parallel: protectNeedles poupa os
                // coders VIZINHOS vivos (Fase 2). Enum-fail SEM proteção ativa cai no /IM via fallback
                // (cobertura #335 mantida); COM proteção ativa, o killOpencodeOrphans aborta estrito.
                killOpencodeOrphans('opencode', OPENCODE_ORPHAN_NEEDLES, [], opts?.protectNeedles?.() ?? []).catch(() => { /* ignore */ });
                // ⚠️ SETTLE FORÇADO (#644): se o kill falhar e o filho NUNCA emitir 'exit', a
                // promise ficaria pendurada para sempre → execChain congela → pendingExecs preso.
                // Após a grace, força o settle para a cadeia avançar (pendingExecs-- e autoPlayNext).
                forceKillTimer = setTimeout(() => {
                    finish(new Error(
                        `opencode kill não confirmado em ${Math.round(KILL_GRACE_MS / 1000)}s ` +
                        `(kill falho/órfão) — liberando a cadeia de execução para não travar a fila`,
                    ));
                }, KILL_GRACE_MS);
            }
        }, 500);

        // Sampling CPU/mem (#305 + #502): a cada 2s mede o(s) processo(s) `opencode` — o trabalho
        // real — e NÃO o child.pid, que é o git-bash wrapper (`git-bash -lc → opencode`) e fica ~0%
        // só esperando o neto. Como os runs do TaskRunner são serializados (worktreeLock), os
        // opencode.exe vivos durante a amostragem pertencem a esta task; somamos a CPU/RSS deles.
        // Se nenhum opencode estiver vivo (ainda subindo ou já encerrado), pula a amostra em vez de
        // registrar os zeros enganosos do git-bash. listPidsByName é rápido (Get-Process, sem WMI).
        let sampling = false;
        const sampler = onSample ? setInterval(() => {
            if (killed || sampling) return;
            sampling = true;
            (async () => {
                try {
                    const pids = await listPidsByName('opencode');
                    if (pids.length === 0) return;
                    const stats = await new Promise<Record<string, { cpu: number; memory: number } | undefined>>((res, rej) => {
                        pidusage(pids, (err, s) => (err ? rej(err) : res(s as any)));
                    });
                    let cpu = 0;
                    let mem = 0;
                    for (const key of Object.keys(stats)) {
                        const s = stats[key];
                        if (!s) continue;
                        cpu += s.cpu || 0;
                        mem += s.memory || 0;
                    }
                    onSample({
                        ts: new Date().toISOString(),
                        cpuPercent: Math.round(cpu * 10) / 10,
                        rssMb: Math.round((mem / (1024 * 1024)) * 10) / 10,
                    });
                } catch {
                    // amostra perdida (enum/pidusage falhou sob carga) — ignora, próximo tick tenta
                } finally {
                    sampling = false;
                }
            })();
        }, 2000) : null;

        const killTimer = setTimeout(() => {
            // #1154 P3 item 26: inclui o TAIL do stdout no erro — antes o timeout descartava todo o output
            // acumulado, escondendo o que o opencode fazia quando travou (diagnóstico do #335).
            const tail = (stdout || '').slice(-1500).trim();
            finish(new Error(`opencode timeout (${Math.round(timeoutMs / 1000)}s)${tail ? ` — últimas linhas do output:\n${tail}` : ''}`));
            if (child.pid) killTree(child.pid).catch(() => { /* ignore */ });
            // Backstop: mata o opencode na FONTE do timeout p/ não virar órfão (causa do ciclo
            // vicioso no #335) — por needle, poupando opencode manual/vizinho. Enum-fail sem proteção
            // ativa cai no /IM via fallback do killOpencodeOrphans (cobertura #335 mantida). #parallel:
            // protectNeedles poupa os coders vizinhos vivos.
            killOpencodeOrphans('opencode', OPENCODE_ORPHAN_NEEDLES, [], opts?.protectNeedles?.() ?? []).catch(() => { /* ignore */ });
        }, timeoutMs);

        child.on('exit', (code, signal) => {
            if (killed) {
                finish(new Error(`opencode killed (signal=${signal}, code=${code})`));
            } else if (code === 0) {
                finish();
            } else {
                finish(new Error(`opencode exited code=${code} signal=${signal}: ${(stderr || stdout).substring(0, 2000)}`));
            }
        });
        child.on('error', (err) => {
            finish(err);
        });
    });
}
