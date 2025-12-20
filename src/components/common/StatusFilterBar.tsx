import React from 'react';

export interface FilterOption {
    id: string;
    label: string;
    color?: string; // tw class suffix, e.g. 'emerald', 'orange', 'slate'
}

interface StatusFilterBarProps {
    filters: FilterOption[];
    activeFilter: string;
    onFilterChange: (id: string) => void;
    themeColor?: string;
}

export const StatusFilterBar: React.FC<StatusFilterBarProps> = ({
    filters,
    activeFilter,
    onFilterChange,
    themeColor = 'indigo'
}) => {
    return (
        <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto px-4 pt-2">
            {filters.map((filter) => {
                const isActive = activeFilter === filter.id;

                // Determine style based on active state and color override
                let activeClass = '';
                if (isActive) {
                    if (filter.color) {
                        activeClass = `border-${filter.color}-500 text-${filter.color}-600 dark:text-${filter.color}-400 dark:border-${filter.color}-400`;
                    } else {
                        activeClass = `border-${themeColor}-600 text-${themeColor}-600 dark:text-${themeColor}-400 dark:border-${themeColor}-400`;
                    }
                } else {
                    activeClass = 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200';
                }

                return (
                    <button
                        key={filter.id}
                        onClick={() => onFilterChange(filter.id)}
                        className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeClass}`}
                    >
                        {filter.label}
                    </button>
                );
            })}
        </div>
    );
};
