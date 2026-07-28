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
