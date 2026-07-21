/**
 * Helpers de SANITIZAÇÃO + TRUNCAMENTO de HTML para o body do GitHub issue
 * (issue #1563). Mantém o body bem ABAIXO do limite hard de 60KB da API
 * do GitHub, considerando todas as outras seções (URL, console logs,
 * contexto capturado, etc.).
 *
 * Separado de `services/issueReportService.ts` para:
 *   - ficar testável sem mockar fs/uuid/process;
 *   - ser reusado por QUALQUER ponto que precise colar HTML no body
 *     (futuro webhook de report, novas rotas de report, etc).
 */
import sanitizeHtml from 'sanitize-html';

/**
 * Limite inline do HTML snapshot no body do issue GitHub (#1563).
 * Mantém o body bem abaixo do limite hard de 60KB da API do GitHub.
 */
export const HTML_SNAPSHOT_BODY_MAX_BYTES = 5 * 1024; // 5KB

export interface SanitizedHtmlResult {
    /** HTML pronto p/ colar no `<details>` do body (sanitizado, truncado). */
    html: string;
    /** True quando o conteúdo foi cortado (marcador `...truncado` presente). */
    truncated: boolean;
}

/**
 * Política padrão de sanitização para snapshots HTML (issue #1563).
 * Alinhada com `persistHtmlSnapshot` em `issueReportService.ts` para que
 * o anexo em disco e o body compartilhem a MESMA política (consistência
 * p/ triagem). Marca tags/atributos "executáveis" como proibidos e
 * bloqueia schemes `javascript:`.
 */
export const HTML_SANITIZE_OPTS: sanitizeHtml.IOptions = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        'img', 'style', 'figure', 'figcaption', 'picture', 'source',
        'details', 'summary', 'mark', 'kbd', 'code', 'pre',
    ]),
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        '*': ['class', 'id', 'style', 'role', 'data-*', 'aria-*', 'title'],
        img: ['src', 'alt', 'width', 'height', 'loading'],
        a: ['href', 'name', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
};

/**
 * Aplica a política padrão de sanitização (sem truncar). Re-exportada
 * aqui para servir como single-source-of-truth — `issueReportService`
 * importa daqui p/ manter o anexo em disco e o body idênticos.
 */
export function sanitizeHtmlSnapshot(html: string): string {
    return sanitizeHtml(html, HTML_SANITIZE_OPTS);
}

/**
 * Sanitiza + trunca para inclusão inline no body do GitHub issue (#1563).
 * Limite default: 5KB (HTML_SNAPSHOT_BODY_MAX_BYTES).
 * - NUNCA lança: devolve `{ html: '', truncated: false }` p/ entradas vazias.
 * - Ao truncar, preserva o último fechamento de tag ANTES do limite para
 *   não quebrar a estrutura do HTML.
 * - Anexa o marcador `...truncado` no final quando trunca.
 *
 * @param html      HTML a sanitizar (vazio/inválido → vazio).
 * @param maxBytes  Limite em BYTES (default 5KB); customizável p/ testes.
 */
export function sanitizeForIssueBody(
    html: string,
    maxBytes: number = HTML_SNAPSHOT_BODY_MAX_BYTES,
): SanitizedHtmlResult {
    if (!html || typeof html !== 'string') {
        return { html: '', truncated: false };
    }

    let cleaned: string;
    try {
        cleaned = sanitizeHtml(html, HTML_SANITIZE_OPTS);
    } catch {
        return { html: '', truncated: false };
    }

    const totalBytes = Buffer.byteLength(cleaned, 'utf8');
    if (totalBytes <= maxBytes) {
        return { html: cleaned, truncated: false };
    }

    // Truncar por chars (sanitização remove handlers/javascript: encoders
    // que inflariam, então p/ HTMLs típicos o teto de chars ≈ teto de bytes).
    // O algoritmo INCLUI o `>` da última tag de fechamento encontrada no
    // slice — assim a última tag fica completa no output (HTML válido).
    // O overhead de bytes extra cai em "alguns por tag" (≤ ~10), sempre
    // bem dentro do limite hard de 60KB da API do GitHub.
    const sliced = cleaned.slice(0, maxBytes);
    const lastOpen = sliced.lastIndexOf('</');
    let base: string;
    if (lastOpen > 0) {
        const closeEnd = sliced.indexOf('>', lastOpen);
        base = closeEnd > 0 ? sliced.slice(0, closeEnd + 1) : sliced;
    } else {
        // Sem tag de fechamento antes do limite — fallback: corta seco.
        base = sliced;
    }
    return {
        html: `${base}...truncado`,
        truncated: true,
    };
}
