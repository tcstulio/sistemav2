import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { MessageSquare, Trash2, RefreshCw, ChevronRight, Bot, User, Wrench, Clock, ArrowLeft, Search } from 'lucide-react';
import { AiService, ChatSessionInfo } from '../services/aiService';
import { logger } from '../utils/logger';
import { useConfirm } from '../hooks/useConfirm';

const log = logger.child('ChatSessionsView');

interface SessionMessage {
    role: 'user' | 'model' | 'system';
    content: string;
    timestamp: number;
    metadata?: {
        hasImage?: boolean;
        toolCalls?: {
            tool: string;
            args: Record<string, any>;
            result?: string;
            duration?: number;
        }[];
        provider?: string;
        model?: string;
    };
}

interface SessionDetail {
    id: string;
    userId: string;
    title: string;
    messages: SessionMessage[];
    createdAt: number;
    updatedAt: number;
    messageCount: number;
}

const formatDate = (ts: number) => new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
});

const ChatSessionsView: React.FC = () => {
    const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
    const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const confirm = useConfirm();

    const fetchSessions = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await AiService.getChatSessions(100);
            setSessions(data);
        } catch (e: any) {
            log.error('Failed to fetch sessions', e);
            toast.error('Erro ao carregar sessões');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchSessions(); }, [fetchSessions]);

    const openSession = async (id: string) => {
        try {
            const data = await AiService.getChatSession(id);
            if (data) {
                const msgs: SessionMessage[] = data.messages.map((m: any) => ({
                    role: m.role,
                    content: m.content || m.text || '',
                    timestamp: m.timestamp || Date.now(),
                    metadata: m.metadata
                }));
                setSelectedSession({
                    id,
                    userId: '',
                    title: sessions.find(s => s.id === id)?.title || 'Sessão',
                    messages: msgs,
                    createdAt: sessions.find(s => s.id === id)?.createdAt || Date.now(),
                    updatedAt: sessions.find(s => s.id === id)?.updatedAt || Date.now(),
                    messageCount: msgs.length
                });
            }
        } catch (e: any) {
            log.error('Failed to load session', e);
            toast.error('Erro ao carregar sessão');
        }
    };

    const deleteSession = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!(await confirm('Excluir esta sessão?'))) return;
        const ok = await AiService.deleteChatSession(id);
        if (ok) {
            toast.success('Sessão excluída');
            setSessions(prev => prev.filter(s => s.id !== id));
            if (selectedSession?.id === id) setSelectedSession(null);
        }
    };

    const deleteAllSessions = async () => {
        if (!(await confirm(`Excluir todas as ${sessions.length} sessões? Esta ação não pode ser desfeita.`))) return;
        const count = await AiService.deleteAllChatSessions();
        if (count > 0) {
            toast.success(`${count} sessão(ões) excluída(s)`);
            setSessions([]);
            setSelectedSession(null);
        }
    };

    const filtered = sessions.filter(s =>
        s.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.lastPreview.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (selectedSession) {
        return (
            <div className="h-full flex flex-col bg-white dark:bg-slate-950">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
                    <button onClick={() => setSelectedSession(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
                        <ArrowLeft size={18} />
                    </button>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{selectedSession.title}</h2>
                        <p className="text-xs text-slate-500">{selectedSession.messageCount} msgs · {formatDate(selectedSession.createdAt)} — {formatDate(selectedSession.updatedAt)}</p>
                    </div>
                    <button onClick={() => deleteSession(selectedSession.id, { stopPropagation: () => {} } as any)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">
                        <Trash2 size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {selectedSession.messages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                                {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                            </div>
                            <div className="max-w-[80%]">
                                <div className={`text-xs px-3 py-2 rounded-xl whitespace-pre-wrap break-words text-sm leading-relaxed ${msg.role === 'user'
                                    ? 'bg-indigo-600 text-white rounded-br-none'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-bl-none'
                                }`}>
                                    {msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content}
                                </div>
                                <div className="flex items-center gap-2 mt-1 px-1">
                                    <span className="text-[10px] text-slate-400">{formatDate(msg.timestamp)}</span>
                                    {msg.metadata?.hasImage && <span className="text-[10px] text-indigo-400">📸 img</span>}
                                    {msg.metadata?.provider && <span className="text-[10px] text-slate-400">{msg.metadata.provider}</span>}
                                </div>
                                {msg.metadata?.toolCalls && msg.metadata.toolCalls.length > 0 && (
                                    <div className="mt-1 space-y-1">
                                        {msg.metadata.toolCalls.map((tc, i) => (
                                            <div key={i} className="text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded px-2 py-1 flex items-center gap-1">
                                                <Wrench size={10} />
                                                <span className="font-mono">{tc.tool}</span>
                                                {tc.duration != null && <span className="text-amber-500">({tc.duration}ms)</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {selectedSession.messages.length === 0 && (
                        <p className="text-center text-sm text-slate-400 mt-8">Nenhuma mensagem registrada.</p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white dark:bg-slate-950">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
                <MessageSquare size={20} className="text-indigo-600" />
                <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Sessões do Assistente</h1>
                <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">{sessions.length}</span>
                <div className="flex-1" />
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/30 w-44"
                    />
                </div>
                <button onClick={fetchSessions} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500" title="Atualizar">
                    <RefreshCw size={16} />
                </button>
                {sessions.length > 0 && (
                    <button onClick={deleteAllSessions} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors" title="Apagar todas as sessões">
                        <Trash2 size={16} />
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center h-40 text-sm text-slate-400">
                        <RefreshCw size={18} className="animate-spin mr-2" /> Carregando...
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                        <MessageSquare size={32} className="mb-2 opacity-30" />
                        <p className="text-sm">{searchTerm ? 'Nenhuma sessão encontrada.' : 'Nenhuma sessão registrada ainda.'}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filtered.map(session => (
                            <button
                                key={session.id}
                                onClick={() => openSession(session.id)}
                                className="group w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                            >
                                <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                                    <MessageSquare size={16} className="text-indigo-600 dark:text-indigo-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{session.title}</p>
                                    <p className="text-xs text-slate-400 truncate">{session.lastPreview || 'Sem mensagens'}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-[10px] text-slate-400">{formatDate(session.updatedAt)}</p>
                                    <p className="text-[10px] text-slate-400">{session.messageCount} msgs</p>
                                </div>
                                <button onClick={e => deleteSession(session.id, e)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Excluir sessão">
                                    <Trash2 size={14} />
                                </button>
                                <ChevronRight size={16} className="text-slate-300" />
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChatSessionsView;
