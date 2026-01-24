import React from 'react';
import { ArrowLeft, UserX, ChevronDown, Bot, SidebarClose, SidebarOpen, Send, Inbox, Folder } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { EmailBody } from '../../types/email';
import { EmailService } from '../../services/emailService';
import { toast } from 'sonner';

interface EmailReadingPaneProps {
    messageBody: EmailBody | null;
    isLoadingBody: boolean;
    onBack?: () => void;
    users: any[];
    assignment: string | null;
    setAssignment: (id: string | null) => void;
    selectedAccountId: string | null;
    selectedMessageId: number | null;
    threadSettings: any;
    setThreadSettings: (settings: any) => void;
    isContextOpen: boolean;
    setIsContextOpen: (isOpen: boolean) => void;
    onReply: () => void;
}

export const EmailReadingPane: React.FC<EmailReadingPaneProps> = ({
    messageBody,
    isLoadingBody,
    onBack,
    users,
    assignment,
    setAssignment,
    selectedAccountId,
    selectedMessageId,
    threadSettings,
    setThreadSettings,
    isContextOpen,
    setIsContextOpen,
    onReply
}) => {

    if (!messageBody) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-white dark:bg-slate-900">
                {isLoadingBody ? (
                    <div className="animate-pulse">Carregando conteúdo...</div>
                ) : (
                    <>
                        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                            <Inbox size={32} className="text-slate-300 dark:text-slate-600" />
                        </div>
                        <p>Selecione uma mensagem para ler</p>
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/30">
                {/* Toolbar */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="md:hidden text-slate-500"
                            >
                                <ArrowLeft size={20} />
                            </button>
                        )}

                        {/* Assignment Dropdown */}
                        <div className="relative group">
                            <button className="flex items-center gap-2 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50">
                                <UserX size={14} />
                                {assignment ? users.find(u => u.id === assignment)?.login || 'Desconhecido' : 'Atribuir'}
                                <ChevronDown size={12} />
                            </button>
                            <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg hidden group-hover:block z-50 max-h-60 overflow-y-auto">
                                <div className="p-1">
                                    <button
                                        onClick={() => {
                                            const tid = `${selectedAccountId}_${selectedMessageId}`;
                                            EmailService.assignThread(tid, null);
                                            setAssignment(null);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                    >
                                        Ninguém
                                    </button>
                                    {users.map(user => (
                                        <button
                                            key={user.id}
                                            onClick={() => {
                                                const tid = `${selectedAccountId}_${selectedMessageId}`;
                                                EmailService.assignThread(tid, user.id);
                                                setAssignment(user.id);
                                                toast.success(`Atribuído a ${user.login}`);
                                            }}
                                            className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                        >
                                            {user.login}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Auto-Reply Status */}
                        <button
                            onClick={() => {
                                const tid = `${selectedAccountId}_${selectedMessageId}`;
                                const nextState = !threadSettings?.autoReplyEnabled;
                                EmailService.updateThreadSettings(tid, { autoReplyEnabled: nextState });
                                setThreadSettings((p: any) => ({ ...p, autoReplyEnabled: nextState }));
                                toast.success(nextState ? 'Auto-Resposta Ativada' : 'Auto-Resposta Desativada');
                            }}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-bold transition-colors border ${threadSettings?.autoReplyEnabled
                                ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
                                : 'bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                }`}
                        >
                            <Bot size={14} />
                            {threadSettings?.autoReplyEnabled ? 'ON' : 'OFF'}
                        </button>
                    </div>

                    {/* Context Toggle */}
                    <button
                        onClick={() => setIsContextOpen(!isContextOpen)}
                        className={`p-2 rounded-md transition-colors ${isContextOpen ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        title="Painel de Contexto"
                    >
                        {isContextOpen ? <SidebarClose size={20} /> : <SidebarOpen size={20} />}
                    </button>
                </div>

                <div className="flex items-start justify-between">
                    <div className="min-w-0 pr-4">
                        <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white leading-tight break-words mb-2">
                            {messageBody.subject}
                        </h1>
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-xs shrink-0">
                                {messageBody.from?.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                                <p className="font-medium text-slate-900 dark:text-white truncate text-sm">{messageBody.from}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">para {messageBody.to}</p>
                            </div>
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <span className="text-xs text-slate-500 dark:text-slate-400 block mb-2">
                            {format(new Date(messageBody.date), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </span>
                        <button
                            onClick={onReply}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-sm"
                        >
                            <div className="rotate-180 transform"><Send size={12} /></div>
                            Responder
                        </button>
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar bg-white dark:bg-slate-900">
                <div
                    className="prose dark:prose-invert max-w-none email-content-reset text-sm md:text-base"
                    dangerouslySetInnerHTML={{ __html: messageBody.html || messageBody.text || '' }}
                />

                {messageBody.attachments && messageBody.attachments.length > 0 && (
                    <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-800">
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Anexos</h4>
                        <div className="flex flex-wrap gap-2">
                            {messageBody.attachments.map((att, i) => (
                                <a
                                    key={i}
                                    href={att.content ? `data:${att.contentType};base64,${att.content}` : '#'}
                                    download={att.filename || 'download'}
                                    className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                >
                                    <Folder size={16} className="text-blue-500" />
                                    <span className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-[200px]">{att.filename}</span>
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
