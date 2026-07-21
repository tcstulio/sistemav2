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

    it('renderiza erros de console e chamadas de API que falharam', () => {
        const body = buildIssueBody('x', {
            consoleErrors: ['err1', 'err2'],
            failedRequests: ['GET /api/x 500'],
        });
        expect(body).toContain('#### Erros de console');
        expect(body).toContain('err1');
        expect(body).toContain('#### Chamadas de API que falharam');
        expect(body).toContain('GET /api/x 500');
    });

    it('#1560 renderiza logs de console (consoleLogs)', () => {
        const body = buildIssueBody('x', { consoleLogs: ['log a', 'log b'] });
        expect(body).toContain('#### Logs de console');
        expect(body).toContain('log a');
        expect(body).toContain('log b');
    });

    it('#1560 marca presença do screenshot sem embedar o base64', () => {
        const huge = 'data:image/png;base64,' + 'A'.repeat(5000);
        const body = buildIssueBody('x', { screenshot: huge });
        expect(body).toContain('**Screenshot:** capturado');
        expect(body).toMatch(/\d+ kB base64\/PNG/);
        // Não vaza o base64 no body (seria grande demais p/ markdown).
        expect(body).not.toContain('A'.repeat(5000));
    });

    it('#1560 justifica ausência de screenshot via captureMeta.reason', () => {
        const body = buildIssueBody('x', { captureMeta: { reason: 'sensitive-route', screenshotOmitted: true } });
        expect(body).toContain('**Screenshot:** não capturado');
        expect(body).toContain('rota sensível');
    });

    it('#1560 registra timeout como motivo de screenshot ausente', () => {
        const body = buildIssueBody('x', { captureMeta: { reason: 'timeout', screenshotOmitted: true } });
        expect(body).toContain('timeout');
    });

    it('#1560 colapsa e trunca o snapshot HTML grande', () => {
        const big = '<div>' + 'x'.repeat(30000) + '</div>';
        const body = buildIssueBody('x', { htmlSnapshot: big });
        expect(body).toContain('<details><summary>Snapshot HTML da página</summary>');
        expect(body).toContain('<!-- truncado de ');
        // Trunca p/ no máximo 20k de snapshot.
        expect(body.length).toBeLessThan(big.length);
    });

    it('#1560 mantém snapshot HTML pequeno sem truncar', () => {
        const small = '<html><body>ok</body></html>';
        const body = buildIssueBody('x', { htmlSnapshot: small });
        expect(body).toContain(small);
        expect(body).not.toContain('<!-- truncado');
    });

    it('inclui nome do reporter quando fornecido', () => {
        const body = buildIssueBody('x', {}, 'joao');
        expect(body).toContain('**Reportado por:** joao');
    });

    it('protege campos de contexto contra quebra da estrutura markdown', () => {
        const body = buildIssueBody('x', {
            url: 'http://app/orders`malicioso',
            consoleErrors: ['erro', '```', '# título injetado'],
            htmlSnapshot: '<html>```</html>',
        }, 'joao\n# injetado');
        expect(body).toContain('`` http://app/orders`malicioso ``');
        expect(body).toContain('**Reportado por:** joao # injetado');
        expect(body).toContain('````\nerro\n```\n# título injetado\n````');
        expect(body).toContain('````html\n<html>```</html>\n````');
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
