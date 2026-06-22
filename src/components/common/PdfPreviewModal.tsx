import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { getDocumentBlob, downloadDocument } from '../../services/api/core';

export interface PdfPreviewModalProps {
    entityType: string;
    entityId: string | number;
    title?: string;
    isOpen: boolean;
    onClose: () => void;
}

/**
 * PdfPreviewModal — exibe um PDF inline via object URL e oferece botão de download.
 *
 * Busca o blob via `getDocumentBlob` (proxy de backend, sem DOLAPIKEY no cliente),
 * renderiza em <iframe> e revoga o object URL ao fechar para evitar memory leaks.
 */
export const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({
    entityType,
    entityId,
    title,
    isOpen,
    onClose,
}) => {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Busca o PDF quando o modal abre
    useEffect(() => {
        if (!isOpen) return;

        let revoked = false;
        let url: string | null = null;

        setIsLoading(true);
        setError(null);
        setObjectUrl(null);

        getDocumentBlob(entityType, entityId)
            .then((blob) => {
                if (revoked) return;
                url = URL.createObjectURL(blob);
                setObjectUrl(url);
            })
            .catch((err: Error) => {
                if (revoked) return;
                setError(err.message || 'PDF não disponível para este documento');
            })
            .finally(() => {
                if (!revoked) setIsLoading(false);
            });

        // Cleanup: revoga o URL ao desmontar / fechar
        return () => {
            revoked = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [isOpen, entityType, entityId]);

    // Revoga o URL quando o modal fecha (via onClose acionado pelo usuário)
    const handleClose = () => {
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            setObjectUrl(null);
        }
        onClose();
    };

    const handleDownload = () => {
        downloadDocument(entityType, entityId).catch(() => {});
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={title ? `PDF — ${title}` : 'Visualizar PDF'}
            size="xl"
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={handleClose}>
                        Fechar
                    </Button>
                    <Button
                        variant="primary"
                        icon={<Download size={16} />}
                        onClick={handleDownload}
                        disabled={isLoading}
                    >
                        Baixar
                    </Button>
                </div>
            }
        >
            {isLoading && (
                <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
                    <span>Carregando PDF...</span>
                </div>
            )}

            {error && !isLoading && (
                <div className="flex items-center justify-center h-64 text-red-500 dark:text-red-400">
                    <span>{error}</span>
                </div>
            )}

            {objectUrl && !isLoading && (
                <iframe
                    src={objectUrl}
                    title={title ?? 'PDF Preview'}
                    className="w-full border-0 rounded"
                    style={{ height: '70vh' }}
                />
            )}
        </Modal>
    );
};

export default PdfPreviewModal;
