/**
 * #1031 — Testes do helper `pdfToImages` (conversão PDF → imagens, isolado p/ teste).
 *
 * Estratégia de mocking (ROBUSTA — sem vi.doMock/vi.resetModules, que causavam vazamento
 * de estado entre testes): todos os mocks são hoisted no topo (vi.mock) e controlados por
 * objetos de estado hoisted (mockFs/mockSharp/mockPdfParse/mockSpawn). Cada teste ajusta o
 * estado e o `beforeEach` reseta. Assim o registro de módulos permanece estável.
 *   - `child_process.spawn` → mockSpawn (fake child EventEmitter).
 *   - `sharp` → lança quando "não instalado" (mockSharp.installed=false); devolve PNGs quando instalado.
 *   - `pdf-parse` → PDFParse fake controlado por mockPdfParse.
 *   - `fs` → filesystem em memória controlado por mockFs (seed/reset por teste).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------------------
// Hoisted state — vi.mock factories referenciam estes objetos (lidos no momento da chamada,
// não da factory), então mudar o estado aqui muda o comportamento em runtime sem re-import.
// ---------------------------------------------------------------------------------------
const mockSpawn = vi.hoisted(() => vi.fn());

const mockFs = vi.hoisted(() => {
    const files: Record<string, Buffer> = {};
    return {
        files,
        reset(): void { for (const k of Object.keys(files)) delete files[k]; },
        seed(rel: string, data: Buffer): void { files[`/tmp/pdfocr-fake/${rel}`] = data; },
    };
});

const mockSharp = vi.hoisted(() => ({
    installed: false,
    /** Índice da página (0-based) que falha ao renderizar; -1 = nenhuma. */
    failOnPage: -1,
    reset(): void { this.installed = false; this.failOnPage = -1; },
}));

const mockPdfParse = vi.hoisted(() => ({
    totalPages: 0,
    screenshotDataUrls: [] as Array<string | null>,
    throwOnScreenshot: false,
    throwOnGetInfo: false,
    reset(): void { this.totalPages = 0; this.screenshotDataUrls = []; this.throwOnScreenshot = false; this.throwOnGetInfo = false; },
}));

vi.mock('child_process', () => ({ spawn: mockSpawn }));

// fs em memória — store é a MESMA referência sempre (reset muta, não reatribui).
vi.mock('fs', () => {
    const store = mockFs.files;
    const pageRe = /^page-?(\d+)\.png$/i;
    const pageNum = (name: string): number => { const m = pageRe.exec(name); return m ? parseInt(m[1], 10) : 0; };
    const api = {
        mkdtempSync: () => '/tmp/pdfocr-fake',
        writeFileSync: (p: string, data: Buffer | string): void => {
            store[String(p)] = Buffer.isBuffer(data) ? data : Buffer.from(data);
        },
        readdirSync: (p: string): string[] => {
            const prefix = `${p}/`;
            return Object.keys(store)
                .filter((f) => f.startsWith(prefix) && pageRe.test(f.slice(prefix.length)))
                .map((f) => f.slice(prefix.length))
                .sort((a, b) => pageNum(a) - pageNum(b));
        },
        readFileSync: (p: string): Buffer => {
            const buf = store[String(p)];
            if (!buf) { const e = new Error('ENOENT'); (e as { code?: string }).code = 'ENOENT'; throw e; }
            return buf;
        },
        rmSync: () => undefined,
        existsSync: (p: string): boolean => Object.prototype.hasOwnProperty.call(store, String(p)),
        mkdirSync: () => undefined,
        statSync: () => ({ isDirectory: () => true }),
    };
    return { ...api, default: api };
});

// sharp — "instalado" é decidido no momento da chamada (a factory roda uma vez só).
vi.mock('sharp', () => ({
    default: (_input: Buffer, opts?: { page?: number; density?: number }) => {
        if (!mockSharp.installed) throw new Error('sharp não instalado no ambiente de teste');
        const page = opts?.page ?? 0;
        if (page === mockSharp.failOnPage) {
            return { png: () => ({ toBuffer: async (): Promise<Buffer> => { throw new Error('no page'); } }) };
        }
        const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        return { png: () => ({ toBuffer: async (): Promise<Buffer> => pngBuf }) };
    },
}));

// pdf-parse é carregado via seam `pdfParseLib` (mock de módulo relativo é estável no vitest;
// vi.mock('pdf-parse') não intercepta o require CJS deste pacote ESM-first). O fake PDFParse
// lê o estado hoisted `mockPdfParse`, controlado por teste.
vi.mock('../../utils/pdfParseLib', () => ({
    loadPdfParse: () => ({
        PDFParse: class {
            constructor(_opts: { data: Buffer }) {}
            async getScreenshot(): Promise<{ pages: Array<{ dataUrl?: string }> }> {
                if (mockPdfParse.throwOnScreenshot) throw new Error('boom screenshot');
                return { pages: mockPdfParse.screenshotDataUrls.map((u) => ({ dataUrl: u ?? undefined })) };
            }
            async getInfo(): Promise<{ total: number }> {
                if (mockPdfParse.throwOnGetInfo) throw new Error('boom getInfo');
                return { total: mockPdfParse.totalPages };
            }
            async destroy(): Promise<void> {}
        },
    }),
}));

