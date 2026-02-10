import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmModalProps {
    /** Whether modal is visible */
    isOpen: boolean;
    /** Close handler */
    onClose: () => void;
    /** Confirm handler */
    onConfirm: () => void;
    /** Modal title */
    title?: string;
    /** Description text */
    message: string;
    /** Confirm button text */
    confirmLabel?: string;
    /** Cancel button text */
    cancelLabel?: string;
    /** Whether confirm action is in progress */
    isLoading?: boolean;
    /** Visual variant */
    variant?: 'danger' | 'warning' | 'info';
}

const variantConfig = {
    danger: {
        iconColor: 'text-red-500',
        iconBg: 'bg-red-100 dark:bg-red-900/30',
    },
    warning: {
        iconColor: 'text-amber-500',
        iconBg: 'bg-amber-100 dark:bg-amber-900/30',
    },
    info: {
        iconColor: 'text-blue-500',
        iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    },
};

/**
 * ConfirmModal - Standard confirmation dialog wrapping Modal.
 *
 * @example
 * ```tsx
 * <ConfirmModal
 *   isOpen={showDelete}
 *   onClose={() => setShowDelete(false)}
 *   onConfirm={handleDelete}
 *   title="Excluir Item"
 *   message="Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita."
 *   variant="danger"
 * />
 * ```
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title = 'Confirmar',
    message,
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    isLoading = false,
    variant = 'danger'
}) => {
    const { iconColor, iconBg } = variantConfig[variant];

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="sm"
            showCloseButton={false}
        >
            <div className="flex flex-col items-center text-center gap-4">
                <div className={`w-12 h-12 rounded-full ${iconBg} flex items-center justify-center`}>
                    <AlertTriangle size={24} className={iconColor} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">{title}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
                </div>
                <div className="flex gap-3 w-full">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        disabled={isLoading}
                        className="flex-1"
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        variant={variant === 'danger' ? 'danger' : 'primary'}
                        onClick={onConfirm}
                        loading={isLoading}
                        className="flex-1"
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default ConfirmModal;
