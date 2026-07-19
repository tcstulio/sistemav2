/**
 * issueReportService — implementação do fluxo de "reportar problema" completo (issue #1561).
 *
 * Pipeline (POST /api/issues/report):
 *   1. Recebe payload JÁ VALIDADO (zod) pela rota — `IssueReportInput`.
 *   2. Gera `reportId` (UUID).
 *   3. Sanitiza o HTML (remove `<script>`/event handlers) — `sanitizeReportHtml`.
 *   4. Valida tamanho do screenshot (>5MB → lança AppError 413) — `assertScreenshotWithinLimit`.
 *   5. Persiste screenshot (./uploads/reports/{reportId}.png) e HTML sanitizado
 *      (./uploads/reports/{reportId}.html) em disco; URL servível é `/uploads/reports/{reportId}.png`.
 *   6. Cria a issue no GitHub via `createGitHubIssue` (helper reutilizado de githubIssueService),
 *      com screenshot embutido (data URI quando pequeno) + link + HTML em code block.
 *   7. Registra no audit log (adminAuditService) quem reportou e quando.
 *   8. Retorna `{ reportId, issueUrl }`.
 *
 * Dependências injetáveis para testes (criação de issue, audit, relógio, IO).
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createGitHubIssue } from './githubIssueService';
import { sanitizeReportHtml, assertScreenshotWithinLimit, MAX_SCREENSHOT_BYTES } from '../middleware/uploadSanitizer';
import { AppError } from '../middleware/errorHandler';
import { adminAuditService } from './adminAuditService';
import { createLogger } from '../utils/logger';

const log = createLogger('IssueReport');

/** Diretório base dos artefatos de report (relativo à CWD do processo). */
export const DEFAULT_REPORTS_DIR = path.resolve('./uploads/reports');

/** Prefixo da URL servida pelo Express (server.ts monta /uploads como estático). */
export const UPLOADS_URL_PREFIX = '/uploads/reports';

/**
 * Limite para embutir o screenshot como data URI inline no corpo da issue.
 * GitHub trunca corpos muito grandes (~65k chars). 25k é um teto seguro que
 * ainda deixa espaço para o restante do markdown.
 */
export const MAX_INLINE_DATAURI_CHARS = 25_000;

/** Tipo do payload esperado pela rota após validação zod (IssueReportSchema). */
export interface IssueReportInput {
    userId: string;
    url: string;
    viewport: string;
    userAgent: string;
    title: string;
    description?: string;
    breadcrumb?: string;
    htmlSnapshot?: string;
    screenshotBase64?: string;
    consoleErrors?: string[];
    consoleLogs?: string[];
    failedRequests?: string[];
    labels?: string[];
}

export interface Reporter {
    id?: string;
    login?: string;
    ip?: string;
}

export interface ProcessReportResult {
    reportId: string;
    issueUrl: string;
    issueNumber?: number;
    screenshotUrl: string | null;
    htmlUrl: string | null;
}

/** Dependências injetáveis (testes). */
export interface IssueReportDeps {
    createIssue?: typeof createGitHubIssue;
    audit?: typeof adminAuditService;
    reportsDir?: string;
    basePublicUrl?: string;
    now?: () => Date;
    /** Override opcional do fs para testes (padrão: fs real). */
    fsImpl?: typeof fs;
}

function safeArray(v: unknown): string[] {
    return Array.isArray(v) ? v.slice(0, 50).map(String) : [];
}

