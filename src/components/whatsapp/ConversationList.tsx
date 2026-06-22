import React, { useMemo, useCallback } from 'react';
import { MessageSquare, MessageSquarePlus, Search, Plus, Trash2, RefreshCw, Loader2, Settings, Users, Building2 } from 'lucide-react';
import { WhatsAppConversation, WhatsAppAccount } from '../../types';
import { formatDateLocal } from '../../utils/dateUtils';

interface ConversationListProps {
    conversations: WhatsAppConversation[];
    selectedConversationId?: string;
    onSelect: (conv: WhatsAppConversation) => void;
    accounts: WhatsAppAccount[];
    selectedAccount: string;
    onAccountChange: (id: string) => void;
    onConnect?: () => void;
    onDeleteSession?: (id: string) => void | Promise<void>;
    onRefresh: () => void;
    isLoading: boolean;
    onCreateSession: () => void;
    onNewConversation?: () => void;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    filterMode: 'all' | 'mine' | 'unassigned';
    onFilterChange: (mode: 'all' | 'mine' | 'unassigned') => void;
    currentUser: any;
    users?: any[];
    onSettingsClick?: () => void;
}

const statusConfig: Record<string, { dot: string; label: string }> = {
    connected: { dot: 'bg-green-500', label: 'Conectado' },
    disconnected: { dot: 'bg-red-500', label: 'Desconectado' },
    qr_code: { dot: 'bg-yellow-500', label: 'Aguardando QR' },
    WORKING: { dot: 'bg-green-500', label: 'Conectado' },
    STOPPED: { dot: 'bg-red-500', label: 'Parado' },
    INITIALIZING: { dot: 'bg-yellow-500', label: 'Iniciando' },
    STARTING: { dot: 'bg-yellow-500', label: 'Iniciando' },
    SCAN_QR_CODE: { dot: 'bg-yellow-500', label: 'Aguardando QR' },
};

