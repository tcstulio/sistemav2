import { describe, it, expect } from 'vitest';
import { buildIssueBody, ReportContext } from '../../services/issueReportService';

describe('buildIssueBody — layout base (compatibilidade)', () => {
    it('inclui descrição ou placeholder quando ausente', () => {
        const body = buildIssueBody('', {});
        expect(body).toContain('_(sem descrição)_');
    });

    it('inclui o separador e a seção "Contexto capturado automaticamente"', () => {
        const body = buildIssueBody('algo', {});
        expect(body).toContain('---');
        expect(body).toContain('### Contexto capturado automaticamente');
    });

    it('lista campos opcionais quando presentes', () => {
        const ctx: ReportContext = {
            url: 'https://app/x',
            breadcrumb: 'Tela › Modal',
            element: 'button#save',
            source: 'src/Foo.tsx:42',
            viewport: '1280x720',
            userAgent: 'Mozilla/5.0',
        };
        const body = buildIssueBody('d', ctx, { reporter: 'jane' });
        expect(body).toContain('**Reportado por:** jane');
        expect(body).toContain('**Tela (URL):** `https://app/x`');
        expect(body).toContain('**Onde:** Tela › Modal');
        expect(body).toContain('**Elemento:** `button#save`');
        expect(body).toContain('**Fonte (dev):** `src/Foo.tsx:42`');
        expect(body).toContain('**Viewport:** 1280x720');
        expect(body).toContain('**Navegador:** Mozilla/5.0');
    });

    it('mantém "Chamadas de API que falharam" em code block quando há failedRequests', () => {
        const body = buildIssueBody('d', { failedRequests: ['GET /api/x → 500', 'POST /api/y → 401'] });
        expect(body).toContain('#### Chamadas de API que falharam');
        expect(body).toContain('GET /api/x → 500');
        expect(body).toContain('POST /api/y → 401');
    });

    it('accepta reporter como 3º arg string (formato antigo, backward compatible)', () => {
        const body = buildIssueBody('d', {}, 'alice');
        expect(body).toContain('**Reportado por:** alice');
    });
});

describe('buildIssueBody — #1563 contexto visual', () => {
    it('embute o screenshot no topo como ![screenshot](url) quando screenshotUrl informada', () => {
        const body = buildIssueBody('d', { screenshotUrl: 'https://img/sh.png' });
        expect(body).toContain('### Contexto visual');
        expect(body).toContain('![screenshot](https://img/sh.png)');
        // O screenshot aparece antes do separador/header de contexto automático.
        const visIdx = body.indexOf('### Contexto visual');
        const autoIdx = body.indexOf('### Contexto capturado automaticamente');
        expect(visIdx).toBeGreaterThan(-1);
        expect(autoIdx).toBeGreaterThan(visIdx);
    });

    it('omite seção "Contexto visual" quando NÃO há screenshot, mas mantém restante', () => {
        const body = buildIssueBody('d', { html: '<p>oi</p>' });
        expect(body).not.toContain('### Contexto visual');
        expect(body).not.toContain('![screenshot]');
        // HTML details ainda devem aparecer (critério: "manter o HTML em details").
        expect(body).toContain('<details>');
    });

    it('ignora screenshotUrl vazia/whitespace', () => {
        const body = buildIssueBody('d', { screenshotUrl: '   ' });
        expect(body).not.toContain('### Contexto visual');
        expect(body).not.toContain('![screenshot]');
    });

    it('inclui seção colapsável <details> "HTML snapshot (sanitizado)" quando há html', () => {
        const body = buildIssueBody('d', { html: '<div><p>conteúdo</p></div>' });
        expect(body).toContain('<details><summary>HTML snapshot (sanitizado)</summary>');
        expect(body).toContain('```html');
        expect(body).toContain('conteúdo');
        expect(body).toContain('</details>');
    });

    it('sanitiza HTML do snapshot (remove <script>)', () => {
        const body = buildIssueBody('d', { html: '<p>ok</p><script>alert(1)</script>' });
        expect(body).toContain('<p>ok</p>');
        expect(body).not.toContain('<script');
        expect(body).not.toContain('alert(1)');
    });

    it('trunca HTML em 5KB e adiciona aviso "...truncado"', () => {
        const huge = `<p>${'x'.repeat(20_000)}</p>`; // ~20KB
        const body = buildIssueBody('d', { html: huge });
        expect(body).toContain('...truncado');
        // O bloco html inteiro (entre ```html e ```) não deve passar de ~6KB.
        const m = body.match(/```html\n([\s\S]*?)\n```/);
        expect(m).not.toBeNull();
        expect(Buffer.byteLength(m![1], 'utf8')).toBeLessThanOrEqual(6 * 1024);
    });

    it('NÃO adiciona aviso quando HTML é menor que 5KB', () => {
        const body = buildIssueBody('d', { html: '<p>pequeno</p>' });
        expect(body).not.toContain('...truncado');
    });

    it('inclui seção "Console logs/erros" em code block com últimos 20', () => {
        const errs = Array.from({ length: 30 }, (_, i) => `err-${i}`);
        const body = buildIssueBody('d', { consoleErrors: errs });
        expect(body).toContain('#### Console logs/erros');
        // Últimos 20 (índices 10..29).
        expect(body).toContain('err-29');
        expect(body).toContain('err-10');
        expect(body).not.toContain('err-9');
    });

    it('combina consoleErrors + consoleLogs mantendo os últimos 20', () => {
        const body = buildIssueBody('d', {
            consoleErrors: ['E1', 'E2'],
            consoleLogs: ['L1', 'L2', 'L3'],
        });
        expect(body).toContain('#### Console logs/erros');
        expect(body).toContain('E1');
        expect(body).toContain('L3');
    });

    it('omite seção de console quando não há logs/erros', () => {
        const body = buildIssueBody('d', {});
        expect(body).not.toContain('#### Console logs/erros');
    });
});

describe('buildIssueBody — limites e robustez', () => {
    it('never excede o limite de 60KB do GitHub', () => {
        const huge = `<p>${'a'.repeat(200_000)}</p>`;
        const body = buildIssueBody('desc enorme', { html: huge, consoleErrors: ['x'.repeat(50_000)] });
        expect(body.length).toBeLessThanOrEqual(60_000);
    });

    it('context null/undefined → apenas descrição + header', () => {
        const b1 = buildIssueBody('d', null as any);
        const b2 = buildIssueBody('d', undefined as any);
        expect(b1).toContain('### Contexto capturado automaticamente');
        expect(b2).toContain('### Contexto capturado automaticamente');
    });

    it('fmt idêntico para POST (criar) e PUT (re-envio) — função pura e estável', () => {
        const ctx: ReportContext = {
            url: 'https://app/x',
            screenshotUrl: 'https://img/s.png',
            html: '<p>oi</p>',
            consoleErrors: ['e1'],
        };
        const a = buildIssueBody('desc', ctx, { reporter: 'r' });
        const b = buildIssueBody('desc', ctx, { reporter: 'r' });
        expect(a).toBe(b);
    });
});
