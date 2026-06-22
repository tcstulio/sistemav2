import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { BOMDetail } from '../../components/Manufacturing/details/BOMDetail';
import { BOM, DolibarrConfig, Product } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';

const config: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
};

const finalProduct: Product = {
    id: '1',
    ref: 'P1',
    label: 'Produto Final',
    type: '0',
    price: 100,
    price_ttc: 100,
    stock_reel: 0,
};

const componentProduct: Product = {
    id: '2',
    ref: 'P2',
    label: 'Componente A',
    type: '0',
    price: 50,
    price_ttc: 50,
    stock_reel: 0,
};

const bom: BOM = {
    id: 'bom1',
    ref: 'BOM001',
    label: 'Receita de Produção',
    status: '1',
    qty: 1,
    product_id: '1',
    lines: [
        { id: 'l1', parent_id: 'bom1', fk_product: '2', qty: 2, cost_price: 50, efficiency: 1 },
    ],
};

describe('BOMDetail — Currency standardization (#642)', () => {
    it('renders estimated total cost in BRL via formatCurrency on overview (no $ prefix)', () => {
        const { container } = render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} />
        );

        // bomTotalCost = cost_price(50) * qty(2) = 100
        const formatted = formatCurrency(100);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(container.textContent).toContain('R$');
    });

    it('renders component estimated cost in BRL via formatCurrency on components tab', () => {
        const { container } = render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} />
        );

        fireEvent.click(screen.getByText('Componentes & Árvore'));

        // Est: formatCurrency(cost_price 50)
        const formatted = formatCurrency(50);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === `Est: ${formatted}`
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(container.textContent).toContain('R$');
    });
});
