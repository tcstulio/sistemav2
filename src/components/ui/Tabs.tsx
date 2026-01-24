import React from 'react';

interface TabsProps {
    /** Currently active tab value */
    value: string;
    /** Tab change handler */
    onChange: (value: string) => void;
    /** Tab items */
    children: React.ReactNode;
    /** Additional CSS classes */
    className?: string;
}

interface TabProps {
    /** Tab value/id */
    value: string;
    /** Tab label */
    children: React.ReactNode;
    /** Badge/count to show */
    badge?: number | string;
    /** Disabled state */
    disabled?: boolean;
}

/**
 * Tabs - Tab navigation component.
 * 
 * @example
 * ```tsx
 * <Tabs value={activeTab} onChange={setActiveTab}>
 *   <Tab value="overview">Visão Geral</Tab>
 *   <Tab value="orders" badge={5}>Pedidos</Tab>
 *   <Tab value="invoices">Faturas</Tab>
 * </Tabs>
 * ```
 */
export const Tabs: React.FC<TabsProps> & { Tab: React.FC<TabProps & { isActive?: boolean; onClick?: () => void }> } = ({
    value,
    onChange,
    children,
    className = ''
}) => {
    return (
        <div className={`flex gap-1 overflow-x-auto py-1 ${className}`}>
            {React.Children.map(children, (child) => {
                if (React.isValidElement<TabProps>(child)) {
                    return React.cloneElement(child as React.ReactElement<TabProps & { isActive: boolean; onClick: () => void }>, {
                        isActive: child.props.value === value,
                        onClick: () => !child.props.disabled && onChange(child.props.value)
                    });
                }
                return child;
            })}
        </div>
    );
};

const Tab: React.FC<TabProps & { isActive?: boolean; onClick?: () => void }> = ({
    children,
    badge,
    disabled = false,
    isActive = false,
    onClick
}) => {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                px-4 py-2.5 
                text-sm font-medium 
                whitespace-nowrap
                border-b-2 
                transition-colors
                ${isActive
                    ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `.trim().replace(/\s+/g, ' ')}
        >
            {children}
            {badge !== undefined && (
                <span className={`
                    ml-2 px-1.5 py-0.5 
                    text-xs rounded-full
                    ${isActive
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }
                `}>
                    {badge}
                </span>
            )}
        </button>
    );
};

Tabs.Tab = Tab;

export { Tab };
export default Tabs;
