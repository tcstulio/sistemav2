/**
 * #531 — Página "Minhas Notificações"
 * - Abas: Minhas (scope=personal) × Sistema (scope=system)
 * - Filtro: Todas / Não-lidas / Lidas
 * - Ícone + rótulo de origem por item (via notificationIcons util)
 * - Ações: marcar como lida, marcar todas como lidas, descartar item
 */
import React, { useMemo, useState } from 'react';
import { Bell, CheckCircle, X, Clock, User, Globe } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { useNotificationActions } from '../hooks/useNotifications';
import { AppNotification } from '../types';
import { formatTime } from '../utils/dateUtils';
import { getNotificationIcon, NOTIFICATION_TYPE_LABELS } from '../utils/notificationIcons';
import { classifyScope, type NotificationScope } from '../utils/notificationScope';

type ReadFilter = 'all' | 'unread' | 'read';
type ScopeTab = NotificationScope;

interface MyNotificationsViewProps {
    config?: any;
    onNavigate?: (view: string, id?: string) => void;
    onRefresh?: (opts?: any) => Promise<void>;
}

const MyNotificationsView: React.FC<MyNotificationsViewProps> = ({ onNavigate }) => {
    const { notifications, setNotifications, currentUser } = useDolibarr();
    // DolibarrUser.id é string (types/common.ts) — passado direto para classifyScope
    // preservando a assinatura original userId: string | undefined.
    const userId = currentUser?.id || currentUser?.login;

    const doAction = useNotificationActions();

    const [activeTab, setActiveTab] = useState<ScopeTab>('personal');
    const [readFilter, setReadFilter] = useState<ReadFilter>('all');
    const [isMarkingAll, setIsMarkingAll] = useState(false);

    const personalNotifs = useMemo(
        () => notifications.filter(n => classifyScope(n, userId) === 'personal'),
        [notifications, userId]
    );

    const systemNotifs = useMemo(
        () => notifications.filter(n => classifyScope(n, userId) === 'system'),
        [notifications, userId]
    );

    const baseList = activeTab === 'personal' ? personalNotifs : systemNotifs;

    const filteredList = useMemo(() => {
        const sorted = [...baseList].sort((a, b) => b.date - a.date);
        if (readFilter === 'unread') return sorted.filter(n => !n.read);
        if (readFilter === 'read') return sorted.filter(n => n.read);
        return sorted;
    }, [baseList, readFilter]);

    const handleMarkRead = async (id: string) => {
        // Atualização otimista
        if (setNotifications) {
            setNotifications((prev: AppNotification[]) =>
                prev.map(n => n.id === id ? { ...n, read: true } : n)
            );
        }
        await doAction('markRead', id);
    };

    const handleDismiss = async (id: string) => {
        // Atualização otimista
        if (setNotifications) {
            setNotifications((prev: AppNotification[]) => prev.filter(n => n.id !== id));
        }
        await doAction('dismiss', id);
    };

    const handleMarkAllRead = async () => {
        if (isMarkingAll) return;
        setIsMarkingAll(true);
        try {
            if (setNotifications) {
                setNotifications((prev: AppNotification[]) => prev.map(n => ({ ...n, read: true })));
            }
            await doAction('markAllRead');
        } finally {
            setIsMarkingAll(false);
        }
    };

    const unreadPersonal = personalNotifs.filter(n => !n.read).length;
    const unreadSystem = systemNotifs.filter(n => !n.read).length;

    const emptyMessage = () => {
        if (readFilter === 'unread') return 'Nenhuma notificação não-lida aqui.';
        if (readFilter === 'read') return 'Nenhuma notificação lida aqui.';
        return activeTab === 'personal'
            ? 'Você não tem notificações pessoais.'
            : 'Sem notificações de sistema.';
    };

    return (
        <div className="max-w-3xl mx-auto px-4 py-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Bell size={22} className="text-indigo-600 dark:text-indigo-400" />
                    <h1 className="text-xl font-bold text-slate-800 dark:text-white">Minhas Notificações</h1>
                </div>
                <button
                    onClick={handleMarkAllRead}
                    disabled={isMarkingAll}
                    className="text-sm text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isMarkingAll ? 'Marcando...' : 'Marcar todas como lidas'}
                </button>
            </div>

            {/* Abas: Minhas × Sistema */}
            <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-700">
                <button
                    onClick={() => setActiveTab('personal')}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'personal'
                            ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <User size={15} />
                    Minhas
                    {unreadPersonal > 0 && (
                        <span className="text-[10px] bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded-full font-bold">
                            {unreadPersonal}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('system')}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'system'
                            ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <Globe size={15} />
                    Sistema
                    {unreadSystem > 0 && (
                        <span className="text-[10px] bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded-full font-bold">
                            {unreadSystem}
                        </span>
                    )}
                </button>
            </div>

            {/* Filtro lido/não-lido */}
            <div className="flex gap-2 mb-5">
                {(['all', 'unread', 'read'] as ReadFilter[]).map(f => {
                    const labels: Record<ReadFilter, string> = { all: 'Todas', unread: 'Não-lidas', read: 'Lidas' };
                    return (
                        <button
                            key={f}
                            onClick={() => setReadFilter(f)}
                            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                                readFilter === f
                                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            {labels[f]}
                        </button>
                    );
                })}
            </div>

            {/* Lista de notificações */}
            {filteredList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
                    <CheckCircle size={48} className="opacity-20" />
                    <p className="text-sm">{emptyMessage()}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredList.map(note => (
                        <div
                            key={note.id}
                            className={`p-4 rounded-xl border transition-all ${
                                note.read
                                    ? 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-70'
                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm border-l-4 border-l-indigo-500'
                            }`}
                        >
                            <div className="flex gap-3">
                                <div className="mt-0.5 shrink-0">
                                    {getNotificationIcon(note.type, note.priority)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                                            <h4 className={`text-sm font-semibold truncate ${note.read ? 'text-slate-600 dark:text-slate-400' : 'text-slate-800 dark:text-white'}`}>
                                                {note.title}
                                            </h4>
                                            {/* Origem/fonte */}
                                            <span className="text-[10px] bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400 px-1.5 py-0.5 rounded font-medium shrink-0">
                                                {NOTIFICATION_TYPE_LABELS[note.type] || note.type}
                                            </span>
                                            {note.senderName && (
                                                <span className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 px-1.5 py-0.5 rounded font-medium shrink-0">
                                                    {note.senderName}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <span className="text-[10px] text-slate-400 whitespace-nowrap">{formatTime(note.date)}</span>
                                            {!note.read && (
                                                <button
                                                    aria-label="Marcar como lida"
                                                    title="Marcar como lida"
                                                    onClick={() => handleMarkRead(note.id)}
                                                    className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 p-0.5 rounded"
                                                >
                                                    <Clock size={13} />
                                                </button>
                                            )}
                                            <button
                                                aria-label="Remover notificação"
                                                title="Remover"
                                                onClick={() => handleDismiss(note.id)}
                                                className="text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 p-0.5 rounded"
                                            >
                                                <X size={13} />
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-3">{note.message}</p>
                                    {note.linkTo && onNavigate && (
                                        <button
                                            onClick={() => {
                                                handleMarkRead(note.id);
                                                onNavigate(note.linkTo!.view, note.linkTo!.id);
                                            }}
                                            className="mt-2 text-[11px] text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium"
                                        >
                                            Ver detalhes →
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MyNotificationsView;
