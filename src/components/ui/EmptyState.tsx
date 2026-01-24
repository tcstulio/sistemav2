import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
    /** Icon to display */
    icon?: LucideIcon;
    /** Main message */
    title: string;
    /** Description text */
    description?: string;
    /** Action button/content */
    action?: React.ReactNode;
    /** Size variant */
    size?: 'sm' | 'md' | 'lg';
    /** Additional CSS classes */
    className?: string;
}

const sizeClasses = {
    sm: { icon: 32, title: 'text-sm', desc: 'text-xs', padding: 'py-6' },
    md: { icon: 48, title: 'text-lg', desc: 'text-sm', padding: 'py-12' },
    lg: { icon: 64, title: 'text-xl', desc: 'text-base', padding: 'py-20' }
};

/**
 * EmptyState - Standard empty/no-data state with icon, message, and optional action.
 * 
 * @example
 * ```tsx
 * <EmptyState
 *   icon={Package}
 *   title="Nenhum produto encontrado"
 *   description="Adicione seu primeiro produto para começar"
 *   action={<Button>Adicionar</Button>}
 * />
 * ```
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
    icon: Icon,
    title,
    description,
    action,
    size = 'md',
    className = ''
}) => {
    const sizes = sizeClasses[size];

    return (
        <div className={`text-center ${sizes.padding} ${className}`}>
            {Icon && (
                <div className="mx-auto mb-4 text-slate-300 dark:text-slate-600">
                    <Icon size={sizes.icon} strokeWidth={1.5} />
                </div>
            )}

            <h3 className={`font-semibold text-slate-600 dark:text-slate-300 ${sizes.title}`}>
                {title}
            </h3>

            {description && (
                <p className={`text-slate-400 dark:text-slate-500 mt-1 max-w-sm mx-auto ${sizes.desc}`}>
                    {description}
                </p>
            )}

            {action && (
                <div className="mt-4">
                    {action}
                </div>
            )}
        </div>
    );
};

export default EmptyState;
