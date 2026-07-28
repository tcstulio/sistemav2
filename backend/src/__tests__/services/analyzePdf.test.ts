import { describe, it, expect, vi, beforeEach } from 'vitest';

// pdfText: mockado (igual ao botService.test) — o require lazy do pdf-parse não é alcançável
// por spy. Aqui controlamos o que extractPdfText/extractPdfPageImages devolvem por cenário.
const mockPdf = vi.hoisted(() => ({
    extractPdfText: vi.fn(async () => ''),
    extractPdfPageImages: vi.fn(async () => [] as string[]),
}));
vi.mock('../../utils/pdfText', () => mockPdf);

import { analyzePdf, defaultRenderPdfPages, OCR_PAGE_HINT, DEFAULT_MIN_TEXT_CHARS } from '../../services/analyzePdf';

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
