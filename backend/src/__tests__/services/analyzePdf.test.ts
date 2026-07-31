import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';

// pdfText: mockado — controlamos o que extractPdfText devolve por cenário (o require lazy
// do pdf-parse não é alcançável por spy). Aqui só o extrator de texto importa.
const mockPdf = vi.hoisted(() => ({
    extractPdfText: vi.fn(async () => ''),
}));
vi.mock('../../utils/pdfText', () => mockPdf);

// Logger: capturamos as chamadas para validar o critério #1031 "Custo/tempo logado por
// chamada" (caminho pdf_parse vs ocr_vision, duração em ms, tokens GLM estimados).
// Sobrescreve o mock global do setup.ts só neste arquivo.
const analyzeLog = vi.hoisted(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({ createLogger: () => analyzeLog }));

import { analyzePdf, OCR_PAGE_HINT, DEFAULT_MIN_TEXT_CHARS, DEFAULT_OCR_CONCURRENCY } from '../../services/analyzePdf';
import { renderPdfPages, runSpawn } from '../../utils/pdfToImages';

/** Helpers de mocks injetáveis (contrato #1031: analyzePdf devolve Promise<string>). */
function makeDeps(overrides: { describeImage?: vi.fn; renderPages?: vi.fn; getPageCount?: vi.fn } = {}) {
    return {
        describeImage: overrides.describeImage ?? vi.fn(async () => 'OCR'),
        renderPages:
            overrides.renderPages ??
            vi.fn(async () => ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']),
        getPageCount: overrides.getPageCount ?? vi.fn(async () => 0),
    };
}

const PDF = Buffer.from('%PDF-');

describe('analyzePdf (#1031 / #1547) — fallback de OCR para PDF escaneado', () => {
    beforeEach(() => {
        mockPdf.extractPdfText.mockReset();
        mockPdf.extractPdfText.mockResolvedValue('');
        analyzeLog.info.mockClear();
        analyzeLog.debug.mockClear();
        analyzeLog.warn.mockClear();
        analyzeLog.error.mockClear();
    });

    it('usa o caminho pdf_parse (rápido, sem OCR) quando há camada de texto suficiente', async () => {
        const longText = 'Beneficiário: CARVALHO. Vencimento 16/07/2026. Valor R$ 1.500,00.';
        mockPdf.extractPdfText.mockResolvedValue(longText);
        const { describeImage, renderPages, getPageCount } = makeDeps();

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount });

        // Contrato #1031: devolve a string do texto (sem OCR).
        expect(result).toBe(longText);
        // Caminho de texto NÃO dispara visão, renderização nem contagem de páginas.
        expect(describeImage).not.toHaveBeenCalled();
        expect(renderPages).not.toHaveBeenCalled();
        expect(getPageCount).not.toHaveBeenCalled();
        // Custo/tempo logado mesmo no caminho rápido (critério #1031).
        expect(analyzeLog.info).toHaveBeenCalledWith(expect.stringMatching(/pdf_parse/));
        expect(analyzeLog.info).toHaveBeenCalledWith(expect.stringMatching(/ms/));
    });

    it('rota para OCR (ocr_vision) quando não há camada de texto e concatena por página (#1031)', async () => {
        mockPdf.extractPdfText.mockResolvedValue(''); // scan → sem texto
        const describeImage = vi.fn(async (b64: string) => `OCR:${b64.slice(-3)}`);
        const renderPages = vi.fn(async () => ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']);
        const getPageCount = vi.fn(async () => 0);

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount });

        // describeImage chamado uma vez por página, com o hint OCR focado.
        expect(describeImage).toHaveBeenCalledTimes(2);
        expect(describeImage).toHaveBeenNthCalledWith(1, 'data:image/png;base64,AAA', OCR_PAGE_HINT);
        expect(describeImage).toHaveBeenNthCalledWith(2, 'data:image/png;base64,BBB', OCR_PAGE_HINT);
        expect(getPageCount).toHaveBeenCalledTimes(1);
        // Spec #1031: separador claro `--- Página N ---\n<descrição>`.
        expect(result).toBe('--- Página 1 ---\nOCR:AAA\n\n--- Página 2 ---\nOCR:BBB');
        expect(analyzeLog.info).toHaveBeenCalledWith(expect.stringMatching(/ocr_vision/));
    });

    it(`trata texto abaixo do limiar (${DEFAULT_MIN_TEXT_CHARS} chars) como escaneado`, async () => {
        // 49 chars → abaixo do limiar padrão (50) → OCR.
        const shortText = 'a'.repeat(DEFAULT_MIN_TEXT_CHARS - 1);
        mockPdf.extractPdfText.mockResolvedValue(shortText);
        const { describeImage, renderPages, getPageCount } = makeDeps({
            renderPages: vi.fn(async () => ['data:image/png;base64,X']),
        });

        const r1 = await analyzePdf(PDF, { describeImage, renderPages, getPageCount });
        expect(renderPages).toHaveBeenCalledTimes(1);
        expect(r1).toContain('--- Página 1 ---');

        // Exatamente o limiar (50) → camada de texto aceita (não regredir conteúdo).
        const atThreshold = 'b'.repeat(DEFAULT_MIN_TEXT_CHARS);
        mockPdf.extractPdfText.mockResolvedValue(atThreshold);
        const r2 = await analyzePdf(PDF, { describeImage, renderPages, getPageCount });
        expect(r2).toBe(atThreshold);
    });

    it('usa minTextChars customizado para decidir o limiar', async () => {
        mockPdf.extractPdfText.mockResolvedValue('texto curto de 25 chars!!'); // 25 chars
        const { describeImage, renderPages, getPageCount } = makeDeps({
            renderPages: vi.fn(async () => ['data:image/png;base64,X']),
        });

        // limiar 10 → 25 chars é suficiente → pdf_parse (texto preservado).
        const rLow = await analyzePdf(PDF, { describeImage, renderPages, getPageCount, minTextChars: 10 });
        expect(rLow).toBe('texto curto de 25 chars!!');

        // limiar 100 → 25 chars é insuficiente → OCR.
        const rHigh = await analyzePdf(PDF, { describeImage, renderPages, getPageCount, minTextChars: 100 });
        expect(rHigh).toContain('--- Página 1 ---\nOCR');
    });

    it('repassa maxPages ao renderizador (controle de custo de OCR)', async () => {
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn(async () => 'OCR');
        const renderPages = vi.fn(async (_buf: Buffer, maxPages: number) =>
            Array.from({ length: maxPages }, (_, i) => `data:image/png;base64,${i}`));
        const getPageCount = vi.fn(async () => 0);

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount, maxPages: 4 });

        expect(renderPages).toHaveBeenCalledTimes(1);
        expect(renderPages.mock.calls[0][1]).toBe(4);
        expect(describeImage).toHaveBeenCalledTimes(4);
        // 4 páginas concatenadas.
        expect(result.split('\n\n')).toHaveLength(4);
    });

    it('usa placeholder quando describeImage devolve null para uma página', async () => {
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn(async () => null);
        const renderPages = vi.fn(async () => ['data:image/png;base64,A', 'data:image/png;base64,B']);
        const getPageCount = vi.fn(async () => 0);

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount });

        expect(result).toBe(
            '--- Página 1 ---\n[não foi possível extrair texto desta página]\n\n--- Página 2 ---\n[não foi possível extrair texto desta página]',
        );
    });

    it('NÃO derruba o processamento se describeImage falhar (throw) numa página específica (#1031)', async () => {
        // Spec #1031: "Falha de OCR em uma página específica: log warn + placeholder, sem explodir".
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn(async (b64: string) => {
            if (b64.endsWith('BBB')) throw new Error('provedor fora do ar');
            return `OCR:${b64.slice(-1)}`;
        });
        const renderPages = vi.fn(async () => ['data:image/png;base64,AAA', 'data:image/png;base64,BBB', 'data:image/png;base64,CCC']);
        const getPageCount = vi.fn(async () => 0);

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount });

        // As 3 páginas foram tentadas; a página 2 falhou → placeholder.
        expect(describeImage).toHaveBeenCalledTimes(3);
        expect(result).toBe(
            '--- Página 1 ---\nOCR:A\n\n--- Página 2 ---\n[não foi possível extrair texto desta página]\n\n--- Página 3 ---\nOCR:C',
        );
        // Falha pontual é logada como warn (critério #1031).
        expect(analyzeLog.warn).toHaveBeenCalledWith(expect.stringMatching(/página 2\/3/));
    });

    it('devolve texto vazio quando nenhuma página pôde ser renderizada', async () => {
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn();
        const renderPages = vi.fn(async () => [] as string[]);
        const getPageCount = vi.fn(async () => 0);

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount });

        expect(result).toBe('');
        expect(describeImage).not.toHaveBeenCalled();
        expect(analyzeLog.warn).toHaveBeenCalledWith(expect.stringMatching(/OCR abortado/));
    });

    it('honra PDF_OCR_MAX_PAGES do ambiente quando maxPages não vem nas options', async () => {
        const original = process.env.PDF_OCR_MAX_PAGES;
        process.env.PDF_OCR_MAX_PAGES = '7';
        try {
            mockPdf.extractPdfText.mockResolvedValue('');
            const describeImage = vi.fn(async () => 'OCR');
            const renderPages = vi.fn(async (_b: Buffer, m: number) =>
                Array.from({ length: m }, (_, i) => `data:image/png;base64,${i}`));
            const getPageCount = vi.fn(async () => 0);

            await analyzePdf(PDF, { describeImage, renderPages, getPageCount });
            expect(renderPages.mock.calls[0][1]).toBe(7);
        } finally {
            if (original === undefined) delete process.env.PDF_OCR_MAX_PAGES;
            else process.env.PDF_OCR_MAX_PAGES = original;
        }
    });

    it('limita a concorrência das chamadas de OCR (rate limiting do provedor de visão)', async () => {
        mockPdf.extractPdfText.mockResolvedValue('');
        const pages = Array.from({ length: 8 }, (_, i) => `data:image/png;base64,${i}`);
        const renderPages = vi.fn(async () => pages);
        const getPageCount = vi.fn(async () => 0);
        let inflight = 0;
        let maxInflight = 0;
        const describeImage = vi.fn(async () => {
            inflight++;
            maxInflight = Math.max(maxInflight, inflight);
            await new Promise((r) => setTimeout(r, 15));
            inflight--;
            return 'OCR';
        });

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount, ocrConcurrency: 3 });

        // Nunca mais de 3 chamadas concorrentes ao provedor de visão (respeita o limite).
        expect(maxInflight).toBeLessThanOrEqual(3);
        expect(describeImage).toHaveBeenCalledTimes(8);
        // Nenhuma página se perdeu: 8 páginas concatenadas no texto final.
        expect(result.split('\n\n')).toHaveLength(8);
    });

    it('preserva a ordem das páginas no resultado mesmo com concorrência limitada', async () => {
        mockPdf.extractPdfText.mockResolvedValue('');
        const pages = ['A', 'B', 'C', 'D', 'E'].map((x) => `data:image/png;base64,${x}`);
        const renderPages = vi.fn(async () => pages);
        const getPageCount = vi.fn(async () => 0);
        // Resolve em tempos decrescentes para tentar bagunçar a ordem do resultado.
        const describeImage = vi.fn(async (b64: string) => {
            const idx = pages.indexOf(b64);
            await new Promise((r) => setTimeout(r, (5 - idx) * 12));
            return b64.slice(-1);
        });

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount, ocrConcurrency: 5 });

        expect(result).toBe(
            '--- Página 1 ---\nA\n\n--- Página 2 ---\nB\n\n--- Página 3 ---\nC\n\n--- Página 4 ---\nD\n\n--- Página 5 ---\nE',
        );
    });

    it('honra PDF_OCR_CONCURRENCY do ambiente quando ocrConcurrency não vem nas options', async () => {
        const original = process.env.PDF_OCR_CONCURRENCY;
        process.env.PDF_OCR_CONCURRENCY = '2';
        try {
            mockPdf.extractPdfText.mockResolvedValue('');
            const pages = Array.from({ length: 6 }, (_, i) => `data:image/png;base64,${i}`);
            const renderPages = vi.fn(async () => pages);
            const getPageCount = vi.fn(async () => 0);
            let inflight = 0;
            let maxInflight = 0;
            const describeImage = vi.fn(async () => {
                inflight++;
                maxInflight = Math.max(maxInflight, inflight);
                await new Promise((r) => setTimeout(r, 15));
                inflight--;
                return 'OCR';
            });
            await analyzePdf(PDF, { describeImage, renderPages, getPageCount });
            expect(maxInflight).toBeLessThanOrEqual(2);
        } finally {
            if (original === undefined) delete process.env.PDF_OCR_CONCURRENCY;
            else process.env.PDF_OCR_CONCURRENCY = original;
        }
    });

    it('DEFAULT_OCR_CONCURRENCY é 2 (spec #1031: não martelar o provedor)', () => {
        expect(DEFAULT_OCR_CONCURRENCY).toBe(2);
    });

    it('o hint OCR é um prompt focado em transcrição fiel (não resumo)', () => {
        const h = OCR_PAGE_HINT.toLowerCase();
        expect(typeof OCR_PAGE_HINT).toBe('string');
        expect(h).toContain('ocr');
        // Foco em transcrever fielmente...
        expect(h).toContain('transcreva');
        // ...e proibe resumir/comentar (negação explícita), não pede resumo.
        expect(h).toContain('não comente nem resuma');
        expect(h).not.toMatch(/^(faça um resumo|resuma este)/);
    });

    it('anexa placeholders [página X não processada] para páginas excedentes (#1031)', async () => {
        // PDF com 5 páginas, mas maxPages=2 → só 2 renderizadas/OCR; 3,4,5 viram placeholder.
        // O total de páginas é injetável (getPageCount) → teste hermético do critério N>limite.
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn(async () => 'OCR');
        const renderPages = vi.fn(async () => ['data:image/png;base64,P1', 'data:image/png;base64,P2']);
        const getPageCount = vi.fn(async () => 5);

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount, maxPages: 2 });

        // Só as 2 primeiras páginas passam pela visão (controle de custo).
        expect(renderPages.mock.calls[0][1]).toBe(2);
        expect(describeImage).toHaveBeenCalledTimes(2);
        // As excedentes (3,4,5) viram placeholder — o agente sabe que existem.
        expect(result).toBe(
            '--- Página 1 ---\nOCR\n\n' +
            '--- Página 2 ---\nOCR\n\n' +
            '--- Página 3 ---\n[página 3 não processada]\n\n' +
            '--- Página 4 ---\n[página 4 não processada]\n\n' +
            '--- Página 5 ---\n[página 5 não processada]',
        );
    });

    it('não gera placeholders excedentes quando o total de páginas é indetectável (0)', async () => {
        // Sem info de total (getPdfPageCount devolve 0) → só concatena as renderizadas.
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn(async () => 'OCR');
        const renderPages = vi.fn(async () => ['data:image/png;base64,P1', 'data:image/png;base64,P2']);
        const getPageCount = vi.fn(async () => 0);

        const result = await analyzePdf(PDF, { describeImage, renderPages, getPageCount, maxPages: 2 });

        expect(result).toBe('--- Página 1 ---\nOCR\n\n--- Página 2 ---\nOCR');
    });

    it('loga custo/tempo por chamada no caminho OCR (ms + tokens GLM estimados)', async () => {
        // Critério #1031: "Custo/tempo logado por chamada (ms total, páginas, tokens GLM)".
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn(async () => 'conteúdo OCR de uma página inteira');
        const renderPages = vi.fn(async () => ['data:image/png;base64,X']);
        const getPageCount = vi.fn(async () => 0);

        await analyzePdf(PDF, { describeImage, renderPages, getPageCount });

        const infoArg = analyzeLog.info.mock.calls.find((c) => /ocr_vision/.test(String(c[0])))?.[0] as string | undefined;
        expect(infoArg).toBeTruthy();
        expect(infoArg).toMatch(/ms/);
        expect(infoArg).toMatch(/tokens GLM/);
        expect(infoArg).toMatch(/placeholder/);
    });
});

