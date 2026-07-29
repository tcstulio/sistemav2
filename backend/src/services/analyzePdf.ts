/**
 * #1547 — Analisa um PDF devolvendo TEXTO legível ao agente, com fallback de OCR.
 *
 * Fluxo:
 *   1. Extrai o texto com `pdf-parse` (camada de texto) — caminho RÁPIDO.
 *   2. Se o texto for vazio ou muito curto (< `minTextChars`, padrão 50), considera o
 *      PDF digitalizado/escaneado e renderiza as páginas em PNG, limitado a `maxPages`
 *      (configurável via `PDF_OCR_MAX_PAGES`, padrão 10) para controlar custo de visão.
 *      Renderização em camadas: `pdftoppm` (poppler) → `sharp` → `pdf-parse getScreenshot`.
 *   3. Chama `describeImage` (visão/OCR) em cada página com prompt OCR focado.
 *   4. Concatena os resultados com índice: `Página 1: ...\n\nPágina 2: ...`.
 *   5. Devolve o texto final ao chamador.
 *
 * Critérios de aceite:
 *   - PDF só com imagens → retorna conteúdo legível (caminho `ocr_vision`).
 *   - PDF com texto → segue rápido, sem OCR (caminho `pdf_parse`).
 *   - Logs distinguem os dois caminhos (`pdf_parse` vs `ocr_vision`).
 *
 *  `describeImage`, `renderPages` e os limites são injetáveis (options) para que os testes
 *  sejam herméticos — a produção usa os defaults (aiService.describeImage + renderer em camadas).
 *  O OCR das páginas corre com concorrência limitada (`ocrConcurrency`, padrão 4) para não
 *  exceder rate limits do provedor de visão. Imports de deps opcionais são lazy via `import()`.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractPdfText, extractPdfPageImages } from '../utils/pdfText';
import { createLogger } from '../utils/logger';

const log = createLogger('AnalyzePdf');

/** Limiar (chars) abaixo do qual o PDF é considerado "sem camada de texto" (escaneado). */
export const DEFAULT_MIN_TEXT_CHARS = 50;

/** Número padrão máximo de páginas a renderizar para OCR (controla custo de visão). */
export const DEFAULT_OCR_MAX_PAGES = 10;

/**
 * Concorrência padrão das chamadas de OCR (describeImage por página). Limita requisições
 * concorrentes ao provedor de visão para não estourar rate limits em PDFs com muitas páginas.
 * Configurável via `PDF_OCR_CONCURRENCY`.
 */
export const DEFAULT_OCR_CONCURRENCY = 4;

/**
 * Timeout padrão (ms) para o spawn do `pdftoppm`. Protege contra DoS em produção: um PDF
 * malformado/enorme pode fazer o processo hungar indefinidamente, prendendo o event loop
 * e exaurindo recursos. Acima do teto, o child é morto (SIGKILL) e a renderização falha
 * graciosamente (a próxima camada do renderer assume). Configurável via env.
 */
export const DEFAULT_RENDER_TIMEOUT_MS = 60_000;

/** Prompt OCR focado, repassado como `userHint` ao `describeImage` para cada página. */
export const OCR_PAGE_HINT =
    'Esta é uma página de um documento PDF digitalizado/escaneado. Faça OCR: transcreva FIELMENTE todo o texto visível (parágrafos, tabelas, listas, números, valores, datas e códigos), em português, preservando a ordem de leitura. Não comente nem resuma — devolva apenas a transcrição do conteúdo da página.';

export type AnalyzePdfPath = 'pdf_parse' | 'ocr_vision' | 'empty';

export interface AnalyzePdfOptions {
    /** Máximo de páginas a renderizar para OCR (default: env `PDF_OCR_MAX_PAGES` ou 10). */
    maxPages?: number;
    /** Limiar de chars para considerar "sem texto" (default 50). */
    minTextChars?: number;
    /** Limite de chars repassado a `extractPdfText` (default do pdfText). */
    maxChars?: number;
    /**
     * Máximo de chamadas concorrentes a `describeImage` durante o OCR (rate limiting do
     * provedor de visão). Default: env `PDF_OCR_CONCURRENCY` ou 4.
     */
    ocrConcurrency?: number;
    /** Injetável p/ testes. Default: `aiService.describeImage`. */
    describeImage?: (imageBase64: string, userHint?: string) => Promise<string | null>;
    /** Injetável p/ testes. Default: renderer em camadas (pdftoppm → sharp → pdf-parse). */
    renderPages?: (buffer: Buffer, maxPages: number) => Promise<string[]>;
}

