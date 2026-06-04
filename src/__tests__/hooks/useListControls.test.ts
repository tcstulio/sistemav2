import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useListControls } from '../../hooks/useListControls';

interface Row { id: number; name: string; qty: number; status: string; }
const items: Row[] = [
    { id: 1, name: 'Banana', qty: 3, status: 'open' },
    { id: 2, name: 'Abacaxi', qty: 10, status: 'closed' },
    { id: 3, name: 'Caju', qty: 1, status: 'open' },
];

const config = {
    searchText: (r: Row) => r.name,
    sorts: [
        { key: 'name', label: 'Nome', get: (r: Row) => r.name },
        { key: 'qty', label: 'Qtd', get: (r: Row) => r.qty },
    ],
    filters: [
        { key: 'status', label: 'Status', options: [{ value: 'open', label: 'Aberto' }, { value: 'closed', label: 'Fechado' }], get: (r: Row) => r.status },
    ],
    initialSortKey: 'name',
};

describe('useListControls', () => {
    it('ordena por nome asc por padrão', () => {
        const { result } = renderHook(() => useListControls(items, config));
        expect(result.current.result.map((r) => r.name)).toEqual(['Abacaxi', 'Banana', 'Caju']);
    });

    it('inverte a direção da ordenação', () => {
        const { result } = renderHook(() => useListControls(items, config));
        act(() => result.current.toggleSortDir());
        expect(result.current.result.map((r) => r.name)).toEqual(['Caju', 'Banana', 'Abacaxi']);
    });

    it('ordena numericamente por qtd', () => {
        const { result } = renderHook(() => useListControls(items, config));
        act(() => result.current.setSortKey('qty'));
        expect(result.current.result.map((r) => r.qty)).toEqual([1, 3, 10]);
    });

    it('filtra pela busca textual', () => {
        const { result } = renderHook(() => useListControls(items, config));
        act(() => result.current.setSearch('ca'));
        expect(result.current.result.map((r) => r.name).sort()).toEqual(['Abacaxi', 'Caju']);
    });

    it('filtra por status', () => {
        const { result } = renderHook(() => useListControls(items, config));
        act(() => result.current.setFilter('status', 'open'));
        expect(result.current.result.map((r) => r.id).sort()).toEqual([1, 3]);
    });

    it('clear limpa busca e filtros', () => {
        const { result } = renderHook(() => useListControls(items, config));
        act(() => { result.current.setSearch('x'); result.current.setFilter('status', 'open'); });
        act(() => result.current.clear());
        expect(result.current.result).toHaveLength(3);
    });
});
