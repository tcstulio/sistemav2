/**
 * Shared helpers for creating/managing GitHub issues via the `gh` CLI.
 *
 * Extraído de `routes/githubRoutes.ts` (issue #1561 — endpoint dedicado de
 * report) para que tanto o botão in-app quanto o novo endpoint
 * `POST /api/issues/report` reutilizem o MESMO helper. Manter a chamada ao
 * `gh` em UM lugar evita divergência (timeouts, parsing de URL, criação de
 * label) e facilita mock nos testes via injeção do módulo.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from './logger';

const log = createLogger('GitHub');
const execFileAsync = promisify(execFile);

/** Repo canônico do projeto no GitHub. */
export const GITHUB_REPO = 'tcstulio/sistemav2';

/** Timeout padrão (ms) para chamadas `gh`. */
export const GH_DEFAULT_TIMEOUT_MS = 30_000;
/** Timeout (ms) para `gh label create` (criação é barata — pode falhar rápido). */
export const GH_LABEL_TIMEOUT_MS = 15_000;

export interface CreateGitHubIssueOptions {
    /** Título do issue. Trim e slice(0,250) são aplicados. */
    title: string;
    /** Corpo markdown. Salvo em arquivo temporário antes de passar ao `gh`. */
    body: string;
    /** Labels opcionais (max 5). */
    labels?: string[];
    /** Override do repo (default: GITHUB_REPO). */
    repo?: string;
    /** Override do timeout. */
    timeoutMs?: number;
}

export interface CreateGitHubIssueResult {
    /** URL da issue criada (https://github.com/owner/repo/issues/N). */
    url: string;
    /** Número extraído da URL, se presente. */
    number?: number;
}

/**
 * Executa o `gh` CLI com args e retorna o stdout. Lança com `.message`
 * legível em caso de falha (stderr ou err.message).
 *
 * O `promisify(execFile)` devolve um único Error em falhas (não embute stderr
 * automaticamente) — então priorizamos `err.stderr` se houver (caso a stack
 * de testes/mock adicione manualmente), caindo para `err.message`.
 */
export async function runGh(args: string[], timeoutMs = GH_DEFAULT_TIMEOUT_MS): Promise<string> {
    try {
        const { stdout } = await execFileAsync('gh', args, { timeout: timeoutMs });
        return stdout;
    } catch (err: unknown) {
        const e = err as { stderr?: string; stdout?: string; message?: string };
        const subcmd = args.slice(0, 2).join(' ');
        const detail = e.stderr?.toString()?.trim() || e.stdout?.toString()?.trim() || e.message || String(err);
        throw new Error(`gh ${subcmd} failed: ${detail}`);
    }
}

/**
 * Garante que um label existe (best-effort; ignora se já existe no repo).
 */
export async function ensureGitHubLabel(name: string, repo: string = GITHUB_REPO): Promise<void> {
    try {
        await runGh(
            ['label', 'create', name, '--repo', repo, '--color', 'D4C5F9', '--description', 'Reportado pelo app'],
            GH_LABEL_TIMEOUT_MS
        );
    } catch {
        /* já existe — ok */
    }
}

/**
 * Cria uma issue no GitHub via `gh issue create`.
 * @returns URL absoluta da issue criada + número (quando parseável).
 */
export async function createGitHubIssue(opts: CreateGitHubIssueOptions): Promise<CreateGitHubIssueResult> {
    const repo = opts.repo || GITHUB_REPO;
    const title = String(opts.title || '').trim().slice(0, 250);
    const body = opts.body || '';

    const labels = Array.isArray(opts.labels) && opts.labels.length ? opts.labels.slice(0, 5) : ['from-app'];
    for (const l of labels) await ensureGitHubLabel(l, repo);

    const args = ['issue', 'create', '--repo', repo, '--title', title, '--body', body];
    for (const l of labels) args.push('--label', l);

    const stdout = await runGh(args, opts.timeoutMs ?? GH_DEFAULT_TIMEOUT_MS);
    const url = stdout.trim().split('\n').filter(Boolean).pop() || '';
    const m = url.match(/\/issues\/(\d+)/);
    log.info('GitHub issue criada', { url, repo });
    return { url, number: m ? Number(m[1]) : undefined };
}
