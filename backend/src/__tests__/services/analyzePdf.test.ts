import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';

// pdfText: mockado (igual ao botService.test) — o require lazy do pdf-parse não é alcançável
// por spy. Aqui controlamos o que extractPdfText/extractPdfPageImages devolvem por cenário.
const mockPdf = vi.hoisted(() => ({
    extractPdfText: vi.fn(async () => ''),
    extractPdfPageImages: vi.fn(async () => [] as string[]),
}));
vi.mock('../../utils/pdfText', () => mockPdf);

import { analyzePdf, defaultRenderPdfPages, runSpawn, OCR_PAGE_HINT, DEFAULT_MIN_TEXT_CHARS, DEFAULT_OCR_CONCURRENCY } from '../../services/analyzePdf';

describe('analyzePdf (#1547) — fallback de OCR para PDF escaneado', () => {
    beforeEach(() => {
        mockPdf.extractPdfText.mockReset();
        mockPdf.extractPdfPageImages.mockReset();
        mockPdf.extractPdfText.mockResolvedValue('');
        mockPdf.extractPdfPageImages.mockResolvedValue([]);
    });

    it('usa o caminho pdf_parse (rápido, sem OCR) quando há camada de texto suficiente', async () => {
        const longText = 'Beneficiário: CARVALHO. Vencimento 16/07/2026. Valor R$ 1.500,00.';
        mockPdf.extractPdfText.mockResolvedValue(longText);
        const describeImage = vi.fn();
        const renderPages = vi.fn(async () => ['data:image/png;base64,AAA']);

        const result = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages });

        expect(result.path).toBe('pdf_parse');
        expect(result.text).toBe(longText);
        // Caminho de texto NÃO dispara visão nem renderização.
        expect(describeImage).not.toHaveBeenCalled();
        expect(renderPages).not.toHaveBeenCalled();
        expect(result.pagesOcr).toBeUndefined();
    });

    it('rota para OCR (ocr_vision) quando não há camada de texto e concatena por página', async () => {
        mockPdf.extractPdfText.mockResolvedValue(''); // scan → sem texto
        const describeImage = vi.fn(async (b64: string) => `OCR:${b64.slice(-3)}`);
        const renderPages = vi.fn(async () => ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']);

        const result = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages });

        expect(result.path).toBe('ocr_vision');
        expect(result.pagesOcr).toBe(2);
        // describeImage chamado uma vez por página, com o hint OCR focado.
        expect(describeImage).toHaveBeenCalledTimes(2);
        expect(describeImage).toHaveBeenNthCalledWith(1, 'data:image/png;base64,AAA', OCR_PAGE_HINT);
        expect(describeImage).toHaveBeenNthCalledWith(2, 'data:image/png;base64,BBB', OCR_PAGE_HINT);
        // Concatenação com índice: 'Página 1: ...\n\nPágina 2: ...'.
        expect(result.text).toBe('Página 1: OCR:AAA\n\nPágina 2: OCR:BBB');
    });

    it(`trata texto abaixo do limiar (${DEFAULT_MIN_TEXT_CHARS} chars) como escaneado`, async () => {
        // 49 chars → abaixo do limiar padrão (50) → OCR.
        const shortText = 'a'.repeat(DEFAULT_MIN_TEXT_CHARS - 1);
        mockPdf.extractPdfText.mockResolvedValue(shortText);
        const describeImage = vi.fn(async () => 'TRANCRICAO');
        const renderPages = vi.fn(async () => ['data:image/png;base64,X']);

        const r1 = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages });
        expect(r1.path).toBe('ocr_vision');
        expect(renderPages).toHaveBeenCalledTimes(1);

        // Exatamente o limiar (50) → camada de texto aceita.
        const atThreshold = 'b'.repeat(DEFAULT_MIN_TEXT_CHARS);
        mockPdf.extractPdfText.mockResolvedValue(atThreshold);
        const r2 = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages });
        expect(r2.path).toBe('pdf_parse');
    });

    it('usa minTextChars customizado para decidir o limiar', async () => {
        mockPdf.extractPdfText.mockResolvedValue('texto curto de 25 chars!!'); // 25 chars
        const describeImage = vi.fn(async () => 'OCR');
        const renderPages = vi.fn(async () => ['data:image/png;base64,X']);

        // limiar 10 → 25 chars é suficiente → pdf_parse.
        const rLow = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages, minTextChars: 10 });
        expect(rLow.path).toBe('pdf_parse');

        // limiar 100 → 25 chars é insuficiente → OCR.
        const rHigh = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages, minTextChars: 100 });
        expect(rHigh.path).toBe('ocr_vision');
    });

    it('repassa maxPages ao renderizador (controle de custo de OCR)', async () => {
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn(async () => 'OCR');
        const renderPages = vi.fn(async (_buf: Buffer, maxPages: number) =>
            Array.from({ length: maxPages }, (_, i) => `data:image/png;base64,${i}`));

        await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages, maxPages: 4 });

        expect(renderPages).toHaveBeenCalledTimes(1);
        expect(renderPages.mock.calls[0][1]).toBe(4);
        expect(describeImage).toHaveBeenCalledTimes(4);
    });

    it('usa placeholder quando describeImage devolve null para uma página', async () => {
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn(async (_b64: string, hint?: string) => (hint ? null : null));
        const renderPages = vi.fn(async () => ['data:image/png;base64,A', 'data:image/png;base64,B']);

        const result = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages });

        expect(result.path).toBe('ocr_vision');
        expect(result.text).toBe(
            'Página 1: [não foi possível extrair texto desta página]\n\nPágina 2: [não foi possível extrair texto desta página]',
        );
    });

    it('devolve caminho empty (texto vazio) quando nenhuma página pôde ser renderizada', async () => {
        mockPdf.extractPdfText.mockResolvedValue('');
        const describeImage = vi.fn();
        const renderPages = vi.fn(async () => [] as string[]);

        const result = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages });

        expect(result.path).toBe('empty');
        expect(result.text).toBe('');
        expect(describeImage).not.toHaveBeenCalled();
    });

    it('honra PDF_OCR_MAX_PAGES do ambiente quando maxPages não vem nas options', async () => {
        const original = process.env.PDF_OCR_MAX_PAGES;
        process.env.PDF_OCR_MAX_PAGES = '7';
        try {
            mockPdf.extractPdfText.mockResolvedValue('');
            const describeImage = vi.fn(async () => 'OCR');
            const renderPages = vi.fn(async (_b: Buffer, m: number) =>
                Array.from({ length: m }, (_, i) => `data:image/png;base64,${i}`));

            await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages });
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
        let inflight = 0;
        let maxInflight = 0;
        const describeImage = vi.fn(async () => {
            inflight++;
            maxInflight = Math.max(maxInflight, inflight);
            await new Promise((r) => setTimeout(r, 15));
            inflight--;
            return 'OCR';
        });

        const result = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages, ocrConcurrency: 3 });

        // Nunca mais de 3 chamadas concorrentes ao provedor de visão (respeita o limite).
        expect(maxInflight).toBeLessThanOrEqual(3);
        expect(describeImage).toHaveBeenCalledTimes(8);
        // Nenhuma página se perdeu: 8 páginas concatenadas no texto final.
        expect(result.text.split('\n\n')).toHaveLength(8);
    });

    it('preserva a ordem das páginas no resultado mesmo com concorrência limitada', async () => {
        mockPdf.extractPdfText.mockResolvedValue('');
        const pages = ['A', 'B', 'C', 'D', 'E'].map((x) => `data:image/png;base64,${x}`);
        const renderPages = vi.fn(async () => pages);
        // Resolve em tempos decrescentes para tentar bagunçar a ordem do resultado.
        const describeImage = vi.fn(async (b64: string) => {
            const idx = pages.indexOf(b64);
            await new Promise((r) => setTimeout(r, (5 - idx) * 12));
            return b64.slice(-1);
        });

        const result = await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages, ocrConcurrency: 5 });

        expect(result.text).toBe('Página 1: A\n\nPágina 2: B\n\nPágina 3: C\n\nPágina 4: D\n\nPágina 5: E');
    });

    it('honra PDF_OCR_CONCURRENCY do ambiente quando ocrConcurrency não vem nas options', async () => {
        const original = process.env.PDF_OCR_CONCURRENCY;
        process.env.PDF_OCR_CONCURRENCY = '2';
        try {
            mockPdf.extractPdfText.mockResolvedValue('');
            const pages = Array.from({ length: 6 }, (_, i) => `data:image/png;base64,${i}`);
            const renderPages = vi.fn(async () => pages);
            let inflight = 0;
            let maxInflight = 0;
            const describeImage = vi.fn(async () => {
                inflight++;
                maxInflight = Math.max(maxInflight, inflight);
                await new Promise((r) => setTimeout(r, 15));
                inflight--;
                return 'OCR';
            });
            await analyzePdf(Buffer.from('%PDF-'), { describeImage, renderPages });
            expect(maxInflight).toBeLessThanOrEqual(2);
        } finally {
            if (original === undefined) delete process.env.PDF_OCR_CONCURRENCY;
            else process.env.PDF_OCR_CONCURRENCY = original;
        }
    });

    it('expõe DEFAULT_OCR_CONCURRENCY como limite padrão coerente (>0 e <= maxPages)', () => {
        expect(DEFAULT_OCR_CONCURRENCY).toBeGreaterThan(0);
        expect(DEFAULT_OCR_CONCURRENCY).toBeLessThanOrEqual(10);
    });

    it('o hint OCR é um prompt focado em transcrição fiel (não resumo)', async () => {
        const h = OCR_PAGE_HINT.toLowerCase();
        expect(typeof OCR_PAGE_HINT).toBe('string');
        expect(h).toContain('ocr');
        // Foco em transcrever fielmente...
        expect(h).toContain('transcreva');
        // ...e proibe resumir/comentar (negação explícita), não pede resumo.
        expect(h).toContain('não comente nem resuma');
        expect(h).not.toMatch(/^(faça um resumo|resuma este)/);
    });
});

