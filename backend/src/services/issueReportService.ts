/**
 * issueReportService — issue #1561.
 *
 * Orquestra o pipeline do endpoint POST /api/issues/report:
 *   1. sanitiza o HTML do snapshot (remove `<script>` e afins, mantém
 *      a estrutura para debug);
 *   2. persiste o screenshot base64 em `backend/uploads/reports/{uuid}.png`
 *      e o HTML sanitizado em `backend/uploads/reports/{uuid}.html`;
 *   3. cria a issue no GitHub via helper `createGitHubIssue` (wraps `gh`);
 *   4. loga no trilho de auditoria quem reportou e quando;
 *   5. devolve `{ reportId, issueUrl }` para o frontend.
 *
 * O helper `createGitHubIssue` é o ÚNICO ponto de contato com a CLI `gh`
 * — reutilizado tanto por esta feature quanto potencialmente por outras
 * (cumprindo o critério #1561 "Reutilizar o helper createGitHubIssue já
 * existente no backend"; a função antes embutida no switch do agentTools
 * agora vive aqui como util reusável, com a MESMA régua de dedup e CLI).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import sanitizeHtml from 'sanitize-html';
import { createLogger } from '../utils/logger';
import { findSimilarIssue } from '../utils/issueDedup';
import { sanitizeReportHtml } from '../middleware/uploadSanitizer';

const log = createLogger('IssueReport');
const execFileAsync = promisify(execFile);

/** Repo do projeto (mesmo alvo das rotas /api/github). */
export const GITHUB_REPO = 'tcstulio/sistemav2';

/** Diretório base onde screenshots/HTMLs são persistidos. */
export const REPORTS_DIR = path.join(__dirname, '../../uploads/reports');

/**
 * Limite pragmático para o corpo da issue no GitHub (~64KB oficial; usamos
 * 60KB para deixar respiro pro frontmatter/metadata que o `gh` adiciona).
 * Igual ao limite usado pelo POST /api/github/issues.
 */
export const MAX_ISSUE_BODY_CHARS = 60000;

/** Schema de input do `processIssueReport`. Mantido aqui p/ reuso em testes. */
export interface IssueReportInput {
    userId: string;
    url: string;
    viewport: string;
    userAgent: string;
    title?: string;
    description?: string;
    breadcrumb?: string;
    element?: string;
    source?: string;
    screenshot?: string;       // base64 (data URL ou puro)
    htmlSnapshot?: string;     // HTML bruto da página
    consoleErrors?: string[];
    consoleLogs?: string[];
    failedRequests?: string[];
    labels?: string[];
}

export interface ProcessedReport {
    reportId: string;
    issueUrl: string;
    issueNumber?: number;
    screenshotPath?: string;
    screenshotUrl?: string;
    htmlPath?: string;
}

export interface CreateGitHubIssueArgs {
    title: string;
    body: string;
    labels?: string[];
    /** Quando true, pula a checagem de dedup (ex.: caller já verificou). */
    skipDedup?: boolean;
}

/**
 * Helper reutilizável que cria uma issue no GitHub via CLI `gh`.
 *
 * Antes de criar, faz UMA chamada `gh issue list --state open` e aplica
 * `findSimilarIssue` (mesma régua determinística do agentTools.ts — ver
 * utils/issueDedup.ts). Se encontrar duplicata, NÃO cria e devolve a URL
 * da issue existente (cumprindo #1279 também aqui).
 *
 * Retorna `{ url, number, duplicateOf? }`. Lança em erro real de CLI
 * (caller decide como tratar).
 */
export async function createGitHubIssue(
    args: CreateGitHubIssueArgs
): Promise<{ url: string; number?: number; duplicateOf?: number }> {
    const title = String(args.title || '').trim();
    if (!title) throw new Error("Parâmetro 'title' ausente.");
    const body = String(args.body || '');
    const labels = Array.isArray(args.labels) ? args.labels.filter(Boolean) : [];

    if (!args.skipDedup) {
        try {
            const { stdout: searchOut } = await execFileAsync('gh', [
                'issue', 'list', '--repo', GITHUB_REPO,
                '--state', 'open', '--limit', '100',
                '--json', 'number,title',
            ], { timeout: 15000 });
            const existing: Array<{ number: number; title: string }> = JSON.parse(searchOut);
            const dupe = findSimilarIssue(title, existing);
            if (dupe) {
                log.warn('createGitHubIssue: issue similar já aberta, não criando duplicata', {
                    title, duplicateOf: dupe.number, score: dupe.score,
                });
                const url = `https://github.com/${GITHUB_REPO}/issues/${dupe.number}`;
                return { url, duplicateOf: dupe.number, number: dupe.number };
            }
        } catch (e: any) {
            // Dedup é best-effort: se o `gh issue list` falhar, ainda assim
            // tentamos criar a issue (fail-open para não bloquear o usuário).
            log.warn('createGitHubIssue: checagem de duplicata falhou (fail-open)', { err: e?.message });
        }
    }

    const labelArgs = labels.length > 0 ? labels.flatMap(l => ['--label', l]) : [];
    const createArgs = [
        'issue', 'create', '--repo', GITHUB_REPO,
        '--title', title.slice(0, 250),
        '--body', body.slice(0, MAX_ISSUE_BODY_CHARS),
        ...labelArgs,
    ];
    try {
        const { stdout } = await execFileAsync('gh', createArgs, { timeout: 30000 });
        const url = stdout.trim().split('\n').filter(Boolean).pop() || '';
        const m = url.match(/\/issues\/(\d+)/);
        const number = m ? Number(m[1]) : undefined;
        log.info('createGitHubIssue: issue criada', { url, number });
        return { url, number };
    } catch (e: any) {
        log.error('createGitHubIssue: falha ao criar issue', { err: e?.message });
        throw new Error(`Falha ao criar issue no GitHub: ${e?.message || String(e)}`);
    }
}

