import React from 'react';
import { ArrowLeft, X } from 'lucide-react';

interface MasterDetailLayoutProps {
    /** List/master content (left side) */
    list: React.ReactNode;
    /** Detail content (right side), null/undefined hides detail */
    detail?: React.ReactNode;
    /** Whether detail is currently shown */
    showDetail?: boolean;
    /** Close detail handler (for mobile back button) */
    onCloseDetail?: () => void;
    /** List width on desktop */
    listWidth?: '1/4' | '1/3' | '2/5' | '1/2';
    /** Hide list when detail is selected (on all screen sizes) */
    hideListOnDetail?: boolean;
    /** Additional class for container */
    className?: string;
}

const listWidthClasses = {
    '1/4': 'lg:w-1/4',
    '1/3': 'lg:w-1/3',
    '2/5': 'lg:w-2/5',
    '1/2': 'lg:w-1/2'
};

/**
 * MasterDetailLayout - Responsive split view for list/detail patterns.
 * 
 * On mobile: shows list OR detail (full screen)
 * On desktop: shows list and detail side by side
 * 
 * @example
 * ```tsx
 * <MasterDetailLayout
 *   list={<ProductList onSelect={setSelected} />}
 *   detail={selected && <ProductDetail product={selected} />}
 *   showDetail={!!selected}
 *   onCloseDetail={() => setSelected(null)}
 * />
 * ```
 */
export const MasterDetailLayout: React.FC<MasterDetailLayoutProps> = ({
    list,
    detail,
    showDetail = false,
    onCloseDetail,
    listWidth = '1/3',
    hideListOnDetail = false,
    className = ''
}) => {
    const hasDetail = showDetail && detail;

    return (
        <div className={`flex-1 min-h-0 flex overflow-hidden ${className}`}>
            {/* List Panel */}
            <div
                className={`
                    flex-1 overflow-y-auto
                    ${hasDetail ? 'hidden lg:block' : 'block'}
                    ${hasDetail && !hideListOnDetail ? `lg:flex-none ${listWidthClasses[listWidth]} lg:border-r lg:border-slate-200 lg:dark:border-slate-800` : ''}
                    ${hasDetail && hideListOnDetail ? 'hidden' : ''}
                `.trim().replace(/\s+/g, ' ')}
            >
                {list}
            </div>

            {/* Detail Panel */}
            {hasDetail && (
                <div
                    className={`
                        flex-1 
                        bg-white dark:bg-slate-900 
                        flex flex-col
                        absolute inset-0 z-20 
                        lg:static lg:inset-auto lg:z-auto
                        animate-in slide-in-from-right lg:animate-none
                    `.trim().replace(/\s+/g, ' ')}
                >
                    {detail}
                </div>
            )}

            {/* Empty State when no detail on desktop */}
            {!hasDetail && (
                <div className="hidden lg:flex flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
                    <div className="text-center text-slate-400 dark:text-slate-500">
                        <p>Selecione um item para ver detalhes</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MasterDetailLayout;
