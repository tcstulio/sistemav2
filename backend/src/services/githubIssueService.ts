/**
 * githubIssueService — helper reutilizável para criar issues no GitHub via `gh` CLI.
 *
 * Extraído de routes/githubRoutes.ts (issue #1561) para que o fluxo de report
 * completo (POST /api/issues/report) possa reaproveitá-lo sem duplicar a lógica.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../utils/logger';

const log = createLogger('GitHub');
const execFileAsync = promisify(execFile);

export const GITHUB_REPO = 'tcstulio/sistemav2';

/** Limite pragmático do corpo de uma issue (GitHub aceita ~65k chars). */
export const MAX_ISSUE_BODY_CHARS = 60000;

export interface CreateIssueInput {
    title: string;
    body: string;
    /** Labels opcionais; são garantidas (best-effort) antes de criar a issue. */
    labels?: string[];
    /** Defaults para GITHUB_REPO (tcstulio/sistemav2). */
    repo?: string;
}

export interface CreatedIssue {
    url: string;
    /** Número da issue, se extraído da URL. */
    number?: number;
}

/**
 * Garante que um label existe no repo (best-effort; ignora se já existe).
 * Exportado para que outros fluxos possam reusar sem necessariamente criar issue.
 */
export async function ensureLabel(name: string, repo: string = GITHUB_REPO): Promise<void> {
    try {
        await execFileAsync('gh', ['label', 'create', name, '--repo', repo, '--color', 'D4C5F9', '--description', 'Reportado pelo app'], { timeout: 15000 });
    } catch {
        /* já existe — ok */
    }
}

/**
 * Cria uma issue no GitHub via `gh issue create`.
 *
 * - Usa `--body-file` a partir de um arquivo temporário para evitar limites de
 *   linha de comando e escapamentos frágeis (mesmo padrão do githubRoutes original).
 * - Trunca o corpo em MAX_ISSUE_BODY_CHARS (GitHub rejeita corpos muito grandes).
 * - Garante cada label (best-effort) antes de criar.
 *
 * Retorna `{ url, number? }`. Lança em caso de falha — quem chama decide o status HTTP.
 */
export async function createGitHubIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    const repo = input.repo || GITHUB_REPO;
    const title = String(input.title || '').trim().slice(0, 250);
    if (!title) throw new Error('title é obrigatório');

    const body = String(input.body || '').slice(0, MAX_ISSUE_BODY_CHARS);
    const labels = Array.isArray(input.labels) ? input.labels.slice(0, 5) : [];

    for (const l of labels) await ensureLabel(l, repo);

    const tmp = path.join(os.tmpdir(), `gh-issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`);
    fs.writeFileSync(tmp, body);

    const args = ['issue', 'create', '--repo', repo, '--title', title, '--body-file', tmp];
    for (const l of labels) args.push('--label', l);

    try {
        const { stdout } = await execFileAsync('gh', args, { timeout: 30000 });
        const url = stdout.trim().split('\n').filter(Boolean).pop() || '';
        const m = url.match(/\/issues\/(\d+)/);
        const number = m ? Number(m[1]) : undefined;
        log.info('Issue criada via createGitHubIssue', { url, number, repo });
        return { url, number };
    } finally {
        fs.rmSync(tmp, { force: true });
    }
}

export default createGitHubIssue;
