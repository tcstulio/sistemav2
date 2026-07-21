import { describe, it, expect } from 'vitest';
import {
    sanitizeForIssueBody,
    sanitizeHtmlSnapshot,
    HTML_SNAPSHOT_BODY_MAX_BYTES,
    HTML_SANITIZE_OPTS,
} from '../../utils/sanitizeHtml';

describe('sanitizeHtml — sanitizeForIssueBody (#1563 helper de body)', () => {
    it('retorna vazio para entradas vazias/inválidas (NUNCA lança)', () => {
        expect(sanitizeForIssueBody('').html).toBe('');
        expect(sanitizeForIssueBody('').truncated).toBe(false);
        expect(sanitizeForIssueBody(undefined as unknown as string).html).toBe('');
        expect(sanitizeForIssueBody(null as unknown as string).html).toBe('');
        expect(sanitizeForIssueBody(123 as unknown as string).html).toBe('');
    });

    it('remove <script> + conteúdo executável antes de devolver', () => {
        const dirty = '<div>ok<script>alert(1)</script><p>fim</p></div>';
        const r = sanitizeForIssueBody(dirty);
        expect(r.html).not.toContain('<script');
        expect(r.html).not.toContain('alert(1)');
        expect(r.html).toContain('<div>');
        expect(r.html).toContain('<p>fim</p>');
    });

    it('remove handlers inline (onclick/onerror/onload)', () => {
        const dirty = '<p onclick="x">a</p><img src="x" onerror="evil()">';
        const r = sanitizeForIssueBody(dirty);
        expect(r.html).not.toContain('onclick=');
        expect(r.html).not.toContain('onerror=');
    });

    it('bloqueia javascript: em hrefs', () => {
        const r = sanitizeForIssueBody('<a href="javascript:alert(1)">link</a>');
        expect(r.html).not.toContain('javascript:');
    });

    it('HTML pequeno NÃO trunca e mantém estrutura', () => {
        const html = '<div class="x" data-foo="bar">ok</div>';
        const r = sanitizeForIssueBody(html);
        expect(r.truncated).toBe(false);
        expect(r.html).toContain('class="x"');
        expect(r.html).toContain('data-foo="bar"');
        expect(r.html).toContain('ok');
    });

    it('HTML maior que 5KB é truncado COM marcador `...truncado`', () => {
        const big = '<div>' + 'x'.repeat(12 * 1024) + '</div>';
        const r = sanitizeForIssueBody(big);
        expect(r.truncated).toBe(true);
        expect(r.html).toContain('...truncado');
        expect(Buffer.byteLength(r.html, 'utf8')).toBeLessThanOrEqual(HTML_SNAPSHOT_BODY_MAX_BYTES + 32);
    });

    it('trunca no ÚLTIMO fechamento de tag antes do limite (não corta tag no meio)', () => {
        // 20 tags <p></p> curtas antes do lixo — cap pequeno p/ forçar truncamento.
        const html = Array.from({ length: 20 }, () => '<p>par</p>').join('') + 'xxxxxxxxxxxx';
        const r = sanitizeForIssueBody(html, 50);
        expect(r.truncated).toBe(true);
        expect(r.html).toContain('...truncado');
        // Não pode terminar com "par" solto (precisa estar dentro de </p>).
        expect(r.html).not.toMatch(/par\s*\.{3}truncado\s*$/);
        // E o bloco termina com `</...truncado` (fechamento de tag antes do marcador).
        expect(r.html).toMatch(/<\/[A-Za-z0-9]+>{0,2}\.{3}truncado\s*$/);
    });

    it('respeita `maxBytes` customizado', () => {
        const html = '<div>' + 'a'.repeat(2048) + '</div>';
        const r = sanitizeForIssueBody(html, 256);
        expect(r.truncated).toBe(true);
        expect(r.html).toContain('...truncado');
        expect(Buffer.byteLength(r.html, 'utf8')).toBeLessThanOrEqual(256 + 32);
    });

    it('preserva <style>, <details>, <code>, data-* e aria-* (politica de debug)', () => {
        const html = [
            '<style>.a{color:red}</style>',
            '<details><summary>x</summary><code class="c">y</code></details>',
            '<span data-foo="bar" aria-label="al">ok</span>',
        ].join('');
        const r = sanitizeForIssueBody(html);
        expect(r.truncated).toBe(false);
        expect(r.html).toContain('<style>');
        expect(r.html).toContain('<details>');
        expect(r.html).toContain('<code');
        expect(r.html).toContain('data-foo="bar"');
        expect(r.html).toContain('aria-label="al"');
    });

    it('HTML_SNAPSHOT_BODY_MAX_BYTES é exposto como 5KB para integração no body', () => {
        expect(HTML_SNAPSHOT_BODY_MAX_BYTES).toBe(5 * 1024);
    });

    it('HTML_SANITIZE_OPTS inclui img/style/details/code/pre', () => {
        // sanity check do contrato de policy — usado para garantir paridade com disco.
        expect(HTML_SANITIZE_OPTS.allowedTags).toEqual(expect.arrayContaining([
            'img', 'style', 'details', 'summary', 'code', 'pre',
        ]));
    });

    it('sanitizeHtmlSnapshot (sem truncar) está disponível para reuso p/ disco', () => {
        const clean = sanitizeHtmlSnapshot('<div><script>x</script>ok</div>');
        expect(clean).not.toContain('<script');
        expect(clean).toContain('<div>');
        expect(clean).toContain('ok');
    });
});
