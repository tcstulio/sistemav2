/**
 * #1031 / #1547 — Analisa um PDF devolvendo TEXTO legível ao agente, com fallback de OCR.
 *
 * Contrato (#1031): `Promise<string>` — uma string única, seja o texto da camada de
 * texto OU a concatenação do OCR por página. Observabilidade (caminho usado, duração,
 * páginas, tokens GLM estimados) é LOGADA por chamada, não devolvida no retorno — o
 * chamador consome apenas o texto.
 *
 * Fluxo:
 *   1. Extrai o texto com `pdf-parse` (camada de texto) — caminho RÁPIDO, sem custo de visão.
 *   2. Gatilho de OCR: texto vazio OU < `minTextChars` (padrão 50) OU só whitespace.
 *   3. Se gatilho:
 *      - Detecta o nº total de páginas (via `getPdfPageCount`); se for maior que `maxPages`,
 *        anexa placeholders `[página X não processada]` para as excedentes — o agente sabe
 *        que existem páginas adicionais mesmo sem OCR delas.
 *      - Renderiza cada página em PNG (helper `pdfToImages`, até `maxPages` configurável via
 *        `PDF_OCR_MAX_PAGES`, padrão 10) — camadas `pdftoppm` (poppler) → `sharp` → `pdf-parse`.
 *      - Chama `describeImage` (visão/OCR) por página com prompt OCR focado, em paralelo
 *        controlado (`ocrConcurrency`, padrão 2 — spec #1031) com try/catch POR PÁGINA:
 *        falha de visão numa página vira placeholder e log warn, sem derrubar as outras.
 *      - Concatena com separador claro `--- Página N ---\n<descrição>` (spec #1031).
 *   4. Loga custo/tempo (ms total, páginas processadas, tokens GLM estimados) por chamada.
 *
 * Critérios de aceite (issue #1031):
 *   - PDF só com imagens → retorna conteúdo legível (caminho `ocr_vision`).
 *   - PDF com texto → segue rápido, sem OCR (caminho `pdf_parse`); não regredir latência/conteúdo.
 *   - PDF escaneado com N>limite: processa até o limite, resto vira placeholder.
 *   - Falha de OCR em uma página: log warn + placeholder, sem explodir.
 *   - Disponibilidade de `pdftoppm` detectada em runtime; ausência cai gracefully.
 *
 * `describeImage`, `renderPages`, `getPageCount` e os limites são injetáveis (options) para
 * que os testes sejam herméticos — a produção usa os defaults. Imports de deps opcionais
 * são lazy via `import()`/`require` para não quebrar o carregamento do módulo.
 */
import { extractPdfText } from '../utils/pdfText';
import {
    renderPdfPages,
    getPdfPageCount,
    type PdfPageImageRenderer,
} from '../utils/pdfToImages';
import { createLogger } from '../utils/logger';

const log = createLogger('AnalyzePdf');

/** Limiar (chars) abaixo do qual o PDF é considerado "sem camada de texto" (escaneado). */
export const DEFAULT_MIN_TEXT_CHARS = 50;

/** Número padrão máximo de páginas a renderizar para OCR (controla custo de visão). */
export const DEFAULT_OCR_MAX_PAGES = 10;

/**
 * Concorrência padrão das chamadas de OCR (describeImage por página). Limita requisições
 * concorrentes ao provedor de visão para não estourar rate limits em PDFs com muitas
 * páginas. Spec #1031: 2 (não martelar o provedor). Configurável via `PDF_OCR_CONCURRENCY`.
 */
export const DEFAULT_OCR_CONCURRENCY = 2;

/** Heurística de chars para 1 token GLM (estimativa grosseira — só p/ log de custo). */
const APPROX_CHARS_PER_GLM_TOKEN = 4;

/** Prompt OCR focado, repassado como `userHint` ao `describeImage` para cada página. */
export const OCR_PAGE_HINT =
    'Esta é uma página de um documento PDF digitalizado/escaneado. Faça OCR: transcreva FIELMENTE todo o texto visível (parágrafos, tabelas, listas, números, valores, datas e códigos), em português, preservando a ordem de leitura. Não comente nem resuma — devolva apenas a transcrição do conteúdo da página.';