/** Constrói o markdown do corpo da issue a partir do report. */
export function buildReportIssueMarkdown(opts: {
    title: string;
    description?: string;
    reportId: string;
    input: IssueReportInput;
    reporter: Reporter;
    when: Date;
    screenshotUrl: string | null;
    screenshotBase64?: string;
    sanitizedHtml: string;
}): string {
    const { title, description, reportId, input, reporter, when, screenshotUrl, screenshotBase64, sanitizedHtml } = opts;
    const lines: string[] = [];

    lines.push(`# ${title}`, '');
    if (description && description.trim()) {
        lines.push(description.trim(), '');
    }
    lines.push('---', '');
    lines.push('### Contexto do report', '');
    lines.push(`- **Reportado por:** ${reporter.login || reporter.id || '(desconhecido)'}`);
    lines.push(`- **User ID:** \`${input.userId}\``);
    lines.push(`- **Report ID:** \`${reportId}\``);
    lines.push(`- **Quando:** ${when.toISOString()}`);
    if (input.url) lines.push(`- **URL:** \`${input.url}\``);
    if (input.breadcrumb) lines.push(`- **Onde:** ${input.breadcrumb}`);
    if (input.viewport) lines.push(`- **Viewport:** ${input.viewport}`);
    if (input.userAgent) lines.push(`- **User-Agent:** ${input.userAgent}`);

    // Screenshot: embute como data URI quando pequeno; senão, link.
    if (screenshotBase64 && screenshotBase64.length <= MAX_INLINE_DATAURI_CHARS) {
        lines.push('', '### Screenshot', '', `![screenshot-${reportId}](data:image/png;base64,${screenshotBase64})`);
        if (screenshotUrl) lines.push('', `_Link direto: ${screenshotUrl}_`);
    } else if (screenshotUrl) {
        lines.push('', '### Screenshot', '', `![screenshot-${reportId}](${screenshotUrl})`);
    }

    if (sanitizedHtml.trim()) {
        lines.push('', '### HTML snapshot (sanitizado)', '', '```html', sanitizedHtml.slice(0, 20000), '```');
    }

    const errs = safeArray(input.consoleErrors);
    if (errs.length) {
        lines.push('', '### Erros de console', '', '```', ...errs, '```');
    }
    const logs = safeArray(input.consoleLogs);
    if (logs.length) {
        lines.push('', '### Logs de console', '', '```', ...logs, '```');
    }
    const failed = safeArray(input.failedRequests);
    if (failed.length) {
        lines.push('', '### Chamadas que falharam', '', '```', ...failed, '```');
    }

    lines.push('', '_Reportado pelo botão in-app (POST /api/issues/report)._');
    return lines.join('\n');
}

/**
 * Persiste os artefatos do report (screenshot + html + manifest) em disco.
 * Retorna as URLs servíveis. Falha não-fatal no HTML (pode estar ausente).
 */
export function persistReportArtifacts(opts: {
    reportId: string;
    input: IssueReportInput;
    sanitizedHtml: string;
    screenshotBuffer: Buffer | null;
    when: Date;
    reporter: Reporter;
    reportsDir: string;
    fsImpl?: typeof fs;
}): { screenshotUrl: string | null; htmlUrl: string | null; screenshotPath: string | null; htmlPath: string | null } {
    const fsImpl = opts.fsImpl || fs;
    const { reportId, input, sanitizedHtml, screenshotBuffer, when, reporter, reportsDir } = opts;

    fsImpl.mkdirSync(reportsDir, { recursive: true });

    let screenshotPath: string | null = null;
    let screenshotUrl: string | null = null;
    if (screenshotBuffer && screenshotBuffer.length > 0) {
        screenshotPath = path.join(reportsDir, `${reportId}.png`);
        fsImpl.writeFileSync(screenshotPath, screenshotBuffer);
        screenshotUrl = `${UPLOADS_URL_PREFIX}/${reportId}.png`;
    }

    let htmlPath: string | null = null;
    let htmlUrl: string | null = null;
    if (sanitizedHtml.trim()) {
        htmlPath = path.join(reportsDir, `${reportId}.html`);
        fsImpl.writeFileSync(htmlPath, sanitizedHtml, 'utf8');
        htmlUrl = `${UPLOADS_URL_PREFIX}/${reportId}.html`;
    }

    // Manifest JSON associado ao reportId — permite reabrir/auditar o contexto depois.
    const manifestPath = path.join(reportsDir, `${reportId}.json`);
    const manifest = {
        reportId,
        when: when.toISOString(),
        reporter: { id: reporter.id, login: reporter.login, ip: reporter.ip },
        payload: {
            userId: input.userId,
            url: input.url,
            viewport: input.viewport,
            userAgent: input.userAgent,
            breadcrumb: input.breadcrumb || '',
            consoleErrors: safeArray(input.consoleErrors),
            consoleLogs: safeArray(input.consoleLogs),
            failedRequests: safeArray(input.failedRequests),
        },
        artifacts: {
            screenshot: screenshotUrl,
            html: htmlUrl,
        },
    };
    fsImpl.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    return { screenshotUrl, htmlUrl, screenshotPath, htmlPath };
}

