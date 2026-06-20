import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListToolbar } from '../../components/ui/ListToolbar';
import { useListControls, ListControls, UseListControlsConfig } from '../../hooks/useListControls';

interface Row { id: number; name: string; capacity: number; status: string; }

const items: Row[] = [
    { id: 1, name: 'Banana', capacity: 10, status: 'open' },
    { id: 2, name: 'Abacaxi', capacity: 5, status: 'closed' },
    { id: 3, name: 'Caju', capacity: 20, status: 'open' },
];

const config: UseListControlsConfig<Row> = {
    searchText: (r: Row) => r.name,
    sorts: [
        { key: 'name', label: 'Nome', get: (r: Row) => r.name },
        { key: 'capacity', label: 'Capacidade', get: (r: Row) => r.capacity },
    ],
    filters: [
        { key: 'status', label: 'Status', options: [{ value: 'open', label: 'Aberto' }], get: (r: Row) => r.status },
    ],
    initialSortKey: 'name',
};

// Conecta o ListToolbar ao hook real, permitindo testes comportamentais
// (toggle de direção e troca de campo refletem o estado real).
function renderToolbar(configOverride?: Partial<UseListControlsConfig<Row>>) {
    function Harness() {
        const controls = useListControls(items, { ...config, ...configOverride });
        return <ListToolbar controls={controls} />;
    }
    return render(<Harness />);
}

// Controles mockados para os regression guards de classes estáticas.
function buildMockControls(overrides: Partial<ListControls<Row>> = {}): ListControls<Row> {
    return {
        search: '',
        setSearch: vi.fn(),
        sortKey: 'name',
        setSortKey: vi.fn(),
        sortDir: 'asc',
        toggleSortDir: vi.fn(),
        filterValues: {},
        setFilter: vi.fn(),
        clear: vi.fn(),
        result: [],
        config,
        ...overrides,
    };
}

describe('ListToolbar', () => {
    // Caso 1: Renderização
    it('renderiza o select de ordenação e o botão de direção', () => {
        renderToolbar();
        const sortSelect = screen.getByTitle('Ordenar por');
        const dirButton = screen.getByLabelText('Inverter ordem');
        expect(sortSelect).toBeInTheDocument();
        expect(dirButton).toBeInTheDocument();
        expect(document.body.contains(sortSelect)).toBe(true);
        expect(document.body.contains(dirButton)).toBe(true);
    });

    it('renderiza busca e filtros quando configurados', () => {
        renderToolbar();
        expect(screen.getByPlaceholderText('Buscar...')).toBeInTheDocument();
        expect(screen.getByTitle('Status')).toBeInTheDocument();
    });

    // Caso 2: Toggle de direção (o affordance muda)
    it('alterna o título do botão de direção entre Crescente e Decrescente ao clicar', () => {
        renderToolbar();
        const dirButton = screen.getByLabelText('Inverter ordem');
        // estado inicial (asc) -> "Crescente"
        expect(dirButton.getAttribute('title')).toBe('Crescente');
        fireEvent.click(dirButton);
        // após o clique (desc) -> "Decrescente"
        expect(screen.getByLabelText('Inverter ordem').getAttribute('title')).toBe('Decrescente');
        // segundo clique volta para "Crescente"
        fireEvent.click(screen.getByLabelText('Inverter ordem'));
        expect(screen.getByLabelText('Inverter ordem').getAttribute('title')).toBe('Crescente');
    });

    // Caso 3: Troca de campo de ordenação
    it('atualiza o valor selecionado do select ao mudar o campo de ordenação', () => {
        renderToolbar();
        const sortSelect = screen.getByTitle('Ordenar por') as HTMLSelectElement;
        // valor inicial
        expect(sortSelect.value).toBe('name');
        fireEvent.change(sortSelect, { target: { value: 'capacity' } });
        // após a troca, o valor selecionado mudou
        expect((screen.getByTitle('Ordenar por') as HTMLSelectElement).value).toBe('capacity');
    });

    // Caso 4: Altura padrazada (regression guard)
    it('o select de ordenação e o botão de direção possuem altura h-9', () => {
        renderToolbar();
        const sortSelect = screen.getByTitle('Ordenar por');
        const dirButton = screen.getByLabelText('Inverter ordem');
        expect(sortSelect).toHaveClass('h-9');
        expect(dirButton).toHaveClass('h-9');
    });

    // ---- Regression guards adicionais ----

    it('todos os controles têm altura h-9', () => {
        renderToolbar();
        expect(screen.getByPlaceholderText('Buscar...')).toHaveClass('h-9');
        expect(screen.getByTitle('Status')).toHaveClass('h-9');
        expect(screen.getByTitle('Ordenar por')).toHaveClass('h-9');
        expect(screen.getByLabelText('Inverter ordem')).toHaveClass('h-9');
    });

    it('o botão de direção centraliza o ícone', () => {
        renderToolbar();
        expect(screen.getByLabelText('Inverter ordem')).toHaveClass('flex', 'items-center', 'justify-center');
    });

    it('mantém o agrupamento visual select+botão (cantos e borda compartilhada)', () => {
        renderToolbar();
        const sortSelect = screen.getByTitle('Ordenar por');
        const dirButton = screen.getByLabelText('Inverter ordem');
        expect(sortSelect).toHaveClass('rounded-l-lg');
        expect(dirButton).toHaveClass('rounded-r-lg', 'border-l-0');
    });

    it('mantém o layout responsivo (flex-wrap e gap)', () => {
        const { container } = renderToolbar();
        const toolbar = container.firstChild as HTMLElement;
        expect(toolbar).toHaveClass('flex', 'flex-wrap', 'gap-2');
    });

    it('preserva as classes de dark mode', () => {
        renderToolbar();
        expect(screen.getByTitle('Status')).toHaveClass('dark:bg-slate-800', 'dark:border-slate-700', 'dark:text-white');
        expect(screen.getByLabelText('Inverter ordem')).toHaveClass('dark:border-slate-700', 'dark:text-slate-300', 'dark:hover:bg-slate-800');
    });

    it('não renderiza busca quando searchText não está definido', () => {
        renderToolbar({ searchText: undefined, sorts: [], filters: [] });
        expect(screen.queryByPlaceholderText('Buscar...')).not.toBeInTheDocument();
    });

    it('chama toggleSortDir ao clicar no botão de direção', () => {
        const toggleSortDir = vi.fn();
        render(<ListToolbar controls={buildMockControls({ toggleSortDir })} />);
        fireEvent.click(screen.getByLabelText('Inverter ordem'));
        expect(toggleSortDir).toHaveBeenCalledTimes(1);
    });

    it('mostra o título crescente quando sortDir=asc', () => {
        render(<ListToolbar controls={buildMockControls({ sortDir: 'asc' })} />);
        expect(screen.getByLabelText('Inverter ordem').getAttribute('title')).toBe('Crescente');
    });

    it('mostra o título decrescente quando sortDir=desc', () => {
        render(<ListToolbar controls={buildMockControls({ sortDir: 'desc' })} />);
        expect(screen.getByLabelText('Inverter ordem').getAttribute('title')).toBe('Decrescente');
    });
});