/** Placeholder para páginas excedentes (N > maxPages) — não foram renderizadas/OCR. */
const PAGE_PLACEHOLDER = (n: number): string => `[página ${n} não processada]`;

/** Placeholder para páginas renderizadas cujo OCR falhou (provedor fora do ar, etc.). */
const OCR_FAIL_PLACEHOLDER = '[não foi possível extrair texto desta página]';

/** Detecta nº de páginas do PDF — assinatura isolada p/ injeção em testes. */
export type PdfPageCounter = (buffer: Buffer) => Promise<number>;

export interface AnalyzePdfOptions {
    /** Máximo de páginas a renderizar para OCR (default: env `PDF_OCR_MAX_PAGES` ou 10). */
    maxPages?: number;
    /** Limiar de chars para considerar "sem texto" (default 50). */
    minTextChars?: number;
    /** Limite de chars repassado a `extractPdfText` (default do pdfText). */
    maxChars?: number;
    /**
     * Máximo de chamadas concorrentes a `describeImage` durante o OCR (rate limiting do
     * provedor de visão). Default: env `PDF_OCR_CONCURRENCY` ou 2 (spec #1031).
     */
    ocrConcurrency?: number;
    /** Injetável p/ testes. Default: `aiService.describeImage`. */
    describeImage?: (imageBase64: string, userHint?: string) => Promise<string | null>;
    /** Injetável p/ testes. Default: `renderPdfPages` (camadas pdftoppm → sharp → pdf-parse). */
    renderPages?: PdfPageImageRenderer;
    /** Injetável p/ testes. Default: `getPdfPageCount` (pdf-parse getInfo). */
    getPageCount?: PdfPageCounter;
}

