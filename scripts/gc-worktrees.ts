#!/usr/bin/env tsx
/**
 * GC de Worktrees (issue #1112) — job de manutenção DESACOPLADO da execução de task.
 * Mantém o ambiente limpo: poda worktrees git stale, remove dirs órfãos de `.claude/worktrees`
 * de forma JUNCTION-SAFE, reapeia processos órfãos (vite preview / opencode sem task) e relata
 * disco antes/depois.
 *
 * Rodável manual:
 *   npx tsx scripts/gc-worktrees.ts            # executa
 *   npx tsx scripts/gc-worktrees.ts --dry-run  # só planeja, não muta (útil p/ auditoria)
 *   npx tsx scripts/gc-worktrees.ts --no-proc-reap  # pula reap de processos
 *
 * Segurança: JUNCTION-SAFE (node_modules do repo principal sempre intacto). Idempotente.
 * NÃO toca pm2/tulipa-v4/MCP.
 *
 * Agendamento: Windows Task Scheduler diário OU cron do backend (ver docs). O binário é este script.
 */
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    buildJunctionSafeRemovalPlan,
    classifyWorktreeDir,
    computeFreedBytes,
    DEFAULT_DISK_THRESHOLD_BYTES,
    isNodeModulesEntry,
    isOrphanOpencode,
    isTaskrunnerVitePreview,
    isUnderClaudeWorktrees,
    isWorktreeInUse,
    junctionPreUnlinkSteps,
    normalizePath,
    OPENCODE_ORPHAN_NEEDLES,
    parseWorktreePorcelain,
    shouldAlertLowDisk,
    summarizeReport,
    type DiskInfo,
    type GcReport,
} from '../backend/src/utils/gcWorktrees';
import { killTree, listPidsByName } from '../backend/src/utils/processTree';
import { SLOT2_ROOT } from '../backend/src/services/slotManager';

const execFileAsync = promisify(execFile);

const DRY_RUN = process.argv.includes('--dry-run');
const NO_PROC_REAP = process.argv.includes('--no-proc-reap');

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CURRENT_ROOT = path.resolve(SCRIPT_DIR, '..');

/**
 * Resolve o repo PRINCIPAL (common worktree) via `git rev-parse --git-common-dir`. Robusto:
 * funciona rodando do repo principal OU do worktree (sistemav2-taskrunner-wt) — ambos compartilham
 * o mesmo `.git` comum. Em falha do git, cai no fallback (dir atual).
 */
function resolveMainRepo(fallback: string): string {
    try {
        const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
            cwd: fallback, encoding: 'utf8', timeout: 10000, windowsHide: true,
        }).trim();
        const absCommon = path.isAbsolute(commonDir) ? commonDir : path.resolve(fallback, commonDir);
        return path.resolve(absCommon, '..');
    } catch {
        return fallback;
    }
}

const REPO_ROOT = process.env.GC_REPO_ROOT || resolveMainRepo(CURRENT_ROOT);
const WT_ROOT = process.env.GC_WT_ROOT || path.resolve(REPO_ROOT, '..', 'sistemav2-taskrunner-wt');
const CLAUDE_WORKTREES_DIRS = [
    path.join(REPO_ROOT, '.claude', 'worktrees'),
    path.join(WT_ROOT, '.claude', 'worktrees'),
].filter((d) => fs.existsSync(d));

const DISK_THRESHOLD = Number(process.env.GC_DISK_THRESHOLD_BYTES) || DEFAULT_DISK_THRESHOLD_BYTES;
// #kill-per-slot: usa a fonte ÚNICA de needles (inclui RUN_MARKER_PREFIX). No GC é seguro matar por
// [tr-run: porque o reap de opencode só roda com o robô OCIOSO (taskRunnerHasLiveRun()==false).
const OPENCODE_NEEDLES = OPENCODE_ORPHAN_NEEDLES;

function log(msg: string): void {
    const ts = new Date().toISOString();
    console.log(`[gc-worktrees ${ts}] ${msg}`);
}

function git(args: string[], opts?: { cwd?: string; timeout?: number }) {
    return execFileAsync('git', args, {
        cwd: opts?.cwd || REPO_ROOT,
        timeout: opts?.timeout || 60000,
        maxBuffer: 20 * 1024 * 1024,
    });
}

/** Lê disco livre/total do drive do caminho. null se indisponível (ex.: statfs ausente). */
function readDisk(dirPath: string): DiskInfo {
    try {
        const st = fs.statfsSync(dirPath);
        return { freeBytes: st.bsize * st.bavail, totalBytes: st.bsize * st.blocks };
    } catch {
        return { freeBytes: null, totalBytes: null };
    }
}

