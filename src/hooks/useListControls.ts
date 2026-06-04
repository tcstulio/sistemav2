import { useMemo, useState } from 'react';

// Fundação reutilizável de busca + ordenação + filtro para as listas do ERP (#121).
// Cada lista declara: como extrair o texto de busca, as opções de ordenação e os filtros.
// O hook cuida do estado e devolve a lista já filtrada/ordenada.

export interface SortOption<T> {
    key: string;
    label: string;
    get: (item: T) => string | number | null | undefined;
}

export interface FilterOption<T> {
    key: string;
    label: string;
    options: { value: string; label: string }[];
    get: (item: T) => string | null | undefined;
}

export interface UseListControlsConfig<T> {
    /** Texto a comparar com a busca (concatene os campos relevantes). */
    searchText?: (item: T) => string;
    sorts?: SortOption<T>[];
    filters?: FilterOption<T>[];
    initialSortKey?: string;
    initialSortDir?: 'asc' | 'desc';
}

export interface ListControls<T> {
    search: string;
    setSearch: (v: string) => void;
    sortKey: string;
    setSortKey: (k: string) => void;
    sortDir: 'asc' | 'desc';
    toggleSortDir: () => void;
    filterValues: Record<string, string>;
    setFilter: (key: string, value: string) => void;
    clear: () => void;
    /** Lista final (filtrada + ordenada). */
    result: T[];
    config: UseListControlsConfig<T>;
}

export function useListControls<T>(items: T[], config: UseListControlsConfig<T>): ListControls<T> {
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState(config.initialSortKey || config.sorts?.[0]?.key || '');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>(config.initialSortDir || 'asc');
    const [filterValues, setFilterValues] = useState<Record<string, string>>({});

    const result = useMemo(() => {
        let r = Array.isArray(items) ? [...items] : [];

        // Busca textual
        const q = search.trim().toLowerCase();
        if (q && config.searchText) {
            r = r.filter((i) => (config.searchText!(i) || '').toLowerCase().includes(q));
        }

        // Filtros (valor vazio = "todos")
        for (const f of config.filters || []) {
            const v = filterValues[f.key];
            if (v) r = r.filter((i) => String(f.get(i) ?? '') === v);
        }

        // Ordenação
        const sort = config.sorts?.find((s) => s.key === sortKey);
        if (sort) {
            r.sort((a, b) => {
                const av = sort.get(a);
                const bv = sort.get(b);
                let c: number;
                if (typeof av === 'number' && typeof bv === 'number') {
                    c = av - bv;
                } else {
                    c = String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR', { numeric: true });
                }
                return sortDir === 'asc' ? c : -c;
            });
        }
        return r;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, search, sortKey, sortDir, filterValues]);

    return {
        search,
        setSearch,
        sortKey,
        setSortKey,
        sortDir,
        toggleSortDir: () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')),
        filterValues,
        setFilter: (key, value) => setFilterValues((p) => ({ ...p, [key]: value })),
        clear: () => { setSearch(''); setFilterValues({}); },
        result,
        config,
    };
}
