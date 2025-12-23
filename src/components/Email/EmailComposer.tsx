import React, { useState } from 'react';
import { Send, X } from 'lucide-react';

interface EmailComposerProps {
    onClose: () => void;
    onSend: (to: string, subject: string, body: string) => Promise<void>;
}

export const EmailComposer: React.FC<EmailComposerProps> = ({ onClose, onSend }) => {
    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [isSending, setIsSending] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSending(true);
        try {
            await onSend(to, subject, body);
            onClose();
        } catch (error) {
            console.error(error);
            alert('Erro ao enviar email');
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col h-[600px]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Nova Mensagem</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col p-6 space-y-4">
                    <div>
                        <input
                            type="email"
                            placeholder="Para"
                            className="w-full px-4 py-3 bg-transparent border-b border-slate-200 dark:border-slate-700 outline-none text-slate-800 dark:text-white placeholder-slate-400 focus:border-blue-500 transition-colors"
                            value={to}
                            onChange={e => setTo(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <input
                            type="text"
                            placeholder="Assunto"
                            className="w-full px-4 py-3 bg-transparent border-b border-slate-200 dark:border-slate-700 outline-none text-slate-800 dark:text-white placeholder-slate-400 focus:border-blue-500 transition-colors font-medium"
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                            required
                        />
                    </div>
                    <div className="flex-1">
                        <textarea
                            placeholder="Escreva sua mensagem aqui..."
                            className="w-full h-full p-4 bg-slate-50 dark:bg-slate-950/50 rounded-lg resize-none outline-none text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:ring-2 focus:ring-blue-500/20"
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            required
                        />
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            type="submit"
                            disabled={isSending}
                            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-lg hover:shadow-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSending ? 'Enviando...' : (
                                <>
                                    <Send size={18} />
                                    Enviar
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