describe('defaultRenderPdfPages (#1547) — renderer em camadas (pdftoppm → sharp → pdf-parse)', () => {
    beforeEach(() => {
        mockPdf.extractPdfPageImages.mockReset();
    });

    it('faz fallback final para extractPdfPageImages (convenção do repo) sem quebrar', async () => {
        // Em ambientes sem poppler/sharp (caso típico de dev/CI), a última camada é o
        // pdf-parse getScreenshot. Validamos o contrato: devolve o que ela devolver.
        const pages = ['data:image/png;base64,ZZZ'];
        mockPdf.extractPdfPageImages.mockResolvedValue(pages);

        const out = await defaultRenderPdfPages(Buffer.from('%PDF-'), 3);

        expect(Array.isArray(out)).toBe(true);
        expect(out).toEqual(pages);
        expect(mockPdf.extractPdfPageImages).toHaveBeenCalledTimes(1);
    });

    it('devolve array vazio quando todas as camadas falham (sem lançar)', async () => {
        mockPdf.extractPdfPageImages.mockResolvedValue([]);
        const out = await defaultRenderPdfPages(Buffer.from('%PDF-'), 2);
        expect(out).toEqual([]);
    });
});

describe('runSpawn (#1547) — timeout mata o child (anti-DoS em pdftoppm)', () => {
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
