import React, { useState, useRef, useEffect } from 'react';
import { Send, X, Paperclip, Trash2, Bot } from 'lucide-react';
import { EmailAttachment } from '../../types/email';
import { AiService } from '../../services/aiService';
import { EmailService } from '../../services/emailService';

interface EmailComposerProps {
    onClose: () => void;
    onSend: (to: string, subject: string, body: string, attachments: EmailAttachment[]) => Promise<void>;
    initialTo?: string;
    initialSubject?: string;
    initialBody?: string;
}

export const EmailComposer: React.FC<EmailComposerProps> = ({
    onClose,
    onSend,
    initialTo = '',
    initialSubject = '',
    initialBody = ''
}) => {
    const [to, setTo] = useState(initialTo);
    const [subject, setSubject] = useState(initialSubject);
    const [body, setBody] = useState(initialBody);
    const [isSending, setIsSending] = useState(false);
    const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Focus To field on mount if empty, else Body
    useEffect(() => {
        // Load Signature
        const loadSig = async () => {
            try {
                const { userSettings } = await EmailService.getUserStore();
                if (userSettings?.signatureName && !initialBody) { // Only append if new message/empty body
                    // Very simple signature append.
                    // In future can use HTML but textarea is plain text currently?
                    // The component uses textarea for body, so plain text signature.
                    setBody((prev) => prev ? prev : `\n\n--\n${userSettings.signatureName}`);
                }
            } catch (e) {
                console.error("Failed to load signature", e);
            }
        };
        loadSig();
    }, []); // Run once

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const newAttachments: EmailAttachment[] = [];
            for (let i = 0; i < e.target.files.length; i++) {
                const file = e.target.files[i];
                try {
                    const content = await readFileAsBase64(file);
                    newAttachments.push({
                        filename: file.name,
                        content: content,
                        contentType: file.type
                    });
                } catch (err) {
                    console.error("Error reading file", file.name, err);
                }
            }
            setAttachments(prev => [...prev, ...newAttachments]);
        }
        // Reset input so same file can be selected again if needed
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const readFileAsBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                // Remove data URL prefix (e.g., "data:image/png;base64,")
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // [ANTIGRAVITY] AI Command Check
        if (body.trim().startsWith('/sys ')) {
            const query = body.trim().replace('/sys ', '');
            setIsSending(true);
            try {
                const result = await AiService.analyzeSystem(query);
                // Instead of alert, maybe replace body? Or just alert as requested in WhatsApp view.
                // WhatsApp view alerts. User might want to paste it?
                // Let's replace the /sys line with the result or append it.
                // Alert is annoying for long text. Let's append to body.

                // Remove the command line
                const newBody = body.replace(/^\/sys .*/, '') + `\n\n--- ANÁLISE DO SISTEMA ---\n${result}`;
                setBody(newBody);
                alert("Análise concluída e adicionada ao corpo do email.");
            } catch (e) {
                alert("Erro ao analisar sistema.");
            } finally {
                setIsSending(false);
            }
            return;
        }

        setIsSending(true);
        try {
            await onSend(to, subject, body, attachments);
            onClose();
        } catch (error) {
            console.error(error);
            alert('Erro ao enviar email');
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4">
            <div className="bg-white dark:bg-slate-900 w-full md:max-w-3xl md:rounded-xl shadow-2xl overflow-hidden flex flex-col h-full md:h-[700px]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">
                        {initialSubject ? 'Responder Mensagem' : 'Nova Mensagem'}
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
                    <div className="p-6 space-y-4 flex-none">
                        <div>
                            <input
                                type="text" // changed from email to text to allow multiple emails if needed later, but validation expects email
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
                    </div>

                    <div className="flex-1 p-6 pt-0 min-h-0 flex flex-col">
                        <textarea
                            placeholder="Escreva sua mensagem aqui..."
                            className="flex-1 w-full p-4 bg-slate-50 dark:bg-slate-950/50 rounded-lg resize-none outline-none text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:ring-2 focus:ring-blue-500/20"
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            required
                        />

                        {/* Attachments List */}
                        {attachments.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                {attachments.map((att, index) => (
                                    <div key={index} className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700">
                                        <Paperclip size={14} className="text-slate-500" />
                                        <span className="text-sm text-slate-700 dark:text-slate-300 max-w-[150px] truncate">{att.filename}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeAttachment(index)}
                                            className="text-slate-400 hover:text-red-500 transition-colors"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                        <div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                className="hidden"
                                multiple
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-2 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            >
                                <Paperclip size={18} />
                                <span className="text-sm font-medium">Anexar</span>
                            </button>
                        </div>

                        <button
                            type="submit"
                            disabled={isSending}
                            className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-lg hover:shadow-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