/**
 * Coleta TODOS os junctions/reparse points sob `dir` recursivamente. Cada junction é um ponto
 * de perigo: `rm -rf` seguiria ele e apagaria o alvo (node_modules do repo principal).
 * Retorna caminhos absolutos; em falha parcial, retorna o que conseguiu ler.
 */
function collectJunctions(dir: string): { junctions: string[]; readable: boolean } {
    const junctions: string[] = [];
    let readable = true;
    const walk = (current: string): void => {
        let names: string[];
        try {
            names = fs.readdirSync(current);
        } catch {
            readable = false;
            return;
        }
        for (const name of names) {
            // Nunca desce em node_modules (gigante e irrelevante para junctions além do link topo).
            if (isNodeModulesEntry(name)) {
                const abs = path.join(current, name);
                try {
                    if (fs.lstatSync(abs).isSymbolicLink()) junctions.push(abs);
                } catch { /* ignore */ }
                continue;
            }
            const abs = path.join(current, name);
            try {
                const lst = fs.lstatSync(abs);
                if (lst.isSymbolicLink()) {
                    junctions.push(abs);
                } else if (lst.isDirectory()) {
                    walk(abs);
                }
            } catch { /* ignore */ }
        }
    };
    walk(dir);
    return { junctions, readable };
}

/** Aplica o plano junction-safe: unlink de cada junction (rmdir, não segue) ANTES do rmSync. */
function applyJunctionSafeRemoval(plan: ReturnType<typeof buildJunctionSafeRemovalPlan>): { removed: boolean; junctionsUnlinked: string[]; error?: string } {
    const unlinked: string[] = [];
    for (const step of plan.steps) {
        try {
            if (step.kind === 'unlink-junction') {
                if (fs.existsSync(step.path)) {
                    fs.rmdirSync(step.path);
                    unlinked.push(step.path);
                }
            } else if (step.kind === 'rmdir') {
                if (fs.existsSync(step.path)) {
                    fs.rmSync(step.path, { recursive: true, force: true });
                }
            }
        } catch (e) {
            return { removed: false, junctionsUnlinked: unlinked, error: `${step.kind} ${step.path}: ${String((e as Error).message).substring(0, 160)}` };
        }
    }
    return { removed: !fs.existsSync(plan.residualDir), junctionsUnlinked: unlinked };
}

async function reapProcesses(): Promise<GcReport['processesReaped']> {
    const reaped: GcReport['processesReaped'] = [];
    // opencode órfão (mesma discriminação do TaskRunner — needles do projectID compartilhado).
    // #kill-per-slot: NÃO reapeia opencode se o TaskRunner tem execução VIVA — o GC das 03:00 mataria
    // o coder em pleno trabalho (robô roda 24/7). As varreduras do próprio TaskRunner cuidam dos órfãos
    // durante a execução; o GC só limpa quando o robô está ocioso.
    if (taskRunnerHasLiveRun()) {
        log('reap de opencode PULADO — TaskRunner tem execução viva (running/fixing/cancelling)');
        reaped.push({ name: 'opencode', pids: [] });
    } else {
        try {
            const pids = (await listPidsByName('opencode')).filter((p) => p !== process.pid);
            const cls = await tryGetCommandLines(pids);
            if (cls === null) {
                // #kill-per-slot: CommandLine indisponível (WMI falhou) → NÃO over-mata (mataria opencode
                // manual/outro projeto). Estrito: pula o reap; o próximo tick tenta de novo.
                log('reap de opencode PULADO — CommandLine indisponível (estrito, não over-mata)');
                reaped.push({ name: 'opencode', pids: [] });
            } else {
                const targets = pids.filter((p) => isOrphanOpencode(cls.get(p) ?? '', OPENCODE_NEEDLES));
                const killed: number[] = [];
                for (const pid of targets) {
                    const r = await killTree(pid);
                    if (r.ok && !r.alreadyDead) killed.push(pid);
                }
                reaped.push({ name: 'opencode', pids: killed });
            }
        } catch {
            reaped.push({ name: 'opencode', pids: [] });
        }
    }
    // vite preview vazado (só na faixa de portas do TaskRunner — não toca dev server principal).
    try {
        const pids = await listPidsByName('node');
        const cls = await tryGetCommandLines(pids);
        // cls===null (WMI falhou): isTaskrunnerVitePreview exige cmdline não-vazia, então sem cmdline
        // nada casa → nenhum kill (estrito, seguro). Trata null como "sem alvo".
        const targets = cls === null ? [] : pids.filter((p) => isTaskrunnerVitePreview(cls.get(p) ?? ''));
        const killed: number[] = [];
        for (const pid of targets) {
            const r = await killTree(pid);
            if (r.ok && !r.alreadyDead) killed.push(pid);
        }
        reaped.push({ name: 'vite-preview', pids: killed });
    } catch {
        reaped.push({ name: 'vite-preview', pids: [] });
    }
    return reaped;
}

