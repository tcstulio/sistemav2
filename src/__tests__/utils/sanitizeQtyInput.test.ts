import { describe, it, expect } from 'vitest';
import { sanitizeQtyInput } from '../../utils/sanitizeQtyInput';

// ─── #1582 Sanitização de inputs numéricos (qty) ─────────────────────────────
//
// Estes testes cobrem a função pura `sanitizeQtyInput` em isolamento,
// exercitando diretamente o caminho `parseInt('abc') || 0` (NaN fallback).
//
// Importante: testes de componente (SupplierList / SupplierInvoiceList) NÃO
// conseguem exercitar o caminho NaN via UI porque o `<input type="number">`
// do jsdom sanitiza caracteres não-numéricos → '', fazendo o handler entrar
// no ramo `e.target.value === '' ? 0 : ...` antes de chegar em `parseInt`.
// Por isso, a cobertura real do fallback de NaN fica aqui.

describe('sanitizeQtyInput (#1582)', () => {
    it('retorna 0 para string vazia (campo apagado)', () => {
        expect(sanitizeQtyInput('')).toBe(0);
    });

    it('retorna o número para string numérica válida', () => {
        expect(sanitizeQtyInput('0')).toBe(0);
        expect(sanitizeQtyInput('1')).toBe(1);
        expect(sanitizeQtyInput('5')).toBe(5);
        expect(sanitizeQtyInput('100')).toBe(100);
    });

    it('retorna 0 para texto não-numérico (caminho NaN real) — sem propagar NaN', () => {
        // Este teste exercita de fato `parseInt('abc') || 0` — caminho que
        // o teste de componente não consegue cobrir (jsdom sanitiza 'abc' → ''
        // em <input type="number">).
        expect(sanitizeQtyInput('abc')).toBe(0);
        expect(Number.isNaN(sanitizeQtyInput('abc'))).toBe(false);
        expect(Number.isFinite(sanitizeQtyInput('abc'))).toBe(true);
    });

    it('NÃO propaga NaN para o backend em nenhuma entrada patológica', () => {
        const patologicas = ['abc', 'NaN', 'null', 'undefined', 'foo bar', '--', '   ', 'e10', '0xZZ'];
        for (const input of patologicas) {
            const result = sanitizeQtyInput(input);
            expect(Number.isNaN(result), `input=${JSON.stringify(input)}`).toBe(false);
            expect(Number.isFinite(result), `input=${JSON.stringify(input)}`).toBe(true);
        }
    });

    it('extrai dígitos iniciais de strings mistas (semântica de parseInt)', () => {
        expect(sanitizeQtyInput('5abc')).toBe(5);
        expect(sanitizeQtyInput('5.5')).toBe(5); // parseInt trunca decimal
        expect(sanitizeQtyInput('12x')).toBe(12);
    });

    it('suporta números negativos', () => {
        expect(sanitizeQtyInput('-3')).toBe(-3);
        expect(sanitizeQtyInput('-1')).toBe(-1);
    });

    it('ignora espaços ao redor (parseInt trim default)', () => {
        expect(sanitizeQtyInput('  5  ')).toBe(5);
    });
});