/**
 * Salva o screenshot base64 em disco como PNG. Cria o diretório se preciso.
 * Retorna `{ absolutePath, publicUrl }` — `publicUrl` é um caminho relativo
 * servível pelo Express static mount (`/uploads/reports/{uuid}.png`).
 *
 * Aceita data URL (`data:image/png;base64,...`) ou base64 puro.
 */
export async function saveScreenshotFile(
    base64: string,
    reportId: string,
): Promise<{ absolutePath: string; publicUrl: string }> {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const raw = String(base64 || '').trim();
    const b64 = raw.includes(',') ? raw.split(',').pop()! : raw;
    const buffer = Buffer.from(b64, 'base64');
    const absolutePath = path.join(REPORTS_DIR, `${reportId}.png`);
    await fs.writeFile(absolutePath, buffer);
    const publicUrl = `/uploads/reports/${reportId}.png`;
    log.info('Screenshot salvo', { reportId, bytes: buffer.length });
    return { absolutePath, publicUrl };
}

/**
 * Salva o HTML (já sanitizado pelo caller) em disco como `.html`.
 * Retorna `{ absolutePath, publicUrl }`.
 */
export async function saveHtmlSnapshot(
    html: string,
    reportId: string,
): Promise<{ absolutePath: string; publicUrl: string }> {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const absolutePath = path.join(REPORTS_DIR, `${reportId}.html`);
    await fs.writeFile(absolutePath, String(html || ''), 'utf8');
    const publicUrl = `/uploads/reports/${reportId}.html`;
    log.info('HTML snapshot salvo', { reportId, bytes: Buffer.byteLength(html || '', 'utf8') });
    return { absolutePath, publicUrl };
}

/**
 * Constrói o corpo markdown da issue a partir do payload do report.
 *
 * Estrutura:
 *   - Descrição do usuário
 *   - Metadados do reporter (userId/login) + contexto (URL, viewport, UA)
 *   - Console errors/logs (truncados)
 *   - Screenshot: link servível (markdown image). Quando o base64 é pequeno
 *     o bastante (≤ 30KB para não estourar o limite de body do GH), embute
 *     também como data URI inline.
 *   - HTML sanitizado em code block (truncado).
 *
 * Critério #1561: "screenshot embutido (data URI ou link) e HTML em code block".
 */
