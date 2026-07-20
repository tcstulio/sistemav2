/**
 * uploadSanitizer.test.ts — issue #1561.
 *
 * Cobertura:
 *   - decodeBase64Size: data URL, base64 puro, padding, vazios.
 *   - screenshotSizeGuard: 413 quando > 5MB; next() quando OK; next() quando
 *     screenshot ausente.
 *   - sanitizeReportHtml: remove <script> executáveis, mantém estrutura
 *     de marcação para debug (tags visuais, atributos style/class/id).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
    MAX_SCREENSHOT_BYTES,
    decodeBase64Size,
    screenshotSizeGuard,
    sanitizeReportHtml,
} from '../../middleware/uploadSanitizer';

function mockReqResNext(body: unknown = {}) {
    const req = { body } as unknown as Request;
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    return { req, res, next };
}

describe('uploadSanitizer (#1561)', () => {
    describe('decodeBase64Size', () => {
        it('retorna 0 para input vazio/não-string', () => {
            expect(decodeBase64Size('')).toBe(0);
            expect(decodeBase64Size(undefined)).toBe(0);
            expect(decodeBase64Size(null)).toBe(0);
            expect(decodeBase64Size(123)).toBe(0);
        });

        it('decodifica base64 puro (4 chars = 3 bytes)', () => {
            // 'AAAA' → 3 bytes (sem padding)
            expect(decodeBase64Size('AAAA')).toBe(3);
            // 'AAA=' → 2 bytes (1 padding)
            expect(decodeBase64Size('AAA=')).toBe(2);
            // 'AA==' → 1 byte (2 padding)
            expect(decodeBase64Size('AA==')).toBe(1);
        });

        it('desconsidera o prefixo data URL', () => {
            const dataUrl = 'data:image/png;base64,AAAA';
            const pure = 'AAAA';
            expect(decodeBase64Size(dataUrl)).toBe(decodeBase64Size(pure));
            expect(decodeBase64Size(dataUrl)).toBe(3);
        });

        it('estima corretamente um binário de 1MB', () => {
            // 1MB = 1048576 bytes; base64 ~ 1.4M chars.
            const bytes = 1048576;
            const b64 = 'A'.repeat(Math.ceil(bytes / 0.75));
            const decoded = decodeBase64Size(b64);
            // Margem de 1 byte (floor).
            expect(decoded).toBeGreaterThanOrEqual(bytes - 1);
            expect(decoded).toBeLessThanOrEqual(bytes);
        });
    });

    describe('screenshotSizeGuard', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('chama next() quando screenshot ausente', () => {
            const { req, res, next } = mockReqResNext({ outro: 'campo' });
            screenshotSizeGuard(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        });

        it('chama next() quando screenshot é string vazia', () => {
            const { req, res, next } = mockReqResNext({ screenshot: '' });
            screenshotSizeGuard(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        });

        it('chama next() quando screenshot está dentro do limite (1MB)', () => {
            const bytes = 1024 * 1024;
            const b64 = 'A'.repeat(Math.ceil(bytes / 0.75));
            const { req, res, next } = mockReqResNext({ screenshot: b64 });
            screenshotSizeGuard(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        });

        it('rejeita com 413 quando screenshot excede 5MB', () => {
            // 6MB em base64.
            const bytes = 6 * 1024 * 1024;
            const b64 = 'A'.repeat(Math.ceil(bytes / 0.75));
            const { req, res, next } = mockReqResNext({ screenshot: b64 });
            screenshotSizeGuard(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(413);
            const body = (res.json as any).mock.calls[0][0];
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
            expect(body.error.details.receivedBytes).toBeGreaterThan(MAX_SCREENSHOT_BYTES);
            expect(body.error.details.maxBytes).toBe(MAX_SCREENSHOT_BYTES);
        });

        it('aceita screenshot exatamente no limite (5MB)', () => {
            const bytes = MAX_SCREENSHOT_BYTES;
            const b64 = 'A'.repeat(Math.ceil(bytes / 0.75));
            const { req, res, next } = mockReqResNext({ screenshot: b64 });
            screenshotSizeGuard(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        });

        it('rejeita data URL excedendo o limite', () => {
            const bytes = 6 * 1024 * 1024;
            const b64 = 'A'.repeat(Math.ceil(bytes / 0.75));
            const { req, res, next } = mockReqResNext({
                screenshot: `data:image/png;base64,${b64}`,
            });
            screenshotSizeGuard(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(413);
        });
    });

    describe('sanitizeReportHtml', () => {
        it('retorna string vazia para input não-string', () => {
            expect(sanitizeReportHtml(undefined)).toBe('');
            expect(sanitizeReportHtml(null)).toBe('');
            expect(sanitizeReportHtml(123)).toBe('');
        });

        it('remove tags <script> executáveis', () => {
            const html = '<div>olá</div><script>alert("xss")</script><p>mundo</p>';
            const out = sanitizeReportHtml(html);
            // Nenhuma tag <script> executável sobra: o sanitize-html escapa
            // o nome da tag (`&lt;script&gt;`) — o conteúdo textual entre as
            // tags removidas é preservado (debug), mas NÃO é executável.
            expect(out).not.toMatch(/<script/i);
            expect(out).toMatch(/&lt;script&gt;/);
            expect(out).toMatch(/olá/);
            expect(out).toMatch(/mundo/);
        });

        it('remove atributos on* (event handlers)', () => {
            const html = '<img src="x.png" onload="alert(1)">';
            const out = sanitizeReportHtml(html);
            expect(out).not.toMatch(/onload/i);
            // src é mantido.
            expect(out).toMatch(/x\.png/);
        });

        it('mantém estrutura visual para debug (div, span, img, style, class)', () => {
            const html = '<html><head><meta charset="utf-8"><title>t</title></head>'
                + '<body><div class="container" style="color:red"><span>texto</span>'
                + '<img src="logo.png" alt="logo"></div></body></html>';
            const out = sanitizeReportHtml(html);
            expect(out).toMatch(/<html/);
            expect(out).toMatch(/<head>/);
            expect(out).toMatch(/<meta/);
            expect(out).toMatch(/<body>/);
            expect(out).toMatch(/<div/);
            expect(out).toMatch(/class="container"/);
            expect(out).toMatch(/style="color:red"/);
            expect(out).toMatch(/<img/);
            expect(out).toMatch(/src="logo.png"/);
        });

        it('remove <iframe> por padrão (sanitize-html defaults)', () => {
            const html = '<iframe src="https://evil.com"></iframe><p>ok</p>';
            const out = sanitizeReportHtml(html);
            expect(out).not.toMatch(/<iframe/i);
            expect(out).toMatch(/ok/);
        });
    });
});
