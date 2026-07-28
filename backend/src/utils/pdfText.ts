import { logger } from './logger';

const log = logger.child('PdfText');

/**
 * Extrai o texto de um PDF (buffer) usando pdf-parse v2 (classe `PDFParse`).
 *
 * v2 exporta uma CLASSE (`const { PDFParse } = require('pdf-parse')`), NÃO uma função —
 * chamar `require('pdf-parse')(buffer)` (padrão antigo/v1) quebra. Uso correto:
 * `new PDFParse({ data: buffer }).getText()`.
 *
 * `require` lazy (só carrega o pacote quando chega um PDF; o pacote está na raiz do repo).
 * Retorna '' em qualquer falha (PDF só-imagem, corrompido, pacote ausente) — o caller decide
 * a mensagem. Trunca em `maxChars` p/ não estourar o contexto do LLM.
 */
export async function extractPdfText(buffer: Buffer, maxChars = 15000): Promise<string> {
    let parser: any = null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { PDFParse } = require('pdf-parse');
        parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        return String(result?.text || '').slice(0, maxChars);
    } catch (e: any) {
        log.warn(`Falha ao extrair texto do PDF: ${e?.message}`);
        return '';
    } finally {
        try { if (parser?.destroy) await parser.destroy(); } catch { /* ignore */ }
    }
}

/**
 * Renderiza as primeiras `maxPages` páginas de um PDF como imagens PNG (data URLs), via
 * `getScreenshot` do pdf-parse v2 (usa pdfjs internamente, sem node-canvas). Usado quando o
 * PDF NÃO tem camada de texto (digitalizado/scan) → as imagens vão para a VISÃO (OCR).
 * `{ first, last }` limita a renderização (não renderiza PDF gigante inteiro). Sempre array
 * (vazio em qualquer falha). Cada item: `data:image/png;base64,...`.
 */
export async function extractPdfPageImages(buffer: Buffer, maxPages = 3): Promise<string[]> {
    let parser: any = null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { PDFParse } = require('pdf-parse');
        parser = new PDFParse({ data: buffer });
        const r = await parser.getScreenshot({ first: 1, last: Math.max(1, maxPages) });
        const pages: any[] = Array.isArray(r?.pages) ? r.pages : [];
        return pages
            .map((p: any) => p?.dataUrl)
            .filter((u: any): u is string => typeof u === 'string' && u.startsWith('data:image'));
    } catch (e: any) {
        log.warn(`Falha ao renderizar PDF para imagem: ${e?.message}`);
        return [];
    } finally {
        try { if (parser?.destroy) await parser.destroy(); } catch { /* ignore */ }
    }
}
