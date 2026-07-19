import sanitizeHtml from 'sanitize-html';

// Helper de sanitização/truncamento de snapshots HTML anexados a reports de bug
// in-app (#1563). O HTML vem do cliente e NÃO é confiável — removemos scripts,
// handlers on*, javascript:/data: URLs etc. antes de embutir no body do issue.

/** Limite duro para o snapshot HTML embutido no issue (GitHub aceita ~60KB no body). */
export const MAX_HTML_SNAPSHOT_BYTES = 5 * 1024; // 5KB

export interface SanitizeOptions {
    /** Tamanho máximo em bytes (default 5KB). */
    maxBytes?: number;
}

export interface SanitizedSnapshot {
    /** HTML sanitizado (e truncado, se aplicável). */
    text: string;
    /** True se o original excedeu maxBytes e foi cortado. */
    truncated: boolean;
    /** Tamanho original (antes do truncamento), em bytes UTF-8. */
    originalBytes: number;
    /** Tamanho final após sanitização + truncamento, em bytes UTF-8. */
    finalBytes: number;
}

/**
 * Sanitiza HTML não-confiável mantendo apenas tags/atributos de formatação
 * (sem <script>, on*, iframes, javascript: URLs). Usa o `sanitize-html` já
 * usado no emailService — battle-tested, sem reinventar parser.
 */
export function sanitizeSnapshotHtml(input: string): string {
    if (!input) return '';
    try {
        return sanitizeHtml(input, {
            // Permite o perfil default (tags de formatação básicas) + algumas
            // úteis para snapshot de tela, sem expor nada perigoso.
            allowedTags: (sanitizeHtml.defaults.allowedTags || []).concat([
                'h1', 'h2', 'span', 'details', 'summary', 'img',
            ]),
            allowedAttributes: {
                '*': ['style', 'class', 'id', 'role', 'aria-label'],
                'a': ['href', 'title'],
                'img': ['src', 'alt', 'width', 'height'],
            },
            disallowedTagsMode: 'discard',
        });
    } catch {
        // Em caso de falha do parser, devolve texto puro (sem tags) como fallback.
        return input.replace(/<[^>]*>/g, '');
    }
}

/**
 * Trunca uma string para no máximo `maxBytes` bytes UTF-8 sem quebrar code
 * points multibyte. Retorna também o tamanho original para inspeção.
 */
export function truncateToBytes(text: string, maxBytes: number): { text: string; truncated: boolean; originalBytes: number } {
    const originalBytes = Buffer.byteLength(text, 'utf8');
    if (originalBytes <= maxBytes) {
        return { text, truncated: false, originalBytes };
    }
    const buf = Buffer.from(text, 'utf8');
    let end = Math.min(maxBytes, buf.length);
    // Recua até o início de um code point válido (não-continuação UTF-8: 10xxxxxx).
    while (end > 0 && (buf[end] & 0xC0) === 0x80) end--;
    return { text: buf.subarray(0, end).toString('utf8'), truncated: true, originalBytes };
}

/**
 * Pipeline completo: sanitiza → trunca em `maxBytes` (default 5KB).
 * Use este no issueReportService ao montar o body do GitHub issue.
 */
export function sanitizeAndTruncate(input: string, options: SanitizeOptions = {}): SanitizedSnapshot {
    const maxBytes = options.maxBytes ?? MAX_HTML_SNAPSHOT_BYTES;
    const sanitized = sanitizeSnapshotHtml(input);
    const { text, truncated, originalBytes } = truncateToBytes(sanitized, maxBytes);
    return {
        text,
        truncated,
        originalBytes,
        finalBytes: Buffer.byteLength(text, 'utf8'),
    };
}
