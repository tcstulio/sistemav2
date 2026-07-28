import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDolibarr } from '../context/DolibarrContext';
import { AppNotification, AppView } from '../types';
import { X, Bell, CheckCircle, Filter, ExternalLink } from 'lucide-react';
import { formatTime } from '../utils/dateUtils';
import { getNotificationIcon } from '../utils/notificationIcons';
import { classifyScope } from '../utils/notificationScope';
import { safeStorage } from '../utils/safeStorage';

interface NotificationPanelProps {
    isOpen: boolean;
    onClose: () => void;
    notifications: AppNotification[];
    onMarkRead: (id: string) => void;
    onNavigate: (view: AppView, id: string) => void;
    onClearAll: () => void;
    onMarkAllRead: () => void;
    onDismiss?: (id: string) => void;
}

type FilterType = 'all' | 'invoice' | 'ticket' | 'stock' | 'agent' | 'whatsapp' | 'task' | 'info';

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'invoice', label: 'Faturas' },
    { key: 'ticket', label: 'Tickets' },
    { key: 'stock', label: 'Estoque' },
    { key: 'agent', label: 'Agente' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'task', label: 'Tarefas' },
];

const NotificationPanel: React.FC<NotificationPanelProps> = ({ isOpen, onClose, notifications, onMarkRead, onNavigate, onClearAll, onMarkAllRead, onDismiss }) => {
    const navigate = useNavigate();
    const { currentUser } = useDolibarr();
    // DolibarrUser.id é string (types/common.ts) — passado direto para classifyScope
    // preservando a assinatura original userId: string | undefined (mesmo padrão de MyNotificationsView).
    const userId = currentUser?.id || currentUser?.login;
    const [activeFilter, setActiveFilter] = useState<FilterType>('all');
    const [showFilters, setShowFilters] = useState(false);

    // #1430: colapso da seção SISTEMA com persistência em localStorage.
    // Estado inicial lido de 'notif_system_collapsed' (default false = expandido).
    // Usamos safeStorage para lidar com storage indisponível (modo privado, SSR).
    const [systemCollapsed, setSystemCollapsed] = useState<boolean>(() => {
        return safeStorage.getItem('notif_system_collapsed') === 'true';
    });

    const toggleSystemCollapsed = () => {
        setSystemCollapsed(prev => {
            const next = !prev;
            safeStorage.setItem('notif_system_collapsed', String(next));
            return next;
        });
    };

    // #1429: filtro por tipo aplica ANTES da divisão por escopo (MINHAS × SISTEMA).
    // Primeiro aplicamos o filtro de tipo e ordenamos por data desc; depois o
    // particionamento por escopo é derivado via classifyScope em useMemos separados.
    const filteredNotifications = useMemo(() => {
        let result = [...notifications].sort((a, b) => b.date - a.date);
        if (activeFilter !== 'all') {
            result = result.filter(n => n.type === activeFilter);
        }
        return result;
    }, [notifications, activeFilter]);

    const personalNotifs = useMemo(
        () => filteredNotifications.filter(n => classifyScope(n, userId) === 'personal'),
        [filteredNotifications, userId]
    );
    const systemNotifs = useMemo(
        () => filteredNotifications.filter(n => classifyScope(n, userId) === 'system'),
        [filteredNotifications, userId]
    );

    const unreadCount = useMemo(
        () => notifications.filter(n => !n.read).length,
        [notifications]
    );

    if (!isOpen) return null;

    const handleVerTodas = () => {
        navigate('/notifications');
        onClose();
    };

    const hasAny = personalNotifs.length > 0 || systemNotifs.length > 0;

    const renderNotificationItem = (note: AppNotification) => (
        <div
            key={note.id}
            className={`p-3 rounded-lg border transition-all cursor-pointer ${note.read ? 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-60' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm border-l-4 border-l-indigo-500'}`}
            onClick={() => {
                onMarkRead(note.id);
                if (note.linkTo) {
                    onNavigate(note.linkTo.view, note.linkTo.id);
                    onClose();
                }
            }}
        >
            <div className="flex gap-3">
                <div className="mt-1 shrink-0">{getNotificationIcon(note.type, note.priority)}</div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-1.5">
                            <h4 className={`text-sm font-semibold ${note.read ? 'text-slate-600 dark:text-slate-400' : 'text-slate-800 dark:text-white'}`}>{note.title}</h4>
                            {note.senderName && (
                                <span className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 px-1.5 py-0.5 rounded font-medium">{note.senderName}</span>
                            )}
                        </div>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                            <span className="text-[10px] text-slate-400 whitespace-nowrap">{formatTime(note.date)}</span>
                            {onDismiss && (
                                <button
                                    aria-label="Remover notificação"
                                    onClick={(e) => { e.stopPropagation(); onDismiss(note.id); }}
                                    className="text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 p-0.5 rounded"
                                >
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{note.message}</p>

                    {!note.read && (
                        <div className="flex justify-end mt-2">
                            <button
                                aria-label={`Marcar ${note.title} como lida`}
                                title="Marcar como lida"
                                onClick={(e) => { e.stopPropagation(); onMarkRead(note.id); }}
                                className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                            >
                                <CheckCircle size={11} /> Marcar como lida
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden" onClick={onClose}></div>
            <div className="fixed top-0 right-0 z-50 h-full w-80 md:w-96 bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 transform transition-transform duration-300 ease-out animate-in slide-in-from-right">

                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur">
                    <div className="flex items-center gap-2">
                        <Bell size={18} className="text-slate-600 dark:text-slate-300" />
                        <h3 className="font-bold text-slate-800 dark:text-white">Notificações</h3>
                        {unreadCount > 0 && (
                            <span className="text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full font-bold">
                                {unreadCount}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setShowFilters(!showFilters)} className={`text-xs font-medium ${showFilters ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                            <Filter size={14} />
                        </button>
                        <button onClick={onMarkAllRead} className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium">Lidas</button>
                        <button onClick={onClearAll} className="text-xs text-slate-500 hover:text-red-600 dark:hover:text-red-400 font-medium">Limpar</button>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                    </div>
                </div>

                {showFilters && (
                    <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-1.5 bg-slate-50/50 dark:bg-slate-900/50">
                        {FILTER_OPTIONS.map(f => (
                            <button
                                key={f.key}
                                onClick={() => setActiveFilter(f.key)}
                                className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-all ${
                                    activeFilter === f.key
                                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                )}

                <div className="overflow-y-auto p-2" style={{ height: showFilters ? 'calc(100% - 140px)' : 'calc(100% - 100px)' }}>
                    {!hasAny ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-3">
                            <CheckCircle size={48} className="opacity-20" />
                            <p>{activeFilter === 'all' ? 'Tudo em dia!' : 'Nenhuma notificação deste tipo'}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* #1429: seção MINHAS sempre acima. Cabeçalho semântico (h4 com role="heading")
                                mostrando MINHAS (N). Vazio → placeholder "Tudo em dia!" inline. */}
                            <section data-scope="personal" aria-labelledby="notification-panel-personal-heading">
                                <h4
                                    id="notification-panel-personal-heading"
                                    className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 px-1 mb-1.5"
                                >
                                    MINHAS ({personalNotifs.length})
                                </h4>
                                {personalNotifs.length === 0 ? (
                                    <p className="text-xs text-slate-400 dark:text-slate-500 px-1 py-2">Tudo em dia!</p>
                                ) : (
                                    <div className="space-y-2">
                                        {personalNotifs.map(renderNotificationItem)}
                                    </div>
                                )}
                            </section>

                            {/* #1429: seção SISTEMA fica DEPOIS e só renderiza quando há itens.
                                Se systemNotifs está vazio, ocultamos totalmente (nem cabeçalho). */}
                            {systemNotifs.length > 0 && (
                                <section
                                    id="notif-system-section"
                                    data-scope="system"
                                    aria-labelledby="notification-panel-system-heading"
                                >
                                    <h4
                                        id="notification-panel-system-heading"
                                        className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 px-1 mb-1.5 flex items-center gap-2"
                                    >
                                        <span>SISTEMA ({systemNotifs.length})</span>
                                        {/* #1430: toggle colapsa SOMENTE os itens; o cabeçalho
                                            (com a contagem) permanece visível para o usuário
                                            poder expandir de novo. */}
                                        <button
                                            type="button"
                                            onClick={toggleSystemCollapsed}
                                            aria-expanded={!systemCollapsed}
                                            aria-controls="notif-system-section"
                                            className="text-[10px] font-medium normal-case text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                                        >
                                            [{systemCollapsed ? 'mostrar' : 'ocultar'}]
                                        </button>
                                    </h4>
                                    {!systemCollapsed && (
                                        <div className="space-y-2">
                                            {systemNotifs.map(renderNotificationItem)}
                                        </div>
                                    )}
                                </section>
                            )}
                        </div>
                    )}
                </div>

                {/* Rodapé: link "Ver todas" */}
                <div className="absolute bottom-0 left-0 right-0 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
                    <button
                        onClick={handleVerTodas}
                        className="w-full flex items-center justify-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                    >
                        <ExternalLink size={14} />
                        Ver todas as notificações
                    </button>
                </div>
            </div>
        </>
    );
};

export default NotificationPanel;