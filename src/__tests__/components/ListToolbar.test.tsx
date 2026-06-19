import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListToolbar } from '../../components/ui/ListToolbar';
import { ListControls } from '../../hooks/useListControls';

interface Row { id: number; name: string; status: string; }

function buildControls(overrides: Partial<ListControls<Row>> = {}): ListControls<Row> {
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
        config: {
            searchText: (r: Row) => r.name,
            sorts: [
                { key: 'name', label: 'Nome', get: (r: Row) => r.name },
                { key: 'id', label: 'ID', get: (r: Row) => r.id },
            ],
            filters: [
                { key: 'status', label: 'Status', options: [{ value: 'open', label: 'Aberto' }], get: (r: Row) => r.status },
            ],
            initialSortKey: 'name',
        },
        ...overrides,
    };
}

describe('ListToolbar', () => {
    it('renderiza input de busca, filtros e ordenação', () => {
        render(<ListToolbar controls={buildControls()} />);
        expect(screen.getByPlaceholderText('Buscar...')).toBeInTheDocument();
        expect(screen.getByTitle('Ordenar por')).toBeInTheDocument();
        expect(screen.getByLabelText('Inverter ordem')).toBeInTheDocument();
    });

    it('todos os controles têm altura h-9', () => {
        render(<ListToolbar controls={buildControls()} />);
        const input = screen.getByPlaceholderText('Buscar...');
        expect(input).toHaveClass('h-9');

        const filterSelect = screen.getByTitle('Status');
        expect(filterSelect).toHaveClass('h-9');

        const sortSelect = screen.getByTitle('Ordenar por');
        expect(sortSelect).toHaveClass('h-9');

        const dirButton = screen.getByLabelText('Inverter ordem');
        expect(dirButton).toHaveClass('h-9');
    });

    it('o botão de direção centraliza o ícone', () => {
        render(<ListToolbar controls={buildControls()} />);
        const dirButton = screen.getByLabelText('Inverter ordem');
        expect(dirButton).toHaveClass('flex', 'items-center', 'justify-center');
    });

    it('mantém o agrupamento visual select+botão (cantos e borda compartilhada)', () => {
        render(<ListToolbar controls={buildControls()} />);
        const sortSelect = screen.getByTitle('Ordenar por');
        const dirButton = screen.getByLabelText('Inverter ordem');
        expect(sortSelect).toHaveClass('rounded-l-lg');
        expect(dirButton).toHaveClass('rounded-r-lg', 'border-l-0');
    });

    it('mantém o layout responsivo (flex-wrap e gap)', () => {
        const { container } = render(<ListToolbar controls={buildControls()} />);
        const toolbar = container.firstChild as HTMLElement;
        expect(toolbar).toHaveClass('flex', 'flex-wrap', 'gap-2');
    });

    it('preserva as classes de dark mode', () => {
        render(<ListToolbar controls={buildControls()} />);
        const filterSelect = screen.getByTitle('Status');
        expect(filterSelect).toHaveClass('dark:bg-slate-800', 'dark:border-slate-700', 'dark:text-white');

        const dirButton = screen.getByLabelText('Inverter ordem');
        expect(dirButton).toHaveClass('dark:border-slate-700', 'dark:text-slate-300', 'dark:hover:bg-slate-800');
    });

    it('não renderiza busca quando searchText não está definido', () => {
        const controls = buildControls({ config: { sorts: [], filters: [] } });
        render(<ListToolbar controls={controls} />);
        expect(screen.queryByPlaceholderText('Buscar...')).not.toBeInTheDocument();
    });

    it('chama toggleSortDir ao clicar no botão de direção', () => {
        const toggleSortDir = vi.fn();
        render(<ListToolbar controls={buildControls({ toggleSortDir })} />);
        fireEvent.click(screen.getByLabelText('Inverter ordem'));
        expect(toggleSortDir).toHaveBeenCalledTimes(1);
    });

    it('mostra o ícone crescente quando sortDir=asc', () => {
        render(<ListToolbar controls={buildControls({ sortDir: 'asc' })} />);
        expect(screen.getByLabelText('Inverter ordem').getAttribute('title')).toBe('Crescente');
    });

    it('mostra o ícone decrescente quando sortDir=desc', () => {
        render(<ListToolbar controls={buildControls({ sortDir: 'desc' })} />);
        expect(screen.getByLabelText('Inverter ordem').getAttribute('title')).toBe('Decrescente');
    });
});
