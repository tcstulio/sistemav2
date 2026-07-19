/**
 * uploadSanitizer — utilitários de sanitização para o fluxo de report (issue #1561).
 *
 * Duas responsabilidades distintas e testáveis isoladamente:
 *
 *   1. `sanitizeReportHtml(html)` — remove `<script>` executáveis e atributos de
 *      event-handler (`on*`) mantendo a estrutura HTML para inspeção/debug.
 *      Usa `sanitize-html` (já usado em emailService) com uma allowlist ampla
 *      de tags estruturais.
 *
 *   2. `decodeBase64Image/b64ByteLength` + `assertScreenshotWithinLimit` —
 *      valida o tamanho real (decodificado) de um screenshot em base64,
 *      rejeitando > MAX_SCREENSHOT_BYTES com um erro operacional que a rota
 *      converte em HTTP 413.
 */

import sanitizeHtml from 'sanitize-html';
import { AppError } from './errorHandler';

/** Tamanho máximo permitido para o screenshot decodificado: 5 MiB (critério #1561). */
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/**
 * Allowlist ampla de tags estruturais para manter o snapshot legível no debug,
 * SEM incluir `script` (sanitize-html descarta tags não-listadas).
 * Mirror do padrão usado em emailService (defaults + extras).
 */
const REPORT_ALLOWED_TAGS = sanitizeHtml.defaults.allowedTags.concat([
    'html', 'head', 'body', 'title', 'meta', 'link',
    'div', 'span', 'form', 'input', 'button', 'textarea', 'select', 'option',
    'label', 'fieldset', 'legend', 'nav', 'header', 'footer', 'main',
    'section', 'article', 'aside', 'details', 'summary', 'dialog',
    'picture', 'source', 'figure', 'figcaption',
]);

/**
 * Atributos permitidos. Note: NÃO inclui `on*` (event handlers) — sanitize-html
 * descarta qualquer atributo não listado, então onclick/onload/etc. são removidos.
 * Permite `style`, `class`, `id`, ARIA e atributos comuns de layout/links.
 *
 * `aria-*` / `data-*` são aceitos via wildcard (suportado pelo sanitize-html >=2.7).
 * Espelha o padrão do emailService (spread de defaults + overrides).
 */
const REPORT_ALLOWED_ATTRIBUTES: Record<string, sanitizeHtml.AllowedAttribute[]> = {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': [
        'class', 'id', 'style', 'role', 'title', 'name', 'content', 'charset',
        'aria-*', 'data-*',
    ],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    meta: ['name', 'content', 'charset'],
    link: ['href', 'rel', 'type'],
    input: ['type', 'name', 'value', 'placeholder', 'disabled', 'checked'],
};

/**
 * Sanitiza o HTML do snapshot:
 *   - remove `<script>` (não está na allowlist);
 *   - remove atributos de event-handler (`on*`);
 *   - remove URIs perigosas (`javascript:`) em href/src (comportamento padrão);
 *   - mantém estrutura (html/head/body/div/...) para debug.
 *
 * Retorna string vazia para input vazio.
 */
export function sanitizeReportHtml(html: string | null | undefined): string {
    if (!html) return '';
    return sanitizeHtml(html, {
        allowedTags: REPORT_ALLOWED_TAGS,
        allowedAttributes: REPORT_ALLOWED_ATTRIBUTES,
        allowedSchemes: ['http', 'https', 'data', 'mailto'],
        // Não preserva comentários condicionais nem scripts.
        allowVulnerableTags: false,
        parseStyleAttributes: false,
    });
}

/**
 * Calcula o tamanho em bytes do binário representado por uma string base64,
 * SEM materializar o Buffer inteiro (útil para rejeitar cedo payloads grandes).
 * Considera padding (=) e whitespace.
 */
export function b64ByteLength(base64: string): number {
    if (!base64) return 0;
    const cleaned = base64.replace(/[^A-Za-z0-9+/=]/g, '');
    const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
    return Math.floor(cleaned.length * 3 / 4) - padding;
}

/**
 * Decodifica base64 -> Buffer. Lança se a string não é base64 válida.
 */
export function decodeBase64Image(base64: string): Buffer {
    return Buffer.from(base64, 'base64');
}

/**
 * Assegrura que o screenshot (em base64) está dentro do limite de bytes.
 * Retorna o Buffer decodificado. Lança `AppError(413, 'PAYLOAD_TOO_LARGE')`
 * se exceder MAX_SCREENSHOT_BYTES — a rota transforma em HTTP 413.
 */
export function assertScreenshotWithinLimit(base64: string): Buffer {
    const bytes = b64ByteLength(base64);
    if (bytes > MAX_SCREENSHOT_BYTES) {
        throw new AppError(413, 'PAYLOAD_TOO_LARGE', {
            message: `Screenshot excede o limite de ${MAX_SCREENSHOT_BYTES} bytes (recebido ~${bytes} bytes)`,
            details: { receivedBytes: bytes, limit: MAX_SCREENSHOT_BYTES },
        });
    }
    return decodeBase64Image(base64);
}
