import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BOMDetail } from '../../components/Manufacturing/details/BOMDetail';
import { BOM, DolibarrConfig, Product } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';
import { TAB_ACTIVE_CLASSES } from '../../utils/theme';

// ---------------------------------------------------------------------------
// Static source analysis for #1300 — read BOMDetail.tsx to verify zero
// dynamic color-class interpolation at the source level (criterion a).
// ---------------------------------------------------------------------------
const __testDir = dirname(fileURLToPath(import.meta.url));
const BOM_DETAIL_PATH = resolve(__testDir, '../../components/Manufacturing/details/BOMDetail.tsx');
const BOM_DETAIL_SOURCE = readFileSync(BOM_DETAIL_PATH, 'utf-8');

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

const bomNoLines: BOM = {
    id: 'bom2',
    ref: 'BOM002',
    label: 'Receita Vazia',
    status: '1',
    qty: 1,
    product_id: '1',
    lines: [],
};

const bomUndefinedLines: BOM = {
    id: 'bom3',
    ref: 'BOM003',
    label: 'Receita Sem Lines',
    status: '1',
    qty: 1,
    product_id: '1',
};

describe('BOMDetail — Delete (#585)', () => {
    it('shows Excluir button when onDelete is provided', () => {
        const onDelete = vi.fn();
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} onDelete={onDelete} />
        );
        expect(screen.getByTestId('bom-delete-btn')).toBeInTheDocument();
    });

    it('shows confirmation banner after clicking Excluir', () => {
        const onDelete = vi.fn();
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} onDelete={onDelete} />
        );
        fireEvent.click(screen.getByTestId('bom-delete-btn'));
        expect(screen.getByTestId('bom-delete-confirm-btn')).toBeInTheDocument();
    });

    it('calls onDelete after confirming', () => {
        const onDelete = vi.fn();
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} onDelete={onDelete} />
        );
        fireEvent.click(screen.getByTestId('bom-delete-btn'));
        fireEvent.click(screen.getByTestId('bom-delete-confirm-btn'));
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('does not call onDelete when confirmation is cancelled', () => {
        const onDelete = vi.fn();
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} onDelete={onDelete} />
        );
        fireEvent.click(screen.getByTestId('bom-delete-btn'));
        fireEvent.click(screen.getByText('Cancelar'));
        expect(onDelete).not.toHaveBeenCalled();
    });
});

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

describe('BOMDetail — classes Tailwind literais por tema (#1094)', () => {
    const configWith = (themeColor: string): DolibarrConfig => ({
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        themeColor: themeColor as DolibarrConfig['themeColor'],
        darkMode: false,
        apiLimit: 0,
    });

    const tabButton = (label: string) =>
        screen.getByText(label).closest('button') as HTMLElement;

    it('a aba ativa (Visão Geral) usa classes literais da cor de tema (indigo)', () => {
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={configWith('indigo')} onClose={vi.fn()} />
        );

        const overview = tabButton('Visão Geral');
        expect(overview.className).toContain('border-indigo-600');
        expect(overview.className).toContain('text-indigo-600');
        expect(overview.className).toContain('dark:border-indigo-400');
        expect(overview.className).toContain('dark:text-indigo-400');
        // Nenhuma classe interpolada
        expect(overview.className).not.toContain('${');
        expect(overview.className).not.toContain('undefined');
    });

    it('a aba inativa usa classes neutras (sem cor de tema)', () => {
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={configWith('indigo')} onClose={vi.fn()} />
        );

        const components = tabButton('Componentes & Árvore');
        expect(components.className).toContain('border-transparent');
        expect(components.className).not.toContain('border-indigo-600');
        expect(components.className).not.toContain('text-indigo-600');
    });

    it('trocar de aba move as classes ativas para "Componentes & Árvore"', () => {
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={configWith('indigo')} onClose={vi.fn()} />
        );

        const overviewBefore = tabButton('Visão Geral');
        const componentsBefore = tabButton('Componentes & Árvore');
        expect(overviewBefore.className).toContain('border-indigo-600');
        expect(componentsBefore.className).not.toContain('border-indigo-600');

        fireEvent.click(componentsBefore);

        const overviewAfter = tabButton('Visão Geral');
        const componentsAfter = tabButton('Componentes & Árvore');
        expect(componentsAfter.className).toContain('border-indigo-600');
        expect(componentsAfter.className).toContain('text-indigo-600');
        expect(overviewAfter.className).not.toContain('border-indigo-600');
    });

    it('aplica a cor correta para tema diferente (emerald)', () => {
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={configWith('emerald')} onClose={vi.fn()} />
        );

        const overview = tabButton('Visão Geral');
        expect(overview.className).toContain('border-emerald-600');
        expect(overview.className).toContain('text-emerald-600');
        expect(overview.className).toContain('dark:border-emerald-400');
        expect(overview.className).not.toContain('border-indigo-600');
    });

    it('cor de tema desconhecida cai no fallback indigo', () => {
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={configWith('cor-inexistente')} onClose={vi.fn()} />
        );

        const overview = tabButton('Visão Geral');
        expect(overview.className).toContain('border-indigo-600');
        expect(overview.className).not.toContain('undefined');
    });
});

