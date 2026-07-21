import { describe, it, expect } from 'vitest';
import { buildIssueBody } from '../../utils/issueBodyBuilder';

describe('buildIssueBody', () => {
    it('inclui descrição e rodapé mesmo sem contexto', () => {
        const body = buildIssueBody('algo quebrou', null);
        expect(body).toContain('algo quebrou');
        expect(body).toContain('Reportado pelo botão in-app');
    });

    it('usa placeholder quando descrição está vazia', () => {
        const body = buildIssueBody('   ', undefined);
        expect(body).toContain('_(sem descrição)_');
    });

    it('renderiza campos básicos do contexto (url, breadcrumb, viewport, userAgent)', () => {
        const body = buildIssueBody('x', {
            url: 'http://app/orders',
            breadcrumb: 'Pedidos › Novo',
            viewport: '1280x800',
            userAgent: 'Mozilla/Chrome',
        });
        expect(body).toContain('**Tela (URL):** `http://app/orders`');
        expect(body).toContain('**Onde:** Pedidos › Novo');
        expect(body).toContain('**Viewport:** 1280x800');
        expect(body).toContain('**Navegador:** Mozilla/Chrome');
    });

    // #1563: consolidado — `consoleErrors` e `consoleLogs` agora vivem numa
    // ÚNICA seção `#### Console logs/erros` com prefixos `[log]` / `[error]`.
    it('renderiza erros de console, logs e chamadas de API que falharam (seção única #1563)', () => {
        const body = buildIssueBody('x', {
            consoleErrors: ['err1', 'err2'],
            consoleLogs: ['log a', 'log b'],
            failedRequests: ['GET /api/x 500'],
        });
        // Nova seção única substitui "#### Erros de console" + "#### Logs de console".
        expect(body).toContain('#### Console logs/erros');
        expect(body).toContain('[log] log a');
        expect(body).toContain('[log] log b');
        expect(body).toContain('[error] err1');
        expect(body).toContain('[error] err2');
        // HTTP failures continuam em seção separada (destaque próprio).
        expect(body).toContain('#### Chamadas de API que falharam');
        expect(body).toContain('GET /api/x 500');
    });

    // #1560 / #1563: logs de console ainda são renderizados dentro da seção
    // consolidada. Adaptação — antes era `#### Logs de console`, agora cai
    // em `#### Console logs/erros` com prefixo `[log]`.
    it('renderiza logs de console (consoleLogs) na seção consolidada', () => {
        const body = buildIssueBody('x', { consoleLogs: ['log a', 'log b'] });
        expect(body).toContain('#### Console logs/erros');
        expect(body).toContain('[log] log a');
        expect(body).toContain('[log] log b');
    });

    // #1563: o fallback textual do screenshot agora vive na seção
    // "Contexto visual" — antes era inline na lista de contexto capturado.
    it('marca presença do screenshot sem embedar o base64 (via "Contexto visual")', () => {
        const huge = 'data:image/png;base64,' + 'A'.repeat(5000);
        const body = buildIssueBody('x', { screenshot: huge });
        expect(body).toContain('### Contexto visual');
        expect(body).toMatch(/\d+ kB base64\/PNG.*anexo/);
        // Base64 NÃO vaza no body.
        expect(body).not.toContain('A'.repeat(5000));
        // E NUNCA embarcamos a imagem quando só há base64 (sem URL pública).
        expect(body).not.toMatch(/!\[screenshot\]/);
    });

    // #1563: motivo da omissão do screenshot (rota sensível, timeout, …)
    // aparece na seção "Contexto visual".
    it('justifica ausência de screenshot via captureMeta.reason (em "Contexto visual")', () => {
        const body = buildIssueBody('x', { captureMeta: { reason: 'sensitive-route', screenshotOmitted: true } });
        expect(body).toContain('### Contexto visual');
        expect(body).toContain('rota sensível');
    });

    it('registra timeout como motivo de screenshot ausente', () => {
        const body = buildIssueBody('x', { captureMeta: { reason: 'timeout', screenshotOmitted: true } });
        expect(body).toContain('Contexto visual');
        expect(body).toContain('timeout');
    });

    // #1563: HTML snapshot agora (a) usa `<details>` com summary
    // `HTML snapshot (sanitizado)` e (b) é truncado em 5KB com marcador
    // `...truncado` (sem o marcador legado `<!-- truncado de N chars -->`).
    it('colapsa e trunca o snapshot HTML grande (cap 5KB, marcador "...truncado")', () => {
        const big = '<div>' + 'x'.repeat(30 * 1024) + '</div>';
        const body = buildIssueBody('x', { htmlSnapshot: big });
        expect(body).toContain('<details><summary>HTML snapshot (sanitizado)</summary>');
        expect(body).toContain('...truncado');
        // Marcador legado (anterior a #1563) saiu do código.
        expect(body).not.toContain('<!-- truncado de ');
        // O body total fica muito abaixo do limite de 60KB do GitHub.
        expect(body.length).toBeLessThan(big.length);
    });

    it('mantém snapshot HTML pequeno sem truncar (em "HTML snapshot (sanitizado)")', () => {
        // O sanitize-html trata `<html>`/`<body>` como non-text tags (defaults),
        // então usamos `<div>` que SOBREVIVE à sanitização (#1563).
        const small = '<div>ok</div>';
        const body = buildIssueBody('x', { htmlSnapshot: small });
        expect(body).toContain(small);
        expect(body).not.toContain('...truncado');
        // O sumário mudou p/ "HTML snapshot (sanitizado)".
        expect(body).toContain('HTML snapshot (sanitizado)');
    });

    it('inclui nome do reporter quando fornecido', () => {
        const body = buildIssueBody('x', {}, 'joao');
        expect(body).toContain('**Reportado por:** joao');
    });

    it('protege campos de contexto contra quebra da estrutura markdown (#1563)', () => {
        // Sanitize-html remove `<html>` por default (non-text), então usamos `<div>`.
        // Console errors e logs agora vivem na MESMA seção com prefixo `[log]`/`[error]`.
        const body = buildIssueBody('x', {
            url: 'http://app/orders`malicioso',
            consoleErrors: ['erro', '```', '# título injetado'],
            consoleLogs: ['log com backtick ` no meio'],
            htmlSnapshot: '<div>```</div>',
        }, 'joao\n# injetado');
        expect(body).toContain('`` http://app/orders`malicioso ``');
        expect(body).toContain('**Reportado por:** joao # injetado');
        // Errors com prefixo `#1563` dentro de uma section única de Console logs/erros.
        expect(body).toContain('[error] erro');
        expect(body).toContain('[error] ```');
        expect(body).toContain('[error] # título injetado');
        // Logs também na seção consolidada.
        expect(body).toContain('[log] log com backtick ` no meio');
        // HTML snapshot sobrevive à sanitização dentro do fence html.
        expect(body).toMatch(/````html\n<div>```<\/div>\n````/);
    });

    it('limita erros/logs/failed a 20 linhas cada', () => {
        const many = Array.from({ length: 50 }, (_, i) => `linha ${i}`);
        const body = buildIssueBody('x', {
            consoleErrors: many,
            consoleLogs: many,
            failedRequests: many,
        });
        // 20 de cada → não deve conter a linha 20 (0-indexed).
        expect(body).toContain('linha 19');
        expect(body).not.toContain('linha 20');
    });
});

describe('buildIssueBody — #1563 Contexto visual', () => {
    it('embute ![screenshot](url) no topo do body quando há URL pública', () => {
        const body = buildIssueBody('x', {
            screenshotUrl: '/static/reports/abc-123.png',
            url: 'http://app/orders',
        });
        expect(body).toContain('### Contexto visual');
        expect(body).toContain('![screenshot](/static/reports/abc-123.png)');
        // A seção visual vem ANTES da seção de contexto capturado.
        const visualIdx = body.indexOf('### Contexto visual');
        const contextIdx = body.indexOf('### Contexto capturado automaticamente');
        expect(visualIdx).toBeGreaterThanOrEqual(0);
        expect(contextIdx).toBeGreaterThan(visualIdx);
        // Base64 cru NUNCA vaza quando há URL pública.
        expect(body).not.toMatch(/Screenshot capturado \(\d+ kB base64\/PNG\)/);
    });

    it('omite a imagem mas mantém fallback textual (tamanho/anexo) quando NÃO há URL pública', () => {
        const huge = 'data:image/png;base64,' + 'A'.repeat(5000);
        const body = buildIssueBody('x', { screenshot: huge });
        expect(body).toContain('### Contexto visual');
        // Fallback com tamanho (NÃO imagem embutida, NÃO base64 raw).
        expect(body).toMatch(/Screenshot capturado \(\d+ kB base64\/PNG\)[^\n]*anexo/);
        expect(body).not.toContain('A'.repeat(5000));
        expect(body).not.toMatch(/!\[screenshot\]/);
    });

    it('mantém o motivo textual quando apenas captureMeta.reason é informado', () => {
        const body = buildIssueBody('x', {
            captureMeta: { reason: 'sensitive-route', screenshotOmitted: true },
        });
        expect(body).toContain('### Contexto visual');
        expect(body).toContain('rota sensível');
        expect(body).not.toMatch(/!\[screenshot\]/);
    });

    it('omite a seção "Contexto visual" quando não há nenhuma pista de screenshot', () => {
        const body = buildIssueBody('x', {
            url: 'http://app/orders',
            consoleErrors: ['e'],
        });
        // Sem screenshotUrl/screenshot/captureMeta → sem seção visual.
        expect(body).not.toContain('### Contexto visual');
        // Mas contexto capturado segue presente.
        expect(body).toContain('### Contexto capturado automaticamente');
    });
});
