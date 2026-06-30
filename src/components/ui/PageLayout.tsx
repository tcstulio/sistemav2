import React from 'react';

interface PageLayoutProps {
    children: React.ReactNode;
    /** Additional CSS classes */
    className?: string;
    /** Page title for accessibility */
    title?: string;
    /** Maximum width constraint */
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
    /** Remove default padding */
    noPadding?: boolean;
}

const maxWidthClasses = {
    sm: 'max-w-2xl',
    md: 'max-w-4xl',
    lg: 'max-w-6xl',
    xl: 'max-w-7xl',
    '2xl': 'max-w-screen-2xl',
    full: 'max-w-full'
};

/**
 * PageLayout - Standard page container with proper scrolling behavior.
 * 
 * Solves the scroll issue by ensuring content flows properly within
 * the MainLayout's overflow-hidden container.
 * 
 * @example
 * ```tsx
 * <PageLayout title="Products">
 *   <h1>Products & Services</h1>
 *   <ProductTable />
 * </PageLayout>
 * ```
 */
export const PageLayout: React.FC<PageLayoutProps> = ({
    children,
    className = '',
    title,
    maxWidth = 'full',
    noPadding = false
}) => {
    return (
        <div
            role="main"
            aria-label={title}
            className={`
                flex-1 
                min-h-0
                overflow-y-auto 
                bg-slate-50 dark:bg-slate-950
                transition-colors
                ${noPadding ? '' : 'p-4 md:p-6'}
                ${className}
            `.trim().replace(/\s+/g, ' ')}
        >
            <div className={`${maxWidthClasses[maxWidth]} mx-auto`}>
                {children}
            </div>
        </div>
    );
};

export default PageLayout;
