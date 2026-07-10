/**
 * taskPreCheck — Serviço de análise prévia de tasks (#1015, Epic #972).
 *
 * Recebe uma task nova (título + body) e devolve um `PrecheckReport` indicando
 * se o problema descrito já existe (duplicado), já foi resolvido (commit/issue
 * fechada), é um falso relato (referência a arquivo inexistente) ou tem baixa
 * evidência (nenhum rastro nos logs/código). Orquestra as MESMAS fontes internas
 * expostas ao agente (list_github_issues, list_opencode_tasks, git_recent,
 * read_logs, read_project_file), mas de forma estruturada e tipada.
 *
 * USO:
 *   import { analyzeTask } from './services/taskPreCheck';
 *   const report = await analyzeTask({ title: 'Erro ao salvar cliente', body: '...' });
 *   if (report.verdict === 'duplicate') { ... report.originalUrl }
 *   // report.suggestedAction ∈ 'proceed' | 'ask_user' | 'reject'
 *   // report.confidence ∈ [0,1]
 *
 * As fontes de dados (GitHub, git, logs, tasks, FS) são injetáveis via 2º
 * argumento para facilitar testes unitários (mocks das chamadas internas). Em
 * produção, omitir o 2º argumento usa a implementação default (gh/git/FS reais +
 * buffer de logs + taskRunnerService).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, getRecentLogs } from '../utils/logger';
import type {
    PrecheckReport,
    PrecheckEvidence,
    PrecheckSuggestedAction,
} from './taskRunnerService';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const REPO = 'tcstulio/sistemav2';

const log = createLogger('TaskPreCheck');

/** Limiares de similaridade/decisão (ajustados para PT-BR, normalizando acentos). */
const DUPLICATE_THRESHOLD = 0.55; // issue/task aberta muito parecida → duplicado
const RESOLVED_ISSUE_THRESHOLD = 0.5; // issue fechada parecida → já resolvido
const DEFAULT_GH_LIMIT = 20;
const DEFAULT_GIT_LIMIT = 20;
const DEFAULT_LOG_LINES = 50;

export interface TaskPreCheckInput {
    title: string;
    body: string;
}

/** Issue bruta retornada pelo `gh issue list --json`. */
export interface RawGithubIssue {
    number: number;
    title: string;
    state?: string;
    url?: string;
    labels?: Array<{ name: string } | string>;
    body?: string;
}

/** Commit bruto解析 de `git log`. */
export interface RawGitCommit {
    hash: string;
    message: string;
    date: string;
}

/** Task do board opencode (subset de Task). */
export interface RawOpencodeTask {
    issueNumber: number;
    title: string;
    status: string;
    prNumber?: number;
}

/**
 * Fontes de dados injetáveis. Cada method mapeia 1:1 para uma tool interna do
 * agente. Em testes, passe implementações stub; em produção, use `defaultSources`.
 */
export interface PreCheckSources {
    /** equivale a list_github_issues({ state }). */
    listGithubIssues(state: 'open' | 'closed' | 'all'): Promise<RawGithubIssue[]>;
    /** equivale a list_opencode_tasks(). */
    listOpencodeTasks(): Promise<RawOpencodeTask[]>;
    /** equivale a git_recent({ limit }). */
    gitRecentCommits(limit: number): Promise<RawGitCommit[]>;
    /** equivale a read_logs({ lines }). */
    readRecentLogs(lines: number): Promise<string[]>;
    /** equivale a read_project_file só para checar existência (opcional). */
    projectFileExists?(fileHint: string): boolean;
}

/* ---------------------------------- helpers --------------------------------- */

const STOPWORDS = new Set([
    'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'que', 'na', 'no', 'nas', 'nos',
    'ao', 'aos', 'a', 'o', 'as', 'os', 'e', 'ou', 'um', 'uma', 'uns', 'umas',
    'the', 'and', 'for', 'to', 'of', 'in', 'on', 'at', 'is', 'it', 'with', 'sem',
    'com', 'por', 'pelo', 'pela', 'desde', 'ate', 'quando', 'se', 'senao', 'mais',
    'menos', 'muito', 'ja', 'nao', 'issue', 'task', 'tarefa', 'bug',
]);

