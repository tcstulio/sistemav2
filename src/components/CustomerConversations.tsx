/**
 * CustomerConversations — Conversas com clientes (IA/WhatsApp)
 *
 * Exibe as conversas da IA (auto-resposta do bot) com clientes via WhatsApp.
 * Somente leitura — sem envio de mensagens, sem gestão de sessões.
 * Fonte: GET /api/whatsapp/conversations + GET /api/whatsapp/messages/:chatId
 * Hooks: useConversations (sessionId='all') + useMessages
 */

import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, RefreshCw, Bot, User, Loader2, Search, Clock } from 'lucide-react';
import { PageHeader, EmptyState, ErrorState } from './ui';
import { useConversations } from '../hooks/whatsapp/useConversations';
import { useMessages } from '../hooks/whatsapp/useMessages';
import { WhatsAppConversation } from '../types';
import { formatDateLocal, formatTime } from '../utils/dateUtils';

// ViewWrapper passes these props; accept (and ignore) them so the component
// can be registered in App.tsx without TypeScript errors.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface CustomerConversationsProps {
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ConversationItem — linha na lista de conversas
// ---------------------------------------------------------------------------
interface ConversationItemProps {
    conversation: WhatsAppConversation;
    isSelected: boolean;
    onSelect: (conv: WhatsAppConversation) => void;
}