/** Resolve o limite de páginas (options > env > default), sempre >= 1. */
function resolveMaxPages(opt?: number): number {
    const raw = opt ?? Number(process.env.PDF_OCR_MAX_PAGES) ?? DEFAULT_OCR_MAX_PAGES;
    const n = Math.trunc(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_OCR_MAX_PAGES;
}

/** Resolve a concorrência de OCR (options > env > default), sempre >= 1. */
function resolveOcrConcurrency(opt?: number): number {
    const raw = opt ?? Number(process.env.PDF_OCR_CONCURRENCY) ?? DEFAULT_OCR_CONCURRENCY;
    const n = Math.trunc(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_OCR_CONCURRENCY;
}

/**
 * Map com concorrência limitada: processa no máximo `limit` itens por vez, preservando a
 * ordem dos resultados (results[i] corresponde a items[i]). Limita chamadas concorrentes ao
 * provedor de visão durante o OCR, evitando estourar rate limits em PDFs grandes.
 *
 * `tryPerItem=true` (default): captura exceções por item — uma falha pontual vira `null`
 * (e é traduzida em placeholder lá na frente), sem rejeitar a Promise toda. Spec #1031:
 * "falha de OCR em uma página específica: log warn + placeholder, sem explodir".
 */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
    tryPerItem = true,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const concurrency = Math.max(1, Math.min(limit, items.length || 1));
    let cursor = 0;
    const run = async (): Promise<void> => {
        while (cursor < items.length) {
            const i = cursor++;
            if (tryPerItem) {
                try {
                    results[i] = await worker(items[i], i);
                } catch (e) {
                    log.warn(`OCR: falha ao processar página ${i + 1}/${items.length}: ${errMsg(e)}`);
                    results[i] = null as unknown as R;
                }
            } else {
                results[i] = await worker(items[i], i);
            }
        }
    };
    await Promise.all(Array.from({ length: concurrency }, () => run()));
    return results;
}

/**
 * Estimativa grosseira de tokens GLM consumidos pelo OCR. Não é cobrança real — apenas
 * uma métrica observável (log) para detectar PDFs abusivos (relação chars/tokens ≈ 4).
 */
function estimateGlmTokens(totalChars: number): number {
    return Math.ceil(totalChars / APPROX_CHARS_PER_GLM_TOKEN);
}

/**
 * Ponto de entrada. Extrai texto; se insuficiente, faz OCR via visão e concatena por página.
 * Contrato #1031: devolve `Promise<string>` — a string única que o agente consome. Métricas
 * (caminho, duração, páginas, tokens) são registradas em log, não no retorno.
 */
export async function analyzePdf(buffer: Buffer, options: AnalyzePdfOptions = {}): Promise<string> {
    const t0 = Date.now();
    const minTextChars = options.minTextChars ?? DEFAULT_MIN_TEXT_CHARS;
    const maxPages = resolveMaxPages(options.maxPages);
    const ocrConcurrency = resolveOcrConcurrency(options.ocrConcurrency);
    const renderPages = options.renderPages ?? renderPdfPages;
    const getPageCount = options.getPageCount ?? getPdfPageCount;
    const describeImage = options.describeImage ?? (async (b64: string, hint?: string) => {
        // Lazy dynamic import: carrega o aiService só quando há OCR de fato (compatível com
        // ESM e evita import circular no carregamento do módulo).
        const { aiService } = await import('./aiService');
        return aiService.describeImage(b64, hint);
    });

    // (1) Caminho de texto puro — rápido, sem custo de visão. Comportamento idêntico ao
    // atual para PDFs com camada de texto (não regredir latência nem conteúdo).
    const textLayer = (await extractPdfText(buffer, options.maxChars)).trim();
    if (textLayer.length >= minTextChars) {
        const durationMs = Date.now() - t0;
        log.info(`analyzePdf: caminho pdf_parse (camada de texto, ${textLayer.length} chars, ${durationMs}ms).`);
        return textLayer;
    }

    // (2) PDF escaneado (sem camada de texto útil) → OCR via visão.
    log.info(`analyzePdf: texto insuficiente (${textLayer.length} < ${minTextChars} chars) → OCR via visão (até ${maxPages} páginas).`);

    // (3) Detecta nº total de páginas — se maior que maxPages, anexa placeholders para as
    // excedentes (spec #1031). Falha silenciosa vira 0 (sem placeholder automático).
    const pagesTotal = await getPageCount(buffer);
    const pageImages = await renderPages(buffer, maxPages);
    if (pageImages.length === 0) {
        log.warn('analyzePdf: OCR abortado — nenhuma página pôde ser renderizada; devolvendo texto vazio.');
        return textLayer;
    }

    // (4) Descreve/OCR de cada página com concorrência limitada (rate limiting do provedor).
    // tryPerItem=true: falha em uma página NÃO derruba o processamento (spec #1031).
    const descriptions = await mapWithConcurrency(
        pageImages,
        ocrConcurrency,
        (img) => describeImage(img, OCR_PAGE_HINT),
        true,
    );

    // (5) Concatena com separador claro (spec #1031): "--- Página N ---\n<descrição>".
    // Páginas renderizadas primeiro (índice OCR); falhas pontuais viram placeholder.
    const parts: string[] = [];
    let skipped = 0;
    descriptions.forEach((d, i) => {
        const desc = d ? String(d).trim() : '';
        if (desc) {
            parts.push(`--- Página ${i + 1} ---\n${desc}`);
        } else {
            parts.push(`--- Página ${i + 1} ---\n${OCR_FAIL_PLACEHOLDER}`);
            skipped += 1;
        }
    });

    // (6) Placeholders para páginas excedentes (PDF tem N>maxPages, só processamos maxPages).
    if (pagesTotal > pageImages.length) {
        for (let i = pageImages.length; i < pagesTotal; i++) {
            parts.push(`--- Página ${i + 1} ---\n${PAGE_PLACEHOLDER(i + 1)}`);
            skipped += 1;
        }
    }

    const finalText = parts.join('\n\n');
    const durationMs = Date.now() - t0;
    const totalOcrChars = descriptions.reduce((acc, d) => acc + (d ? String(d).length : 0), 0);
    log.info(
        `analyzePdf: caminho ocr_vision (${pageImages.length} página(s) transcrita(s), ` +
        `${skipped} placeholder(s), ~${estimateGlmTokens(totalOcrChars)} tokens GLM estimados, ${durationMs}ms).`,
    );
    return finalText;
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