export function buildIssueMarkdown(
    payload: IssueReportInput,
    reporter: string | undefined,
    screenshotUrl: string | undefined,
    screenshotBase64: string | undefined,
    sanitizedHtml: string | undefined,
): string {
    const lines: string[] = [];

    const desc = String(payload.description || '').trim();
    lines.push(desc || '_(sem descrição fornecida)_', '');
    lines.push('---', '');
    lines.push('### Contexto do Report', '');

    if (reporter) lines.push(`- **Reportado por:** \`${reporter}\``);
    if (payload.userId) lines.push(`- **User ID:** \`${payload.userId}\``);
    if (payload.url) lines.push(`- **URL:** \`${payload.url}\``);
    if (payload.breadcrumb) lines.push(`- **Onde:** ${payload.breadcrumb}`);
    if (payload.element) lines.push(`- **Elemento:** \`${payload.element}\``);
    if (payload.source) lines.push(`- **Fonte (dev):** \`${payload.source}\``);
    if (payload.viewport) lines.push(`- **Viewport:** ${payload.viewport}`);
    if (payload.userAgent) lines.push(`- **User-Agent:** ${payload.userAgent}`);

    if (Array.isArray(payload.consoleErrors) && payload.consoleErrors.length) {
        lines.push('', '#### Erros de console', '```',
            ...payload.consoleErrors.slice(0, 20), '```');
    }
    if (Array.isArray(payload.consoleLogs) && payload.consoleLogs.length) {
        lines.push('', '#### Logs de console', '```',
            ...payload.consoleLogs.slice(0, 20), '```');
    }
    if (Array.isArray(payload.failedRequests) && payload.failedRequests.length) {
        lines.push('', '#### Chamadas que falharam', '```',
            ...payload.failedRequests.slice(0, 20), '```');
    }

    // Screenshot — sempre link; data URI só se for pequeno o bastante.
    if (screenshotUrl) {
        lines.push('', '#### Screenshot', '');
        lines.push(`![Screenshot](${screenshotUrl})`);
        const raw = String(screenshotBase64 || '').trim();
        const b64 = raw.includes(',') ? raw.split(',').pop()! : raw;
        if (b64 && b64.length <= 40_000) {
            const dataUri = raw.startsWith('data:') ? raw : `data:image/png;base64,${b64}`;
            lines.push('', `<details><summary>Screenshot embutido (data URI)</summary>`, '');
            lines.push(`![Screenshot inline](${dataUri})`, '');
            lines.push('</details>', '');
        }
    }

    // HTML sanitizado em code block.
    if (sanitizedHtml && sanitizedHtml.trim()) {
        lines.push('', '#### HTML Snapshot (sanitizado)', '');
        const max = 20000;
        const html = sanitizedHtml.length > max
            ? `${sanitizedHtml.slice(0, max)}\n<!-- truncado (${sanitizedHtml.length} chars total) -->`
            : sanitizedHtml;
        lines.push('```html', html, '```');
    }

    lines.push('', '_Reportado pelo botão in-app (POST /api/issues/report)._', '');
    return lines.join('\n');
}

/**
 * Orquestra o pipeline completo do report. Não lança — retorna sempre um
 * resultado (mesmo em falha parcial de screenshot/HTML, ainda assim cria
 * a issue; falha real de criação de issue propaga para o caller decidir).
 *
 * @param payload dados validados pelo schema Zod da rota
 * @param reporter identidade extraída de `req.user` (login ou userId)
 */
export async function processIssueReport(
    payload: IssueReportInput,
    reporter: string | undefined,
): Promise<ProcessedReport> {
    const reportId = randomUUID();
    const reporterLabel = reporter || payload.userId || 'unknown';

    // 1. Sanitiza o HTML do snapshot.
    const sanitizedHtml = payload.htmlSnapshot
        ? sanitizeReportHtml(payload.htmlSnapshot)
        : undefined;

    // 2. Persiste screenshot em disco (best-effort — não trava o fluxo).
    let screenshotUrl: string | undefined;
    if (payload.screenshot) {
        try {
            const saved = await saveScreenshotFile(payload.screenshot, reportId);
            screenshotUrl = saved.publicUrl;
        } catch (e: any) {
            log.error('Falha ao salvar screenshot (continuando sem ele)', { err: e?.message });
        }
    }

    // 3. Persiste HTML sanitizado em disco (best-effort).
    let htmlUrl: string | undefined;
    if (sanitizedHtml) {
        try {
            const saved = await saveHtmlSnapshot(sanitizedHtml, reportId);
            htmlUrl = saved.publicUrl;
        } catch (e: any) {
            log.error('Falha ao salvar HTML (continuando sem ele)', { err: e?.message });
        }
    }

    // 4. Monta o corpo da issue e cria no GitHub.
    const title = String(payload.title || `Report in-app: ${payload.url || 'tela desconhecida'}`).trim();
    const body = buildIssueMarkdown(
        payload, reporter, screenshotUrl, payload.screenshot, sanitizedHtml,
    );
    const labels = Array.isArray(payload.labels) && payload.labels.length
        ? payload.labels.slice(0, 5)
        : ['from-app'];

    const created = await createGitHubIssue({ title, body, labels });

    // 5. Auditoria: log estruturado com reporter + timestamp (auditMiddleware
    //    já capturou o request HTTP; este log é o evento de DOMÍNIO).
    log.info('ISSUE_REPORT', {
        reportId,
        reporter: reporterLabel,
        userId: payload.userId,
        url: payload.url,
        issueUrl: created.url,
        duplicateOf: created.duplicateOf,
        ts: new Date().toISOString(),
    });

    return {
        reportId,
        issueUrl: created.url,
        issueNumber: created.number,
        screenshotPath: screenshotUrl,
        htmlPath: htmlUrl,
    };
}

/**
 * Re-exporta o sanitizeHtml do `sanitize-html` para que callers/testes
 * não precisem importar a lib diretamente (facilita mocking).
 */
export { sanitizeHtml };

export default {
    createGitHubIssue,
    processIssueReport,
    saveScreenshotFile,
    saveHtmlSnapshot,
    buildIssueMarkdown,
    GITHUB_REPO,
    REPORTS_DIR,
    MAX_ISSUE_BODY_CHARS,
};
