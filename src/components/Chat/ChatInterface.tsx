import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDolibarr } from '../../context/DolibarrContext';
import { Send, User as UserIcon, Calendar, Loader2, Search, X, CheckSquare, Paperclip, ArrowLeft, Trash2, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as Operations from '../../services/api/operations';
import { RichTextEditor } from '../common/RichTextEditor';
import { TaskWizard } from '../Projects/TaskWizard';
import { useEvents, useProjects, useUsers } from '../../hooks/dolibarr';
import { Project, DolibarrUser } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';
import { toast } from 'sonner';
import { notifyError } from '../../utils/notifyError';
import { SafeHtml, stripHtml, sanitizeHtml } from '../../utils/sanitizeHtml';
import { useConfirm } from '../../hooks/useConfirm';

interface ChatInterfaceProps {
    elementId: string;
    elementType: string; // 'project', 'task', 'facture', etc.
    title?: string;
    height?: string;
    onBack?: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ elementId, elementType, title = "Comentários", height = "100%", onBack }) => {
    const { config, currentUser, refreshData } = useDolibarr();
    const { data: events, isLoading, refetch } = useEvents(config);
    const navigate = useNavigate();
    const confirm = useConfirm();

    const handleInternalLinkClick = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const anchor = target.closest('a[data-internal-link="true"]');
        if (anchor) {
            e.preventDefault();
            const href = anchor.getAttribute('href');
            if (href) navigate(href);
        }
    }, [navigate]);

    // States
    const [newMessage, setNewMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [replyingTo, setReplyingTo] = useState<any>(null);
    const [showTaskWizard, setShowTaskWizard] = useState(false);
    const [wizardInitialData, setWizardInitialData] = useState<{ label: string; description: string }[] | undefined>(undefined);
    const [isUploading, setIsUploading] = useState(false);
    // Otimista: mensagens adicionadas localmente antes do POST confirmar pelo servidor
    const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
    // Erro de envio visível inline (além do toast) para que o usuário saiba que pode tentar de novo
    const [sendError, setSendError] = useState<string | null>(null);
    // Edição inline: id da mensagem sendo editada + texto em edição
    const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    // Exclusão: ids em processo de exclusão (loading)
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const baseApiUrl = config?.apiUrl.replace('/api/index.php', '') || '';

    // Get Project data if in project mode
    const { data: projectsData } = useProjects(config);
    const projects = (projectsData || []) as Project[];
    const currentProject = elementType === 'project' ? projects.find(p => String(p.id) === String(elementId)) : undefined;

    // Get Users for Wizard
    const { data: usersData } = useUsers(config);
    const users = (usersData || []) as DolibarrUser[];

    // Filter events
    const chatMessages = useMemo(() => {
        const baseEvents = events || [];
        // Remove mensagens otimistas que já possuem contraparte real vinda do Dolibarr
        const realDescriptions = new Set(
            baseEvents
                .filter((e: any) => e.elementtype === elementType && String(e.fk_element) === String(elementId))
                .map((e: any) => e.description || e.label || '')
        );
        const activeOptimistic = optimisticMessages.filter(
            (m: any) => !realDescriptions.has(m.description || m.label || '')
        );
        return [...activeOptimistic, ...baseEvents]
            .filter((e: any) => {
                // Determine if this is a DM or standard entity chat
                if (elementType === 'user') {
                    const isDM = e.elementtype === 'user';
                    if (!isDM) return false;

                    const myId = String(currentUser?.id);
                    const otherId = String(elementId);
                    const authorId = String(e.fk_user_author);
                    const targetId = String(e.fk_element);

                    return (
                        (authorId === myId && targetId === otherId) ||
                        (authorId === otherId && targetId === myId)
                    );
                } else {
                    // Standard Project/Task chat
                    return e.elementtype === elementType && String(e.fk_element) === String(elementId);
                }
            })
            .filter((e: any) => {
                if (!searchTerm) return true;
                const content = (e.description || e.label || '').toLowerCase();
                return content.includes(searchTerm.toLowerCase());
            })
            .sort((a: any, b: any) => a.date_start - b.date_start); // Oldest first
    }, [events, optimisticMessages, elementId, elementType, currentUser, searchTerm]);

    // Reconcilia o estado otimista: descarta mensagens locais assim que a real aparece no cache
    useEffect(() => {
        if (!events || events.length === 0 || optimisticMessages.length === 0) return;
        const realDescriptions = new Set(
            events
                .filter((e: any) => e.elementtype === elementType && String(e.fk_element) === String(elementId))
                .map((e: any) => e.description || e.label || '')
        );
        const remaining = optimisticMessages.filter((m: any) => !realDescriptions.has(m.description || m.label || ''));
        if (remaining.length !== optimisticMessages.length) {
            setOptimisticMessages(remaining);
        }
    }, [events, elementType, elementId, optimisticMessages]);

    const handleDeleteMessage = useCallback(async (msg: any) => {
        if (!config) return;
        const ok = await confirm({
            title: 'Excluir mensagem',
            message: 'Tem certeza que deseja excluir esta mensagem? Esta ação não pode ser desfeita.',
            confirmText: 'Excluir',
            danger: true,
        });
        if (!ok) return;

        setDeletingIds(prev => new Set(prev).add(String(msg.id)));
        try {
            await Operations.deleteEvent(config, String(msg.id));
            await refetch();
        } catch (err) {
            notifyError('Excluir mensagem', err);
        } finally {
            setDeletingIds(prev => {
                const next = new Set(prev);
                next.delete(String(msg.id));
                return next;
            });
        }
    }, [config, confirm, refetch]);

    const handleStartEdit = useCallback((msg: any) => {
        setEditingMsgId(String(msg.id));
        setEditingText(msg.description || msg.label || '');
    }, []);

    const handleSaveEdit = useCallback(async (msg: any) => {
        if (!config || !editingText.trim()) return;
        setIsSavingEdit(true);
        try {
            await Operations.updateEvent(config, String(msg.id), {
                label: msg.label || `Comentário em ${elementType}`,
                description: editingText,
                note: editingText,
            });
            setEditingMsgId(null);
            setEditingText('');
            await refetch();
        } catch (err) {
            notifyError('Editar mensagem', err);
        } finally {
            setIsSavingEdit(false);
        }
    }, [config, editingText, elementType, refetch]);

    const handleCancelEdit = useCallback(() => {
        setEditingMsgId(null);
        setEditingText('');
    }, []);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0 || !config) return;

        const file = e.target.files[0];
        setIsUploading(true);

        try {
            let modulePart = '';
            let ref = '';

            if (elementType === 'project' && currentProject) {
                modulePart = 'project';
                ref = currentProject.ref;
            } else if (elementType === 'user') {
                modulePart = 'user';
                ref = String(currentUser?.id);
            }

            if (modulePart && ref) {
                await DolibarrService.uploadDocument(config, file, modulePart, ref);

                // Construct Link
                // Using document.php wrapper from Dolibarr to handle auth if logged in, or token based if supported.
                // Alternatively, we can use the download endpoint via API but that requires headers.
                // For HTML display, we use a link to the standard interface document handler.
                const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_ ]/g, '');
                const fileUrl = `${baseApiUrl}/document.php?modulepart=${modulePart}&file=${ref}/${encodeURIComponent(safeFileName)}`;
                const fileLink = `<br/><div class="file-attachment mt-2"><a href="${fileUrl}" target="_blank" class="text-blue-600 dark:text-blue-400 underline flex items-center gap-1 bg-gray-50 dark:bg-gray-700/50 p-1 rounded w-fit"><span style="font-size: 1.2em">📎</span> ${safeFileName}</a></div><br/>`;

                setNewMessage(prev => prev + fileLink);
            } else {
                toast.error('Upload não suportado neste contexto (falta referência "Ref").');
            }
        } catch (err) {
            notifyError('Upload de arquivo', err);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSendMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newMessage.trim() || !config || isSending) return;

        setIsSending(true);
        setSendError(null);

        let finalMessage = newMessage;

        // Handle Reply
        if (replyingTo) {
            const quote = `<blockquote style="border-left: 3px solid #ccc; padding-left: 10px; margin-bottom: 5px; color: #666; font-size: 0.9em;">
                <strong>${replyingTo.user_author_name || 'Usuário'}:</strong><br/>
                ${replyingTo.description || replyingTo.label || '(Sem conteúdo)'}
            </blockquote><br/>`;
            finalMessage = quote + finalMessage;
        }

        const nowSec = Math.floor(Date.now() / 1000);

        // Otimista: exibe a mensagem localmente antes do POST resolver
        const optimisticMsg = {
            id: `optimistic-${nowSec}-${Math.random().toString(36).slice(2, 8)}`,
            label: `Comentário em ${elementType}`,
            description: finalMessage,
            date_start: nowSec,
            type_code: 'AC_CHAT',
            elementtype: elementType,
            fk_element: elementId,
            fk_user_author: String(currentUser?.id),
            user_author_name: 'Eu',
            percentage: 100,
            _optimistic: true,
        };
        setOptimisticMessages(prev => [...prev, optimisticMsg]);

        try {
            const payload = {
                label: `Comentário em ${elementType}`,
                datep: nowSec,
                duration: 0,
                description: finalMessage,
                note: finalMessage,
                type_code: 'AC_CHAT',
                elementtype: elementType,
                fk_element: elementId,
                socid: 0,
                fk_project: elementType === 'project' ? elementId : undefined,
                userownerid: currentUser?.id,
                userdoneid: currentUser?.id,
                percentage: 100,
            };

            await Operations.createEvent(config, payload);
            setNewMessage('');
            setReplyingTo(null);
            refreshData();
            // Refetch imediato + refetch adiado: o Dolibarr pode ter latência de indexação
            await refetch();
            setTimeout(() => refetch(), 2500);
        } catch (error) {
            console.error('[ChatInterface] Falha ao enviar mensagem:', error);
            // Preserva o texto digitado para o usuário tentar novamente; remove o bubble otimista
            setOptimisticMessages(prev => prev.filter((m: any) => m.id !== optimisticMsg.id));
            const errMsg = error instanceof Error ? error.message : String(error || 'Erro desconhecido');
            setSendError(errMsg);
            notifyError('Enviar mensagem', error);
        } finally {
            setIsSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [chatMessages]);

    if (isLoading) return <div className="p-4 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ height }}>
            {/* Header */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-between items-center h-[50px]">
                {!showSearch ? (
                    <>
                        <div className="flex items-center gap-2">
                            {onBack && (
                                <button
                                    onClick={onBack}
                                    className="lg:hidden p-2 -ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                >
                                    <ArrowLeft size={20} />
                                </button>
                            )}
                            <h3 className="font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">
                                <UserIcon size={16} />
                                {title}
                            </h3>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 hidden sm:inline">{chatMessages.length} mensagens</span>
                            <button onClick={() => setShowSearch(true)} className="p-2 text-gray-400 hover:text-blue-500">
                                <Search size={20} />
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center gap-2 animate-in fade-in slide-in-from-right-5 duration-200">
                        <Search size={16} className="text-gray-400" />
                        <input
                            autoFocus
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Buscar na conversa..."
                            className="flex-1 bg-transparent border-none text-sm focus:ring-0 px-0 dark:text-gray-200 placeholder:text-gray-400"
                        />
                        <button onClick={() => { setShowSearch(false); setSearchTerm(''); }} className="text-gray-400 hover:text-red-500">
                            <X size={16} />
                        </button>
                    </div>
                )}
            </div>

            {/* Messages Area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-gray-50/50 dark:bg-gray-900/50" ref={scrollRef} onClick={handleInternalLinkClick}>
                {chatMessages.length === 0 ? (
                    <div className="text-center text-gray-400 py-10 text-sm">Nenhum comentário ainda. Inicie a conversa!</div>
                ) : (
                    chatMessages.map((msg: any) => {
                        const isMe = String(msg.fk_user_author) === String(currentUser?.id);
                        const authorName = msg.user_author_name || (isMe ? 'Eu' : `Usuário ${msg.fk_user_author}`);
                        const isEditing = editingMsgId === String(msg.id);
                        const isDeleting = deletingIds.has(String(msg.id));

                        return (
                            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] rounded-lg p-3 shadow-sm ${isMe
                                    ? 'bg-blue-600 text-white rounded-tr-none'
                                    : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-tl-none'
                                    } group relative ${isDeleting ? 'opacity-50' : ''}`}>
                                    {!isMe && (
                                        <div className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-1">
                                            {authorName}
                                        </div>
                                    )}

                                    {isEditing ? (
                                        <div className="flex flex-col gap-2">
                                            <textarea
                                                data-testid={`edit-input-${msg.id}`}
                                                value={editingText}
                                                onChange={e => setEditingText(e.target.value)}
                                                className="w-full text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded p-1 resize-none"
                                                rows={3}
                                                autoFocus
                                            />
                                            <div className="flex gap-2 justify-end">
                                                <button
                                                    onClick={handleCancelEdit}
                                                    className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300"
                                                >
                                                    Cancelar
                                                </button>
                                                <button
                                                    data-testid={`save-edit-${msg.id}`}
                                                    onClick={() => handleSaveEdit(msg)}
                                                    disabled={isSavingEdit}
                                                    className="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
                                                >
                                                    {isSavingEdit ? <Loader2 size={10} className="animate-spin" /> : null}
                                                    Salvar
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <SafeHtml
                                            html={msg.description || msg.label || '(Sem conteúdo)'}
                                            className="text-sm message-content"
                                        />
                                    )}

                                    {/* Action Bar */}
                                    <div className={`absolute top-0 right-[-8px] lg:opacity-0 lg:group-hover:opacity-100 opacity-100 transition-opacity translate-x-full pr-2 flex flex-col gap-2`}>
                                        <button
                                            onClick={() => setReplyingTo(msg)}
                                            className="p-2 bg-white dark:bg-gray-700 shadow-sm border border-gray-100 dark:border-gray-600 rounded-full text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:shadow-md transition-all sm:p-1.5"
                                            title="Responder"
                                        >
                                            <div className="transform scale-x-[-1]">
                                                <Send size={14} />
                                            </div>
                                        </button>

                                        {isMe && !isEditing && (
                                            <button
                                                data-testid={`edit-btn-${msg.id}`}
                                                onClick={() => handleStartEdit(msg)}
                                                disabled={isDeleting}
                                                className="p-2 bg-white dark:bg-gray-700 shadow-sm border border-gray-100 dark:border-gray-600 rounded-full text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 hover:shadow-md transition-all sm:p-1.5"
                                                title="Editar"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                        )}

                                        {isMe && (
                                            <button
                                                data-testid={`delete-btn-${msg.id}`}
                                                onClick={() => handleDeleteMessage(msg)}
                                                disabled={isDeleting}
                                                className="p-2 bg-white dark:bg-gray-700 shadow-sm border border-gray-100 dark:border-gray-600 rounded-full text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:shadow-md transition-all sm:p-1.5"
                                                title="Excluir"
                                            >
                                                {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                            </button>
                                        )}

                                        {elementType === 'project' && (
                                            <button
                                                onClick={() => {
                                                    // Strip HTML for task label/description
                                                    const rawText = msg.description || msg.label || '';
                                                    const cleanText = rawText.replace(/<[^>]*>?/gm, '');
                                                    const label = cleanText.substring(0, 50) + (cleanText.length > 50 ? '...' : '');

                                                    setWizardInitialData([{
                                                        label: label,
                                                        description: rawText
                                                    }]);
                                                    setShowTaskWizard(true);
                                                }}
                                                className="p-2 bg-white dark:bg-gray-700 shadow-sm border border-gray-100 dark:border-gray-600 rounded-full text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:shadow-md transition-all sm:p-1.5"
                                                title="Criar Tarefa"
                                            >
                                                <CheckSquare size={14} />
                                            </button>
                                        )}
                                    </div>

                                    <div className={`text-[10px] mt-1 flex items-center gap-1 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                                        <Calendar size={10} />
                                        {format(new Date(msg.date_start * 1000), 'dd/MM/yy HH:mm', { locale: ptBR })}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Input Area */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col gap-2 flex-shrink-0">
                {/* Reply Banner */}
                {replyingTo && (
                    <div className="flex items-center justify-between text-xs bg-gray-100 dark:bg-gray-700 p-2 rounded border-l-4 border-blue-500 mb-1">
                        <div className="truncate max-w-[90%]">
                            <span className="font-bold">Respondendo a {replyingTo.user_author_name}: </span>
                            <span className="text-gray-500 dark:text-gray-400">{stripHtml(replyingTo.description || '').substring(0, 50) + '...'}</span>
                        </div>
                        <button onClick={() => setReplyingTo(null)} className="text-gray-500 hover:text-red-500">
                            &times;
                        </button>
                    </div>
                )}

                {/* Send Error (inline) */}
                {sendError && (
                    <div role="alert" data-testid="send-error" className="flex items-center gap-2 text-xs bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-2 rounded border-l-4 border-red-500 mb-1">
                        <span className="font-medium whitespace-nowrap">Falha ao enviar:</span>
                        <span className="truncate">{sendError}</span>
                    </div>
                )}

                <RichTextEditor
                    value={newMessage}
                    onChange={setNewMessage}
                    placeholder="Digite sua mensagem..."
                    className="flex-1"
                    minHeight="60px"
                    maxHeight="200px"
                    onKeyDown={handleKeyDown}
                />

                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleFileUpload}
                />

                <div className="flex justify-end gap-2">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSending || isUploading}
                        className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 p-3 rounded-full transition-colors disabled:opacity-50 sm:p-2"
                        title="Anexar arquivo"
                    >
                        {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Paperclip size={20} />}
                    </button>
                    <button
                        onClick={() => handleSendMessage()}
                        disabled={isSending || !newMessage.trim()}
                        aria-label="Enviar mensagem"
                        className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:p-2"
                    >
                        {isSending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    </button>
                </div>
            </div>

            {/* Task Wizard Modal */}
            {showTaskWizard && currentProject && config && (
                <TaskWizard
                    isOpen={showTaskWizard}
                    onClose={() => setShowTaskWizard(false)}
                    project={currentProject}
                    config={config}
                    users={users}
                    initialTasks={wizardInitialData}
                    onSuccess={() => {
                        setShowTaskWizard(false);
                        refreshData();
                    }}
                />
            )}
        </div>
    );
};
