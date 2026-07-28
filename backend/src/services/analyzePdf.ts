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
 `describeImage`, `renderPages` e os limites são injetáveis (options) para que os testes
 sejam herméticos — a produção usa os defaults (aiService.describeImage + renderer em camadas).
 */
import { spawn, spawnSync } from 'child_process';
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

/**
 * Ponto de entrada. Extrai texto; se insuficiente, faz OCR via visão e concatena por página.
 */
export async function analyzePdf(buffer: Buffer, options: AnalyzePdfOptions = {}): Promise<AnalyzePdfResult> {
    const minTextChars = options.minTextChars ?? DEFAULT_MIN_TEXT_CHARS;
    const maxPages = resolveMaxPages(options.maxPages);
    const renderPages = options.renderPages ?? defaultRenderPdfPages;
    const describeImage = options.describeImage ?? (async (b64: string, hint?: string) => {
        // Lazy require: mantém o módulo testável sem carregar o aiService no import.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { aiService } = require('./aiService');
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

    // (3) Descreve/OCR de cada página em paralelo.
    const descriptions = await Promise.all(pageImages.map((img) => describeImage(img, OCR_PAGE_HINT)));

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
    if (!isCommandAvailable('pdftoppm')) return [];
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfocr-'));
    const pdfPath = path.join(tmpDir, 'input.pdf');
    const prefix = path.join(tmpDir, 'page');
    try {
        fs.writeFileSync(pdfPath, buffer);
        // -png (saída PNG), -r 150 (DPI), -l <maxPages> (última página a renderizar).
        await runSpawn('pdftoppm', ['-png', '-r', '150', '-l', String(maxPages), pdfPath, prefix]);
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
    let sharpMod: any;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        sharpMod = require('sharp');
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

function isCommandAvailable(cmd: string): boolean {
    try {
        const r = spawnSync(cmd, ['-v'], { stdio: 'ignore' });
        // ENOENT = binário ausente no PATH. Qualquer outra coisa (incl. exit != 0) consideramos presente.
        return !(r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT');
    } catch {
        return false;
    }
}

function runSpawn(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
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
