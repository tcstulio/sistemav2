import { describe, it, expect } from 'vitest';
import { extractCiLogExcerpt, jobIdsFromRollup } from '../../utils/ciLogExcerpt';

// Linha no formato REAL do `gh run view --log-failed`: "job\tstep\t<timestamp> <conteúdo>".
const L = (content: string) => `test\tRun npx playwright test\t2026-07-20T15:01:25.9Z ${content}`;

describe('extractCiLogExcerpt — extrator PURO de log de CI', () => {
    it('render/playwright: extrai as falhas + spec:linha + sumário; SEM ruído; dedup de retries', () => {
        const raw = [
            L('[WebServer] [vite] ws proxy error:'),
            L('[WebServer] Error: connect ECONNREFUSED 127.0.0.1:3004'),
            L('  1) [chromium] › tests/render/orders.render.spec.ts:56:5 › OrderListPage › convertToInvoice abre o detalhe'),
            L('    Error: locator.click: Test timeout of 30000ms exceeded.'),
            L('        at /home/runner/work/sistemav2/sistemav2/tests/render/orders.render.spec.ts:65:9'),
            // retry do MESMO teste (deve deduplicar)
            L('  1) [Mobile Chrome] › tests/render/orders.render.spec.ts:56:5 › OrderListPage › convertToInvoice abre o detalhe'),
            L('  2) [chromium] › tests/render/proposals.render.spec.ts:41:5 › resolve seletores contra o DOM real'),
            L('    Error: strict mode violation: locator resolved to 2 elements'),
            L('  6 failed'),
            L('  116 passed (7.7m)'),
            L('##[error]Process completed with exit code 1.'),
        ].join('\n');
        const out = extractCiLogExcerpt(raw, 1500);
        expect(out.length).toBeLessThanOrEqual(1500);
        expect(out).not.toMatch(/ECONNREFUSED|WebServer|ws proxy/);
        expect(out).toContain('orders.render.spec.ts:56:5');
        expect(out).toContain('proposals.render.spec.ts:41:5');
        expect(out).toContain('strict mode violation');
        expect(out).toContain('6 failed');
        expect(out).toContain('exit code 1');
        // dedup: a linha do teste #1 aparece só UMA vez (retry chromium/Mobile Chrome colapsado)
        expect(out.match(/convertToInvoice abre o detalhe/g)?.length).toBe(1);
    });

    it('vitest verde-com-Unhandled: pega o Unhandled Rejection + sumário ANTES do console.error de teste que passa', () => {
        const raw = [
            L('stderr | InvoiceList > erro'),
            L('[ERROR][InvoiceList] Dolibarr indisponível — caminho de erro exercitado de propósito'),
            L('Unhandled Rejection: TypeError: Cannot read properties of undefined'),
            L('Test Files  1 failed | 120 passed (121)'),
            L('Tests  2820 passed (2820)'),
            L('Errors  1 error'),
        ].join('\n');
        const out = extractCiLogExcerpt(raw, 1500);
        expect(out).toContain('Unhandled Rejection');
        expect(out).toContain('Errors  1 error');
        expect(out.length).toBeLessThanOrEqual(1500);
    });

    it('tsc: extrai a linha error TS', () => {
        const raw = [L("src/x.ts(5,3): error TS2345: Argument of type 'number' is not assignable.")].join('\n');
        expect(extractCiLogExcerpt(raw)).toContain('error TS2345');
    });

    it('nada acionável → fallback tail (≤800), não vazio; input vazio → ""', () => {
        expect(extractCiLogExcerpt('')).toBe('');
        const raw = Array.from({ length: 50 }, (_, i) => L(`linha de log comum numero ${i} sem falha`)).join('\n');
        const out = extractCiLogExcerpt(raw, 1500);
        expect(out.length).toBeGreaterThan(0);
        expect(out.length).toBeLessThanOrEqual(800);
    });

    it('linha gigante é capada em ~300 chars e o teto GLOBAL é respeitado', () => {
        const huge = 'Error: ' + 'x'.repeat(5000);
        const raw = [L(huge)].join('\n');
        const out = extractCiLogExcerpt(raw, 1500);
        expect(out.length).toBeLessThanOrEqual(1500);
        // a linha isolada foi capada bem abaixo dos 5000
        expect(out.length).toBeLessThan(400);
    });

    it('overflow: prioriza Tier A (identidade/sumário) sobre Tier B (contexto)', () => {
        const many = [];
        for (let i = 0; i < 30; i++) many.push(L(`    Error: contexto B numero ${i} ${'y'.repeat(50)}`)); // Tier B
        many.push(L('  1) [chromium] › a.spec.ts:1:1 › FALHA IMPORTANTE A')); // Tier A
        many.push(L('  6 failed')); // Tier A sumário
        const out = extractCiLogExcerpt(many.join('\n'), 400);
        expect(out.length).toBeLessThanOrEqual(400);
        expect(out).toContain('FALHA IMPORTANTE A'); // Tier A entra mesmo com a fila cheia de B
        expect(out).toContain('6 failed');
    });
});

describe('jobIdsFromRollup', () => {
    it('extrai jobIds únicos do detailsUrl (dedup + cap)', () => {
        const rollup = [
            { detailsUrl: 'https://github.com/o/r/actions/runs/29/job/88386805009' },
            { detailsUrl: 'https://github.com/o/r/actions/runs/29/job/88386804954' },
            { detailsUrl: 'https://github.com/o/r/actions/runs/29/job/88386805009' }, // dup
        ];
        expect(jobIdsFromRollup(rollup, 2)).toEqual(['88386805009', '88386804954']);
    });
    it('check sem detailsUrl (status legado) → ignorado; vazio → []', () => {
        expect(jobIdsFromRollup([{ }, { detailsUrl: '' }])).toEqual([]);
        expect(jobIdsFromRollup([])).toEqual([]);
    });
    it('respeita o cap', () => {
        const rollup = [1, 2, 3].map((n) => ({ detailsUrl: `x/runs/1/job/${n}00` }));
        expect(jobIdsFromRollup(rollup, 2)).toEqual(['100', '200']);
    });
});
