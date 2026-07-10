import path from 'path';

/**
 * Utilitários PUROS do GC de worktrees (issue #1112). Toda a lógica de DECISÃO vive aqui —
 * junction-safe, idempotente — e é coberta por Vitest (backend/src/__tests__/utils/gcWorktrees.test.ts).
 * O executor (scripts/gc-worktrees.ts) injeta o filesystem real; testes injetam dados/mocks.
 *
 * Contexto do incidente 2026-07-06: 110 worktrees órfãos do Claude Code (.claude/worktrees) +
 * processos vazados. O risco CRÍTICO é o `node_modules` JUNCTION (mklink /J) que cada worktree
 * cria apontando p/ o node_modules do repo principal: um `rm -rf` ingênuo SEGUE o junction e apaga
 * o node_modules do repo principal. Por isso a remoção é JUNCTION-SAFE: unlink do junction primeiro
 * (rmdir no link, NÃO recurse), depois o dir residual.
 */

export const PROMPT_FILE = '.taskrunner-prompt.md';
export const VISUAL_JUDGE_MARKER = 'taskrunner-visual-judge';
/** Limiar padrão de alerta de disco livre: 5 GiB. */
export const DEFAULT_DISK_THRESHOLD_BYTES = 5 * 1024 ** 3;

/** Faixa de portas de preview derivadas do TaskRunner (previewPortsFor: 5174+(n%10), 3014+(n%10)). */
export const PREVIEW_FRONTEND_PORT_BASE = 5174;
export const PREVIEW_BACKEND_PORT_BASE = 3014;
export const PREVIEW_PORT_RANGE = 10;

export interface DiskInfo {
    freeBytes: number | null;
    totalBytes: number | null;
}

export interface DirEntry {
    name: string;
    absolutePath: string;
    isDirectory: boolean;
    /** True se lstat detectou junction/reparse point/symlink — o sinal de perigo. */
    isSymbolicLink: boolean;
}

export type RemovalStepKind = 'unlink-junction' | 'rmdir';

export interface RemovalStep {
    kind: RemovalStepKind;
    path: string;
}

/** Plano JUNCTION-SAFE de remoção: junctions sempre ANTES do rmdir do dir residual. */
export interface RemovalPlan {
    /** Caminhos de junction a desligar primeiro (rmdir no link, sem seguir o alvo). */
    junctions: string[];
    /** Diretório residual a remover depois que todos junctions foram desligados. */
    residualDir: string;
    /** Passos ordenados: unlink-junction* seguido de exatamente um rmdir residual. */
    steps: RemovalStep[];
}

export type WorktreeDirClassification = 'orphan' | 'known' | 'protected';

export interface GcReport {
    gitPruned: boolean;
    gitWorktreesRemoved: string[];
    /** Worktrees git-registered PRESERVADOS (processo vivo detectado — correção #3). */
    gitWorktreesKept: string[];
    orphanDirsRemoved: string[];
    orphanDirsKept: string[];
    junctionsUnlinked: string[];
    processesReaped: Array<{ name: string; pids: number[] }>;
    diskBefore: DiskInfo;
    diskAfter: DiskInfo;
    freedBytes: number | null;
    lowDiskAlert: boolean | null;
    errors: string[];
}

