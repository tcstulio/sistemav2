import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationControlsProps {
    page: number;
    limit: number;
    onPageChange: (newPage: number) => void;
    onLimitChange: (newLimit: number) => void;
    hasPrev?: boolean;
    hasNext: boolean;
    itemName?: string;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({
    page,
    limit,
    onPageChange,
    onLimitChange,
    hasPrev,
    hasNext,
    itemName = 'itens'
}) => {
    return (
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 z-10 relative">
            <div className="flex items-center gap-2">
                <select
                    value={limit}
                    onChange={(e) => { onLimitChange(Number(e.target.value)); }}
                    className="bg-slate-100 dark:bg-slate-800 border-none text-xs rounded p-1 dark:text-white focus:ring-1 focus:ring-indigo-500"
                >
                    <option value="10">10 / pág</option>
                    <option value="20">20 / pág</option>
                    <option value="50">50 / pág</option>
                    <option value="100">100 / pág</option>
                </select>
                <span className="text-xs text-slate-500">
                    Pág {page + 1}
                </span>
            </div>
            <div className="flex items-center gap-1">
                <button
                    disabled={hasPrev !== undefined ? !hasPrev : page === 0}
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 dark:text-white transition-colors"
                >
                    <ChevronLeft size={16} />
                </button>
                <button
                    disabled={!hasNext}
                    onClick={() => onPageChange(page + 1)}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 dark:text-white transition-colors"
                >
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
};
