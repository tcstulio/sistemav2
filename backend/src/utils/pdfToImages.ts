/**
 * #1031 — Helper de conversão PDF → imagens (PNG/JPEG data URLs) usado pelo fallback de
 * OCR do `analyzePdf`. Extraído para cá (a partir do `analyzePdf.ts`) para que cada
 * estratégia de renderização seja testável isoladamente e reusável por outros fluxos que
 * precisem transformar PDF em imagens (ex.: pré-visualização, anexos).
 *
 * Estratégias em camadas (best-effort, falha silenciosa vira `[]` e a próxima assume):
 *   1. `pdftoppm` (poppler-utils) — primário. Binário externo, mais rápido e fiel.
 *   2. `sharp` (libvips c/ suporte a PDF) — fallback se pdftoppm indisponível no ambiente.
 *   3. `pdf-parse getScreenshot` (pdfjs) — fallback final, sem deps de sistema/binários.
 *
 * Tudo aqui é **isolado de I/O global** e configurável por parâmetro — `runSpawn` é
 * exportado para teste do comportamento de timeout (anti-DoS) e `isCommandAvailable`
 * detecta a presença do binário em runtime sem bloquear o event loop.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from './logger';
import { loadPdfParse, type PdfParseInstance } from './pdfParseLib';

const log = createLogger('PdfToImages');

/** Timeout padrão (ms) para o spawn do `pdftoppm`. Anti-DoS: PDF malformado pode hungar. */
export const DEFAULT_RENDER_TIMEOUT_MS = 60_000;

/** Resolução (DPI) usada ao renderizar páginas. 150 dpi = compromisso legibilidade/tamanho. */
export const DEFAULT_RENDER_DPI = 150;

/**
 * Assinatura padrão de um renderer de páginas PDF → imagens (data URLs). Reutilizável por
 * outros fluxos que precisem transformar PDF em imagens (ex.: pré-visualização).
 */
export type PdfPageImageRenderer = (buffer: Buffer, maxPages: number) => Promise<string[]>;

/**
 * Renderiza até `maxPages` páginas de `buffer` (PDF) como data URLs PNG/JPEG. Tenta cada
 * estratégia em camadas; a primeira que devolver ao menos uma página vence. Se TODAS
 * falharem, devolve `[]` — o caller trata como caminho `empty` (sem nada a OCR).
 */
export const renderPdfPages: PdfPageImageRenderer = async (buffer, maxPages) => {
    const cap = Math.max(0, Math.trunc(maxPages));
    if (cap === 0 || !buffer || !buffer.length) return [];

    const viaPdftoppm = await renderViaPdftoppm(buffer, cap).catch((e: unknown) => {
        log.debug(`renderPdfPages: pdftoppm indisponível/falhou (${errMsg(e)}).`);
        return [] as string[];
    });
    if (viaPdftoppm.length) return viaPdftoppm;

    const viaSharp = await renderViaSharp(buffer, cap).catch((e: unknown) => {
        log.debug(`renderPdfPages: sharp indisponível/falhou (${errMsg(e)}).`);
        return [] as string[];
    });
    if (viaSharp.length) return viaSharp;

    return renderViaPdfParse(buffer, cap);
};

