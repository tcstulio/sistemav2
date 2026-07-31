/**
 * #1031 — Seam único de carregamento do `pdf-parse` v2.
 *
 * Isolar o carregamento da dependência aqui serve a dois propósitos:
 *   1. **Testabilidade confiável**: `vi.mock('pdf-parse')` NÃO intercepta o `require` CJS
 *      deste pacote (ele é ESM-first, `"type":"module"` — o `require` resolve para o build
 *      `.cjs`, um module record diferente do mock). Mocks de módulos *relativos* como este
 *      são estáveis no vitest, então os testes substituem este módulo em vez do pacote.
 *   2. **Cache único**: o `require` memoiza o módulo; centralizar evita dispersar o loader.
 *
 * A produção carrega o pacote real; os testes substituem `loadPdfParse` por um fake.
 */
export interface PdfParseInstance {
    getScreenshot(opts: { first: number; last: number }): Promise<{ pages: Array<{ dataUrl?: string }> }>;
    getInfo(): Promise<{ total: number }>;
    destroy(): Promise<void>;
}

export type PdfParseModule = { PDFParse: new (opts: { data: Buffer }) => PdfParseInstance };

let memo: PdfParseModule | null = null;

/** Carrega (uma vez) e devolve o módulo pdf-parse. Mockado nos testes. */
export function loadPdfParse(): PdfParseModule {
    if (!memo) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        memo = require('pdf-parse') as PdfParseModule;
    }
    return memo;
}