import {
    renderPdfPages,
    renderViaPdftoppm,
    renderViaSharp,
    renderViaPdfParse,
    getPdfPageCount,
    isCommandAvailable,
    runSpawn,
    DEFAULT_RENDER_TIMEOUT_MS,
    DEFAULT_RENDER_DPI,
} from '../../utils/pdfToImages';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Cria um fake child (EventEmitter) que aceita emit('error'|'close') programaticamente. */
function makeFakeChild(): EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> } {
    const c = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
    c.pid = 12345;
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.kill = vi.fn();
    return c;
}

describe('pdfToImages (#1031)', () => {
    beforeEach(() => {
        mockSpawn.mockReset();
        mockFs.reset();
        mockSharp.reset();
        mockPdfParse.reset();
    });

    describe('isCommandAvailable — detecção de binário em runtime', () => {
        it('devolve true quando o binário responde (close com exit 0)', async () => {
            const child = makeFakeChild();
            mockSpawn.mockReturnValue(child);
            setImmediate(() => child.emit('close', 0));
            expect(await isCommandAvailable('pdftoppm')).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith('pdftoppm', ['-v'], { stdio: 'ignore' });
        });

        it('devolve false quando o spawn emite ENOENT (binário ausente)', async () => {
            const child = makeFakeChild();
            mockSpawn.mockReturnValue(child);
            setImmediate(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
            expect(await isCommandAvailable('binario-inexistente')).toBe(false);
        });

        it('devolve true quando o spawn emite outro erro (EACCES) — binário existe mas bloqueado', async () => {
            const child = makeFakeChild();
            mockSpawn.mockReturnValue(child);
            setImmediate(() => child.emit('error', Object.assign(new Error('EACCES'), { code: 'EACCES' })));
            expect(await isCommandAvailable('pdftoppm')).toBe(true);
        });
    });

    describe('renderViaPdftoppm — primário via poppler', () => {
        it('devolve [] quando pdftoppm não está disponível (probe ENOENT)', async () => {
            const probe = makeFakeChild();
            mockSpawn.mockReturnValue(probe);
            setImmediate(() => probe.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
            expect(await renderViaPdftoppm(Buffer.from('%PDF-'), 3)).toEqual([]);
        });

        it('devolve data URLs PNG quando pdftoppm gera arquivos (em ordem)', async () => {
            const probe = makeFakeChild();
            const render = makeFakeChild();
            mockSpawn.mockReturnValueOnce(probe).mockReturnValueOnce(render);
            setImmediate(() => probe.emit('close', 0));
            setImmediate(() => {
                // pdftoppm "escreve" as páginas no fs fake antes de terminar.
                mockFs.seed('page-1.png', PNG_BYTES);
                mockFs.seed('page-2.png', PNG_BYTES);
                render.emit('close', 0);
            });

            const out = await renderViaPdftoppm(Buffer.from('%PDF-'), 2);
            expect(out).toHaveLength(2);
            expect(out[0]).toMatch(/^data:image\/png;base64,/);
            expect(out[1]).toMatch(/^data:image\/png;base64,/);
            // Argumentos do runSpawn (2ª chamada = render): -png -r <DPI> -l N <pdf> <prefix>.
            expect(mockSpawn.mock.calls[1][0]).toBe('pdftoppm');
            expect(mockSpawn.mock.calls[1][1]).toEqual([
                '-png', '-r', String(DEFAULT_RENDER_DPI), '-l', '2', expect.any(String), expect.any(String),
            ]);
        });
    });

    describe('renderViaSharp — fallback via libvips', () => {
        it('devolve [] quando sharp lança (ausente/instável no ambiente)', async () => {
            // mockSharp.installed=false (default) → default() lança → loop breaka → [].
            expect(await renderViaSharp(Buffer.from('%PDF-'), 3)).toEqual([]);
        });

        it('empilha PNGs quando sharp está disponível (mock devolve buffer por página)', async () => {
            mockSharp.installed = true;
            const out = await renderViaSharp(Buffer.from('%PDF-'), 3);
            expect(out).toHaveLength(3);
            out.forEach((u) => expect(u).toMatch(/^data:image\/png;base64,/));
        });

        it('para de empilhar quando uma página falha (PDF sem página X)', async () => {
            mockSharp.installed = true;
            mockSharp.failOnPage = 2; // páginas 0 e 1 ok; página 2 falha → break.
            const out = await renderViaSharp(Buffer.from('%PDF-'), 5);
            expect(out).toHaveLength(2);
        });
    });

    describe('renderViaPdfParse — fallback final via pdfjs', () => {
        it('mapeia dataUrls de PDFParse.getScreenshot na ordem', async () => {
            mockPdfParse.screenshotDataUrls = ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'];
            expect(await renderViaPdfParse(Buffer.from('%PDF-'), 2)).toEqual([
                'data:image/png;base64,AAA', 'data:image/png;base64,BBB',
            ]);
        });

        it('devolve [] se getScreenshot lança (PDF corrompido)', async () => {
            mockPdfParse.throwOnScreenshot = true;
            expect(await renderViaPdfParse(Buffer.from('%PDF-'), 2)).toEqual([]);
        });

        it('ignora entradas sem dataUrl válido', async () => {
            mockPdfParse.screenshotDataUrls = ['data:image/png;base64,X', null, 'não-data-url'];
            expect(await renderViaPdfParse(Buffer.from('%PDF-'), 5)).toEqual(['data:image/png;base64,X']);
        });
    });

    describe('getPdfPageCount — detecção de total de páginas', () => {
        it('devolve info.total quando pdf-parse expõe o nº de páginas', async () => {
            mockPdfParse.totalPages = 7;
            expect(await getPdfPageCount(Buffer.from('%PDF-'))).toBe(7);
        });

        it('devolve 0 quando getInfo falha (PDF corrompido)', async () => {
            mockPdfParse.throwOnGetInfo = true;
            expect(await getPdfPageCount(Buffer.from('%PDF-'))).toBe(0);
        });

        it('devolve 0 para buffer vazio (defesa em profundidade)', async () => {
            expect(await getPdfPageCount(Buffer.alloc(0))).toBe(0);
        });

        it('devolve 0 quando total é inválido (negativo)', async () => {
            mockPdfParse.totalPages = -1;
            expect(await getPdfPageCount(Buffer.from('%PDF-'))).toBe(0);
        });
    });

    describe('renderPdfPages — orquestrador em camadas', () => {
        it('devolve [] para maxPages=0 ou buffer vazio (caminho rápido)', async () => {
            expect(await renderPdfPages(Buffer.from('whatever'), 0)).toEqual([]);
            expect(await renderPdfPages(Buffer.alloc(0), 5)).toEqual([]);
        });

        it('usa pdftoppm quando disponível (camada primária vence)', async () => {
            const probe = makeFakeChild();
            const render = makeFakeChild();
            mockSpawn.mockReturnValueOnce(probe).mockReturnValueOnce(render);
            setImmediate(() => probe.emit('close', 0));
            setImmediate(() => {
                mockFs.seed('page-1.png', PNG_BYTES);
                render.emit('close', 0);
            });
            const out = await renderPdfPages(Buffer.from('%PDF-'), 1);
            expect(out.length).toBe(1);
            expect(out[0]).toMatch(/^data:image\/png;base64,/);
        });

        it('cai para sharp quando pdftoppm indisponível (camada 2)', async () => {
            const probe = makeFakeChild();
            mockSpawn.mockReturnValueOnce(probe);
            setImmediate(() => probe.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
            mockSharp.installed = true;
            const out = await renderPdfPages(Buffer.from('%PDF-'), 2);
            expect(out).toHaveLength(2);
            out.forEach((u) => expect(u).toMatch(/^data:image\/png;base64,/));
        });

        it('cai para pdf-parse quando pdftoppm e sharp ausentes (camada 3)', async () => {
            const probe = makeFakeChild();
            mockSpawn.mockReturnValueOnce(probe);
            setImmediate(() => probe.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
            // mockSharp.installed=false (default) → sharp lança → cai para pdf-parse.
            mockPdfParse.screenshotDataUrls = ['data:image/png;base64,FALLBACK'];
            const out = await renderPdfPages(Buffer.from('%PDF-'), 1);
            expect(out).toContain('data:image/png;base64,FALLBACK');
        });
    });

    describe('runSpawn — anti-DoS do spawn externo', () => {
        it('DEFAULT_RENDER_TIMEOUT_MS é coerente (>= 1000ms para anti-DoS)', () => {
            expect(DEFAULT_RENDER_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
        });

        it('DEFAULT_RENDER_DPI é 150 (compromisso legibilidade × tamanho)', () => {
            expect(DEFAULT_RENDER_DPI).toBe(150);
        });

        it('rejeita com erro de timeout e mata o child (anti-DoS)', async () => {
            const child = makeFakeChild();
            mockSpawn.mockReturnValue(child);
            // Não emite 'close' → o timer deve matar (SIGKILL) e rejeitar.
            await expect(runSpawn('pdftoppm', [], 150)).rejects.toThrow(/tempo limite/i);
            expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        }, 5_000);

        it('resolve quando o processo termina antes do timeout (happy path)', async () => {
            const child = makeFakeChild();
            mockSpawn.mockReturnValue(child);
            setImmediate(() => child.emit('close', 0));
            await expect(runSpawn('cmd', [], 5_000)).resolves.toBeUndefined();
        });

        it('rejeita quando exit code é não-zero', async () => {
            const child = makeFakeChild();
            mockSpawn.mockReturnValue(child);
            setImmediate(() => child.emit('close', 2));
            await expect(runSpawn('cmd', [], 5_000)).rejects.toThrow(/exited 2/);
        });

        it('rejeita quando o spawn emite ENOENT (binário inexistente)', async () => {
            const child = makeFakeChild();
            mockSpawn.mockReturnValue(child);
            setImmediate(() => child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
            await expect(runSpawn('binario-fake', [], 5_000)).rejects.toThrow();
        });
    });
});