/**
 * Lê CommandLines de PIDs (Windows via WMI; ps no Unix). Retorna `null` em FALHA de query
 * (paridade com processTree.ts:tryGetCommandLines). #kill-per-slot (red-team Fable): antes devolvia
 * Map VAZIA em falha de WMI → o reap lia `cl=''` → isOrphanOpencode('')=true → matava TODO opencode
 * da máquina (manual e vivo). `null` sinaliza "não sei" → o reap NÃO over-mata (estrito).
 */
async function tryGetCommandLines(pids: number[]): Promise<Map<number, string> | null> {
    const m = new Map<number, string>();
    if (pids.length === 0) return m;
    if (process.platform === 'win32') {
        try {
            const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ');
            const { stdout } = await execFileAsync('powershell', [
                '-NoProfile', '-NonInteractive', '-Command',
                `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }; exit 0`,
            ], { windowsHide: true, timeout: 20000 });
            for (const line of stdout.split(/\r?\n/)) {
                const i = line.indexOf('\t');
                if (i <= 0) continue;
                const pid = parseInt(line.slice(0, i), 10);
                if (Number.isFinite(pid)) m.set(pid, line.slice(i + 1));
            }
            return m;
        } catch { return null; } // WMI falhou → null (não Map vazia): não over-mata
    }
    try {
        const { stdout } = await execFileAsync('ps', ['-eo', 'pid,args'], { timeout: 15000 });
        for (const line of stdout.split('\n')) {
            const t = line.trim();
            const sp = t.indexOf(' ');
            const pid = parseInt(sp > 0 ? t.slice(0, sp) : t, 10);
            if (pids.includes(pid)) m.set(pid, sp > 0 ? t.slice(sp + 1) : '');
        }
        return m;
    } catch { return null; }
}

/**
 * #kill-per-slot (red-team Fable): o GC roda 24/7 (cron 03:00) e o robô também — se um coder está
 * EXECUTANDO, o reap de opencode do GC mataria o coder vivo. Lê o store do TaskRunner (best-effort)
 * e retorna true se há task em running/fixing/cancelling. Em qualquer erro de leitura, retorna TRUE
 * (conservador: na dúvida NÃO reapeia opencode — a limpeza é feita pelas varreduras do próprio
 * TaskRunner durante a execução; o GC é só backup p/ quando o robô está ocioso).
 */
function taskRunnerHasLiveRun(): boolean {
    try {
        const storePath = path.join(REPO_ROOT, 'backend', 'data', 'tasks.json');
        if (!fs.existsSync(storePath)) return false;
        const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
        const tasks = Object.values(store.tasks || {}) as Array<{ status?: string }>;
        return tasks.some((t) => t.status === 'running' || t.status === 'fixing' || t.status === 'cancelling');
    } catch {
        return true; // ilegível → assume vivo (não mata coder por engano)
    }
}

/**
 * Coleta cwds de processos vivos (best-effort) p/ o guard `isWorktreeInUse` (correção #3).
 * No Windows não há API portátil p/ o cwd de processo alheio (vive no PEB), então a estratégia é
 * conservadora e em camadas: (1) sempre inclui o cwd do PRÓPRIO GC (protege um run manual feito de
 * dentro de um worktree — complementa o guard PREVIEW_MODE do scheduler); (2) extrai paths absolutos
 * sob `.claude/worktrees` das command lines de opencode/node vivos (pega processos lançados com path
 * explícito, ex.: `node .../wt1/...`). O guard PRIMÁRIO é o reap ANTES da remoção (mata órfãos); este
 * coletor é defesa-em-profundidão p/ o caso raro de um processo vivo não-órfão num worktree.
 */
