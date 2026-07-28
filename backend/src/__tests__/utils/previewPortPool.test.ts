import { describe, it, expect, beforeEach } from 'vitest';
import {
    acquirePreviewPorts,
    previewPortsFor,
    _resetPreviewPortPool,
} from '../../utils/previewPorts';
import {
    PREVIEW_FRONTEND_PORT_BASE,
    PREVIEW_BACKEND_PORT_BASE,
    PREVIEW_PORT_RANGE,
} from '../../utils/gcWorktrees';

/**
 * FLIP Degrau 2 PR-C (#1661): pool/lease de portas de preview. Oráculo do risco G3 — duas tasks
 * vivas com `issue % RANGE` igual NÃO podem receber as MESMAS portas (senão EADDRINUSE ou, pior, o
 * Judge fotografa a porta de OUTRA task). A alocação vira lease por-issue DENTRO da faixa do GC.
 */
describe('acquirePreviewPorts — pool/lease por-issue (#1661)', () => {
    beforeEach(() => {
        _resetPreviewPortPool();
    });

    it('1. duas issues com mesmo %RANGE recebem pares DISTINTOS (mata a colisão mod-10)', () => {
        // 12 % 10 == 22 % 10 == 2 → sob a fórmula antiga seriam idênticos.
        const a = acquirePreviewPorts(12);
        const b = acquirePreviewPorts(22);
        expect(a.frontendPort).not.toBe(b.frontendPort);
        expect(a.backendPort).not.toBe(b.backendPort);
        // Ambos dentro da faixa do GC.
        for (const p of [a, b]) {
            expect(p.frontendPort).toBeGreaterThanOrEqual(PREVIEW_FRONTEND_PORT_BASE);
            expect(p.frontendPort).toBeLessThan(PREVIEW_FRONTEND_PORT_BASE + PREVIEW_PORT_RANGE);
            expect(p.backendPort).toBeGreaterThanOrEqual(PREVIEW_BACKEND_PORT_BASE);
            expect(p.backendPort).toBeLessThan(PREVIEW_BACKEND_PORT_BASE + PREVIEW_PORT_RANGE);
        }
        // A 1ª issue fica no slot preferido k0=2; a 2ª foi deslocada circularmente p/ o próximo livre.
        expect(a.frontendPort).toBe(PREVIEW_FRONTEND_PORT_BASE + 2);
    });

    it('2. release() de uma issue libera o slot p/ outra issue reusar', () => {
        const a = acquirePreviewPorts(12); // k0 = 2
        const front12 = a.frontendPort;
        a.release();
        // Uma issue nova cujo k0 também caia em 2 reusa o slot recém-liberado.
        const c = acquirePreviewPorts(2); // k0 = 2
        expect(c.frontendPort).toBe(front12);
    });

    it('3. re-acquire da MESMA issue (sem release) devolve o MESMO par (idempotente)', () => {
        const first = acquirePreviewPorts(12);
        const second = acquirePreviewPorts(12);
        expect(second.frontendPort).toBe(first.frontendPort);
        expect(second.backendPort).toBe(first.backendPort);
        // E um TERCEIRO acquirer distinto com mesmo k0 é deslocado (o slot segue leased pela issue 12).
        const other = acquirePreviewPorts(22);
        expect(other.frontendPort).not.toBe(first.frontendPort);
    });

    it('4. pool esgotado (RANGE issues distintas) → o próximo acquire lança "esgotado"', () => {
        for (let i = 0; i < PREVIEW_PORT_RANGE; i++) {
            acquirePreviewPorts(1000 + i); // RANGE issues → todos os slots ocupados
        }
        expect(() => acquirePreviewPorts(9999)).toThrowError(/esgotado/i);
    });

    it('5. acquire(n) sem colisão usa k0 = n % RANGE (par preferido de hoje — prova de compat)', () => {
        for (const n of [0, 7, 123, 2050]) {
            _resetPreviewPortPool();
            const got = acquirePreviewPorts(n);
            const pref = previewPortsFor(n);
            expect(got.frontendPort).toBe(pref.frontendPort);
            expect(got.backendPort).toBe(pref.backendPort);
            // Mantém EXATAMENTE os números de sempre.
            expect(got.frontendPort).toBe(PREVIEW_FRONTEND_PORT_BASE + (n % PREVIEW_PORT_RANGE));
            expect(got.backendPort).toBe(PREVIEW_BACKEND_PORT_BASE + (n % PREVIEW_PORT_RANGE));
        }
    });

    it('release é idempotente: chamar duas vezes não libera um lease NOVO da mesma issue', () => {
        const a = acquirePreviewPorts(12);
        a.release();
        a.release(); // no-op
        // Novo lease da mesma issue reserva de novo; o release STALE de `a` não deve derrubá-lo.
        const b = acquirePreviewPorts(12);
        a.release(); // stale — não deve liberar o lease de `b`
        // Uma issue concorrente com mesmo k0 deve ser deslocada (b segue leased).
        const other = acquirePreviewPorts(22);
        expect(other.frontendPort).not.toBe(b.frontendPort);
    });

    it('previewPortsFor (helper puro) NÃO reserva — não afeta o pool', () => {
        const p = previewPortsFor(12);
        expect(p.frontendPort).toBe(PREVIEW_FRONTEND_PORT_BASE + 2);
        // O pool segue vazio: uma issue com k0=2 pega o slot preferido.
        const a = acquirePreviewPorts(2);
        expect(a.frontendPort).toBe(PREVIEW_FRONTEND_PORT_BASE + 2);
    });
});
