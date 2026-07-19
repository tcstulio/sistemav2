// Serviço de montagem do body (markdown) do GitHub issue a partir do contexto
// capturado in-app pelo botão "Reportar problema" (#1563).
//
// Função pura (`buildIssueBody`) — pode ser usada tanto para criar um issue
// novo (POST /api/github/issues) quanto para re-enviar/atualizar um issue
// existente (PUT/edit no mesmo número), garantindo formato idêntico.

import { sanitizeAndTruncate } from '../utils/sanitizeHtml';

const GITHUB_BODY_LIMIT = 60000; // GitHub rejeita bodies > ~64KB; usamos 60KB com folga.
const MAX_LOG_LINES = 20;

/** Contexto capturado no front (ReportButton) + campos novos (#1563). */
export interface ReportContext {
    // Campos já enviados hoje:
    url?: string;
    breadcrumb?: string;
    element?: string;
    source?: string;
    viewport?: string;
    userAgent?: string;
    consoleErrors?: string[];
    failedRequests?: string[];
    // Campos novos (#1563 — contexto visual automático):
    /** URL pública da screenshot já uploaded (ex.: GitHub asset / imgur / S3). */
    screenshotUrl?: string;
    /** Snapshot do HTML da página (será sanitizado + truncado em 5KB). */
    html?: string;
    /** Logs de console (nível info/log) — em adição aos consoleErrors. */
    consoleLogs?: string[];
}

export interface BuildIssueBodyOptions {
    /** Identidade de quem reportou (login ou nome), exibida no header. */
    reporter?: string;
}

/**
 * Monta o corpo markdown do GitHub issue. Layout:
 *
 *   <descrição livre>
 *
 *   ### Contexto visual        ← screenshot embutido (se houver)
 *   ![screenshot](url)
 *
 *   ---
 *   ### Contexto capturado automaticamente
 *   - **Reportado por:** ...
 *   - **Tela (URL):** ...
 *   ...
 *
 *   #### Console logs/erros      ← code block, últimos 20
 *   ```
 *   ...
 *   ```
 *
 *   <details><summary>HTML snapshot (sanitizado)</summary>   ← colapsável, 5KB max
 *   ```html
 *   ...
 *   ```
 *   </details>
 *
 * Se não houver screenshot, a seção "Contexto visual" é omitida mas o HTML
 * snapshot continua presente (quando houver).
 */
export function buildIssueBody(
    description: string,
    context: ReportContext | unknown,
    options: BuildIssueBodyOptions | string = {},
): string {
    const c = (context || {}) as ReportContext;
    const reporter = typeof options === 'string' ? options : options.reporter;
    const lines: string[] = [];

    // Descrição livre do usuário.
    lines.push(description?.trim() || '_(sem descrição)_', '');

    // === Contexto visual (screenshot embutido no topo) ===
    const shot = typeof c.screenshotUrl === 'string' ? c.screenshotUrl.trim() : '';
    if (shot) {
        lines.push('### Contexto visual', '');
        lines.push(`![screenshot](${shot})`, '');
    }

    lines.push('---', '', '### Contexto capturado automaticamente', '');
    if (reporter) lines.push(`- **Reportado por:** ${reporter}`);
    if (c.url) lines.push(`- **Tela (URL):** \`${c.url}\``);
    if (c.breadcrumb) lines.push(`- **Onde:** ${c.breadcrumb}`);
    if (c.element) lines.push(`- **Elemento:** \`${c.element}\``);
    if (c.source) lines.push(`- **Fonte (dev):** \`${c.source}\``);
    if (c.viewport) lines.push(`- **Viewport:** ${c.viewport}`);
    if (c.userAgent) lines.push(`- **Navegador:** ${c.userAgent}`);

    // === Console logs/erros em code block (últimos 20) ===
    const logs = pickLastLogs(c.consoleErrors, c.consoleLogs);
    if (logs.length) {
        lines.push('', '#### Console logs/erros', '```', ...logs, '```');
    }

    if (Array.isArray(c.failedRequests) && c.failedRequests.length) {
        lines.push('', '#### Chamadas de API que falharam', '```', ...c.failedRequests.slice(0, 20), '```');
    }

    // === HTML snapshot sanitizado em <details> colapsável ===
    const htmlRaw = typeof c.html === 'string' ? c.html : '';
    if (htmlRaw.trim()) {
        const { text, truncated, originalBytes } = sanitizeAndTruncate(htmlRaw);
        const warning = truncated
            ? `\n<!-- ...truncado (${originalBytes} bytes > 5KB; exibindo apenas o início) -->`
            : '';
        lines.push(
            '',
            '<details><summary>HTML snapshot (sanitizado)</summary>',
            '',
            '```html',
            `${text}${warning}`,
            '```',
            '',
            '</details>',
            '',
        );
    }

    lines.push('', '_Reportado pelo botão in-app (Reportar problema)._');

    let body = lines.join('\n');
    if (body.length > GITHUB_BODY_LIMIT) {
        body = body.slice(0, GITHUB_BODY_LIMIT);
    }
    return body;
}

/**
 * Combina consoleErrors + consoleLogs e devolve os últimos MAX_LOG_LINES.
 * Mantém os mais recentes ao final (comportamento equivalente ao cap original
 * que fazia `.slice(0, 20)` sobre consoleErrors — agora estendido para também
 * englobar logs info).
 */
function pickLastLogs(consoleErrors: unknown, consoleLogs: unknown): string[] {
    const errs = Array.isArray(consoleErrors) ? consoleErrors.filter(Boolean) : [];
    const logs = Array.isArray(consoleLogs) ? consoleLogs.filter(Boolean) : [];
    const all = [...errs, ...logs].map(String);
    if (!all.length) return [];
    return all.slice(-MAX_LOG_LINES);
}
