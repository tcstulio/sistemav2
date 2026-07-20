/**
 * Upload Sanitizer — issue #1561.
 *
 * Utilitários de sanitização para o endpoint de report de issues
 * (POST /api/issues/report). Mantém a casca fina e testável:
 *
 *   - `decodeBase64Size`: estima o tamanho (bytes) do binário decodificado
 *     a partir de um data URL (`data:image/png;base64,...`) ou base64 puro.
 *   - `screenshotSizeGuard`: middleware Express que rejeita screenshots
 *     > 5MB com 413 (envelope `{ success:false, error:{...} }`) ANTES de
 *     tocar o service. Critério de aceite #1561.
 *   - `sanitizeReportHtml`: remove `<script>` executáveis (e demais tags
 *     perigosas do padrão do `sanitize-html`) mantendo a estrutura de
 *     marcação para debug. Critério de aceite #1561.
 *
 * Não depende de services nem de IO — pure utils, fáceis de testar.
 */
import { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';
import { fail } from '../utils/apiResponse';

/** Limite máximo aceito para o screenshot decodificado (5MB). */
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/**
 * Estima o tamanho (em bytes) do binário decodificado a partir de uma
 * string base64. Aceita tanto data URLs (`data:image/png;base64,AAA...`)
 * quanto base64 puro (`AAA...`). Retorna 0 para vazio/inválido.
 *
 * Fórmula: cada caractere base64 codifica 6 bits → 4 chars = 3 bytes.
 * Subtraímos o padding (`=`) antes de aplicar o fator 3/4.
 */
export function decodeBase64Size(input: unknown): number {
    if (typeof input !== 'string') return 0;
    const s = input.trim();
    if (!s) return 0;
    // Desconsidera o prefixo data URL quando presente.
    const b64 = s.includes(',') ? s.split(',').pop()! : s;
    if (!b64) return 0;
    const paddingMatch = b64.match(/=+$/);
    const padding = paddingMatch ? paddingMatch[0].length : 0;
    const len = b64.length - padding;
    if (len <= 0) return 0;
    return Math.floor(len * 0.75);
}

/**
 * Middleware Express que rejeita screenshots > 5MB com 413 antes de
 * chamar o service. Escreve direto na resposta via `fail()` (envelope
 * padronizado) — não delega ao errorHandler global porque 413 não está
 * na lista de códigos "safe" do sanitizer de mensagens do handler.
 *
 * Se o campo `screenshot` estiver ausente, apenas chama next() — a
 * obrigatoriedade (se aplicável) é responsabilidade do schema Zod da
 * rota, não deste guard.
 */
export function screenshotSizeGuard(req: Request, res: Response, next: NextFunction): void {
    const screenshot = (req.body as Record<string, unknown> | undefined)?.screenshot;
    if (typeof screenshot !== 'string' || screenshot.length === 0) {
        return next();
    }
    const size = decodeBase64Size(screenshot);
    if (size > MAX_SCREENSHOT_BYTES) {
        const mb = (size / 1024 / 1024).toFixed(2);
        const maxMb = (MAX_SCREENSHOT_BYTES / 1024 / 1024).toFixed(0);
        fail(
            res,
            'PAYLOAD_TOO_LARGE',
            `Screenshot excede o limite de ${maxMb}MB (recebido: ${mb}MB)`,
            413,
            { maxBytes: MAX_SCREENSHOT_BYTES, receivedBytes: size }
        );
        return;
    }
    next();
}

/**
 * Sanitiza o HTML do snapshot do report.
 *
 * Remove tags executáveis (`<script>`, `<object>`, `<embed>`, `<applet`,
 * `<iframe>`, ...) e atributos perigosos (`on*` event handlers, `javascript:`
 * URLs) preservando a estrutura de marcação para inspeção/debug — ou seja,
 * mantém `<html>`, `<head>`, `<body>`, `<meta>`, `<title>`, `<link>`,
 * `<style>` e a maior parte do corpo visível para que o arquivo salvo em
 * disco continue renderizável num navegador quando aberto diretamente.
 */
export function sanitizeReportHtml(html: unknown): string {
    const input = typeof html === 'string' ? html : '';
    if (!input) return '';
    const allowedTags = (sanitizeHtml.defaults.allowedTags as string[]).concat([
        'html', 'head', 'body', 'meta', 'title', 'img',
    ]);
    return sanitizeHtml(input, {
        allowedTags,
        // Mantém atributos de estilo/classe/id e os href/src para inspeção.
        allowedAttributes: {
            ...sanitizeHtml.defaults.allowedAttributes,
            '*': ['style', 'class', 'id', 'data-*'],
            img: ['src', 'alt', 'width', 'height', 'style'],
            a: ['href', 'title', 'target', 'rel'],
            meta: ['name', 'content', 'charset', 'http-equiv'],
        },
        // Permite scheme `data:` em imgs (thumbnails inline do snapshot).
        allowedSchemes: ['http', 'https', 'mailto', 'data'],
        // Não descartar o conteúdo textual de tags removidas (importante p/
        // debug do texto da página). `escape` mantém o conteúdo visível.
        disallowedTagsMode: 'escape',
    });
}

export default {
    MAX_SCREENSHOT_BYTES,
    decodeBase64Size,
    screenshotSizeGuard,
    sanitizeReportHtml,
};
