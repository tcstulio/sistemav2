import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useDolibarr } from '../../context/DolibarrContext';
import { Send, User as UserIcon, Calendar, Clock, Loader2, Search, X, CheckSquare, Paperclip, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as Operations from '../../services/api/operations';
import { RichTextEditor } from '../common/RichTextEditor';
import { TaskWizard } from '../Projects/TaskWizard';
import { useEvents, useProjects, useUsers } from '../../hooks/dolibarr';
import { Project, DolibarrUser } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';

interface ChatInterfaceProps {
    elementId: string;
    elementType: string; // 'project', 'task', 'facture', etc.
    title?: string;
    height?: string;
    onBack?: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ elementId, elementType, title = "Comentários", height = "400px", onBack }) => {
    const { config, currentUser, refreshData } = useDolibarr();
    const { data: events, isLoading, refetch } = useEvents(config);

    // States
    const [newMessage, setNewMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [replyingTo, setReplyingTo] = useState<any>(null);
    const [showTaskWizard, setShowTaskWizard] = useState(false);
    const [wizardInitialData, setWizardInitialData] = useState<{ label: string; description: string }[] | undefined>(undefined);
    const [isUploading, setIsUploading] = useState(false);

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
        if (!events) return [];
        return events
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
    }, [events, elementId, elementType, currentUser, searchTerm]);

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
                const fileUrl = `${baseApiUrl}/document.php?modulepart=${modulePart}&file=${ref}/${encodeURIComponent(file.name)}`;
                const fileLink = `<br/><div class="file-attachment mt-2"><a href="${fileUrl}" target="_blank" class="text-blue-600 dark:text-blue-400 underline flex items-center gap-1 bg-gray-50 dark:bg-gray-700/50 p-1 rounded w-fit"><span style="font-size: 1.2em">📎</span> ${file.name}</a></div><br/>`;

                setNewMessage(prev => prev + fileLink);
            } else {
                alert('Upload não suportado neste contexto (falta referência "Ref").');
            }
        } catch (err) {
            console.error('Upload Error:', err);
            alert('Falha no upload do arquivo.');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSendMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newMessage.trim() || !config || isSending) return;

        setIsSending(true);
        try {
            // Construct payload
            let finalMessage = newMessage;

            // Handle Reply
            if (replyingTo) {
                const quote = `<blockquote style="border-left: 3px solid #ccc; padding-left: 10px; margin-bottom: 5px; color: #666; font-size: 0.9em;">
                    <strong>${replyingTo.user_author_name || 'Usuário'}:</strong><br/>
                    ${replyingTo.description || replyingTo.label || '(Sem conteúdo)'}
                </blockquote><br/>`;
                finalMessage = quote + finalMessage;
            }

            const payload = {
                label: `Comentário em ${elementType}`,
                datep: Math.floor(Date.now() / 1000),
                duration: 0,
                description: finalMessage,
                note: finalMessage,
                type_code: 'AC_OTH',
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
            await refreshData();
        } catch (error) {
            console.error("Failed to send message", error);
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
        <div className="flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ height }}>
            {/* Header */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-between items-center h-[50px]">
                {!showSearch ? (
                    <>
                        <div className="flex items-center gap-2">
                            {onBack && (
                                <button
                                    onClick={onBack}
                                    className="lg:hidden p-2 -ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                    aria-label="Voltar"
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
                            <button onClick={() => setShowSearch(true)} className="p-2 text-gray-400 hover:text-blue-500" aria-label="Buscar na conversa">
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
                        <button onClick={() => { setShowSearch(false); setSearchTerm(''); }} className="text-gray-400 hover:text-red-500" aria-label="Limpar busca">
                            <X size={16} />
                        </button>
                    </div>
                )}
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50 dark:bg-gray-900/50" ref={scrollRef}>
                {chatMessages.length === 0 ? (
                    <div className="text-center text-gray-400 py-10 text-sm">Nenhum comentário ainda. Inicie a conversa!</div>
                ) : (
                    chatMessages.map((msg: any) => {
                        const isMe = String(msg.fk_user_author) === String(currentUser?.id);
                        const authorName = msg.user_author_name || (isMe ? 'Eu' : `Usuário ${msg.fk_user_author}`);

                        return (
                            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] rounded-lg p-3 shadow-sm ${isMe
                                    ? 'bg-blue-600 text-white rounded-tr-none'
                                    : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-tl-none'
                                    } group relative`}>
                                    {!isMe && (
                                        <div className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-1">
                                            {authorName}
                                        </div>
                                    )}
                                    <div
                                        className="text-sm message-content"
                                        dangerouslySetInnerHTML={{ __html: msg.description || msg.label || '(Sem conteúdo)' }}
                                    />

                                    {/* Action Bar */}
                                    <div className={`absolute top-0 right-[-8px] lg:opacity-0 lg:group-hover:opacity-100 opacity-100 transition-opacity translate-x-full pr-2 flex flex-col gap-2`}>
                                        <button
                                            onClick={() => setReplyingTo(msg)}
                                            className="p-2 bg-white dark:bg-gray-700 shadow-sm border border-gray-100 dark:border-gray-600 rounded-full text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:shadow-md transition-all sm:p-1.5"
                                            title="Responder"
                                            aria-label="Responder"
                                        >
                                            <div className="transform scale-x-[-1]">
                                                <Send size={14} />
                                            </div>
                                        </button>

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
                                                aria-label="Criar Tarefa"
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
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col gap-2">
                {/* Reply Banner */}
                {replyingTo && (
                    <div className="flex items-center justify-between text-xs bg-gray-100 dark:bg-gray-700 p-2 rounded border-l-4 border-blue-500 mb-1">
                        <div className="truncate max-w-[90%]">
                            <span className="font-bold">Respondendo a {replyingTo.user_author_name}: </span>
                            <span className="text-gray-500 dark:text-gray-400" dangerouslySetInnerHTML={{ __html: (replyingTo.description || '').substring(0, 50) + '...' }}></span>
                        </div>
                        <button onClick={() => setReplyingTo(null)} className="text-gray-500 hover:text-red-500" aria-label="Cancelar resposta">
                            &times;
                        </button>
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
                        aria-label="Anexar arquivo"
                    >
                        {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Paperclip size={20} />}
                    </button>
                    <button
                        onClick={() => handleSendMessage()}
                        disabled={isSending || !newMessage.trim()}
                        className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:p-2"
                        aria-label="Enviar mensagem"
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
