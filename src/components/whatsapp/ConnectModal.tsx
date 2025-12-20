import React from 'react';
import { X, Loader2 } from 'lucide-react';

interface ConnectModalProps {
    isOpen: boolean;
    onClose: () => void;
    qrCodeUrl: string | null;
    isLoading: boolean;
    onRefresh: () => void;
}

export const ConnectModal: React.FC<ConnectModalProps> = ({
    isOpen,
    onClose,
    qrCodeUrl,
    onRefresh
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-700 relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
                >
                    <X size={24} />
                </button>

                <div className="text-center mb-6">
                    <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Conectar Aparelho</h3>
                    <p className="text-slate-400 text-sm">Abra o WhatsApp {'>'} Aparelhos Conectados {'>'} Conectar Aparelho</p>
                </div>

                <div className="flex flex-col items-center justify-center gap-4 min-h-[300px]">
                    {qrCodeUrl ? (
                        <div className="p-2 bg-white rounded-lg">
                            <img src={qrCodeUrl} alt="QR Code" className="w-64 h-64" />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 text-slate-500">
                            <Loader2 size={48} className="animate-spin text-green-500" />
                            <p>Carregando QR Code...</p>
                            <p className="text-xs text-red-400 mt-2 max-w-[200px] text-center">
                                Se não aparecer em aguns segundos, o backend pode estar iniciando a sessão.
                            </p>
                        </div>
                    )}
                    <p className="text-xs text-slate-500 animate-pulse mt-2">Atualiza a cada 5 segundos...</p>
                </div>

                <div className="mt-6">
                    <button
                        onClick={onRefresh}
                        className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors border border-slate-700"
                    >
                        Já escaneei (Atualizar Página)
                    </button>
                </div>
            </div>
        </div>
    );
};
