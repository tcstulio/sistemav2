import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';

/**
 * Diretórios ignorados no hash/snapshot: dependências, VCS e artefatos de build
 * (seu conteúdo muda independentemente do código da task e inflaria o hash).
 */
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

export interface WorktreeSnapshot {
    round: number;
    sha: string;
    message: string;
    /** Branch dedicada onde o checkpoint WIP foi criado (isolada do principal). */
    branch: string;
}

async function collectFiles(dir: string, acc: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
            await collectFiles(full, acc);
        } else if (entry.isFile()) {
            acc.push(full);
        }
        // Symlinks (entry.isSymbolicLink()) são intencionalmente ignorados:
        // seguir o alvo quebraria o determinismo do hash (o alvo pode mudar
        // fora do worktree ou apontar p/ fora dele) e poderia criar ciclos
        // de recursão. Sockets, FIFOs e devices tampouco fazem sentido num
        // worktree de código. Decisão documentada — ver teste dedicado.
    }
}

/**
 * Devolve um SHA256 determinístico dos arquivos relevantes do worktree
 * (exclui node_modules, .git, dist, build, coverage). Inclui caminho
 * relativo (normalizado p/ '/') + conteúdo de cada arquivo, com ordem
 * de iteração estável (sort) — mesmo conteúdo ⇒ mesmo hash.
 */
export async function computeWorktreeHash(worktreePath: string): Promise<string> {
    const files: string[] = [];
    await collectFiles(worktreePath, files);
    files.sort();

    const hash = createHash('sha256');
    for (const absPath of files) {
        const rel = relative(worktreePath, absPath).replace(/\\/g, '/');
        const content = await readFile(absPath);
        hash.update(rel);
        hash.update('\u0000');
        hash.update(content);
        hash.update('\u0000');
    }
    return hash.digest('hex');
}

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

/**
 * Persiste o estado do worktree entre rodadas criando um commit WIP nomeado
 * `wip-round-{n}` (com `--allow-empty`, p/ sempre gerar checkpoint recuperável)
 * numa branch dedicada `wip-round-{n}` — isolada do branch principal.
 *
 * Antes do commit, faz `git checkout -B wip-round-{n}` a partir do HEAD atual,
 * de forma que o checkpoint NUNCA caia no histórico de `main`/`master`, mesmo
 * se o worktree estiver compartilhando branch com o repo principal. O worktree
 * permanece na branch WIP após o snapshot (semântica de checkpoint: o trabalho
 * continua dali). Retorna o SHA do commit criado.
 */
export function snapshotWorktree(worktreePath: string, round: number): WorktreeSnapshot {
    const message = `wip-round-${round}`;
    const branch = `wip-round-${round}`;
    git(worktreePath, ['checkout', '-B', branch]);
    git(worktreePath, ['add', '-A']);
    git(worktreePath, ['commit', '--allow-empty', '-m', message]);
    const sha = git(worktreePath, ['rev-parse', 'HEAD']);
    return { round, sha, message, branch };
}
