import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { getProductName, getProductPrice, getProjectName, getStatusBadge } from '../../components/Manufacturing/utils';
import { Product, Project } from '../../types';

describe('Manufacturing utils', () => {
    const createMockProduct = (id: string, label: string, price: number): Product => ({
        id,
        label,
        price,
        description: null,
        ref: `PROD-${id}`,
        price_variazione: 0,
        barsize: null,
        barcode: null,
        fk_product_type: 0,
        price_min: 0,
        price_min_ttc: 0,
        status: 1
    });

    const createMockProject = (id: string, title: string): Project => ({
        id,
        ref: `PRJ-${id}`,
        title,
        description: null,
        statu: '1',
        date_c: Date.now(),
        date_end: null,
        socid: null,
        public: '0',
        contact_id: null,
        assigned_users: []
    });

    describe('getProductName', () => {
        it('returns product label when found', () => {
            const products = [createMockProduct('1', 'Açúcar 5kg', 25)];
            expect(getProductName('1', products)).toBe('Açúcar 5kg');
        });

        it('returns "Produto #id" when not found', () => {
            const products = [createMockProduct('1', 'Açúcar 5kg', 25)];
            expect(getProductName('999', products)).toBe('Produto #999');
        });

        it('returns "Produto Desconhecido" when id is undefined', () => {
            const products = [createMockProduct('1', 'Açúcar 5kg', 25)];
            expect(getProductName(undefined, products)).toBe('Produto Desconhecido');
        });
    });

    describe('getProductPrice', () => {
        it('returns product price when found', () => {
            const products = [createMockProduct('1', 'Açúcar 5kg', 25)];
            expect(getProductPrice('1', products)).toBe(25);
        });

        it('returns 0 when product not found', () => {
            const products = [createMockProduct('1', 'Açúcar 5kg', 25)];
            expect(getProductPrice('999', products)).toBe(0);
        });

        it('returns 0 when id is undefined', () => {
            const products = [createMockProduct('1', 'Açúcar 5kg', 25)];
            expect(getProductPrice(undefined, products)).toBe(0);
        });
    });

    describe('getProjectName', () => {
        it('returns project title when found', () => {
            const projects = [createMockProject('1', 'Projeto Alpha')];
            expect(getProjectName('1', projects)).toBe('Projeto Alpha');
        });

        it('returns null when project not found', () => {
            const projects = [createMockProject('1', 'Projeto Alpha')];
            expect(getProjectName('999', projects)).toBeNull();
        });

        it('returns null when id is undefined', () => {
            const projects = [createMockProject('1', 'Projeto Alpha')];
            expect(getProjectName(undefined, projects)).toBeNull();
        });
    });

    describe('getStatusBadge', () => {
        it('renders Rascunho for status 0', () => {
            const { container } = render(getStatusBadge('0'));
            expect(container.textContent).toContain('Rascunho');
        });

        it('renders Validado for status 1', () => {
            const { container } = render(getStatusBadge('1'));
            expect(container.textContent).toContain('Validado');
        });

        it('renders Em Progresso for status 2', () => {
            const { container } = render(getStatusBadge('2'));
            expect(container.textContent).toContain('Em Progresso');
        });

        it('render Produzido for status 3', () => {
            const { container } = render(getStatusBadge('3'));
            expect(container.textContent).toContain('Produzido');
        });

        it('renders Desconhecido for unknown status', () => {
            const { container } = render(getStatusBadge('9'));
            expect(container.textContent).toContain('Desconhecido');
        });
    });
});