export interface AnalyzePdfResult {
    /** Texto final a devolver ao chamador (camada de texto OU concatenação do OCR). */
    text: string;
    /** Qual caminho foi usado — para debug/observabilidade. */
    path: AnalyzePdfPath;
    /** Quantas páginas foram efetivamente descritas pela visão (apenas em `ocr_vision`). */
    pagesOcr?: number;
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
 */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const concurrency = Math.max(1, Math.min(limit, items.length || 1));
    let cursor = 0;
    const run = async (): Promise<void> => {
        while (cursor < items.length) {
            const i = cursor++;
            results[i] = await worker(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: concurrency }, () => run()));
    return results;
}

/** Resolve o timeout de renderização (env > default), sempre >= 1000ms. */
function resolveTimeoutMs(): number {
    const raw = Number(process.env.PDF_OCR_RENDER_TIMEOUT_MS) || DEFAULT_RENDER_TIMEOUT_MS;
    const n = Math.trunc(raw);
    return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_RENDER_TIMEOUT_MS;
}

/**
 * Ponto de entrada. Extrai texto; se insuficiente, faz OCR via visão e concatena por página.
 */
export async function analyzePdf(buffer: Buffer, options: AnalyzePdfOptions = {}): Promise<AnalyzePdfResult> {
    const minTextChars = options.minTextChars ?? DEFAULT_MIN_TEXT_CHARS;
    const maxPages = resolveMaxPages(options.maxPages);
    const ocrConcurrency = resolveOcrConcurrency(options.ocrConcurrency);
    const renderPages = options.renderPages ?? defaultRenderPdfPages;
    const describeImage = options.describeImage ?? (async (b64: string, hint?: string) => {
        // Lazy dynamic import: carrega o aiService só quando há OCR de fato (compatível com
        // ESM e evita import/circular no carregamento do módulo), sem `require`/eslint-disable.
        const { aiService } = await import('./aiService');
        return aiService.describeImage(b64, hint);
    });

    // (1) Caminho de texto puro — rápido, sem custo de visão.
    const textLayer = (await extractPdfText(buffer, options.maxChars)).trim();
    if (textLayer.length >= minTextChars) {
        log.info(`analyzePdf: caminho pdf_parse (camada de texto, ${textLayer.length} chars).`);
        return { text: textLayer, path: 'pdf_parse' };
    }

    // (2) PDF escaneado (sem camada de texto útil) → OCR via visão.
    log.info(`analyzePdf: texto insuficiente (${textLayer.length} < ${minTextChars} chars) → OCR via visão (até ${maxPages} páginas).`);
    const pageImages = await renderPages(buffer, maxPages);
    if (pageImages.length === 0) {
        log.warn('analyzePdf: OCR abortado — nenhuma página pôde ser renderizada; devolvendo texto vazio.');
        return { text: textLayer, path: 'empty' };
    }

    // (3) Descreve/OCR de cada página com concorrência limitada (rate limiting do provedor).
    const descriptions = await mapWithConcurrency(pageImages, ocrConcurrency, (img) => describeImage(img, OCR_PAGE_HINT));

    // (4) Concatena com índice ('Página 1: ...\n\nPágina 2: ...').
    const parts = descriptions.map((d, i) => {
        const body = d && d.trim().length ? d.trim() : '[não foi possível extrair texto desta página]';
        return `Página ${i + 1}: ${body}`;
    });
    const finalText = parts.join('\n\n');

    log.info(`analyzePdf: caminho ocr_vision (${pageImages.length} página(s) transcrita(s) pela visão).`);
    return { text: finalText, path: 'ocr_vision', pagesOcr: pageImages.length };
}

// ---------------------------------------------------------------------------
// Renderer em camadas — produção. Tentativas best-effort: falha silenciosa vira []
// e a próxima camada assume. Garante que a feature funcione mesmo sem poppler/sharp.
// ---------------------------------------------------------------------------

/**
 * Renderer padrão em camadas (issue #1547):
 *   1. `pdftoppm` (poppler-utils) — primário.
 *   2. `sharp` — fallback se pdftoppm não disponível no ambiente.
 *   3. `pdf-parse getScreenshot` — fallback final (convenção existente do repo, sem deps de sistema).
 */
export async function defaultRenderPdfPages(buffer: Buffer, maxPages: number): Promise<string[]> {
    const viaPdftoppm = await renderViaPdftoppm(buffer, maxPages).catch((e: unknown) => {
        log.debug(`defaultRenderPdfPages: pdftoppm indisponível/falhou (${errMsg(e)}).`);
        return [] as string[];
    });
    if (viaPdftoppm.length) return viaPdftoppm;

    const viaSharp = await renderViaSharp(buffer, maxPages).catch((e: unknown) => {
        log.debug(`defaultRenderPdfPages: sharp indisponível/falhou (${errMsg(e)}).`);
        return [] as string[];
    });
    if (viaSharp.length) return viaSharp;

    return extractPdfPageImages(buffer, maxPages);
}