async function collectLiveCwds(): Promise<string[]> {
    const cwds = new Set<string>();
    try { cwds.add(process.cwd()); } catch { /* ignore */ }
    try {
        const pids = [
            ...(await listPidsByName('opencode')),
            ...(await listPidsByName('node')),
        ].filter((p) => p !== process.pid);
        const cls = await tryGetCommandLines(pids);
        for (const [, cl] of cls ?? []) {
            if (!cl) continue;
            for (const m of cl.matchAll(/([A-Za-z]:[\\/][^\s"'|<>]*|\/[^\s"'|<>]+)/g)) {
                const p = m[1];
                if (isUnderClaudeWorktrees(p, CLAUDE_WORKTREES_DIRS)) cwds.add(p);
            }
        }
    } catch { /* best-effort: falha aqui NÃO impede o GC — apenas enfraquece o guard in-use */ }
    return [...cwds];
}

async function main(): Promise<void> {
    log(`iniciando GC${DRY_RUN ? ' (DRY-RUN)' : ''} — REPO_ROOT=${REPO_ROOT} WT_ROOT=${WT_ROOT}`);
    log(`scanning .claude/worktrees dirs: ${CLAUDE_WORKTREES_DIRS.length ? CLAUDE_WORKTREES_DIRS.join(', ') : '(nenhum)'}`);

    const report: GcReport = {
        gitPruned: false,
        gitWorktreesRemoved: [],
        gitWorktreesKept: [],
        orphanDirsRemoved: [],
        orphanDirsKept: [],
        junctionsUnlinked: [],
        processesReaped: [],
        diskBefore: readDisk(REPO_ROOT),
        diskAfter: { freeBytes: null, totalBytes: null },
        freedBytes: null,
        lowDiskAlert: null,
        errors: [],
    };
    // +SLOT2_ROOT (Degrau 2 PR-2): defesa — o GC NUNCA apaga o clone do slot-2 (é um repo válido
    // fora de .claude/worktrees; esta linha o protege caso um scan futuro passe por perto).
    const protectedPaths = [REPO_ROOT, WT_ROOT, SLOT2_ROOT];

    // 1) git worktree prune — limpa entradas administrativas de worktrees cujo dir sumiu.
    try {
        await git(['worktree', 'prune'], { timeout: 30000 });
        report.gitPruned = true;
        log('git worktree prune: OK');
    } catch (e) {
        report.errors.push(`git worktree prune: ${String((e as Error).message).substring(0, 160)}`);
    }

    // 2) git worktree list → paths registrados (vivo/legítimo). Protege os 2 worktrees fixos.
    let knownPaths: string[] = [];
    try {
        const { stdout } = await git(['worktree', 'list', '--porcelain'], { timeout: 30000 });
        knownPaths = parseWorktreePorcelain(stdout);
    } catch (e) {
        report.errors.push(`git worktree list: ${String((e as Error).message).substring(0, 160)}`);
    }

    // 3) REAP de processos órfãos (vite preview / opencode sem task) ANTES da remoção (correção #3).
    //    Ordem crítica: mata órfãos PRIMEIRO p/ que seus worktrees estejam livres p/ remoção segura
    //    — nunca remove um worktree de debaixo de um processo vivo. Em DRY-RUN não enumera.
    if (!NO_PROC_REAP) {
        if (DRY_RUN) {
            log('[dry-run] reap de processos pulado (não enumera em dry-run)');
        } else {
            try {
                report.processesReaped = await reapProcesses();
                const total = report.processesReaped.reduce((n, p) => n + p.pids.length, 0);
                if (total) log(`processos reapeados: ${total}`);
            } catch (e) {
                report.errors.push(`reap processes: ${String((e as Error).message).substring(0, 160)}`);
            }
        }
    }

    // 4) Coleta cwds de processos vivos (best-effort) p/ o guard isWorktreeInUse. Feito APÓS o reap
    //    p/ que órfãos já mortos não apareçam como "em uso". Defesa-em-profundidão (#1170/#3).
    const liveCwds = DRY_RUN ? [] : await collectLiveCwds();

    // 5) Remove worktrees git STALE registrados sob .claude/worktrees (origem do Claude Code),
    //    via `git worktree remove -f -f`. Nunca toca repo principal nem WT_ROOT. JUNCTION-SAFE em
    //    TODOS os caminhos (correção #3): junctions (node_modules) são desligados via rmdir ANTES
    //    do `git worktree remove`, de modo que o git jamais siga um junction e apague o alvo
    //    (incidente #1170). Guard isWorktreeInUse: NUNCA toca worktree com processo vivo.
    for (const wt of knownPaths) {
        const cls = classifyWorktreeDir(wt, [], protectedPaths);
        if (cls === 'protected') continue;
        const underClaude = CLAUDE_WORKTREES_DIRS.some((d) => normalizePath(wt).startsWith(normalizePath(d)));
        if (!underClaude) continue;
        if (isWorktreeInUse(wt, liveCwds)) {
            report.gitWorktreesKept.push(wt);
            log(`worktree git PRESERVADO (processo vivo): ${path.basename(wt)}`);
            continue;
        }
        const exists = fs.existsSync(wt);
        // JUNCTION-SAFE (correção #3, incidente #1170): desliga junctions ANTES do git remove.
        const { junctions } = collectJunctions(wt);
        const preUnlink = junctionPreUnlinkSteps(junctions);
        if (!DRY_RUN) {
            for (const step of preUnlink) {
                if (step.kind === 'unlink-junction' && fs.existsSync(step.path)) {
                    try {
                        fs.rmdirSync(step.path);
                        report.junctionsUnlinked.push(step.path);
                    } catch (e) {
                        report.errors.push(`pre-unlink ${step.path}: ${String((e as Error).message).substring(0, 120)}`);
                    }
                }
            }
            try {
                await git(['worktree', 'remove', '-f', '-f', wt], { timeout: 60000 });
                report.gitWorktreesRemoved.push(wt);
                log(`git worktree remove -f -f: ${path.basename(wt)}${exists ? '' : ' (dir ausente)'}${junctions.length ? ` — ${junctions.length} junction(s) desligado(s) antes` : ''}`);
            } catch (e) {
                report.errors.push(`git worktree remove ${wt}: ${String((e as Error).message).substring(0, 160)}`);
            }
        } else {
            report.gitWorktreesRemoved.push(wt);
            report.junctionsUnlinked.push(...junctions);
            log(`[dry-run] removeria worktree git (junction-safe): ${path.basename(wt)} (${junctions.length} junction(s))`);
        }
    }

    // 6) Remove dirs ÓRFÃOS em .claude/worktrees (não registrados no git) — JUNCTION-SAFE + guard vivo.
    for (const wtDir of CLAUDE_WORKTREES_DIRS) {
        let entries: string[] = [];
        try {
            entries = fs.readdirSync(wtDir);
        } catch {
            continue;
        }
        for (const name of entries) {
            const abs = path.join(wtDir, name);
            let isDir = false;
            try { isDir = fs.lstatSync(abs).isDirectory(); } catch { continue; }
            if (!isDir) continue;
            const cls = classifyWorktreeDir(abs, knownPaths, protectedPaths);
            if (cls !== 'orphan') {
                report.orphanDirsKept.push(abs);
                continue;
            }
            if (isWorktreeInUse(abs, liveCwds)) {
                report.orphanDirsKept.push(abs);
                log(`órfão PRESERVADO (processo vivo): ${name}`);
                continue;
            }
            if (DRY_RUN) {
                const { junctions } = collectJunctions(abs);
                report.orphanDirsRemoved.push(abs);
                report.junctionsUnlinked.push(...junctions);
                log(`[dry-run] removeria órfão junction-safe: ${name} (${junctions.length} junction(s))`);
                continue;
            }
            // JUNCTION-SAFE: coleta junctions, desliga via rmdir ANTES do rmSync(recursive).
            const { junctions } = collectJunctions(abs);
            const plan = buildJunctionSafeRemovalPlan(junctions, abs);
            const res = applyJunctionSafeRemoval(plan);
            report.junctionsUnlinked.push(...res.junctionsUnlinked);
            if (res.removed) {
                report.orphanDirsRemoved.push(abs);
                log(`órfão removido (junction-safe): ${name} — ${junctions.length} junction(s) desligado(s) antes`);
            } else {
                report.orphanDirsKept.push(abs);
                if (res.error) report.errors.push(res.error);
                log(`órfão NÃO removido: ${name} — ${res.error ?? 'motivo desconhecido'}`);
            }
        }
    }

    // 7) Disco depois + métricas.
    report.diskAfter = readDisk(REPO_ROOT);
    report.freedBytes = computeFreedBytes(report.diskBefore, report.diskAfter);
    report.lowDiskAlert = shouldAlertLowDisk(report.diskAfter.freeBytes, DISK_THRESHOLD);

    console.log(summarizeReport(report));
    const hadErrors = report.errors.length > 0;
    log(`GC concluído${hadErrors ? ' com erros' : ''}.`);
    process.exitCode = hadErrors ? 1 : 0;
}

main().catch((e) => {
    console.error('[gc-worktrees] FALHA:', e);
    process.exitCode = 1;
});