/** Formata bytes em string humana (B/KiB/MiB/GiB/TiB). null/NaN → "N/A". */
export function formatBytes(bytes: number | null | undefined): string {
    if (bytes == null || !Number.isFinite(bytes)) return 'N/A';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const sign = bytes < 0 ? '-' : '';
    let v = Math.abs(bytes);
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${sign}${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Normaliza caminho p/ comparação cross-platform: resolve, lowercase, barra forward. */
export function normalizePath(p: string): string {
    try {
        return path.resolve(p).toLowerCase().replace(/\\/g, '/');
    } catch {
        return p.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
    }
}

/** True se o nome é node_modules (case-insensitive) — o junction mais perigoso. */
export function isNodeModulesEntry(name: string): boolean {
    return name.toLowerCase() === 'node_modules';
}

/**
 * Classifica um DirEntry como junction (reparse point) — o sinal de perigo. No Windows um
 * junction (mklink /J) é reportado por lstatSync como symbolicLink; statSync (segue o link)
 * mente como diretório. Por isso o executor DEVE passar dados de lstat, não stat.
 */
export function isJunctionEntry(entry: Pick<DirEntry, 'isSymbolicLink' | 'isDirectory'>): boolean {
    return Boolean(entry.isSymbolicLink);
}

/**
 * Monta o plano JUNCTION-SAFE de remoção. REGRA INVARIÁVEL: TODO junction é desligado via
 * rmdir ANTES de remover o diretório residual. Assim o rmSync(recursive) seguinte nunca segue
 * um junction e nunca apaga o node_modules do repo principal. Os junctions vêm na ordem recebida
 * (típicos: node_modules no topo; coleta recursiva pode trazer outros).
 */
export function buildJunctionSafeRemovalPlan(junctionPaths: string[], parentDir: string): RemovalPlan {
    const junctions = [...junctionPaths];
    const steps: RemovalStep[] = [
        ...junctions.map<RemovalStep>((jp) => ({ kind: 'unlink-junction', path: jp })),
        { kind: 'rmdir', path: parentDir },
    ];
    return { junctions, residualDir: parentDir, steps };
}

/**
 * Passos de PRÉ-UNLINK de junctions para caminhos onde a remoção do dir RESIDUAL é delegada a
 * outra via (ex.: `git worktree remove -f -f`). Garante junction-safety ANTES do git remover o
 * restante da árvore (incidente #1170): o node_modules junction é desligado via rmdir (no link,
 * NÃO segue o alvo) antes do `git worktree remove`, de modo que o git jamais tenha um junction
 * p/ seguir. Retorna SOMENTE passos `unlink-junction` (sem rmdir residual — esse é trabalho do git).
 *
 * Cobertura junction-safe em TODOS os caminhos (correção #3):
 *  - Órfãos não-registrados  → buildJunctionSafeRemovalPlan (unlink + rmSync residual).
 *  - Worktree git registrado  → junctionPreUnlinkSteps (unlink) + `git worktree remove` (residual).
 */
export function junctionPreUnlinkSteps(junctionPaths: string[]): RemovalStep[] {
    return [...junctionPaths].map<RemovalStep>((jp) => ({ kind: 'unlink-junction', path: jp }));
}

/**
 * Parseia `git worktree list --porcelain` → lista de caminhos absolutos de worktrees registrados.
 * Cada bloco começa com "worktree <path>". Robusto a lock/branch/detached/etc.
 */
export function parseWorktreePorcelain(stdout: string): string[] {
    const out: string[] = [];
    for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^worktree\s+(.+)$/);
        if (m) out.push(m[1].trim());
    }
    return out;
}

/**
 * Decide o que fazer com um diretório candidato a órfão. Compara caminhos normalizados:
 * - 'protected': bate com um caminho protegido (repo principal, WT_ROOT ativo) → NUNCA remover.
 * - 'known': bate com um worktree registrado no git (vivo/legítimo) → não remover.
 * - 'orphan': não bate com nenhum → candidato à remoção junction-safe.
 */
export function classifyWorktreeDir(
    dirAbsPath: string,
    knownWorktreePaths: string[],
    protectedPaths: string[],
): WorktreeDirClassification {
    const target = normalizePath(dirAbsPath);
    for (const p of protectedPaths) {
        if (normalizePath(p) === target) return 'protected';
    }
    for (const k of knownWorktreePaths) {
        if (normalizePath(k) === target) return 'known';
    }
    return 'orphan';
}

/** Porta está na faixa de preview do TaskRunner (frontend 5174-5183, backend 3014-3023)? */
export function isTaskrunnerPreviewPort(port: number): boolean {
    if (!Number.isFinite(port) || port <= 0) return false;
    const frontendMin = PREVIEW_FRONTEND_PORT_BASE;
    const frontendMax = PREVIEW_FRONTEND_PORT_BASE + PREVIEW_PORT_RANGE - 1;
    const backendMin = PREVIEW_BACKEND_PORT_BASE;
    const backendMax = PREVIEW_BACKEND_PORT_BASE + PREVIEW_PORT_RANGE - 1;
    return (port >= frontendMin && port <= frontendMax) || (port >= backendMin && port <= backendMax);
}

/**
 * Discrimina um processo `vite preview` ÓRFÃO do TaskRunner. Casamento conservador:
 * command line contém "vite" E "preview" E alguma porta da faixa de preview do TaskRunner.
 * Assim NÃO mata o `vite` (dev server principal na 5173) nem vite build/outros projetos.
 * NÃO toca pm2/tulipa-v4/MCP (processos sem "vite preview" na faixa).
 */
export function isTaskrunnerVitePreview(commandLine: string): boolean {
    if (!commandLine) return false;
    const cl = commandLine.toLowerCase();
    if (!cl.includes('vite') || !cl.includes('preview')) return false;
    // Procura portas (--port 5177, --strictPort, --port=5178, etc.) e testa cada uma.
    const portMatches = cl.matchAll(/--?port[=\s]+(\d{1,5})/g);
    for (const m of portMatches) {
        const port = parseInt(m[1], 10);
        if (Number.isFinite(port) && isTaskrunnerPreviewPort(port)) return true;
    }
    return false;
}

/**
 * Discrimina um processo opencode ÓRFÃO do TaskRunner. Mesma regra de killOpencodeOrphans:
 * command line vazia/desconhecida OU contém um needle do TaskRunner (PROMPT_FILE ou
 * VISUAL_JUDGE_MARKER). Não mata opencode manual de outro projeto.
 */
export function isOrphanOpencode(commandLine: string, needles: string[]): boolean {
    if (!commandLine || !commandLine.trim()) return true;
    return needles.some((n) => n && commandLine.includes(n));
}

