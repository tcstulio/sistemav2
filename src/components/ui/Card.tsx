import React from 'react';

interface CardProps {
    children: React.ReactNode;
    /** Additional CSS classes */
    className?: string;
    /** Card header content */
    header?: React.ReactNode;
    /** Card footer content */
    footer?: React.ReactNode;
    /** Padding size */
    padding?: 'none' | 'sm' | 'md' | 'lg';
    /** Make card clickable */
    onClick?: () => void;
    /** Selected state styling */
    selected?: boolean;
    /** Hover effect */
    hoverable?: boolean;
}

const paddingClasses = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6'
};

/**
 * Card - Standard card component with consistent styling.
 *
 * Quando clicável (`onClick`), o Card é renderizado como um `<div role="button">`
 * — e NÃO como um `<button>` real. HTML proíbe `<button>` aninhado em `<button>`,
 * o que causava erro de hidratação em listas cujo card clicável contém botões de
 * ação internos (ex.: `ConfirmDeleteButton`). Acessibilidade (foco/teclado) é
 * preservada via `role`, `tabIndex` e handlers de teclado Enter/Space. (#822)
 *
 * @example
 * ```tsx
 * <Card header={<h3>Title</h3>} padding="md" hoverable>
 *   Card content here
 * </Card>
 * ```
 */
export const Card: React.FC<CardProps> = ({
    children,
    className = '',
    header,
    footer,
    padding = 'md',
    onClick,
    selected = false,
    hoverable = false
}) => {
    const clickable = !!onClick;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.();
        }
    };

    return (
        <div
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={onClick}
            onKeyDown={clickable ? handleKeyDown : undefined}
            className={`
                bg-white dark:bg-slate-900
                border rounded-xl
                ${selected
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                    : 'border-slate-200 dark:border-slate-800'
                }
                ${hoverable || clickable ? 'hover:shadow-md cursor-pointer transition-all' : 'shadow-sm'}
                ${clickable ? 'w-full text-left' : ''}
                ${className}
            `.trim().replace(/\s+/g, ' ')}
        >
            {header && (
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 rounded-t-xl font-medium">
                    {header}
                </div>
            )}

            <div className={paddingClasses[padding]}>
                {children}
            </div>

            {footer && (
                <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 rounded-b-xl">
                    {footer}
                </div>
            )}
        </div>
    );
};

export default Card;