/** Renderiza páginas via `pdftoppm -png` (poppler-utils). Requer o binário no PATH. */
async function renderViaPdftoppm(buffer: Buffer, maxPages: number): Promise<string[]> {
    if (!(await isCommandAvailable('pdftoppm'))) return [];
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfocr-'));
    const pdfPath = path.join(tmpDir, 'input.pdf');
    const prefix = path.join(tmpDir, 'page');
    try {
        fs.writeFileSync(pdfPath, buffer);
        // -png (saída PNG), -r 150 (DPI), -l <maxPages> (última página a renderizar).
        // Timeout (default 60s, env PDF_OCR_RENDER_TIMEOUT_MS): um PDF malformado pode fazer
        // o pdftoppm hungar indefinidamente — matamos o child e deixamos a próxima camada assumir.
        await runSpawn('pdftoppm', ['-png', '-r', '150', '-l', String(maxPages), pdfPath, prefix], resolveTimeoutMs());
        const re = /^page-?(\d+)\.png$/i;
        const files = fs
            .readdirSync(tmpDir)
            .filter((f) => re.test(f))
            .sort((a, b) => numIn(a, re) - numIn(b, re));
        return files.map((f) => {
            const b64 = fs.readFileSync(path.join(tmpDir, f)).toString('base64');
            return `data:image/png;base64,${b64}`;
        });
    } finally {
        cleanupDir(tmpDir);
    }
}

/** Renderiza páginas via `sharp` (libvips c/ suporte a PDF). Requer o pacote instalado e build c/ PDF. */
async function renderViaSharp(buffer: Buffer, maxPages: number): Promise<string[]> {
    let sharpMod: (input: Buffer, options?: { page?: number; density?: number }) => import('sharp').SharpImage;
    try {
        // Dynamic import: o pacote é opcional (não é dependency) — se ausente, rejeita e
        // retornamos [] (próxima camada assume). Evita `require` + `any` + eslint-disable.
        sharpMod = (await import('sharp')).default;
    } catch {
        return [];
    }
    const out: string[] = [];
    for (let page = 0; page < maxPages; page++) {
        try {
            const png = await sharpMod(buffer, { page, density: 150 }).png().toBuffer();
            if (!png || !png.length) break;
            out.push(`data:image/png;base64,${png.toString('base64')}`);
        } catch {
            // Página inexistente ou PDF não suportado por este build do sharp → para.
            break;
        }
    }
    return out;
}

/**
 * Verifica (sem bloquear o event loop) se um binário existe no PATH. Usa `spawn` assíncrono
 * em vez de `spawnSync`: um `spawnSync` prende o loop inteiro durante a checagem, o que é
 * custoso sob carga. ENOENT = binário ausente; qualquer outro término (incl. exit != 0)
 * consideramos presente.
 */
async function isCommandAvailable(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
        let done = false;
        const settle = (v: boolean): void => {
            if (!done) {
                done = true;
                resolve(v);
            }
        };
        try {
            const child = spawn(cmd, ['-v'], { stdio: 'ignore' });
            child.on('error', (err: NodeJS.ErrnoException) => settle(err?.code !== 'ENOENT'));
            child.on('close', () => settle(true));
        } catch {
            settle(false);
        }
    });
}

/**
 * Spawna um processo externo e aguarda seu término. `timeoutMs` (default 60s) protege
 * contra DoS: se o child não terminar a tempo (PDF malformado que trava o pdftoppm),
 * matamos com SIGKILL e rejeitamos — a camada de renderização seguinte assume (graceful).
 * O `settled` flag garante que só UM de resolve/reject vença (timer vs close/error).
 * Exportado para teste do comportamento de timeout.
 */
export function runSpawn(cmd: string, args: string[], timeoutMs: number = DEFAULT_RENDER_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: 'ignore' });
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn();
        };
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* child já encerrou */ }
            // Passa pelo `finish()` para consistência: garante o flag `settled` e limpa o
            // timer também pelo path do timeout (evita duplo settle contra close/error).
            finish(() => reject(new Error(`${cmd} excedeu o tempo limite de ${timeoutMs}ms (possível DoS / PDF malformado).`)));
        }, timeoutMs);
        // Não impede o processo Node de encerrar.
        if (typeof (timer as { unref?: () => void }).unref === 'function') {
            (timer as { unref: () => void }).unref();
        }
        child.on('error', (err) => finish(() => reject(err)));
        child.on('close', (code) => finish(() => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))));
    });
}

function numIn(name: string, re: RegExp): number {
    const m = re.exec(name);
    return m ? parseInt(m[1], 10) : 0;
}

function cleanupDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        /* best-effort */
    }
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
