import React from 'react';

interface GenericListLayoutProps {
    header: React.ReactNode;
    sidebar?: React.ReactNode; // Can be used for extra filters or navigation
    content: React.ReactNode;  // The main list/grid
    pagination?: React.ReactNode;
    detail?: React.ReactNode;  // Side panel for details (responsive)
    isDetailOpen?: boolean;    // Control visibility on mobile/tablet
    className?: string;
}

export const GenericListLayout: React.FC<GenericListLayoutProps> = ({
    header,
    sidebar,
    content,
    pagination,
    detail,
    isDetailOpen = false,
    className = ''
}) => {
    return (
        <div className={`flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative ${className}`}>
            {/* Header Area */}
            {header}

            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* Sidebar (Optional) */}
                {sidebar && (
                    <div className="hidden md:block w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-y-auto">
                        {sidebar}
                    </div>
                )}

                {/* Main List Content */}
                <div className={`flex-1 flex flex-col p-0 transition-all duration-300 ${isDetailOpen ? 'hidden lg:flex lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'} `}>
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950">
                        {content}
                    </div>
                    {/* Pagination Footer */}
                    {pagination}
                </div>

                {/* Detail Panel */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${isDetailOpen ? 'absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'} `}>
                    {detail}
                </div>
            </div>
        </div>
    );
};
