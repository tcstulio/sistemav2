import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { BOMDetail } from '../../components/Manufacturing/details/BOMDetail';
import { BOM, DolibarrConfig, Product } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';
import { TAB_ACTIVE_CLASSES, ThemeColor } from '../../utils/theme';

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
// Testes comportamentais: validam o DOM RENDERizado pelo componente (não
// leitura de fonte via readFileSync). Assim os testes sobrevivem a refactors
// de estrutura de arquivo e validam o comportamento real do usuário.
// ===========================================================================
describe('BOMDetail (#1300) — classes Tailwind estáticas (zero interpolação dinâmica)', () => {
    const configWith = (themeColor: string): DolibarrConfig => ({
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        themeColor: themeColor as DolibarrConfig['themeColor'],
        darkMode: false,
        apiLimit: 0,
    });

    const tabButton = (label: string) =>
        screen.getByText(label).closest('button') as HTMLElement;

    const ALL_COLORS: ThemeColor[] = [
        'slate', 'gray', 'zinc', 'neutral', 'stone',
        'red', 'orange', 'amber', 'yellow', 'lime',
        'green', 'emerald', 'teal', 'cyan', 'sky',
        'blue', 'indigo', 'violet', 'purple', 'fuchsia',
        'pink', 'rose',
    ];

    // --- Critério (a): zero interpolação de classe de cor ---
    // Verificado via DOM renderizado: nenhuma className deve conter "${"
    // (artefato de template literal não-resolvido) ou "undefined".

    it('criterio (a): aba ativa (Visão Geral) não tem artefatos de interpolação no DOM', () => {
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} />
        );
        const overview = tabButton('Visão Geral');
        expect(overview.className).not.toContain('${');
        expect(overview.className).not.toContain('undefined');
    });

    it('criterio (a): aba inativa (Componentes) não tem artefatos de interpolação no DOM', () => {
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={config} onClose={vi.fn()} />
        );
        const components = tabButton('Componentes & Árvore');
        expect(components.className).not.toContain('${');
        expect(components.className).not.toContain('undefined');
    });

    it.each(ALL_COLORS)('criterio (a)/(b): tema "%s" renderiza classes de cor literais no DOM', (color) => {
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={configWith(color)} onClose={vi.fn()} />
        );
        const overview = tabButton('Visão Geral');
        expect(overview.className).toContain(`border-${color}-600`);
        expect(overview.className).toContain(`text-${color}-600`);
        expect(overview.className).toContain(`dark:border-${color}-400`);
        expect(overview.className).toContain(`dark:text-${color}-400`);
        expect(overview.className).not.toContain('${');
        expect(overview.className).not.toContain('undefined');
    });

    // --- Critério (b): mapa segue Record<ThemeColor, string> ---

    it('criterio (b): TAB_ACTIVE_CLASSES exporta classes literais completas para todas as cores', () => {
        ALL_COLORS.forEach((color) => {
            const classes = TAB_ACTIVE_CLASSES[color];
            expect(classes).toBeTruthy();
            expect(classes).toContain(`border-${color}-600`);
            expect(classes).toContain(`text-${color}-600`);
            expect(classes).toContain(`dark:border-${color}-400`);
            expect(classes).toContain(`dark:text-${color}-400`);
            expect(classes).not.toContain('${');
        });
    });

    it('criterio (b): fallback de cor desconhecida usa indigo', () => {
        render(
            <BOMDetail bom={bom} products={[finalProduct, componentProduct]} config={configWith('cor-inexistente')} onClose={vi.fn()} />
        );
        const overview = tabButton('Visão Geral');
        expect(overview.className).toContain('border-indigo-600');
        expect(overview.className).toContain('text-indigo-600');
        expect(overview.className).not.toContain('undefined');
        expect(overview.className).not.toContain('${');
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

// ===========================================================================
// #1300 — Renderização theme-aware em elementos não-tab
//
// Valida comportamento renderizado (DOM) para confirmar que badges, ícones,
// bordas e nós da árvore usam as classes literais corretas do mapa
// Record<ThemeColor, string> em utils/theme.ts (getThemeClasses), sem
// interpolação dinâmica de classe de cor. Cobre critérios (c) e (f).
// ===========================================================================
describe('BOMDetail (#1300) — renderização theme-aware em elementos não-tab', () => {
    const configWith = (themeColor: string): DolibarrConfig => ({
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        themeColor: themeColor as DolibarrConfig['themeColor'],
        darkMode: false,
        apiLimit: 0,
    });

    const products = [finalProduct, componentProduct];

    const versionBadge = () => screen.getByText(/V1/).closest('button') as HTMLElement;

    const iconContainer = (container: HTMLElement) =>
        container.querySelector('.lucide-layers')?.parentElement as HTMLElement;

    it('badge de versão (V1) renderiza classes do tema indigo', () => {
        render(<BOMDetail bom={bom} products={products} config={configWith('indigo')} onClose={vi.fn()} />);
        const badge = versionBadge();
        expect(badge.className).toContain('bg-indigo-100');
        expect(badge.className).toContain('text-indigo-700');
        expect(badge.className).not.toContain('${');
    });

    it('badge de versão respeita tema emerald', () => {
        render(<BOMDetail bom={bom} products={products} config={configWith('emerald')} onClose={vi.fn()} />);
        const badge = versionBadge();
        expect(badge.className).toContain('bg-emerald-100');
        expect(badge.className).toContain('text-emerald-700');
        expect(badge.className).not.toContain('bg-indigo-100');
    });

    it('container de ícone na visão geral usa classes do tema (indigo)', () => {
        const { container } = render(<BOMDetail bom={bom} products={products} config={configWith('indigo')} onClose={vi.fn()} />);
        const iconBox = iconContainer(container);
        expect(iconBox.className).toContain('bg-indigo-100');
        expect(iconBox.className).toContain('text-indigo-600');
        expect(iconBox.className).not.toContain('${');
    });

    it('container de ícone respeita tema blue', () => {
        const { container } = render(<BOMDetail bom={bom} products={products} config={configWith('blue')} onClose={vi.fn()} />);
        const iconBox = iconContainer(container);
        expect(iconBox.className).toContain('bg-blue-100');
        expect(iconBox.className).toContain('text-blue-600');
        expect(iconBox.className).not.toContain('bg-indigo-100');
    });

    it('árvore de componentes: elementos do nó pai usam classes do tema (indigo)', () => {
        const { container } = render(<BOMDetail bom={bom} products={products} config={configWith('indigo')} onClose={vi.fn()} />);
        fireEvent.click(screen.getByText('Componentes & Árvore'));

        const label = screen.getAllByText('Produto Final').find(
            el => el.className.includes('uppercase')
        ) as HTMLElement;
        expect(label.className).toContain('text-indigo-700');
        expect(label.className).not.toContain('${');

        const box = label.parentElement as HTMLElement;
        expect(box.className).toContain('bg-indigo-50');
        expect(box.className).toContain('border-indigo-200');

        const wrapper = box.parentElement as HTMLElement;
        const dot = wrapper.querySelector('[class*="rounded-full"]') as HTMLElement;
        expect(dot.className).toContain('bg-indigo-500');

        const headerIcon = container.querySelector('.lucide-layers') as HTMLElement;
        expect(headerIcon.getAttribute('class')).toContain('text-indigo-500');
    });

    it('árvore de componentes: elementos do nó pai respeitam tema emerald', () => {
        render(<BOMDetail bom={bom} products={products} config={configWith('emerald')} onClose={vi.fn()} />);
        fireEvent.click(screen.getByText('Componentes & Árvore'));

        const label = screen.getAllByText('Produto Final').find(
            el => el.className.includes('uppercase')
        ) as HTMLElement;
        expect(label.className).toContain('text-emerald-700');
        expect(label.className).not.toContain('text-indigo-700');

        const box = label.parentElement as HTMLElement;
        expect(box.className).toContain('bg-emerald-50');
        expect(box.className).toContain('border-emerald-200');

        const wrapper = box.parentElement as HTMLElement;
        const dot = wrapper.querySelector('[class*="rounded-full"]') as HTMLElement;
        expect(dot.className).toContain('bg-emerald-500');
    });

    it('cor de tema desconhecida cai no fallback indigo em todos os elementos', () => {
        const { container } = render(<BOMDetail bom={bom} products={products} config={configWith('cor-inexistente')} onClose={vi.fn()} />);

        const badge = versionBadge();
        expect(badge.className).toContain('bg-indigo-100');
        expect(badge.className).not.toContain('undefined');

        const iconBox = iconContainer(container);
        expect(iconBox.className).toContain('bg-indigo-100');
        expect(iconBox.className).not.toContain('undefined');

        fireEvent.click(screen.getByText('Componentes & Árvore'));
        const label = screen.getAllByText('Produto Final').find(
            el => el.className.includes('uppercase')
        ) as HTMLElement;
        expect(label.className).toContain('text-indigo-700');
        expect(label.className).not.toContain('undefined');
    });

    it('nenhum elemento renderizado contém ${ ou undefined na className', () => {
        const { container } = render(<BOMDetail bom={bom} products={products} config={configWith('indigo')} onClose={vi.fn()} />);
        fireEvent.click(screen.getByText('Componentes & Árvore'));

        const allElements = container.querySelectorAll('*');
        allElements.forEach(el => {
            const cn = el.getAttribute('class');
            if (cn) {
                expect(cn).not.toContain('${');
                expect(cn).not.toContain('undefined');
            }
        });
    });

    it('troca de tema altera classes em tempo real (re-render)', () => {
        const { rerender } = render(<BOMDetail bom={bom} products={products} config={configWith('indigo')} onClose={vi.fn()} />);

        const badgeBefore = versionBadge();
        expect(badgeBefore.className).toContain('bg-indigo-100');

        rerender(<BOMDetail bom={bom} products={products} config={configWith('rose')} onClose={vi.fn()} />);

        const badgeAfter = versionBadge();
        expect(badgeAfter.className).toContain('bg-rose-100');
        expect(badgeAfter.className).not.toContain('bg-indigo-100');
    });
});
