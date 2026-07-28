import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/errorBuffer', () => ({
    installErrorBuffer: vi.fn(),
    readErrorBuffer: vi.fn(() => ({ logs: ['log1'], errors: ['err1'] })),
}));
vi.mock('../../utils/screenshot', () => ({
    captureHtmlSnapshot: vi.fn(() => '<html>SNAP</html>'),
    captureScreenshotDetailed: vi.fn(),
    isRouteSafeForSnapshot: vi.fn(() => true),
}));

import { captureContext, captureFullContext, pushFailedRequest } from '../../utils/reportContext';
import { captureScreenshotDetailed, isRouteSafeForSnapshot } from '../../utils/screenshot';

describe('reportContext', () => {
    beforeEach(() => {
        vi.mocked(captureScreenshotDetailed).mockReset();
        vi.mocked(isRouteSafeForSnapshot).mockReset().mockReturnValue(true);
    });

    describe('captureContext (síncrono)', () => {
        it('retorna todos os campos básicos + consoleLogs + htmlSnapshot', () => {
            const ctx = captureContext();
            expect(ctx.url).toContain('/');
            expect(typeof ctx.breadcrumb).toBe('string');
            expect(ctx.viewport).toMatch(/^\d+x\d+$/);
            expect(typeof ctx.userAgent).toBe('string');
            expect(ctx.consoleErrors).toEqual(['err1']);
            expect(ctx.consoleLogs).toEqual(['log1']);
            expect(ctx.htmlSnapshot).toBe('<html>SNAP</html>');
            expect(ctx.screenshot).toBe(''); // preenchido só por captureFullContext
        });

        it('inclui failedRequests acumulados via pushFailedRequest', () => {
            pushFailedRequest('POST', '/api/y', 'network', 'timeout');
            const ctx = captureContext();
            expect(ctx.failedRequests.length).toBeGreaterThanOrEqual(1);
            expect(ctx.failedRequests.some((f) => f.includes('/api/y') && f.includes('network'))).toBe(true);
        });
    });

    describe('captureFullContext (assíncrono)', () => {
        it('adiciona screenshot base64 ao contexto', async () => {
            vi.mocked(captureScreenshotDetailed).mockResolvedValue({ dataUrl: 'data:image/png;base64,abc' });
            const ctx = await captureFullContext();
            expect(ctx.screenshot).toBe('data:image/png;base64,abc');
            expect(ctx.consoleLogs).toEqual(['log1']);
            expect(ctx.htmlSnapshot).toBe('<html>SNAP</html>');
        });

        it('quando screenshot estoura/falha (timeout), omite HTML e mantém os demais campos', async () => {
            vi.mocked(captureScreenshotDetailed).mockResolvedValue({ dataUrl: '', reason: 'timeout' });
            const ctx = await captureFullContext();
            expect(ctx.screenshot).toBe('');
            expect(ctx.consoleErrors).toEqual(['err1']);
            expect(ctx.consoleLogs).toEqual(['log1']);
            expect(ctx.htmlSnapshot).toBe('');
            expect(ctx.captureMeta).toEqual({ screenshotOmitted: true, reason: 'timeout' });
        });

        it('se captureScreenshot lançar, captura o erro e devolve contexto sem screenshot', async () => {
            vi.mocked(captureScreenshotDetailed).mockRejectedValue(new Error('boom'));
            const ctx = await captureFullContext();
            expect(ctx.screenshot).toBe('');
            expect(ctx.htmlSnapshot).toBe('<html>SNAP</html>');
        });
    });

    describe('captureMeta (#1560 — diagnóstico de captura parcial)', () => {
        it('ausente quando screenshot é capturado com sucesso', async () => {
            vi.mocked(captureScreenshotDetailed).mockResolvedValue({ dataUrl: 'data:image/png;base64,abc' });
            const ctx = await captureFullContext();
            expect(ctx.captureMeta).toBeUndefined();
        });

        it('marca sensitiveRoute quando a rota está na deny-list', async () => {
            vi.mocked(isRouteSafeForSnapshot).mockReturnValue(false);
            // Mesmo que html2canvas funcionasse, não deve ser chamado em rota sensível.
            vi.mocked(captureScreenshotDetailed).mockResolvedValue({ dataUrl: 'data:image/png;base64,abc' });
            const ctx = await captureFullContext();
            expect(ctx.captureMeta).toEqual({
                sensitiveRoute: true,
                screenshotOmitted: true,
                reason: 'sensitive-route',
            });
            expect(ctx.screenshot).toBe('');
            expect(vi.mocked(captureScreenshotDetailed)).not.toHaveBeenCalled();
        });

        it('marca reason="timeout" quando screenshot devolve null', async () => {
            vi.mocked(captureScreenshotDetailed).mockResolvedValue({ dataUrl: '', reason: 'timeout' });
            const ctx = await captureFullContext();
            expect(ctx.captureMeta).toEqual({ screenshotOmitted: true, reason: 'timeout' });
        });

        it('marca reason="error" quando captureScreenshot lança', async () => {
            vi.mocked(captureScreenshotDetailed).mockRejectedValue(new Error('boom'));
            const ctx = await captureFullContext();
            expect(ctx.captureMeta).toEqual({ screenshotOmitted: true, reason: 'error' });
        });
    });
});