// ===========================================================================
// #1300 — Zero interpolação dinâmica de classe de cor (epic #1096)
//
// O código de produção já foi corrigido pelo PR #1258 (issue #1094).
// Esta suíte "trava" o comportamento esperado e previne regressões,
// cobrindo os critérios de aceite (a), (b) e (c) da issue #1300.
// ===========================================================================
describe('BOMDetail (#1300) — classes Tailwind estáticas (zero interpolação dinâmica)', () => {
    // Detecta construção de classe de cor por interpolação:
    // `border-${...}`, `bg-${...}`, `text-${...}`, `hover:bg-${...}`, etc.
    // Esses padrões não são detectados pelo JIT scanner do Tailwind v4.
    const COLOR_INTERPOLATION_RE =
        /(?:hover:|dark:|focus:|group-hover:|active:)?(?:border|bg|text|ring|ring-offset|from|to|via|outline|fill|stroke|divide|placeholder|accent|caret|decoration)-\$\{/;

    // --- Critério (a): zero interpolação de classe de cor ---

    it('criterio (a): código-fonte não contém interpolação de classe de cor via template string', () => {
        expect(BOM_DETAIL_SOURCE).not.toMatch(COLOR_INTERPOLATION_RE);
    });

    it('criterio (a): todas as interpolações ${ no arquivo são chamadas de getTabClasses (não de cor)', () => {
        const interpolations = BOM_DETAIL_SOURCE.match(/\$\{[^}]*\}/g) ?? [];
        expect(interpolations.length).toBeGreaterThan(0);
        interpolations.forEach((interp) => {
            expect(interp).not.toMatch(COLOR_INTERPOLATION_RE);
        });
    });

    // --- Critério (b): mapa segue Record<ThemeColor, string> ---

    it('criterio (b): importa getTabClasses do helper compartilhado utils/theme', () => {
        expect(BOM_DETAIL_SOURCE).toContain("from '../../../utils/theme'");
        expect(BOM_DETAIL_SOURCE).toContain('getTabClasses');
    });

    it('criterio (b): TAB_ACTIVE_CLASSES usa apenas classes literais (sem interpolação)', () => {
        expect(TAB_ACTIVE_CLASSES.indigo).toBe('border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400');
        expect(TAB_ACTIVE_CLASSES.emerald).toBe('border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400');
        Object.values(TAB_ACTIVE_CLASSES).forEach((v) => expect(v).not.toContain('${'));
    });

    // --- Critério (c): renderização sem regressão em edge cases ---

    it('criterio (c): renderiza BOM com linhas vazias sem erros', () => {
        render(
            <BOMDetail bom={bomNoLines} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} />
        );
        fireEvent.click(screen.getByText('Componentes & Árvore'));
        expect(screen.getByText('Nenhum componente definido.')).toBeInTheDocument();
    });

    it('criterio (c): renderiza BOM sem propriedade lines (undefined) sem erros', () => {
        render(
            <BOMDetail bom={bomUndefinedLines} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} />
        );
        fireEvent.click(screen.getByText('Componentes & Árvore'));
        expect(screen.getByText('Nenhum componente definido.')).toBeInTheDocument();
    });
});
