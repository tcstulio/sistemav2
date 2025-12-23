/**
 * Send Document Modal
 * 
 * Modal para enviar boletos, notas fiscais e recibos via WhatsApp
 */

import React, { useState } from 'react';
import {
    X,
    Send,
    FileText,
    MessageSquare,
    Phone,
    Loader2,
    CheckCircle,
    AlertCircle,
    Landmark
} from 'lucide-react';

// ===== Types =====

interface SendDocumentModalProps {
    isOpen: boolean;
    onClose: () => void;
    documentType: 'boleto' | 'invoice' | 'receipt';
    documentId: string;
    banco?: 'inter' | 'itau';
    defaultPhone?: string;
    defaultMessage?: string;
    sessionId: string;
}

// ===== Component =====

export function SendDocumentModal({
    isOpen,
    onClose,
    documentType,
    documentId,
    banco,
    defaultPhone = '',
    defaultMessage = '',
    sessionId,
}: SendDocumentModalProps) {
    const [phone, setPhone] = useState(defaultPhone);
    const [message, setMessage] = useState(defaultMessage || getDefaultMessage(documentType));
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

    if (!isOpen) return null;

    const handleSend = async () => {
        if (!phone.trim()) {
            setResult({ success: false, message: 'Informe o número de telefone' });
            return;
        }

        setLoading(true);
        setResult(null);

        try {
            const res = await fetch('/api/documents/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    documentType,
                    documentId,
                    banco,
                    phone,
                    sessionId,
                    message,
                }),
            });

            const data = await res.json();

            if (data.success) {
                if (data.approvalRequired) {
                    setResult({
                        success: true,
                        message: 'Documento adicionado à fila de aprovação. Aguarde a confirmação de um gestor.',
                    });
                } else {
                    setResult({
                        success: true,
                        message: 'Documento enviado com sucesso!',
                    });
                }
            } else {
                setResult({
                    success: false,
                    message: data.error || 'Erro ao enviar documento',
                });
            }
        } catch (error: any) {
            setResult({
                success: false,
                message: error.message || 'Erro de conexão',
            });
        } finally {
            setLoading(false);
        }
    };

    const formatPhone = (value: string) => {
        // Remove não-numéricos
        const cleaned = value.replace(/\D/g, '');

        // Formata como (XX) XXXXX-XXXX
        if (cleaned.length <= 2) return cleaned;
        if (cleaned.length <= 7) return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2)}`;
        if (cleaned.length <= 11) return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
        return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7, 11)}`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md mx-4 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${banco === 'inter' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' :
                                banco === 'itau' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
                                    'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                            }`}>
                            {banco ? <Landmark className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                        </div>
                        <div>
                            <h3 className="font-semibold text-slate-800 dark:text-white">
                                Enviar via WhatsApp
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {getDocumentTypeName(documentType)} #{documentId}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <X className="h-5 w-5 text-slate-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-4">
                    {/* Phone Input */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            <Phone className="h-4 w-4 inline mr-1" />
                            Telefone do destinatário
                        </label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(formatPhone(e.target.value))}
                            placeholder="(00) 00000-0000"
                            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        />
                    </div>

                    {/* Message Input */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            <MessageSquare className="h-4 w-4 inline mr-1" />
                            Mensagem (opcional)
                        </label>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={3}
                            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                        />
                    </div>

                    {/* Result Message */}
                    {result && (
                        <div className={`flex items-center gap-2 p-3 rounded-lg ${result.success
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                            }`}>
                            {result.success ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                            <span className="text-sm">{result.message}</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSend}
                        disabled={loading}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                        {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                        Enviar
                    </button>
                </div>
            </div>
        </div>
    );
}

// ===== Helpers =====

function getDefaultMessage(documentType: string): string {
    switch (documentType) {
        case 'boleto':
            return '📄 Segue o boleto em anexo. Qualquer dúvida, estamos à disposição!';
        case 'invoice':
            return '📄 Segue a nota fiscal em anexo. Obrigado pela preferência!';
        case 'receipt':
            return '✅ Segue o comprovante de pagamento em anexo.';
        default:
            return '📄 Segue o documento em anexo.';
    }
}

function getDocumentTypeName(documentType: string): string {
    switch (documentType) {
        case 'boleto': return 'Boleto';
        case 'invoice': return 'Nota Fiscal';
        case 'receipt': return 'Recibo';
        default: return 'Documento';
    }
}

export default SendDocumentModal;