export const ConversationList: React.FC<ConversationListProps> = ({
    conversations,
    selectedConversationId,
    onSelect,
    accounts,
    selectedAccount,
    onAccountChange,
    onConnect,
    onDeleteSession,
    onRefresh,
    isLoading,
    onCreateSession,
    onNewConversation,
    searchTerm,
    onSearchChange,
    filterMode,
    onFilterChange,
    currentUser,
    users = [],
    onSettingsClick
}) => {

    const getAvatarColor = useCallback((name: string) => {
        if (!name) return 'bg-slate-500';
        const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500'];
        const index = name.length % colors.length;
        return colors[index];
    }, []);

    // Memoized filter logic for performance
    const filteredConversations = useMemo(() => {
        const searchLower = searchTerm.toLowerCase();
        return conversations
            .filter(c => {
                const matchesSearch = c.customerName.toLowerCase().includes(searchLower) || c.customerNumber.includes(searchLower);
                if (!matchesSearch) return false;

                if (filterMode === 'mine') return c.assignedUserId === currentUser?.id;
                if (filterMode === 'unassigned') return !c.assignedUserId;

                return true;
            })
            .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
    }, [conversations, searchTerm, filterMode, currentUser?.id]);

    const isCurrentAccountConnected = useMemo(
        () => accounts.find(a => a.id === selectedAccount)?.status === 'connected',
        [accounts, selectedAccount]
    );

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="font-bold text-xl text-slate-800 dark:text-white flex items-center gap-2">
                        <MessageSquare className="text-green-500" /> WhatsApp
                    </h2>
                    <div className="flex gap-1">
                        {onNewConversation && (
                            <button onClick={onNewConversation} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-green-500" title="Nova Conversa"><MessageSquarePlus size={18} /></button>
                        )}
                        {onSettingsClick && (
                            <button onClick={onSettingsClick} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500" title="Configurações"><Settings size={18} /></button>
                        )}
                        <button onClick={onCreateSession} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-indigo-500" title="Nova Conta"><Plus size={18} /></button>
                        {(selectedAccount !== 'all') && (
                            <button
                                onClick={() => onDeleteSession && onDeleteSession(selectedAccount)}
                                className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full text-red-500"
                                title="Excluir Sessão"
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                        <button onClick={onRefresh} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500"><RefreshCw size={18} /></button>
                    </div>
                </div>

                {/* Account Selector */}
                <div className="mb-4">
                    <select
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                        value={selectedAccount}
                        onChange={(e) => onAccountChange(e.target.value)}
                    >
                        <option value="all">Todas as Contas ({accounts.length})</option>
                        {accounts.map(acc => {
                            const st = statusConfig[acc.status] || { label: acc.status };
                            const phone = acc.phoneNumber && acc.phoneNumber !== '---' ? ` - ${acc.phoneNumber}` : '';
                            return (
                                <option key={acc.id} value={acc.id}>
                                    {acc.name}{phone} ({st.label})
                                </option>
                            );
                        })}
                    </select>
                    {selectedAccount !== 'all' && !isCurrentAccountConnected && (
                        <button
                            onClick={onConnect}
                            className="w-full mt-2 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                        >
                            <RefreshCw size={16} /> Conectar {accounts.find(a => a.id === selectedAccount)?.name || selectedAccount}
                        </button>
                    )}
                </div>

                {/* Search */}
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="Buscar conversa..."
                        className="w-full pl-9 pr-4 py-2 rounded-full border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-sm focus:outline-none focus:border-green-500 dark:text-white"
                        value={searchTerm}
                        onChange={e => onSearchChange(e.target.value)}
                    />
                </div>

                {/* Filter Tabs */}
                <div className="flex justify-between gap-1 bg-slate-200 dark:bg-slate-800 p-1 rounded-lg">
                    {(['all', 'mine', 'unassigned'] as const).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => onFilterChange(mode)}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${filterMode === mode ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            {mode === 'all' ? 'Todos' : (mode === 'mine' ? 'Meus' : 'Livres')}
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {isLoading ? (
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin text-green-500" /></div>
                ) : filteredConversations.length === 0 ? (
                    <div className="text-center p-8 text-slate-400 text-sm">Nenhuma conversa encontrada.</div>
                ) : (
                    filteredConversations.map(conv => {
                        // Find assigned user
                        const assignee = conv.assignedUserId ? users.find(u => u.id === conv.assignedUserId) : null;

                        return (
                            <div
                                key={`${conv.accountId}_${conv.id}`} // [ANTIGRAVITY] Composite key to prevent duplicates across accounts
                                onClick={() => onSelect(conv)}
                                className={`flex items-center gap-3 p-3 border-b border-slate-100 dark:border-slate-800 cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${selectedConversationId === conv.id ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                            >
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0 ${getAvatarColor(conv.customerName)}`}>
                                    {conv.isGroup ? <Users size={24} /> : (conv.customerName ? conv.customerName[0] : '?')}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-1">
                                        <div className="flex items-center gap-1.5 min-w-0 max-w-[70%]">
                                            <h4 className="font-semibold text-slate-900 dark:text-white truncate">{conv.customerName}</h4>
                                            {conv.isGroup && (
                                                <span className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 text-[10px] font-bold px-1.5 rounded border border-indigo-200 dark:border-indigo-800 shrink-0">
                                                    GRUPO
                                                </span>
                                            )}
                                            {conv.customer_id && (
                                                <span className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 text-[10px] font-bold px-1.5 rounded border border-emerald-200 dark:border-emerald-800 shrink-0 flex items-center gap-0.5" title="Cliente vinculado">
                                                    <Building2 size={9} /> CRM
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs text-slate-400 shrink-0">{formatDateLocal(conv.lastMessageTimestamp)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <p className="text-sm text-slate-500 dark:text-slate-400 truncate max-w-[80%]">{conv.lastMessage}</p>

                                        {conv.unreadCount > 0 ? (
                                            <span className="bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center ml-2">
                                                {conv.unreadCount}
                                            </span>
                                        ) : (
                                            assignee && (
                                                <div className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center max-w-[60px]" title={`Atribuído a: ${assignee.login}`}>
                                                    <span className="truncate">{assignee.login}</span>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    );
};
