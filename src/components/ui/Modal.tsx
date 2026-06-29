import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
    /** Whether modal is visible */
    isOpen: boolean;
    /** Close handler */
    onClose: () => void;
    /** Modal title */
    title?: React.ReactNode;
    /** Modal content */
    children: React.ReactNode;
    /** Footer content (typically buttons) */
    footer?: React.ReactNode;
    /** Modal width */
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
    /** Close on overlay click */
    closeOnOverlay?: boolean;
    /** Close on Escape key */
    closeOnEscape?: boolean;
    /** Show close button in header */
    showCloseButton?: boolean;
}

const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]'
};

/**
 * Modal - Standard modal component with proper scroll, keyboard handling, and accessibility.
 * 
 * Content area scrolls independently while header/footer stay fixed.
 * 
 * @example
 * ```tsx
 * <Modal 
 *   isOpen={isOpen} 
 *   onClose={() => setIsOpen(false)}
 *   title="Edit Product"
 *   footer={<Button onClick={handleSave}>Save</Button>}
 * >
 *   <form>...</form>
 * </Modal>
 * ```
 */
export const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    title,
    children,
    footer,
    size = 'md',
    closeOnOverlay = true,
    closeOnEscape = true,
    showCloseButton = true
}) => {
    // Handle Escape key
    useEffect(() => {
        if (!isOpen || !closeOnEscape) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, closeOnEscape, onClose]);

    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'modal-title' : undefined}
            // Renderizado via portal no body; impede que cliques (overlay, botões, conteúdo)
            // borbulhem na árvore React de componentes para ancestrais clicáveis — ex.: um
            // <Card onClick> que envolve o ConfirmDeleteButton em listas (#121).
            onClick={(e) => e.stopPropagation()}
        >
            {/* Overlay */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={closeOnOverlay ? onClose : undefined}
                aria-hidden="true"
            />

            {/* Modal Panel */}
            <div
                className={`
                    relative w-full ${sizeClasses[size]}
                    bg-white dark:bg-slate-900
                    border border-slate-200 dark:border-slate-800
                    rounded-xl shadow-2xl
                    animate-in zoom-in-95 fade-in duration-200
                    flex flex-col max-h-[90vh]
                `.trim().replace(/\s+/g, ' ')}
            >
                {/* Header */}
                {(title || showCloseButton) && (
                    <div className="flex-none flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                        {title && (
                            <h2 id="modal-title" className="text-lg font-bold text-slate-800 dark:text-white">
                                {title}
                            </h2>
                        )}
                        {showCloseButton && (
                            <button
                                onClick={onClose}
                                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                aria-label="Close modal"
                            >
                                <X size={20} />
                            </button>
                        )}
                    </div>
                )}

                {/* Content - Scrollable */}
                <div className="flex-1 overflow-y-auto min-h-0 p-6">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="flex-none p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 rounded-b-xl flex justify-end gap-3">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default Modal;
