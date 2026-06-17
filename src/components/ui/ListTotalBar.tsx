import React from 'react';
import { formatCurrency } from '../../utils/formatUtils';

interface ListTotalBarProps {
    total: number;
    label?: string;
    className?: string;
}

export const ListTotalBar: React.FC<ListTotalBarProps> = ({ total, label = 'Total', className = '' }) => {
    return (
        <div
            className={`flex justify-end items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-800 shadow-sm ${className}`}
            data-testid="list-total-bar"
        >
            <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">{label}</span>
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums" data-testid="list-total-value">
                {formatCurrency(total)}
            </span>
        </div>
    );
};
