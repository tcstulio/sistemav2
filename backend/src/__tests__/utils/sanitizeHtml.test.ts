import { describe, it, expect } from 'vitest';
import {
    sanitizeSnapshotHtml,
    truncateToBytes,
    sanitizeAndTruncate,
    MAX_HTML_SNAPSHOT_BYTES,
} from '../../utils/sanitizeHtml';

describe('sanitizeSnapshotHtml', () => {
    it('remove tags <script> e seu conteúdo', () => {
        const out = sanitizeSnapshotHtml('<p>ok</p><script>alert(1)</script>');
        expect(out).toContain('<p>ok</p>');
        expect(out).not.toContain('<script');
        expect(out).not.toContain('alert(1)');
    });

    it('remove handlers on* de elementos', () => {
        const out = sanitizeSnapshotHtml('<div onclick="evil()">x</div>');
        expect(out).not.toContain('onclick');
        expect(out).not.toContain('evil');
        expect(out).toContain('x');
    });

    it('remove iframes embutidos', () => {
        const out = sanitizeSnapshotHtml('<p>a</p><iframe src="https://evil"></iframe>');
        expect(out).not.toContain('<iframe');
        expect(out).not.toContain('evil');
    });

    it('mantém tags de formatação segura (p, b, a, ul, li, etc.)', () => {
        const html = '<h1>Título</h1><p>Texto <b>negrito</b> <a href="https://x.com">link</a></p><ul><li>1</li></ul>';
        const out = sanitizeSnapshotHtml(html);
        expect(out).toContain('<h1>Título</h1>');
        expect(out).toContain('<b>negrito</b>');
        expect(out).toContain('href="https://x.com"');
        expect(out).toContain('<ul>');
    });

    it('string vazia → string vazia', () => {
        expect(sanitizeSnapshotHtml('')).toBe('');
    });

    it('_preserva atributos safe em img (src/alt)', () => {
        const out = sanitizeSnapshotHtml('<img src="https://img/x.png" alt="tela">');
        expect(out).toContain('src="https://img/x.png"');
        expect(out).toContain('alt="tela"');
    });
});

describe('truncateToBytes', () => {
    it('não trunca strings abaixo do limite', () => {
        const s = 'abc';
        const r = truncateToBytes(s, 100);
        expect(r.text).toBe('abc');
        expect(r.truncated).toBe(false);
        expect(r.originalBytes).toBe(3);
    });

    it('trunca strings ASCII acima do limite', () => {
        const s = '0123456789'.repeat(10); // 100 bytes
        const r = truncateToBytes(s, 50);
        expect(r.truncated).toBe(true);
        expect(r.originalBytes).toBe(100);
        expect(Buffer.byteLength(r.text, 'utf8')).toBeLessThanOrEqual(50);
        expect(r.text).toBe(s.slice(0, 50));
    });

    it('respeita fronteira UTF-8 multibyte (não corta meio code point)', () => {
        // "ç" = 2 bytes UTF-8 (0xC3 0xA7). Repetimos para forçar corte no meio.
        const s = 'ç'.repeat(100); // 200 bytes
        const r = truncateToBytes(s, 7); // 7 = 3.5 chars
        expect(r.truncated).toBe(true);
        expect(Buffer.byteLength(r.text, 'utf8')).toBeLessThanOrEqual(7);
        // Roundtrip UTF-8: nenhum code point cortado → re-encode idêntico e
        // sem U+FFFD (replacement char) ao decodificar.
        const reencoded = Buffer.from(r.text, 'utf8');
        expect(reencoded.toString('utf8')).toBe(r.text);
        expect(r.text).not.toContain('\uFFFD');
        // Texto truncado deve ser prefixo válido do original.
        expect(s.startsWith(r.text)).toBe(true);
    });

    it('limite igual ao tamanho → não trunca', () => {
        const s = 'abcde'; // 5 bytes
        const r = truncateToBytes(s, 5);
        expect(r.truncated).toBe(false);
        expect(r.text).toBe('abcde');
    });

    it('string vazia → vazia, não truncada', () => {
        const r = truncateToBytes('', 100);
        expect(r.text).toBe('');
        expect(r.truncated).toBe(false);
        expect(r.originalBytes).toBe(0);
    });
});

describe('sanitizeAndTruncate', () => {
    it('pipeline: sanitiza e mantém tudo quando abaixo do limite', () => {
        const html = '<p>ok</p><script>x</script>';
        const r = sanitizeAndTruncate(html);
        expect(r.truncated).toBe(false);
        expect(r.text).toContain('<p>ok</p>');
        expect(r.text).not.toContain('<script');
    });

    it('pipeline: trunca quando sanitizado excede 5KB (default)', () => {
        const big = `<p>${'a'.repeat(10_000)}</p>`; // ~10KB
        const r = sanitizeAndTruncate(big);
        expect(r.truncated).toBe(true);
        expect(r.originalBytes).toBeGreaterThan(MAX_HTML_SNAPSHOT_BYTES);
        expect(r.finalBytes).toBeLessThanOrEqual(MAX_HTML_SNAPSHOT_BYTES);
    });

    it('maxBytes customizado', () => {
        const r = sanitizeAndTruncate('<p>abcdefghij</p>', { maxBytes: 5 });
        expect(r.truncated).toBe(true);
        expect(Buffer.byteLength(r.text, 'utf8')).toBeLessThanOrEqual(5);
    });

    it('entrada vazia → texto vazio', () => {
        const r = sanitizeAndTruncate('');
        expect(r.text).toBe('');
        expect(r.truncated).toBe(false);
        expect(r.originalBytes).toBe(0);
        expect(r.finalBytes).toBe(0);
    });
});