/**
 * Decide se alerta disco baixo. true = livre < limiar; false = ok; null = impossível medir
 * (freeBytes null — ex.: statfs indisponível). null NÃO dispara alerta (não dá pra afirmar).
 */
export function shouldAlertLowDisk(freeBytes: number | null, thresholdBytes: number): boolean | null {
    if (freeBytes == null || !Number.isFinite(freeBytes)) return null;
    if (!Number.isFinite(thresholdBytes) || thresholdBytes <= 0) return null;
    return freeBytes < thresholdBytes;
}

/** Bytes livres ganhos: after.free - before.free. null se algum lado for impossível de medir. */
export function computeFreedBytes(before: DiskInfo, after: DiskInfo): number | null {
    if (before.freeBytes == null || after.freeBytes == null) return null;
    return after.freeBytes - before.freeBytes;
}

/** True se o caminho está sob um diretório `.claude/worktrees` (origem típica dos órfãos). */
export function isUnderClaudeWorktrees(absPath: string, claudeWorktreesDirs: string[]): boolean {
    const target = normalizePath(absPath);
    return claudeWorktreesDirs.some((d) => {
        const base = normalizePath(d);
        return target === base || target.startsWith(base + '/');
    });
}

/**
 * True se algum processo vivo está rodando DE DENTRO de `worktreePath` (cwd dentro dele).
 * O GC usa isto para NUNCA tocar worktree com processo vivo (opencode/preview) — incidente #1170,
 * correção #3. `liveCwds` = cwds absolutos dos processos vivos (coletados pelo executor, best-effort:
 * inclui o cwd do próprio GC + paths extraídos das command lines de opencode/node vivos).
 *
 * Comparação via normalizePath (case/barra-insensitive); prefix-match com separador ('/') evita
 * falso-positivo entre "wt1" e "wt10". Primário: o reap roda ANTES da remoção (mata órfãos);
 * este guard é defesa-em-profundidão p/ o caso raro de um processo vivo não-órfão num worktree.
 */
export function isWorktreeInUse(worktreePath: string, liveCwds: string[]): boolean {
    const wt = normalizePath(worktreePath);
    return liveCwds.some((c) => {
        if (!c) return false;
        const cwd = normalizePath(c);
        return cwd === wt || cwd.startsWith(wt + '/');
    });
}

/** Sumário humano do relatório de GC (várias linhas). */
export function summarizeReport(r: GcReport): string {
    const lines: string[] = [];
    lines.push('=== GC de Worktrees — Relatório ===');
    if (r.gitPruned) lines.push('git worktree prune: OK');
    lines.push(`worktrees git removidos: ${r.gitWorktreesRemoved.length}${r.gitWorktreesRemoved.length ? ` [${r.gitWorktreesRemoved.join(', ')}]` : ''}`);
    if (r.gitWorktreesKept.length) lines.push(`worktrees git preservados (processo vivo): ${r.gitWorktreesKept.length} [${r.gitWorktreesKept.map((p) => path.basename(p)).join(', ')}]`);
    lines.push(`dirs órfãos removidos: ${r.orphanDirsRemoved.length}${r.orphanDirsRemoved.length ? ` [${r.orphanDirsRemoved.map((p) => path.basename(p)).join(', ')}]` : ''}`);
    lines.push(`dirs órfãos preservados: ${r.orphanDirsKept.length}`);
    lines.push(`junctions desligados (junction-safe): ${r.junctionsUnlinked.length}${r.junctionsUnlinked.length ? ` [${r.junctionsUnlinked.map((p) => path.basename(p)).join(', ')}]` : ''}`);
    const reaped = r.processesReaped.reduce((n, p) => n + p.pids.length, 0);
    lines.push(`processos órfãos reapeados: ${reaped}${reaped ? ` (${r.processesReaped.filter((p) => p.pids.length).map((p) => `${p.name}:${p.pids.length}`).join(', ')})` : ''}`);
    lines.push(`disco antes: ${formatBytes(r.diskBefore.freeBytes)} livre / ${formatBytes(r.diskBefore.totalBytes)} total`);
    lines.push(`disco depois: ${formatBytes(r.diskAfter.freeBytes)} livre / ${formatBytes(r.diskAfter.totalBytes)} total`);
    lines.push(`espaço liberado: ${formatBytes(r.freedBytes)}`);
    if (r.lowDiskAlert === true) {
        lines.push('ALERTA: disco livre abaixo do limiar!');
    } else if (r.lowDiskAlert === null) {
        lines.push('disco: medição indisponível (sem alerta)');
    } else {
        lines.push('disco: acima do limiar (ok)');
    }
    if (r.errors.length) {
        lines.push(`erros (${r.errors.length}):`);
        for (const e of r.errors) lines.push(`  - ${e}`);
    } else {
        lines.push('erros: nenhum');
    }
    return lines.join('\n');
}
