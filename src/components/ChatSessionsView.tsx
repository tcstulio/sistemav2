import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { MessageSquare, Trash2, RefreshCw, ChevronRight, Bot, User, Wrench, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { AiService, ChatSessionInfo } from '../services/aiService';
import { logger } from '../utils/logger';
import { useConfirm } from '../hooks/useConfirm';
import { useListControls } from '../hooks/useListControls';
import { PageLayout, PageHeader, ListToolbar, EmptyState, Spinner } from './ui';

const log = logger.child('ChatSessionsView');

interface ToolCall {
    tool: string;
    args: Record<string, unknown>;
    result?: string;
    duration?: number;
}

interface SessionMessage {
    role: 'user' | 'model' | 'system';
    content: string;
    timestamp: number;
    metadata?: {
        hasImage?: boolean;
        toolCalls?: ToolCall[];
        provider?: string;
        model?: string;
        usage?: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        };
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

// --- ExpandableContent: shows content with "ver mais" toggle ---
const ExpandableContent: React.FC<{ text: string; limit?: number }> = ({ text, limit = 500 }) => {
    const [expanded, setExpanded] = useState(false);
    if (text.length <= limit) return <span>{text}</span>;
    return (
        <span>
            {expanded ? text : text.slice(0, limit) + '…'}
            <button
                onClick={() => setExpanded(v => !v)}
                className="ml-1 text-indigo-300 hover:text-indigo-100 underline text-[11px] font-medium"
            >
                {expanded ? 'ver menos' : 'ver mais'}
            </button>
        </span>
    );
};

// --- ExpandableToolCall: shows tool args/result expandably ---
const ExpandableToolCall: React.FC<{ tool: ToolCall }> = ({ tool }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded px-2 py-1">
            <button
                onClick={() => setOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left"
            >
                <Wrench size={10} />
                <span className="font-mono">{tool.tool}</span>
                {tool.duration != null && <span className="text-amber-500">({tool.duration}ms)</span>}
                <span className="ml-auto">
                    {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </span>
            </button>
            {open && (
                <div className="mt-1 space-y-1 pl-4">
                    {tool.args && Object.keys(tool.args).length > 0 && (
                        <div>
                            <span className="font-semibold">args:</span>
                            <pre className="whitespace-pre-wrap break-all text-[9px] mt-0.5 bg-amber-100 dark:bg-amber-900/40 rounded p-1">
                                {JSON.stringify(tool.args, null, 2)}
                            </pre>
                        </div>
                    )}
                    {tool.result != null && (
                        <div>
                            <span className="font-semibold">result:</span>
                            <pre className="whitespace-pre-wrap break-all text-[9px] mt-0.5 bg-amber-100 dark:bg-amber-900/40 rounded p-1">
                                {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// --- Detail view ---
const SessionDetailView: React.FC<{
    session: SessionDetail;
    onBack: () => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
}> = ({ session, onBack, onDelete }) => (
    <div className="h-full flex flex-col bg-white dark:bg-slate-950">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
            <button
                onClick={onBack}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                aria-label="Voltar"
            >
                <ArrowLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{session.title}</h2>
                <p className="text-xs text-slate-500">
                    {session.messageCount} msgs · {formatDate(session.createdAt)} — {formatDate(session.updatedAt)}
                    {session.userId && (
                        <span className="ml-2 font-medium text-indigo-500" aria-label="Dono da sessão">
                            @{session.userId}
                        </span>
                    )}
                </p>
            </div>
            <button
                onClick={e => onDelete(session.id, e)}
                className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
                title="Excluir sessão"
            >
                <Trash2 size={16} />
            </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {session.messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        msg.role === 'user'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}>
                        {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                    </div>
                    <div className="max-w-[80%]">
                        <div className={`text-xs px-3 py-2 rounded-xl whitespace-pre-wrap break-words text-sm leading-relaxed ${
                            msg.role === 'user'
                                ? 'bg-indigo-600 text-white rounded-br-none'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-bl-none'
                        }`}>
                            <ExpandableContent text={msg.content} />
                        </div>
                        <div className="flex items-center gap-2 mt-1 px-1 flex-wrap">
                            <span className="text-[10px] text-slate-400">{formatDate(msg.timestamp)}</span>
                            {msg.metadata?.hasImage && <span className="text-[10px] text-indigo-400">📸 img</span>}
                            {msg.metadata?.provider && <span className="text-[10px] text-slate-400">{msg.metadata.provider}</span>}
                            {msg.metadata?.model && <span className="text-[10px] text-slate-400 font-mono">{msg.metadata.model}</span>}
                            {msg.metadata?.usage && (
                                <span
                                    className="text-[10px] text-emerald-600 dark:text-emerald-400"
                                    title={`prompt: ${msg.metadata.usage.promptTokens} + completion: ${msg.metadata.usage.completionTokens}`}
                                >
                                    {msg.metadata.usage.totalTokens} tokens
                                </span>
                            )}
                        </div>
                        {msg.metadata?.toolCalls && msg.metadata.toolCalls.length > 0 && (
                            <div className="mt-1 space-y-1">
                                {msg.metadata.toolCalls.map((tc, i) => (
                                    <ExpandableToolCall key={i} tool={tc} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ))}
            {session.messages.length === 0 && (
                <EmptyState
                    icon={MessageSquare}
                    title="Nenhuma mensagem registrada"
                    size="sm"
                />
            )}
        </div>
    </div>
);

// --- Main list view ---
const ChatSessionsView: React.FC = () => {
    const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
    const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isDeletingAll, setIsDeletingAll] = useState(false);
    const confirm = useConfirm();

    const fetchSessions = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await AiService.getChatSessions(100);
            setSessions(data);
        } catch (e: unknown) {
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
                const msgs: SessionMessage[] = data.messages.map((m: Record<string, unknown>) => ({
                    role: m.role as SessionMessage['role'],
                    content: String(m.content || m.text || ''),
                    timestamp: Number(m.timestamp) || Date.now(),
                    metadata: m.metadata as SessionMessage['metadata']
                }));
                const sessionInfo = sessions.find(s => s.id === id);
                setSelectedSession({
                    id,
                    userId: data.userId,
                    title: sessionInfo?.title || 'Sessão',
                    messages: msgs,
                    createdAt: sessionInfo?.createdAt || Date.now(),
                    updatedAt: sessionInfo?.updatedAt || Date.now(),
                    messageCount: msgs.length
                });
            }
        } catch (e: unknown) {
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
        setIsDeletingAll(true);
        try {
            const count = await AiService.deleteAllChatSessions();
            if (count > 0) {
                toast.success(`${count} sessão(ões) excluída(s)`);
                setSessions([]);
                setSelectedSession(null);
            } else {
                toast.info('Nenhuma sessão para excluir');
            }
        } catch (e: unknown) {
            log.error('Failed to delete all sessions', e);
            toast.error('Erro ao excluir todas as sessões');
        } finally {
            setIsDeletingAll(false);
        }
    };

    const controls = useListControls<ChatSessionInfo>(sessions, {
        searchText: (s) => `${s.title} ${s.lastPreview} ${s.userId}`,
        sorts: [
            { key: 'updatedAt', label: 'Data de atualização', get: (s) => s.updatedAt },
            { key: 'createdAt', label: 'Data de criação', get: (s) => s.createdAt },
            { key: 'messageCount', label: 'Nº de mensagens', get: (s) => s.messageCount },
            { key: 'title', label: 'Título', get: (s) => s.title },
        ],
        initialSortKey: 'updatedAt',
        initialSortDir: 'desc',
    });

    if (selectedSession) {
        return (
            <SessionDetailView
                session={selectedSession}
                onBack={() => setSelectedSession(null)}
                onDelete={deleteSession}
            />
        );
    }

    return (
        <PageLayout title="Sessões do Assistente" noPadding>
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        Sessões do Assistente
                        <span className="text-sm font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                            {sessions.length}
                        </span>
                    </span>
                }
                subtitle="Histórico de sessões do Assistente Virtual IA"
                actions={
                    <>
                        <button
                            onClick={fetchSessions}
                            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                            title="Atualizar"
                            aria-label="Atualizar lista"
                        >
                            <RefreshCw size={16} />
                        </button>
                        {sessions.length > 0 && (
                            <button
                                onClick={deleteAllSessions}
                                disabled={isDeletingAll}
                                className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Apagar todas as sessões"
                                aria-label="Apagar todas as sessões"
                                aria-busy={isDeletingAll}
                            >
                                {isDeletingAll ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            </button>
                        )}
                    </>
                }
            />

            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <ListToolbar controls={controls} searchPlaceholder="Buscar por título, preview ou usuário..." />
            </div>

            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center h-40 gap-2 text-sm text-slate-400">
                        <Spinner size="sm" />
                        Carregando...
                    </div>
                ) : controls.result.length === 0 ? (
                    <EmptyState
                        icon={MessageSquare}
                        title={controls.search ? 'Nenhuma sessão encontrada' : 'Nenhuma sessão registrada ainda'}
                        description={controls.search ? `Não há sessões correspondendo a "${controls.search}".` : 'As sessões do Assistente Virtual aparecerão aqui.'}
                        size="md"
                    />
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {controls.result.map(session => (
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
                                    {session.userId && (
                                        <p className="text-[10px] text-indigo-500 font-medium mt-0.5" aria-label="Dono da sessão">
                                            @{session.userId}
                                        </p>
                                    )}
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-[10px] text-slate-400">{formatDate(session.updatedAt)}</p>
                                    <p className="text-[10px] text-slate-400">{session.messageCount} msgs</p>
                                </div>
                                <button
                                    onClick={e => deleteSession(session.id, e)}
                                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Excluir sessão"
                                >
                                    <Trash2 size={14} />
                                </button>
                                <ChevronRight size={16} className="text-slate-300" />
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </PageLayout>
    );
};

export default ChatSessionsView;