/**
 * Processa um report recebido pela rota. Orquestra todo o pipeline do #1561.
 *
 * @throws {AppError} 413 se o screenshot exceder MAX_SCREENSHOT_BYTES.
 * @throws              propaga erros da createGitHubIssue (rede/`gh`).
 */
export async function processIssueReport(
    input: IssueReportInput,
    reporter: Reporter,
    deps: IssueReportDeps = {},
): Promise<ProcessReportResult> {
    const createIssue = deps.createIssue || createGitHubIssue;
    const audit = deps.audit || adminAuditService;
    const reportsDir = deps.reportsDir || DEFAULT_REPORTS_DIR;
    const basePublicUrl = (deps.basePublicUrl || '').replace(/\/+$/, '');
    const when = (deps.now || (() => new Date()))();

    const reportId = randomUUID();

    // (3) sanitiza HTML — remove <script>/on* attributes, mantém estrutura.
    const sanitizedHtml = sanitizeReportHtml(input.htmlSnapshot);

    // (4) valida tamanho do screenshot -> Buffer (lança AppError 413 se > 5MB).
    let screenshotBuffer: Buffer | null = null;
    if (input.screenshotBase64) {
        screenshotBuffer = assertScreenshotWithinLimit(input.screenshotBase64);
    }

    // (2)+(5) persiste screenshot + HTML + manifest em ./uploads/reports/{reportId}.{png,html,json}
    const { screenshotUrl, htmlUrl } = persistReportArtifacts({
        reportId,
        input,
        sanitizedHtml,
        screenshotBuffer,
        when,
        reporter,
        reportsDir,
        fsImpl: deps.fsImpl,
    });

    // URL absoluta (se basePublicUrl informada) — usada no corpo da issue para o GitHub.
    const absoluteScreenshotUrl = screenshotUrl && basePublicUrl
        ? `${basePublicUrl}${screenshotUrl}`
        : screenshotUrl;

    // (6) monta o corpo da issue e cria no GitHub reutilizando createGitHubIssue.
    const body = buildReportIssueMarkdown({
        title: input.title,
        description: input.description,
        reportId,
        input,
        reporter,
        when,
        screenshotUrl: absoluteScreenshotUrl,
        screenshotBase64: input.screenshotBase64,
        sanitizedHtml,
    });

    let issueUrl = '';
    let issueNumber: number | undefined;
    try {
        const created = await createIssue({
            title: input.title,
            body,
            labels: input.labels && input.labels.length ? input.labels : ['from-app'],
        });
        issueUrl = created.url;
        issueNumber = created.number;
    } catch (e: any) {
        log.error('Falha ao criar issue no GitHub para report', { reportId, error: e?.message });
        // Auditoria even on failure — quem reportou e quando + motivo.
        audit.record({
            adminId: reporter.id || 'unknown',
            adminLogin: reporter.login || 'unknown',
            action: 'issue.report.github_failed',
            target: reportId,
            summary: `Report ${reportId} por ${reporter.login || reporter.id || '?'} — falha ao criar issue: ${e?.message || e}`,
        });
        throw e;
    }

    // (7) audit log — quem reportou e quando (sucesso).
    audit.record({
        adminId: reporter.id || 'unknown',
        adminLogin: reporter.login || 'unknown',
        action: 'issue.report',
        target: reportId,
        summary: `Report ${reportId} por ${reporter.login || reporter.id || '?'} em ${when.toISOString()} — issue ${issueNumber || issueUrl || '(sem issue)'}`,
    });

    log.info('Report processado', { reportId, issueUrl, reporter: reporter.login });

    return { reportId, issueUrl, issueNumber, screenshotUrl, htmlUrl };
}

/** Reexporta constantes úteis para testes/rotas. */
export { MAX_SCREENSHOT_BYTES };
