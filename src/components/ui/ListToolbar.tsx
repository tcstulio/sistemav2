import React from 'react';
import { Search, ArrowDownAZ, ArrowUpAZ } from 'lucide-react';
import { Input } from './Input';
import { ListControls } from '../../hooks/useListControls';

// Barra de busca + ordenação + filtros para as listas (#121). Recebe o objeto do
// useListControls e renderiza os controles padronizados.
interface ListToolbarProps<T> {
    controls: ListControls<T>;
    searchPlaceholder?: string;
    className?: string;
}

export function ListToolbar<T>({ controls, searchPlaceholder = 'Buscar...', className = '' }: ListToolbarProps<T>) {
    const { config } = controls;
    const hasSearch = !!config.searchText;
    const sorts = config.sorts || [];
    const filters = config.filters || [];

    return (
        <div className={`flex flex-wrap items-center gap-2 ${className}`}>
            {hasSearch && (
                <Input
                    placeholder={searchPlaceholder}
                    value={controls.search}
                    onChange={(e) => controls.setSearch(e.target.value)}
                    icon={<Search size={16} />}
                    className="w-48"
                    fullWidth={false}
                />
            )}

            {filters.map((f) => (
                <select
                    key={f.key}
                    value={controls.filterValues[f.key] || ''}
                    onChange={(e) => controls.setFilter(f.key, e.target.value)}
                    className="text-sm px-2 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                    title={f.label}
                >
                    <option value="">{f.label}: todos</option>
                    {f.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            ))}

            {sorts.length > 0 && (
                <div className="flex items-center">
                    <select
                        value={controls.sortKey}
                        onChange={(e) => controls.setSortKey(e.target.value)}
                        className="text-sm px-2 py-2 border rounded-l-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                        title="Ordenar por"
                    >
                        {sorts.map((s) => (
                            <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={controls.toggleSortDir}
                        className="px-2 py-2 border border-l-0 rounded-r-lg dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        title={controls.sortDir === 'asc' ? 'Crescente' : 'Decrescente'}
                        aria-label="Inverter ordem"
                    >
                        {controls.sortDir === 'asc' ? <ArrowDownAZ size={16} /> : <ArrowUpAZ size={16} />}
                    </button>
                </div>
            )}
        </div>
    );
}