/** Minúsculas + remove acentos (NFD → strip combining marks). */
export function normalizeText(s: string): string {
    return (s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

/** Conjunto de palavras-chave significantes (len>=2 após filtro de stopwords). */
export function extractKeywords(s: string): Set<string> {
    const tokens = normalizeText(s).match(/[a-z0-9]+/g) || [];
    return new Set(tokens.filter((t) => t.length >= 2 && !STOPWORDS.has(t)));
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
    let n = 0;
    for (const t of a) if (b.has(t)) n++;
    return n;
}

/** Similaridade de Jaccard sobre conjuntos de palavras-chave (0-1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    const inter = intersectionSize(a, b);
    const union = a.size + b.size - inter;
    return union > 0 ? inter / union : 0;
}

/**
 * Similaridade entre dois títulos/textos: Jaccard de palavras-chave + boost se
 * um título contém o outro (normalizado). Resultado em [0,1].
 */
export function textSimilarity(a: string, b: string): number {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) return 0;
    const base = jaccard(extractKeywords(na), extractKeywords(nb));
    let boost = 0;
    if (na.length >= 8 && nb.length >= 8 && (na.includes(nb) || nb.includes(na))) {
        boost = 0.25;
    }
    if (na === nb) boost = Math.max(boost, 0.3);
    return Math.min(1, base + boost);
}

/** Palavras-chave "fortes" (len>=4) — usadas p/ casar logs sem ruído. */
function significantKeywords(kw: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const t of kw) if (t.length >= 4) out.add(t);
    return out;
}

/** Commit casa com a task se 2+ keywords batem, ou 1 keyword longa (len>=5). */
export function commitMatchesTask(message: string, taskKeywords: Set<string>): boolean {
    const msgKw = extractKeywords(normalizeText(message));
    const inter = intersectionSize(taskKeywords, msgKw);
    if (inter >= 2) return true;
    for (const t of taskKeywords) {
        if (t.length >= 5 && msgKw.has(t)) return true;
    }
    return false;
}

/** Linha de log casa se contém ao menos 1 keyword forte da task. */
export function logMatchesTask(line: string, sigKeywords: Set<string>): boolean {
    if (sigKeywords.size === 0) return false;
    const nl = normalizeText(line);
    for (const t of sigKeywords) if (nl.includes(t)) return true;
    return false;
}

/** Extrai pistas de arquivos (ex.: src/components/Foo.tsx) do texto. */
export function extractFileHints(text: string): string[] {
    const hints = new Set<string>();
    // sufixos mais longos primeiro p/ não capturar 'Foo.ts' dentro de 'Foo.tsx'
    const re = /([\w./-]+\.(?:tsx|ts|jsx|js|json|scss|css|py))/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text || '')) !== null) {
        hints.add(m[1]);
    }
    return [...hints];
}

function clip(s: string, max = 160): string {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
}

function issueUrl(n: number): string {
    return `https://github.com/${REPO}/issues/${n}`;
}

/* ------------------------------ fontes padrão ------------------------------- */

/** list_github_issues: chama `gh issue list --json` e devolve estruturado. */
export async function listGithubIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<RawGithubIssue[]> {
    try {
        const { stdout } = await execFileAsync('gh', [
            'issue', 'list', '--repo', REPO,
            '--state', state,
            '--json', 'number,title,state,labels,url',
            '--limit', String(DEFAULT_GH_LIMIT),
        ], { timeout: 15000, cwd: PROJECT_ROOT });
        const parsed = JSON.parse(stdout || '[]') as RawGithubIssue[];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        log.warn('listGithubIssues falhou', (e as Error)?.message);
        return [];
    }
}

/** list_opencode_tasks: delega ao taskRunnerService (board opencode). */
export async function listOpencodeTasks(): Promise<RawOpencodeTask[]> {
    try {
        const mod = require('./taskRunnerService') as typeof import('./taskRunnerService');
        const tasks = await mod.taskRunnerService.syncTasks('open');
        return tasks.map((t) => ({
            issueNumber: t.issueNumber,
            title: t.title,
            status: t.status,
            prNumber: t.prNumber,
        }));
    } catch (e) {
        log.warn('listOpencodeTasks falhou', (e as Error)?.message);
        return [];
    }
}