describe('renderPdfPages (#1031) — helper isolado de conversão PDF → imagens', () => {
    it('devolve array vazio para maxPages=0 ou buffer vazio (caminho rápido)', async () => {
        expect(await renderPdfPages(Buffer.from('whatever'), 0)).toEqual([]);
        expect(await renderPdfPages(Buffer.alloc(0), 5)).toEqual([]);
    });

    it('best-effort: devolve sempre um array (mesmo que todas as camadas falhem no ambiente de teste)', async () => {
        // Em ambientes sem poppler/sharp (dev/CI), a última camada é o pdf-parse getScreenshot.
        // Como o buffer é dummy, ele falha e devolve [] — o contrato é "sempre um array".
        const out = await renderPdfPages(Buffer.from('%PDF-'), 3);
        expect(Array.isArray(out)).toBe(true);
        expect(out.length).toBeGreaterThanOrEqual(0);
    });
});

describe('runSpawn (#1031) — timeout mata o child (anti-DoS em pdftoppm)', () => {
    // Polla a existência do PID: process.kill(pid,0) lança quando o processo sumiu.
    // Retry suaviza a race entre child.kill('SIGKILL') e o SO liberar o PID (variável entre SOs).
    async function waitUntilGone(pid: number, tries = 20, delayMs = 50): Promise<boolean> {
        for (let i = 0; i < tries; i++) {
            try { process.kill(pid, 0); } catch { return true; }
            await new Promise((r) => setTimeout(r, delayMs));
        }
        return false;
    }

    it('rejeita com erro de timeout e MATA o processo que trava (sem vazar / DoS)', async () => {
        // O setup.ts global mocka `fs` — o child (processo node separado) escreve no FS real,
        // então lemos via importActual para enxergar o que ele gravou.
        const realFs = await vi.importActual<typeof import('fs')>('fs');
        const marker = path.join(os.tmpdir(), `runspawn-pid-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
        // Child grava seu PID e fica "vivo" (setInterval) — simula pdftoppm hungado por PDF malformado.
        const script = `require('fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(function(){},1000);`;
        const t0 = Date.now();
        await expect(runSpawn(process.execPath, ['-e', script], 1500)).rejects.toThrow(/tempo limite/i);
        const elapsed = Date.now() - t0;
        // Rejeitou por causa do timer (não esperou indefinidamente).
        expect(elapsed).toBeLessThan(6000);

        const pid = Number(realFs.existsSync(marker) ? realFs.readFileSync(marker, 'utf8') : '');
        try { realFs.unlinkSync(marker); } catch { /* ignore */ }
        expect(pid).toBeGreaterThan(0);
        // O SIGKILL foi entregue → o processo não existe mais (DoS mitigado).
        expect(await waitUntilGone(pid)).toBe(true);
    }, 10_000);

    it('resolve normalmente quando o processo termina antes do timeout (happy path)', async () => {
        await expect(runSpawn(process.execPath, ['-e', 'process.exit(0)'], 10_000)).resolves.toBeUndefined();
    });

    it('rejeita com exit code != 0 quando o processo falha rápido', async () => {
        await expect(runSpawn(process.execPath, ['-e', 'process.exit(3)'], 10_000)).rejects.toThrow(/exited 3/);
    });
});
