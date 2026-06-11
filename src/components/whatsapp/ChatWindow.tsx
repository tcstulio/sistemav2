import React, { useRef, useEffect, useState } from 'react';
import { ArrowLeft, User, Layout, MessageSquare, AlertTriangle, Loader2, CheckCheck, Check, Bot, Mic, UserPlus, Sparkles, X } from 'lucide-react';
import { WhatsAppMessage, WhatsAppConversation, DolibarrUser, ThirdParty } from '../../types';
import { AiService } from '../../services/aiService';
import { formatTime } from '../../utils/dateUtils';
import { useCustomerMutations } from '../../hooks/useMutations';
import { useDolibarr } from '../../context/DolibarrContext';
import { toast } from 'sonner';
import { logger } from '../../utils/logger';
import { useConfirm } from '../../hooks/useConfirm';

const log = logger.child('ChatWindow');

interface ChatWindowProps {
    messages: WhatsAppMessage[];
    currentUser: DolibarrUser;
    users: DolibarrUser[]; // For assigning names
    selectedConversation: WhatsAppConversation | null;
    isLoading: boolean;
    error: string | null;
    onAssign: (userId: string | null) => void;
    onClose: () => void;
    onOpenContext: () => void;
    isContextOpen: boolean;
    onRetry: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
    messages,
    currentUser,
    users,
    selectedConversation,
    isLoading,
    error,
    onAssign,
    onClose,
    onOpenContext,
    isContextOpen,
    onRetry
}) => {
    const confirm = useConfirm();
    const chatContainerRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        if (chatContainerRef.current) {
            const { scrollHeight, clientHeight } = chatContainerRef.current;
            chatContainerRef.current.scrollTop = scrollHeight - clientHeight;
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);



    const getAvatarColor = (name: string) => {
        if (!name) return 'bg-slate-500';
        const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500'];
        const index = name.length % colors.length;
        return colors[index];
    };

    const renderAttachment = (attachment: { type: 'image' | 'file' | 'video' | 'audio', url: string, name: string }) => {
        switch (attachment.type) {
            case 'image':
                return (
                    <div className="mb-1 rounded-lg overflow-hidden max-w-[280px]">
                        <img src={attachment.url} alt={attachment.name} className="w-full h-auto object-cover" />
                    </div>
                );
            case 'video':
                return (
                    <div className="mb-1 rounded-lg overflow-hidden max-w-[280px]">
                        <video src={attachment.url} controls className="w-full h-auto bg-black" />
                    </div>
                );
            case 'audio':
                return (
                    <div className="mb-1 min-w-[240px]">
                        <audio src={attachment.url} controls className="w-full h-8" />
                        <div className="text-[10px] opacity-70 mt-1 flex items-center gap-1">
                            <Mic size={10} /> {attachment.name}
                        </div>
                    </div>
                );
            case 'file':
            default:
                return (
                    <div className="flex items-center gap-3 p-3 bg-black/5 dark:bg-white/10 rounded-lg mb-1 border border-black/10 dark:border-white/10 max-w-[280px]">
                        <div className="p-2 bg-white dark:bg-slate-700 rounded-full text-indigo-500">
                            {/* <FileIcon size={20} /> */} <span className="font-bold">FILE</span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{attachment.name}</div>
                            <div className="text-xs opacity-70">Documento</div>
                        </div>
                        <a href={attachment.url} download onClick={(e) => e.stopPropagation()} className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded">
                            <ArrowLeft size={16} className="-rotate-90" />
                        </a>
                    </div>
                );
        }
    };

    const { config } = useDolibarr();
    const { createCustomer } = useCustomerMutations(config);
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractedData, setExtractedData] = useState<Partial<ThirdParty> | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const handleExtractCustomer = async () => {
        setIsExtracting(true);
        try {
            // Combine last 10 messages from user to get context
            const relevantText = messages
                .filter(m => m.sender === 'user')
                .slice(-10)
                .map(m => m.text)
                .join('\n');

            if (!relevantText) {
                toast.error("Sem mensagens do cliente para analisar.");
                return;
            }

            const result = await AiService.extractCustomerInfo(relevantText);
            if (result) {
                setExtractedData(result);
                setIsCreateModalOpen(true);
            } else {
                toast.error("Não foi possível extrair informações.");
            }
        } catch (e) {
            log.error(e);
            toast.error("Erro na extração IA.");
        } finally {
            setIsExtracting(false);
        }
    };

    const handleConfirmCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!extractedData) return;

        try {
            await createCustomer.mutateAsync({
                ...extractedData,
                client: '2' // Create as Prospect by default
            });
            toast.success(`Cliente ${extractedData.name} criado com sucesso!`);
            setIsCreateModalOpen(false);
            // Optionally assign this conversation to the new customer if the system supports linking
        } catch (e: any) {
            toast.error("Erro ao criar cliente: " + e.message);
        }
    };

    const [sentiment, setSentiment] = React.useState<{ score: number, label: string } | null>(null);

    // Analyze sentiment of the last customer message
    useEffect(() => {
        const lastCustomerMsg = [...messages].reverse().find(m => m.sender === 'user');
        if (lastCustomerMsg && lastCustomerMsg.text) {
            // Only analyze if changed to save API calls
            /* In a real app we would cache this in the message object itself. 
               For MVP, we fetch on mount/change if cheap local LLM, or just mock/debounce. */

            // For safety/speed, let's assuming we just call it once per open conversation for now:
            import('../../services/aiService').then(({ AiService }) => {
                AiService.analyzeSentiment(lastCustomerMsg.text!).then(res => {
                    setSentiment(res);
                });
            });
        }
    }, [selectedConversation?.id, messages]);


    if (!selectedConversation) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 border-b-8 border-green-500 bg-[#efeae2] dark:bg-[#0b141a]">
                <div className="w-24 h-24 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6">
                    <MessageSquare size={48} className="text-slate-400 opacity-50" />
                </div>
                <h2 className="text-2xl font-light text-slate-600 dark:text-slate-300 mb-2">WhatsApp Web CoolGroove</h2>
                <p className="text-sm">Envie e receba mensagens sem manter seu celular conectado.</p>
                <p className="text-sm mt-1">Selecione uma conversa para começar.</p>
            </div>
        );
    }

    const getSentimentIcon = (score: number) => {
        if (score >= 70) return '🙂';
        if (score >= 40) return '😐';
        return '😡';
    };

    const getSentimentColor = (score: number) => {
        if (score >= 70) return 'text-green-600';
        if (score >= 40) return 'text-yellow-600';
        return 'text-red-600';
    };

    return (
        <div className="flex flex-col flex-1 min-h-0 bg-[#efeae2] dark:bg-[#0b141a] relative overflow-hidden">
            {/* Header */}
            <div className="p-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center z-10 shadow-sm flex-none">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="md:hidden p-2 text-slate-500"><ArrowLeft /></button>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${getAvatarColor(selectedConversation.customerName)}`}>
                        {selectedConversation.customerName ? selectedConversation.customerName[0] : '?'}
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800 dark:text-white">{selectedConversation.customerName}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{selectedConversation.customerNumber}</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleExtractCustomer}
                        disabled={isExtracting}
                        className="hidden md:flex items-center gap-1 px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-bold hover:bg-indigo-200 transition-colors"
                        title="Extrair dados do chat para criar cliente"
                    >
                        {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        Extrair Cliente
                    </button>

                    {/* Assignment Logic */}
                    {(() => {
                        const assignedTo = selectedConversation.assignedUserId;
                        const assignee = assignedTo ? users.find(u => u.id === assignedTo) : null;
                        const isMine = assignedTo === currentUser.id;

                        if (!assignedTo) {
                            // Unassigned -> Show Assume
                            return (
                                <button
                                    onClick={() => onAssign(currentUser.id)}
                                    className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-green-700 shadow-sm flex items-center gap-1"
                                    title="Puxar para mim"
                                >
                                    <UserPlus size={16} />
                                    Assumir
                                </button>
                            );
                        } else if (isMine) {
                            // Mine -> Show Unassign (Release)
                            return (
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1 px-2 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg text-xs font-bold border border-green-200 dark:border-green-800">
                                        <User size={14} />
                                        Você assumiu
                                    </div>
                                    <button
                                        onClick={() => onAssign(null as any)}
                                        className="text-slate-500 hover:text-red-600 p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg border border-transparent hover:border-red-200 transition-colors"
                                        title="Liberar conversa (Desassumir)"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            );
                        } else {
                            // Someone else -> Show "Steal" option
                            return (
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600" title={`Assumido por ${assignee?.login || 'Outro'}`}>
                                        <User size={14} className="opacity-50" />
                                        <span className="max-w-[100px] truncate">{assignee?.login || 'Outro Agente'}</span>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            if (await confirm(`Esta conversa está com ${assignee?.login || 'outro agente'}. Deseja assumir mesmo assim?`)) {
                                                onAssign(currentUser.id);
                                            }
                                        }}
                                        className="text-xs text-orange-600 hover:text-orange-700 underline px-2"
                                        title="Roubar conversa"
                                    >
                                        Assumir
                                    </button>
                                </div>
                            );
                        }
                    })()}

                    <button
                        onClick={onOpenContext}
                        className={`p-2 rounded-full transition-colors ${isContextOpen ? 'bg-slate-200 dark:bg-slate-700 text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                    >
                        <Layout size={20} />
                    </button>
                </div>
            </div>

            {/* Sentiment Indicator */}
            {sentiment && (
                <div className="absolute top-[60px] right-4 z-10 opacity-80 hover:opacity-100 transition-opacity animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-1 bg-white/90 dark:bg-slate-900/90 px-2 py-1 rounded-full shadow-sm text-xs font-bold border border-slate-200 dark:border-slate-800 backdrop-blur-sm" title={`Sentimento: ${sentiment.label}`}>
                        <span>{getSentimentIcon(sentiment.score)}</span>
                        <span className={getSentimentColor(sentiment.score)}>{sentiment.score}%</span>
                    </div>
                </div>
            )}

            {/* Chat Area */}
            <div
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto p-4 space-y-2 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] dark:bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat opacity-95"
            >
                {error ? (
                    <div className="flex h-full items-center justify-center flex-col gap-4 p-8 text-center opacity-80 animate-in fade-in zoom-in">
                        <div className="bg-red-100 dark:bg-red-900/30 p-4 rounded-full text-red-500">
                            <AlertTriangle size={32} />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 dark:text-white mb-1">Erro ao carregar mensagens</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                                {error}
                            </p>
                        </div>
                        <button
                            onClick={onRetry}
                            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg text-sm font-bold transition-colors"
                        >
                            Tentar Novamente
                        </button>
                    </div>
                ) : isLoading ? (
                    <div className="flex h-full items-center justify-center flex-col gap-2">
                        <Loader2 className="animate-spin text-green-600" size={32} />
                        <p className="text-sm text-slate-500 font-medium">Carregando mensagens...</p>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center flex-col opacity-60">
                        <MessageSquare size={32} className="mb-2" />
                        <p className="text-sm">Nenhuma mensagem encontrada.</p>
                    </div>
                ) : (
                    <div className="max-w-4xl mx-auto w-full space-y-2">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-start' : 'justify-end'}`}>
                                <div className={`max-w-[85%] md:max-w-[70%] rounded-lg p-2 shadow-sm relative ${msg.sender === 'user'
                                    ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none'
                                    : msg.sender === 'system'
                                        ? 'bg-indigo-100 dark:bg-indigo-900 text-slate-800 dark:text-slate-100 rounded-tr-none border border-indigo-200 dark:border-indigo-800' // System (AI) Style
                                        : 'bg-[#d9fdd3] dark:bg-[#005c4b] text-slate-900 dark:text-slate-100 rounded-tr-none' // Human Agent Style
                                    }`}>

                                    {/* Group Sender Name */}
                                    {selectedConversation.isGroup && msg.sender === 'user' && msg.senderName && (
                                        <div className={`text-xs font-bold mb-1 ${getAvatarColor(msg.senderName).replace('bg-', 'text-').replace('500', '600')}`}>
                                            {msg.senderName}
                                        </div>
                                    )}

                                    {/* Attachments Section */}
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="mb-1 space-y-1">
                                            {msg.attachments.map((att: any, idx) => (
                                                <div key={idx}>{renderAttachment(att)}</div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Text Content */}
                                    {msg.text && <p className="text-sm whitespace-pre-wrap leading-relaxed pb-2">{msg.text}</p>}

                                    {/* Timestamp & Status */}
                                    <div className="flex items-center justify-end gap-1 text-[10px] opacity-70 absolute bottom-1 right-2">
                                        {msg.sender === 'system' && <Bot size={10} className="mr-1" />}
                                        <span>{formatTime(msg.timestamp)}</span>
                                        {(msg.sender === 'agent' || msg.sender === 'system') && (
                                            <span>
                                                {msg.status === 'read' ? <CheckCheck size={14} className="text-blue-500" /> :
                                                    msg.status === 'delivered' ? <CheckCheck size={14} className="text-slate-500" /> :
                                                        <Check size={14} className="text-slate-500" />}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Customer Modal */}
            {isCreateModalOpen && extractedData && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-indigo-50 dark:bg-indigo-900/20 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <Sparkles size={18} className="text-indigo-600" /> Cliente Extraído da Conversa
                            </h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleConfirmCreate} className="p-6 space-y-4">
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={extractedData.name || ''} onChange={e => setExtractedData({ ...extractedData, name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={extractedData.email || ''} onChange={e => setExtractedData({ ...extractedData, email: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Telefone</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={extractedData.phone || ''} onChange={e => setExtractedData({ ...extractedData, phone: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Endereço</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={extractedData.address || ''} onChange={e => setExtractedData({ ...extractedData, address: e.target.value })} />
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    <UserPlus size={16} /> Criar Prospect
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