/** Renderiza via `pdftoppm -png` (poppler-utils). Requer o binário no PATH. */
export async function renderViaPdftoppm(buffer: Buffer, maxPages: number): Promise<string[]> {
    if (!(await isCommandAvailable('pdftoppm'))) return [];
    const tmpDir = mkTempDir('pdfocr');
    const pdfPath = path.join(tmpDir, 'input.pdf');
    const prefix = path.join(tmpDir, 'page');
    try {
        fs.writeFileSync(pdfPath, buffer);
        await runSpawn(
            'pdftoppm',
            ['-png', '-r', String(DEFAULT_RENDER_DPI), '-l', String(maxPages), pdfPath, prefix],
            resolveRenderTimeoutMs(),
        );
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

/** Renderiza via `sharp` (libvips com build c/ PDF). `sharp` é pacote opcional — falha = []. */
export async function renderViaSharp(buffer: Buffer, maxPages: number): Promise<string[]> {
    let sharpMod: ((input: Buffer, options?: { page?: number; density?: number }) => import('sharp').SharpImage) | null = null;
    try {
        sharpMod = (await import('sharp')).default;
    } catch {
        return [];
    }
    const out: string[] = [];
    for (let page = 0; page < maxPages; page++) {
        try {
            const png = await sharpMod(buffer, { page, density: DEFAULT_RENDER_DPI }).png().toBuffer();
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
 * Renderiza via `pdf-parse getScreenshot` (pdfjs sem node-canvas). Estratégia final —
 * funciona mesmo sem poppler/sharp, sem deps de sistema. Retorna `[]` em qualquer falha.
 */
export async function renderViaPdfParse(buffer: Buffer, maxPages: number): Promise<string[]> {
    let parser: PdfParseInstance | null = null;
    try {
        const { PDFParse } = loadPdfParse();
        parser = new PDFParse({ data: buffer });
        const r = await parser.getScreenshot({ first: 1, last: Math.max(1, maxPages) });
        const pages: Array<{ dataUrl?: string }> = Array.isArray(r?.pages) ? r.pages : [];
        return pages
            .map((p: { dataUrl?: string }) => p?.dataUrl)
            .filter((u: unknown): u is string => typeof u === 'string' && u.startsWith('data:image'));
    } catch (e: unknown) {
        log.warn(`renderViaPdfParse falhou: ${errMsg(e)}`);
        return [];
    } finally {
        try { if (parser?.destroy) await parser.destroy(); } catch { /* ignore */ }
    }
}

/**
 * Detecta o nº de páginas do PDF. Usa `pdf-parse getInfo` (pdfjs expõe `total`). Devolve
 * `0` em qualquer falha — o caller trata como "PDF ilegível, sem contagem confiável" e usa
 * o `maxPages` diretamente sem gerar placeholders.
 */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
    if (!buffer || !buffer.length) return 0;
    let parser: PdfParseInstance | null = null;
    try {
        const { PDFParse } = loadPdfParse();
        parser = new PDFParse({ data: buffer });
        const info = await parser.getInfo();
        const n = Math.trunc(Number(info?.total ?? 0));
        return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (e: unknown) {
        log.debug(`getPdfPageCount falhou: ${errMsg(e)} (provavelmente PDF sem info legível).`);
        return 0;
    } finally {
        try { if (parser?.destroy) await parser.destroy(); } catch { /* ignore */ }
    }
}

/**
 * Verifica (sem bloquear o event loop) se um binário existe no PATH. Usa `spawn` assíncrono
 * em vez de `spawnSync`: um `spawnSync` prende o loop durante a checagem, o que é custoso
 * sob carga. ENOENT = ausente; qualquer outro término (incl. exit != 0) consideramos presente.
 */
export function isCommandAvailable(cmd: string): Promise<boolean> {
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
 */
export function runSpawn(cmd: string, args: string[], timeoutMs: number = DEFAULT_RENDER_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: 'ignore' });
        let settled = false;
        const finish = (fn: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn();
        };
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* child já encerrou */ }
            finish(() => reject(new Error(`${cmd} excedeu o tempo limite de ${timeoutMs}ms (possível DoS / PDF malformado).`)));
        }, timeoutMs);
        if (typeof (timer as { unref?: () => void }).unref === 'function') {
            (timer as { unref: () => void }).unref();
        }
        child.on('error', (err) => finish(() => reject(err)));
        child.on('close', (code) => finish(() => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))));
    });
}

/** Resolve o timeout de renderização (env > default), sempre >= 1000ms. */
function resolveRenderTimeoutMs(): number {
    const raw = Number(process.env.PDF_OCR_RENDER_TIMEOUT_MS) || DEFAULT_RENDER_TIMEOUT_MS;
    const n = Math.trunc(raw);
    return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_RENDER_TIMEOUT_MS;
}

function numIn(name: string, re: RegExp): number {
    const m = re.exec(name);
    return m ? parseInt(m[1], 10) : 0;
}

function mkTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
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
