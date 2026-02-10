import React from 'react';

export type BadgeVariant = 'slate' | 'blue' | 'emerald' | 'orange' | 'red' | 'purple' | 'indigo' | 'amber' | 'cyan';

const variantClasses: Record<BadgeVariant, string> = {
    slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    orange: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
    purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    cyan: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800',
};

export interface StatusConfig {
    label: string;
    variant: BadgeVariant;
    icon?: React.ReactNode;
}

interface StatusBadgeProps {
    /** Status value to look up in the config map */
    status: string | number;
    /** Map of status values to their display configuration */
    config: Record<string, StatusConfig>;
    /** Size variant */
    size?: 'sm' | 'md';
    /** Additional CSS classes */
    className?: string;
}

/**
 * StatusBadge - Reusable status badge with consistent styling.
 *
 * @example
 * ```tsx
 * const invoiceStatuses: Record<string, StatusConfig> = {
 *   '0': { label: 'Rascunho', variant: 'slate', icon: <FileEdit size={12} /> },
 *   '1': { label: 'A Pagar', variant: 'orange', icon: <Clock size={12} /> },
 *   '2': { label: 'Pago', variant: 'emerald', icon: <CheckCircle2 size={12} /> },
 * };
 *
 * <StatusBadge status={invoice.statut} config={invoiceStatuses} />
 * ```
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
    status,
    config,
    size = 'md',
    className = ''
}) => {
    const key = String(status);
    const statusConfig = config[key];

    if (!statusConfig) {
        return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium border ${variantClasses.slate} ${size === 'sm' ? 'text-[10px]' : 'text-xs'} ${className}`}>
                {key}
            </span>
        );
    }

    const { label, variant, icon } = statusConfig;
    const sizeClasses = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-0.5';

    return (
        <span className={`inline-flex items-center gap-1 ${sizeClasses} rounded-full font-medium border ${variantClasses[variant]} ${className}`}>
            {icon}
            {label}
        </span>
    );
};

export default StatusBadge;
