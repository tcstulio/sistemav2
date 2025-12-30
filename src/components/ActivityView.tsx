import React, { useMemo, useState } from 'react';
import { Activity, Users, TrendingUp, Clock, FileText, Package, Receipt, Ticket, FolderKanban, User, Filter, RefreshCw, Search, Inbox, ChevronRight, Sparkles } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { useSystemLogs, useUsers } from '../hooks/dolibarr';
import { SystemLog, AppView } from '../types';
import { formatRelativeTime } from '../utils/dateUtils';
import { getEntityLink } from '../utils/navigationUtils';

interface ActivityViewProps {
    onNavigate?: (view: AppView, id: string) => void;
}



// Helper to get action description from code
const getEntityLabel = (elementtype: string | undefined): string => {
    if (!elementtype) return 'Item';
    const map: Record<string, string> = {
        'facture': 'Fatura',
        'facture_fourn': 'Fatura Fornecedor',
        'propal': 'Proposta',
        'commande': 'Pedido',
        'commande_fournisseur': 'Pedido Fornecedor',
        'projet': 'Projeto',
        'project': 'Projeto',
        'societe': 'Parceiro',
        'ticket': 'Ticket',
        'user': 'Usuário',
        'contact': 'Contato',
        'contract': 'Contrato',
        'contrat': 'Contrato',
        'shipping': 'Envio',
        'expedition': 'Expedição',
        'order_supplier': 'Pedido Compra',
        'task': 'Tarefa',
        'mrp_mo': 'Ordem Fab.',
        'fichinter': 'Intervenção'
    };
    return map[elementtype] || elementtype;
};

const getActionDescription = (log: SystemLog): { action: string; color: string; icon: React.ReactNode } => {
    const code = (log.type_code || '').toLowerCase();
    const entity = getEntityLabel(log.elementtype);

    let action = 'Atualizou';
    let color = 'text-slate-600 bg-slate-50';
    let icon = <Activity size={14} />;

    if (code.includes('_create')) {
        action = `Criou ${entity}`;
        color = 'text-blue-600 bg-blue-50';
        icon = <Sparkles size={14} />;
    } else if (code.includes('_modify')) {
        action = `Atualizou ${entity}`;
        color = 'text-amber-600 bg-amber-50';
        icon = <FileText size={14} />;
    } else if (code.includes('_validate')) {
        action = `Validou ${entity}`;
        color = 'text-green-600 bg-green-50';
        icon = <TrendingUp size={14} />;
    } else if (code.includes('_delete')) {
        action = `Removeu ${entity}`;
        color = 'text-red-600 bg-red-50';
        icon = <Activity size={14} />;
    } else if (code.includes('_close')) {
        action = `Fechou ${entity}`;
        color = 'text-slate-600 bg-slate-100';
        icon = <Package size={14} />;
    } else if (code.includes('_payed') || code.includes('_paid')) {
        action = `Pagou ${entity}`;
        color = 'text-emerald-600 bg-emerald-50';
        icon = <Receipt size={14} />;
    } else if (code.includes('_sentbymail')) {
        action = `Enviou ${entity} por Email`;
        color = 'text-purple-600 bg-purple-50';
        icon = <Inbox size={14} />;
    } else if (code.includes('ticket_msg')) {
        action = `Respondeu Ticket`;
        color = 'text-indigo-600 bg-indigo-50';
        icon = <Ticket size={14} />;
    }

    return { action, color, icon };
};

import ActivityReportModal from './ActivityReportModal';