/** git_recent: `git log` (hash, mensagem, data relativa). */
export async function gitRecentCommits(limit: number = DEFAULT_GIT_LIMIT): Promise<RawGitCommit[]> {
    const max = Math.min(30, Math.max(1, limit));
    try {
        const { stdout } = await execFileAsync('git', [
            'log', `--max-count=${max}`, '--no-merges',
            '--pretty=format:%h%x09%s%x09%cr',
        ], { timeout: 10000, cwd: PROJECT_ROOT });
        if (!stdout.trim()) return [];
        return stdout.trim().split('\n').map((line) => {
            const [hash, message, date] = line.split('\t');
            return { hash: hash || '', message: message || '', date: date || '' };
        });
    } catch (e) {
        log.warn('gitRecentCommits falhou', (e as Error)?.message);
        return [];
    }
}

/** read_logs: últimas linhas do buffer de logs do backend. */
export function readRecentLogs(lines: number = DEFAULT_LOG_LINES): string[] {
    return getRecentLogs(lines);
}

/** read_project_file (existência only): checa FS relativo à raiz do projeto. */
export function projectFileExists(fileHint: string): boolean {
    const rel = String(fileHint || '').replace(/\\/g, '/').replace(/^\//, '');
    if (!rel) return false;
    const full = path.resolve(PROJECT_ROOT, rel);
    if (!full.startsWith(PROJECT_ROOT)) return false;
    return fs.existsSync(full);
}

/** Implementação default das fontes — usada quando analyzeTask é chamada sem deps. */
export const defaultSources: PreCheckSources = {
    listGithubIssues,
    listOpencodeTasks,
    gitRecentCommits,
    readRecentLogs: (lines: number) => Promise.resolve(readRecentLogs(lines)),
    projectFileExists,
};

/* --------------------------------- orquestração ----------------------------- */

function buildReport(
    verdict: PrecheckReport['verdict'],
    confidence: number,
    evidence: PrecheckEvidence[],
    suggestedAction: PrecheckSuggestedAction,
    reason: string,
    extra?: Partial<PrecheckReport>,
): PrecheckReport {
    return {
        verdict,
        confidence: Math.max(0, Math.min(1, confidence)),
        evidence,
        suggestedAction,
        reason,
        ...extra,
    };
}

/**
 * Analisa uma task nova e retorna um `PrecheckReport`.
 *
 * Ordem de checagem (primeiro que bate vence):
 *  1. duplicado  — issue/task aberta muito similar → 'duplicate' (ask_user)
 *  2. já resolvido — commit recente ou issue fechada que casa → 'already_resolved' (reject)
 *  3. falso relato — referência a arquivo que não existe → 'false_report' (reject)
 *  4. baixa evidência — nada nos logs nem no código → 'low_evidence' (ask_user)
 *  5. caso contrário (erro de log corrobora) → 'ok' (proceed)
 */
export async function analyzeTask(
    input: TaskPreCheckInput,
    sources: PreCheckSources = defaultSources,
): Promise<PrecheckReport> {
    const title = (input?.title || '').trim();
    const body = (input?.body || '').trim();
    const haystack = `${title}\n${body}`;
    const taskKw = extractKeywords(haystack);
    const sigKw = significantKeywords(taskKw);

    log.info('analyzeTask start', { title: clip(title, 80) });

    // 1) DUPLICADOS — issues abertas + tasks do board opencode.
    const [openIssues, ocTasks] = await Promise.all([
        sources.listGithubIssues('open').catch(() => [] as RawGithubIssue[]),
        sources.listOpencodeTasks().catch(() => [] as RawOpencodeTask[]),
    ]);

    let bestDupe: { kind: 'issue' | 'task'; number: number; title: string; url: string; score: number } | null = null;
    for (const is of openIssues) {
        const score = textSimilarity(title, is.title || '');
        if (score >= DUPLICATE_THRESHOLD && score > (bestDupe?.score ?? -1)) {
            bestDupe = { kind: 'issue', number: is.number, title: is.title, url: is.url || issueUrl(is.number), score };
        }
    }
    for (const t of ocTasks) {
        const score = textSimilarity(title, t.title || '');
        if (score >= DUPLICATE_THRESHOLD && score > (bestDupe?.score ?? -1)) {
            bestDupe = { kind: 'task', number: t.issueNumber, title: t.title, url: issueUrl(t.issueNumber), score };
        }
    }
    if (bestDupe) {
        const evidence: PrecheckEvidence[] = [{
            type: bestDupe.kind === 'task' ? 'similar_task' : 'similar_issue',
            reference: `#${bestDupe.number}`,
            excerpt: clip(bestDupe.title),
            url: bestDupe.url,
        }];
        log.info('analyzeTask verdict=duplicate', { of: bestDupe.number, score: bestDupe.score });
        return buildReport(
            'duplicate',
            Math.max(0.6, Math.min(0.95, bestDupe.score)),
            evidence,
            'ask_user',
            `Task muito similar a ${bestDupe.kind} #${bestDupe.number} já aberta`,
            { originalIssueNumber: bestDupe.number, originalUrl: bestDupe.url },
        );
    }

    // 2) JÁ RESOLVIDO — commits recentes + issues fechadas.
    const [commits, closedIssues] = await Promise.all([
        sources.gitRecentCommits(DEFAULT_GIT_LIMIT).catch(() => [] as RawGitCommit[]),
        sources.listGithubIssues('closed').catch(() => [] as RawGithubIssue[]),
    ]);

    const evidence: PrecheckEvidence[] = [];
    let resolvedHits = 0;
    for (const c of commits) {
        if (commitMatchesTask(c.message, taskKw)) {
            evidence.push({ type: 'commit', reference: c.hash, excerpt: clip(c.message) });
            resolvedHits++;
        }
    }
    for (const ci of closedIssues) {
        const score = textSimilarity(title, ci.title || '');
        if (score >= RESOLVED_ISSUE_THRESHOLD) {
            evidence.push({ type: 'similar_issue', reference: `#${ci.number}`, excerpt: clip(ci.title), url: ci.url || issueUrl(ci.number) });
            resolvedHits++;
        }
    }
    if (resolvedHits > 0) {
        log.info('analyzeTask verdict=already_resolved', { hits: resolvedHits });
        return buildReport(
            'already_resolved',
            Math.min(0.85, 0.55 + 0.1 * resolvedHits),
            evidence,
            'reject',
            `Provável já resolvido: ${resolvedHits} evidência(s) em commits/issues fechadas`,
        );
    }

    // 3) LOGS — procura erros de runtime relacionados.
    const logs = await sources.readRecentLogs(DEFAULT_LOG_LINES).catch(() => [] as string[]);
    const logHits = logs.filter((l) => logMatchesTask(l, sigKw));

    if (logHits.length > 0) {
        evidence.push({ type: 'log', reference: `${logHits.length} linha(s)`, excerpt: clip(logHits[0]) });
        log.info('analyzeTask verdict=ok', { logHits: logHits.length });
        return buildReport(
            'ok',
            0.8,
            evidence,
            'proceed',
            'Task nova com evidência de runtime nos logs',
        );
    }

    // 4) PISTAS DE CÓDIGO — se a task referencia arquivos, valida existência.
    const fileHints = extractFileHints(haystack);
    if (fileHints.length > 0 && typeof sources.projectFileExists === 'function') {
        const existing = fileHints.find((h) => sources.projectFileExists!(h));
        if (!existing) {
            for (const h of fileHints) {
                evidence.push({ type: 'missing_file', reference: h, excerpt: 'arquivo referenciado não encontrado no projeto' });
            }
            log.info('analyzeTask verdict=false_report', { hints: fileHints.length });
            return buildReport(
                'false_report',
                0.6,
                evidence,
                'reject',
                'Arquivo(s) referenciado(s) não existe(m) no projeto',
            );
        }
        evidence.push({ type: 'log', reference: existing, excerpt: 'componente existe, mas sem erro de runtime capturado' });
        log.info('analyzeTask verdict=ok (componente existe)', { file: existing });
        return buildReport('ok', 0.6, evidence, 'proceed', 'Componente referenciado existe; sem erro de runtime capturado ainda');
    }

    // 5) BAIXA EVIDÊNCIA — nenhum rastro em lugar nenhum.
    evidence.push({ type: 'log', reference: '-', excerpt: 'sem evidência nos logs nem no código' });
    log.info('analyzeTask verdict=low_evidence');
    return buildReport(
        'low_evidence',
        0.3,
        evidence,
        'ask_user',
        'Baixa evidência: nada nos logs, commits, issues ou código corrobora o relato',
    );
}

export default analyzeTask;
