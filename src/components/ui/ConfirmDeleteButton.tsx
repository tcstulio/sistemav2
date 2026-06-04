import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmModal } from './ConfirmModal';

// Botão de excluir padronizado (#121): abre confirmação, chama onDelete (reusa as funções
// deleteX existentes), mostra toast e dispara onDeleted (ex.: refetch da lista).
interface ConfirmDeleteButtonProps {
    onDelete: () => Promise<any>;
    onDeleted?: () => void;
    itemLabel?: string;        // ex.: nome do registro, p/ a mensagem
    title?: string;
    message?: string;
    className?: string;
    iconSize?: number;
    /** Renderiza como botão com rótulo "Excluir" em vez de só o ícone. */
    withLabel?: boolean;
    stopPropagation?: boolean; // útil quando o botão fica dentro de um card clicável
}

export const ConfirmDeleteButton: React.FC<ConfirmDeleteButtonProps> = ({
    onDelete,
    onDeleted,
    itemLabel,
    title = 'Excluir',
    message,
    className = '',
    iconSize = 16,
    withLabel = false,
    stopPropagation = true,
}) => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await onDelete();
            toast.success(`${itemLabel ? `"${itemLabel}"` : 'Registro'} excluído.`);
            setOpen(false);
            onDeleted?.();
        } catch (e: any) {
            toast.error(`Falha ao excluir: ${e?.response?.data?.error || e?.message || 'erro'}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={(e) => { if (stopPropagation) e.stopPropagation(); setOpen(true); }}
                className={`text-slate-400 hover:text-red-500 transition-colors ${withLabel ? 'flex items-center gap-1 text-sm' : 'p-1'} ${className}`}
                title="Excluir"
                aria-label="Excluir"
            >
                <Trash2 size={iconSize} />{withLabel && 'Excluir'}
            </button>
            <ConfirmModal
                isOpen={open}
                onClose={() => setOpen(false)}
                onConfirm={handleConfirm}
                title={title}
                message={message || `Tem certeza que deseja excluir ${itemLabel ? `"${itemLabel}"` : 'este registro'}? Esta ação não pode ser desfeita.`}
                confirmLabel="Excluir"
                isLoading={loading}
                variant="danger"
            />
        </>
    );
};