const ActivityView: React.FC<ActivityViewProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();
    const { data: systemLogs = [], isLoading: isLoadingLogs, refetch } = useSystemLogs(config, !!config);
    const { data: users = [] } = useUsers(config, !!config);

    const [filterUser, setFilterUser] = useState<string>('all');
    const [filterType, setFilterType] = useState<string>('all');

    // New Filters
    const [searchText, setSearchText] = useState<string>('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

    // Pagination
    const [page, setPage] = useState<number>(1);
    const ITEMS_PER_PAGE = 50;
    const [visibleItems, setVisibleItems] = useState<number>(ITEMS_PER_PAGE);

    // Report Modal
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);

    // Create user map for quick lookup
    const userMap = useMemo(() => {
        const map: Record<string, string> = {};
        users.forEach(u => {
            map[u.id] = `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login;
        });
        return map;
    }, [users]);

    // Get unique action types for filter
    const actionTypes = useMemo(() => {
        const types = new Set<string>();
        systemLogs.forEach(log => {
            if (log.type_code) types.add(log.type_code);
        });
        return Array.from(types).sort();
    }, [systemLogs]);

    // Filter and sort logs
    const filteredLogs = useMemo(() => {
        let logs = systemLogs;

        // 1. User Filter
        if (filterUser !== 'all') {
            logs = logs.filter(log => log.fk_user_author === filterUser);
        }

        // 2. Type Filter
        if (filterType !== 'all') {
            logs = logs.filter(log => log.type_code === filterType);
        }

        // 3. Date Filter
        if (dateRange.start) {
            const startDate = new Date(dateRange.start).setHours(0, 0, 0, 0);
            logs = logs.filter(log => log.date_action >= startDate);
        }
        if (dateRange.end) {
            const endDate = new Date(dateRange.end).setHours(23, 59, 59, 999);
            logs = logs.filter(log => log.date_action <= endDate);
        }

        // 4. Search Filter
        if (searchText) {
            const lowerSearch = searchText.toLowerCase();
            logs = logs.filter(log => {
                const userName = log.fk_user_author ? userMap[log.fk_user_author] || '' : '';
                const typeLabel = getActionDescription(log).action;
                const entityLabel = getEntityLabel(log.elementtype);
                const label = log.label || '';

                return (
                    (userName && userName.toLowerCase().includes(lowerSearch)) ||
                    typeLabel.includes(lowerSearch) ||
                    entityLabel.toLowerCase().includes(lowerSearch) ||
                    label.toLowerCase().includes(lowerSearch) ||
                    (log.type_code && log.type_code.toLowerCase().includes(lowerSearch))
                );
            });
        }

        return logs;
    }, [systemLogs, filterUser, filterType, dateRange, searchText, userMap]);

    // Limit visible items for pagination (infinite scroll style)
    const paginatedLogs = filteredLogs.slice(0, visibleItems);

    const handleLoadMore = () => {
        setVisibleItems(prev => prev + ITEMS_PER_PAGE);
    };

    // Navigation Helper
    const handleItemClick = (log: SystemLog) => {
        if (!onNavigate) return;

        // Use utility to find target
        const link = getEntityLink(log.elementtype, log.fk_element || log.id, { socid: log.socid }); // Assuming fk_element exists or fallback to id
        // Note: SystemLog type might not have fk_element strictly typed yet in some versions, 
        // but typically 'fk_element' or 'elementid' is the ID of the target. 
        // Checking ActivityView usage previously: it didn't use ID.
        // Let's check `SystemLog` definition if possible. 
        // But passing `log.fk_element` is a good guess if it exists on the object at runtime.
        // If not, we might need to map it differently.

        if (link) {
            onNavigate(link.view, link.id);
        }
    };

    // Calculate user activity stats (last 7 days)
    const userStats = useMemo(() => {
        const now = Date.now();
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const todayStart = new Date().setHours(0, 0, 0, 0);

        const stats: Record<string, { today: number; week: number }> = {};

        systemLogs.forEach(log => {
            if (!log.fk_user_author) return;
            if (!stats[log.fk_user_author]) {
                stats[log.fk_user_author] = { today: 0, week: 0 };
            }

            if (log.date_action >= todayStart) {
                stats[log.fk_user_author].today++;
            }
            if (log.date_action >= weekAgo) {
                stats[log.fk_user_author].week++;
            }
        });

        return Object.entries(stats)
            .map(([userId, counts]) => ({
                userId,
                name: userMap[userId] || `Usuário #${userId}`,
                ...counts
            }))
            .sort((a, b) => b.week - a.week)
            .slice(0, 10);
    }, [systemLogs, userMap]);

    // Calculate action type distribution
    const actionDistribution = useMemo(() => {
        const dist: Record<string, number> = {};
        systemLogs.forEach(log => {
            const code = log.type_code || 'OTHER';
            const key = code.split('_').slice(-1)[0]; // Get last part (VALIDATE, CREATE, etc.)
            dist[key] = (dist[key] || 0) + 1;
        });

        return Object.entries(dist)
            .map(([action, count]) => ({ action, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);
    }, [systemLogs]);

    if (!config) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400">
                <p>Carregando configurações...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden">

            {/* Report Modal */}
            <ActivityReportModal
                isOpen={isReportModalOpen}
                onClose={() => setIsReportModalOpen(false)}
                logs={filteredLogs}
                dateRange={dateRange}
                userName={filterUser !== 'all' ? userMap[filterUser] : undefined}
            />

            {/* Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex flex-col gap-4">
                    <div className="flex justify-between items-start md:items-center">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                <Activity className="text-indigo-600" /> Painel de Atividades
                            </h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {filteredLogs.length} ações encontradas
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setIsReportModalOpen(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                            >
                                <Sparkles size={14} />
                                <span className="hidden sm:inline">Relatório IA</span>
                            </button>
                            <button
                                onClick={() => refetch()}
                                disabled={isLoadingLogs}
                                className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors"
                            >
                                <RefreshCw size={14} className={isLoadingLogs ? 'animate-spin' : ''} />
                                <span className="hidden sm:inline">Atualizar</span>
                            </button>
                        </div>
                    </div>

                    {/* Filters Bar */}
                    <div className="flex flex-col md:flex-row gap-3">
                        {/* Custom Search Filter */}
                        <div className="flex-1 relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search size={14} className="text-slate-400" />
                            </div>
                            <input
                                type="text"
                                value={searchText}
                                onChange={(e) => setSearchText(e.target.value)}
                                placeholder="Buscar por usuário, ação ou referência..."
                                className="w-full pl-9 pr-3 py-1.5 bg-slate-100 dark:bg-slate-800 border-none rounded-lg text-sm text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>

                        <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
                            {/* Date Filter */}
                            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-2 py-1.5 whitespace-nowrap">
                                <input
                                    type="date"
                                    value={dateRange.start}
                                    onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                                    className="bg-transparent text-xs text-slate-600 dark:text-slate-300 border-none focus:ring-0 p-0 w-24"
                                />
                                <span className="text-slate-400">-</span>
                                <input
                                    type="date"
                                    value={dateRange.end}
                                    onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                                    className="bg-transparent text-xs text-slate-600 dark:text-slate-300 border-none focus:ring-0 p-0 w-24"
                                />
                            </div>

                            {/* User Filter */}
                            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-1.5">
                                <User size={14} className="text-slate-500" />
                                <select
                                    value={filterUser}
                                    onChange={(e) => setFilterUser(e.target.value)}
                                    className="bg-transparent text-sm font-medium text-slate-700 dark:text-slate-300 border-none focus:ring-0 cursor-pointer w-24 sm:w-auto"
                                >
                                    <option value="all">Todos Users</option>
                                    {users.map(u => (
                                        <option key={u.id} value={u.id}>
                                            {u.firstname} {u.lastname}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Action Type Filter */}
                            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-1.5">
                                <Filter size={14} className="text-slate-500" />
                                <select
                                    value={filterType}
                                    onChange={(e) => setFilterType(e.target.value)}
                                    className="bg-transparent text-sm font-medium text-slate-700 dark:text-slate-300 border-none focus:ring-0 cursor-pointer w-24 sm:w-auto"
                                >
                                    <option value="all">Todas Ações</option>
                                    {actionTypes.slice(0, 20).map(type => (
                                        <option key={type} value={type}>{type}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6" id="activity-feed-container">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Activity Feed (2 columns) */}
                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <Clock size={18} className="text-indigo-600" /> Atividades Recentes
                                </h3>
                                {(searchText || dateRange.start || filterUser !== 'all' || filterType !== 'all') && (
                                    <button
                                        onClick={() => {
                                            setSearchText('');
                                            setDateRange({ start: '', end: '' });
                                            setFilterUser('all');
                                            setFilterType('all');
                                        }}
                                        className="text-xs text-indigo-600 hover:underline"
                                    >
                                        Limpar filtros
                                    </button>
                                )}
                            </div>

                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {isLoadingLogs ? (
                                    <div className="p-12 text-center text-slate-400">
                                        <RefreshCw className="animate-spin mx-auto mb-2" />
                                        Carregando atividades...
                                    </div>
                                ) : paginatedLogs.length === 0 ? (
                                    <div className="p-12 text-center text-slate-400">
                                        <div className="inline-flex p-3 bg-slate-100 dark:bg-slate-800 rounded-full mb-3">
                                            <Inbox size={24} className="text-slate-300" />
                                        </div>
                                        <p>Nenhuma atividade encontrada com os filtros atuais</p>
                                    </div>
                                ) : (
                                    <>
                                        {paginatedLogs.map((log) => {
                                            const { action, color, icon } = getActionDescription(log);
                                            const userName = log.fk_user_author ? userMap[log.fk_user_author] || `Usuário #${log.fk_user_author}` : 'Sistema';
                                            const entityLabel = getEntityLabel(log.elementtype);

                                            // Optional: Check if clicking leads anywhere (for visual feedback)
                                            // const link = getEntityLink(log.elementtype, log.fk_element);
                                            // const isClickable = !!link; 
                                            // Actually let's assume all are hoverable for consistency, passing to click handler

                                            return (
                                                <div
                                                    key={log.id}
                                                    onClick={() => handleItemClick(log)}
                                                    className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group"
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <div className={`p-2 rounded-lg ${color} shrink-0`}>
                                                            {icon}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-start justify-between">
                                                                <p className="text-sm text-slate-800 dark:text-slate-200 line-clamp-2">
                                                                    <span className="font-semibold text-slate-900 dark:text-white hover:text-indigo-600 transition-colors">
                                                                        {userName}
                                                                    </span>
                                                                    {' '}{action}{' '}
                                                                    <span className="font-medium text-slate-700 dark:text-slate-300">{entityLabel}</span>
                                                                    {log.label && (
                                                                        <span className="text-slate-500"> - {log.label}</span>
                                                                    )}
                                                                </p>
                                                                <ChevronRight size={14} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0" />
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-1.5">
                                                                <span className="text-xs text-slate-400 flex items-center gap-1" title={new Date(log.date_action).toLocaleString()}>
                                                                    <Clock size={10} />
                                                                    {formatRelativeTime(log.date_action)}
                                                                </span>
                                                                <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                                                    {log.type_code}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {/* Load More Button */}
                                        {filteredLogs.length > visibleItems && (
                                            <div className="p-3 text-center bg-slate-50 dark:bg-slate-800/20">
                                                <button
                                                    onClick={handleLoadMore}
                                                    className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:underline py-1"
                                                >
                                                    Carregar mais atividades ({filteredLogs.length - visibleItems} restantes)
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Sidebar Stats (1 column) */}
                    <div className="space-y-4">
                        {/* User Productivity */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <Users size={18} className="text-indigo-600" /> Produtividade
                                </h3>
                            </div>
                            <div className="p-4 space-y-3">
                                {userStats.length === 0 ? (
                                    <p className="text-sm text-slate-400 text-center py-4">Sem dados</p>
                                ) : (
                                    userStats.map((stat, idx) => (
                                        <div key={stat.userId} className="flex items-center gap-3">
                                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${idx < 3 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                                                {idx + 1}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                                                    {stat.name}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-indigo-600">{stat.today}</p>
                                                <p className="text-xs text-slate-400">hoje</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-slate-600">{stat.week}</p>
                                                <p className="text-xs text-slate-400">7d</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Action Distribution */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <TrendingUp size={18} className="text-indigo-600" /> Tipos de Ação
                                </h3>
                            </div>
                            <div className="p-4 space-y-2">
                                {actionDistribution.map((item) => {
                                    const maxCount = actionDistribution[0]?.count || 1;
                                    const percentage = (item.count / maxCount) * 100;

                                    return (
                                        <div key={item.action}>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">{item.action}</span>
                                                <span className="text-slate-400">{item.count.toLocaleString()}</span>
                                            </div>
                                            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all"
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ActivityView;
