import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock do html2canvas-pro (importado dinamicamente em screenshot.ts).
const html2canvasMock = vi.fn();
vi.mock('html2canvas-pro', () => ({
    __esModule: true,
    default: html2canvasMock,
}));

import {
    isRouteSafeForSnapshot,
    captureHtmlSnapshot,
    captureScreenshot,
    captureScreenshotDetailed,
    CAPTURE_TIMEOUT_MS,
} from '../../utils/screenshot';

describe('screenshot helpers', () => {
    beforeEach(() => {
        html2canvasMock.mockReset();
        // Garante pathname seguro por padrão.
        window.history.pushState({}, '', '/');
    });

    describe('isRouteSafeForSnapshot', () => {
        it('permite rotas comuns', () => {
            expect(isRouteSafeForSnapshot('/')).toBe(true);
            expect(isRouteSafeForSnapshot('/orders')).toBe(true);
            expect(isRouteSafeForSnapshot('/customers/123')).toBe(true);
            expect(isRouteSafeForSnapshot('/admin/dashboard')).toBe(true);
        });

        it('bloqueia rotas de autenticação (deny-list)', () => {
            expect(isRouteSafeForSnapshot('/login')).toBe(false);
            expect(isRouteSafeForSnapshot('/login/')).toBe(false);
            expect(isRouteSafeForSnapshot('/logout')).toBe(false);
            expect(isRouteSafeForSnapshot('/auth/callback')).toBe(false);
            expect(isRouteSafeForSnapshot('/password/reset')).toBe(false);
            expect(isRouteSafeForSnapshot('/register')).toBe(false);
        });
    });

    describe('captureHtmlSnapshot', () => {
        it('serializa o HTML atual da página', () => {
            document.body.innerHTML = '<main><h1>Pedidos</h1><p>conteúdo</p></main>';
            const snap = captureHtmlSnapshot();
            expect(snap).toContain('<html');
            expect(snap).toContain('Pedidos');
            expect(snap).toContain('conteúdo');
        });

        it('sanitiza inputs[type=password] (zera value/attribute/defaultValue)', () => {
            document.body.innerHTML = `
                <form>
                    <input id="u" type="text" value="joao" />
                    <input id="p" type="password" value="secret123" />
                </form>`;
            const snap = captureHtmlSnapshot();
            // value do campo de texto é preservado; o de senha é removido.
            expect(snap).toContain('joao');
            expect(snap).not.toContain('secret123');
        });

        it('sanitiza campos hidden cujo nome sugira credenciais', () => {
            document.body.innerHTML = `
                <input type="hidden" name="csrf_token" value="TKN-123" />
                <input type="hidden" name="apikey" value="KEY-XYZ" />
                <input type="hidden" name="secret" value="SHH" />`;
            const snap = captureHtmlSnapshot();
            expect(snap).not.toContain('TKN-123');
            expect(snap).not.toContain('KEY-XYZ');
            expect(snap).not.toContain('SHH');
        });

        it('retorna string vazia em rota sensível', () => {
            window.history.pushState({}, '', '/login');
            expect(captureHtmlSnapshot()).toBe('');
        });

        it('trunca snapshots muito grandes', () => {
            document.body.innerHTML = `<div>${'x'.repeat(100000)}</div>`;
            const snap = captureHtmlSnapshot();
            expect(snap.length).toBeLessThanOrEqual(50000);
        });
    });

    describe('captureScreenshot', () => {
        it('retorna data URL base64 PNG quando html2canvas funciona', async () => {
            const toDataURL = vi.fn(() => 'data:image/png;base64,iVBORw0KGgo=');
            html2canvasMock.mockResolvedValue({ toDataURL });
            const result = await captureScreenshot();
            expect(html2canvasMock).toHaveBeenCalledTimes(1);
            expect(toDataURL).toHaveBeenCalledWith('image/png');
            expect(result).toBe('data:image/png;base64,iVBORw0KGgo=');
        });

        it('retorna null quando html2canvas lança', async () => {
            html2canvasMock.mockRejectedValue(new Error('canvas indisponível'));
            const result = await captureScreenshot();
            expect(result).toBeNull();
        });

        it('retorna null em rota sensível (não chama html2canvas)', async () => {
            window.history.pushState({}, '', '/login');
            html2canvasMock.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,xxx' });
            const result = await captureScreenshot();
            expect(result).toBeNull();
            expect(html2canvasMock).not.toHaveBeenCalled();
        });

        it('retorna null quando o canvas não expõe toDataURL', async () => {
            html2canvasMock.mockResolvedValue({ /* sem toDataURL */ });
            const result = await captureScreenshot();
            expect(result).toBeNull();
        });

        it('respeita o timeout padrão de 5s sem resolver', async () => {
            expect(CAPTURE_TIMEOUT_MS).toBe(5000);
            vi.useFakeTimers();
            try {
                html2canvasMock.mockReturnValue(new Promise(() => {}));
                const promise = captureScreenshot();
                await vi.advanceTimersByTimeAsync(CAPTURE_TIMEOUT_MS);
                await expect(promise).resolves.toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });

        it('retorna motivo de indisponibilidade quando o canvas não expõe toDataURL', async () => {
            html2canvasMock.mockResolvedValue({});
            await expect(captureScreenshotDetailed()).resolves.toEqual({ dataUrl: '', reason: 'unavailable' });
        });

        it('sanitiza inputs de senha no clone usado pelo screenshot', async () => {
            const toDataURL = vi.fn(() => 'data:image/png;base64,iVBORw0KGgo=');
            html2canvasMock.mockImplementation(async (_element, options) => {
                const clonedDocument = document.implementation.createHTMLDocument();
                clonedDocument.body.innerHTML = '<input type="password" value="secret123">';
                options.onclone(clonedDocument);
                expect(clonedDocument.body.innerHTML).not.toContain('secret123');
                return { toDataURL };
            });
            await expect(captureScreenshotDetailed()).resolves.toEqual({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
        });

        it('informa timeout quando a renderização não termina', async () => {
            vi.useFakeTimers();
            try {
                html2canvasMock.mockReturnValue(new Promise(() => {}));
                const promise = captureScreenshotDetailed(100);
                await vi.advanceTimersByTimeAsync(100);
                await expect(promise).resolves.toEqual({ dataUrl: '', reason: 'timeout' });
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