const ConversationItem: React.FC<ConversationItemProps> = ({ conversation, isSelected, onSelect }) => {
    const avatarColors = ['bg-indigo-500', 'bg-green-500', 'bg-pink-500', 'bg-orange-500', 'bg-teal-500', 'bg-purple-500'];
    const colorIndex = conversation.customerName.length % avatarColors.length;
    const initial = conversation.customerName?.[0]?.toUpperCase() ?? '?';
    const ts = conversation.lastMessageTimestamp
        ? formatDateLocal(new Date(conversation.lastMessageTimestamp).toISOString())
        : '';

    return (
        <button
            onClick={() => onSelect(conversation)}
            className={`w-full flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left border-b border-slate-100 dark:border-slate-800 ${
                isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-l-indigo-500' : ''
            }`}
        >
            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${avatarColors[colorIndex]}`}>
                {initial}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                    <span className="font-medium text-slate-800 dark:text-slate-100 text-sm truncate">
                        {conversation.customerName}
                    </span>
                    {ts && (
                        <span className="flex-shrink-0 text-xs text-slate-400 dark:text-slate-500">{ts}</span>
                    )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {conversation.customerNumber}
                </p>
                {conversation.lastMessage && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">
                        {conversation.lastMessage}
                    </p>
                )}
            </div>
            {!!conversation.unreadCount && (
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                </span>
            )}
        </button>
    );
};

// ---------------------------------------------------------------------------
// MessageBubble — balão de mensagem individual
// ---------------------------------------------------------------------------
interface MessageBubbleProps {
    text: string;
    sender: 'agent' | 'user' | 'system';
    timestamp: number;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ text, sender, timestamp }) => {
    const isAgent = sender === 'agent' || sender === 'system';
    const time = timestamp ? formatTime(timestamp) : '';

    return (
        <div className={`flex ${isAgent ? 'justify-end' : 'justify-start'} mb-2`}>
            {!isAgent && (
                <div className="mr-2 mt-1 flex-shrink-0 w-7 h-7 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center">
                    <User size={14} className="text-slate-600 dark:text-slate-300" />
                </div>
            )}
            <div
                className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                    isAgent
                        ? 'bg-indigo-500 text-white rounded-tr-sm'
                        : 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-tl-sm'
                }`}
            >
                {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
                <div className={`flex items-center gap-1 mt-1 ${isAgent ? 'justify-end' : 'justify-start'}`}>
                    {isAgent && <Bot size={10} className="opacity-70" />}
                    <span className="text-[10px] opacity-60">{time}</span>
                </div>
            </div>
            {isAgent && (
                <div className="ml-2 mt-1 flex-shrink-0 w-7 h-7 rounded-full bg-indigo-200 dark:bg-indigo-900/50 flex items-center justify-center">
                    <Bot size={14} className="text-indigo-600 dark:text-indigo-300" />
                </div>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// MessagePane — painel de mensagens de uma conversa selecionada
// ---------------------------------------------------------------------------
interface MessagePaneProps {
    conversation: WhatsAppConversation;
}

const MessagePane: React.FC<MessagePaneProps> = ({ conversation }) => {
    const sessionId = conversation.accountId || 'default';
    const { messages, loading, error, refetch } = useMessages(sessionId, conversation.id);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (bottomRef.current && typeof bottomRef.current.scrollIntoView === 'function') {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Chat header */}
            <div className="flex-shrink-0 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-sm">
                    {conversation.customerName?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div>
                    <h3 className="font-semibold text-slate-800 dark:text-white text-sm">{conversation.customerName}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{conversation.customerNumber}</p>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 bg-[#efeae2] dark:bg-[#0b141a]">
                {/* #829: estado de erro visível (wrapper p-4 padronizado com a lista) */}
                {error && !loading ? (
                    <div className="p-4">
                        <ErrorState
                            message="Erro ao carregar mensagens. Tente novamente."
                            onRetry={refetch}
                        />
                    </div>
                ) : loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={28} className="animate-spin text-slate-400" />
                    </div>
                ) : messages.length === 0 ? (
                    <EmptyState
                        icon={MessageSquare}
                        title="Sem mensagens"
                        description="Esta conversa ainda não tem mensagens registradas."
                        size="sm"
                    />
                ) : (
                    messages.map(msg => (
                        <MessageBubble
                            key={msg.id}
                            text={msg.text ?? ''}
                            sender={msg.sender}
                            timestamp={msg.timestamp}
                        />
                    ))
                )}
                <div ref={bottomRef} />
            </div>

            {/* Read-only footer */}
            <div className="flex-shrink-0 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                <Bot size={14} />
                <span>Histórico somente leitura — respondido pelo agente IA</span>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// CustomerConversations — componente principal
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CustomerConversations: React.FC<CustomerConversationsProps> = (_props) => {
    const { conversations, loading, error, refreshConversations } = useConversations('all');
    const [selectedConversation, setSelectedConversation] = useState<WhatsAppConversation | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const filtered = conversations.filter(c => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            c.customerName.toLowerCase().includes(term) ||
            c.customerNumber.toLowerCase().includes(term) ||
            (c.lastMessage ?? '').toLowerCase().includes(term)
        );
    });

    return (
        <div className="flex flex-col h-full min-h-0">
            <PageHeader
                title="Conversas com clientes"
                subtitle="Histórico das conversas da IA com clientes via WhatsApp"
                actions={
                    <button
                        onClick={refreshConversations}
                        className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        title="Atualizar"
                    >
                        <RefreshCw size={16} />
                    </button>
                }
            />

            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* Conversation List Panel */}
                <div className="w-80 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col min-h-0 bg-white dark:bg-slate-900">
                    {/* Search */}
                    <div className="flex-shrink-0 p-3 border-b border-slate-100 dark:border-slate-800">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Buscar conversas..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-100 placeholder-slate-400"
                            />
                        </div>
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto">
                        {/* #829: erro visível (wrapper p-4 padronizado com o painel de mensagens) */}
                        {error && !loading ? (
                            <div className="p-4">
                                <ErrorState
                                    message="Erro ao carregar conversas. Tente novamente."
                                    onRetry={refreshConversations}
                                />
                            </div>
                        ) : loading ? (
                            <div className="flex items-center justify-center py-16">
                                <Loader2 size={28} className="animate-spin text-slate-400" />
                            </div>
                        ) : filtered.length === 0 ? (
                            <EmptyState
                                icon={MessageSquare}
                                title="Nenhuma conversa"
                                description={
                                    searchTerm
                                        ? 'Nenhuma conversa corresponde à busca.'
                                        : 'Ainda não há conversas registradas.'
                                }
                                size="sm"
                            />
                        ) : (
                            filtered.map(conv => (
                                <ConversationItem
                                    key={conv.id}
                                    conversation={conv}
                                    isSelected={selectedConversation?.id === conv.id}
                                    onSelect={setSelectedConversation}
                                />
                            ))
                        )}
                    </div>

                    {/* Footer count */}
                    {!loading && conversations.length > 0 && (
                        <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-800 px-3 py-2 flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                            <Clock size={12} />
                            <span>{filtered.length} conversa{filtered.length !== 1 ? 's' : ''}</span>
                        </div>
                    )}
                </div>

                {/* Main Panel — messages or placeholder */}
                <div className="flex-1 flex flex-col min-h-0 min-w-0">
                    {selectedConversation ? (
                        <MessagePane conversation={selectedConversation} />
                    ) : (
                        <div className="flex-1 flex items-center justify-center bg-[#efeae2] dark:bg-[#0b141a]">
                            <EmptyState
                                icon={MessageSquare}
                                title="Selecione uma conversa"
                                description="Escolha uma conversa na lista ao lado para ver o histórico de mensagens."
                                size="lg"
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CustomerConversations;
