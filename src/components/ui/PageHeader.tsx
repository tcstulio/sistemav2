import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
    /** Page title */
    title: React.ReactNode;
    /** Subtitle/description */
    subtitle?: React.ReactNode;
    /** Action buttons (right side) */
    actions?: React.ReactNode;
    /** Back button handler (shows back arrow if provided) */
    onBack?: () => void;
    /** Additional CSS classes */
    className?: string;
    /** Tabs below header */
    tabs?: React.ReactNode;
}

/**
 * PageHeader - Standard page header with title, subtitle, and actions.
 * 
 * @example
 * ```tsx
 * <PageHeader
 *   title="Produtos"
 *   subtitle="Gerencie seu catálogo"
 *   actions={<Button icon={<Plus />}>Novo</Button>}
 * />
 * ```
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    subtitle,
    actions,
    onBack,
    className = '',
    tabs
}) => {
    return (
        <div className={`bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 ${className}`}>
            <div className="p-4 md:p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
                            >
                                <ArrowLeft size={20} />
                            </button>
                        )}
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
                                {title}
                            </h1>
                            {subtitle && (
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    </div>

                    {actions && (
                        <div className="flex items-center gap-2 flex-wrap">
                            {actions}
                        </div>
                    )}
                </div>
            </div>

            {tabs && (
                <div className="px-4 md:px-6 border-t border-slate-100 dark:border-slate-800">
                    {tabs}
                </div>
            )}
        </div>
    );
};

export default PageHeader;
