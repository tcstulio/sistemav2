import { describe, it, expect } from 'vitest';

import {
    CATEGORY_TYPE_OPTIONS,
    typeToForm,
    formToType,
} from '../../utils/categoryType';

describe('categoryType', () => {
    describe('CATEGORY_TYPE_OPTIONS', () => {
        it('inclui os 8 tipos suportados pelo Dolibarr', () => {
            expect(CATEGORY_TYPE_OPTIONS).toHaveLength(8);
        });

        it('possui códigos 0-7 únicos e contíguos', () => {
            const codes = CATEGORY_TYPE_OPTIONS.map(o => Number(o.code));
            expect(codes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
            expect(new Set(codes).size).toBe(8);
        });

        it('possui valores (form) únicos', () => {
            const values = CATEGORY_TYPE_OPTIONS.map(o => o.value);
            expect(new Set(values).size).toBe(8);
        });
    });

    describe('typeToForm', () => {
        it('mapeia códigos numéricos para valores do form', () => {
            expect(typeToForm('0')).toBe('product');
            expect(typeToForm('1')).toBe('supplier');
            expect(typeToForm('2')).toBe('customer');
            expect(typeToForm('3')).toBe('member');
            expect(typeToForm('4')).toBe('contact');
            expect(typeToForm('5')).toBe('bank_account');
            expect(typeToForm('6')).toBe('project');
            expect(typeToForm('7')).toBe('warehouse');
        });

        it('aceita tipos recebidos como number', () => {
            expect(typeToForm(6)).toBe('project');
            expect(typeToForm(2)).toBe('customer');
        });

        it('aceita o próprio valor do form (idempotente)', () => {
            expect(typeToForm('project')).toBe('project');
            expect(typeToForm('customer')).toBe('customer');
        });

        it('mantém type=project para categoria tipo 6 (critério de aceite)', () => {
            expect(typeToForm('6')).toBe('project');
        });

        it('preserva type=customer para categoria tipo 2 (critério de aceite)', () => {
            expect(typeToForm('2')).toBe('customer');
        });

        it('faz fallback para product em tipo desconhecido', () => {
            expect(typeToForm('999')).toBe('product');
            expect(typeToForm('')).toBe('product');
        });
    });

    describe('formToType', () => {
        it('mapeia valores do form para códigos numéricos', () => {
            expect(formToType('product')).toBe('0');
            expect(formToType('supplier')).toBe('1');
            expect(formToType('customer')).toBe('2');
            expect(formToType('member')).toBe('3');
            expect(formToType('contact')).toBe('4');
            expect(formToType('bank_account')).toBe('5');
            expect(formToType('project')).toBe('6');
            expect(formToType('warehouse')).toBe('7');
        });

        it('preserva o tipo original de uma categoria Projeto (6) ao salvar', () => {
            // Simula fluxo de edição: typeToForm carrega o select; formToType reconstrói o payload.
            const originalCode = '6';
            const formValue = typeToForm(originalCode);
            expect(formToType(formValue)).toBe('6');
        });

        it('preserva type=2 (cliente) ao editar e salvar', () => {
            const formValue = typeToForm('2');
            expect(formToType(formValue)).toBe('2');
        });

        it('preserva type=0 (produto) ao editar e salvar', () => {
            const formValue = typeToForm('0');
            expect(formToType(formValue)).toBe('0');
        });

        it('preserva cada um dos 8 tipos em round-trip (criar/editar)', () => {
            for (const code of ['0', '1', '2', '3', '4', '5', '6', '7']) {
                const formValue = typeToForm(code);
                expect(formToType(formValue)).toBe(code);
            }
        });

        it('cria categoria com type=contact enviando payload correto', () => {
            expect(formToType('contact')).toBe('4');
        });

        it('faz fallback para 0 em valor desconhecido', () => {
            expect(formToType('unknown')).toBe('0');
        });
    });
});
