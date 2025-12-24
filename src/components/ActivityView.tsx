import React, { useMemo, useState } from 'react';
import { Activity, Users, TrendingUp, Clock, FileText, Package, Receipt, Ticket, FolderKanban, User, Filter, RefreshCw } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { useSystemLogs, useUsers } from '../hooks/dolibarr';
import { SystemLog, AppView } from '../types';
import { formatRelativeTime } from '../utils/dateUtils';

interface ActivityViewProps {
    onNavigate?: (view: AppView, id: string) => void;
}



// Helper to get action description from code
const getActionDescription = (code: string): { action: string; color: string; icon: React.ReactNode } => {
    const lowerCode = code.toLowerCase();

    if (lowerCode.includes('_validate')) return { action: 'validou', color: 'text-green-600 bg-green-50', icon: <FileText size={14} /> };
    if (lowerCode.includes('_create')) return { action: 'criou', color: 'text-blue-600 bg-blue-50', icon: <FileText size={14} /> };
    if (lowerCode.includes('_modify')) return { action: 'modificou', color: 'text-amber-600 bg-amber-50', icon: <FileText size={14} /> };
    if (lowerCode.includes('_delete')) return { action: 'deletou', color: 'text-red-600 bg-red-50', icon: <FileText size={14} /> };
    if (lowerCode.includes('_payed') || lowerCode.includes('_paid')) return { action: 'pagou', color: 'text-emerald-600 bg-emerald-50', icon: <Receipt size={14} /> };
    if (lowerCode.includes('_approve')) return { action: 'aprovou', color: 'text-indigo-600 bg-indigo-50', icon: <FileText size={14} /> };
    if (lowerCode.includes('_close')) return { action: 'fechou', color: 'text-slate-600 bg-slate-50', icon: <FileText size={14} /> };
    if (lowerCode.includes('_sentbymail')) return { action: 'enviou por email', color: 'text-sky-600 bg-sky-50', icon: <FileText size={14} /> };
    if (lowerCode.includes('ticket_msg')) return { action: 'respondeu ticket', color: 'text-purple-600 bg-purple-50', icon: <Ticket size={14} /> };

    return { action: 'atualizou', color: 'text-slate-600 bg-slate-50', icon: <Activity size={14} /> };
};

// Helper to get entity type label
const getEntityLabel = (elementtype: string | undefined): string => {
    if (!elementtype) return 'item';
    const map: Record<string, string> = {
        'facture': 'Fatura',
        'facture_fourn': 'Fatura Fornecedor',
        'propal': 'Proposta',
        'commande': 'Pedido',
        'commande_fournisseur': 'Pedido Fornecedor',
        'projet': 'Projeto',
        'ticket': 'Ticket',
        'product': 'Produto',
        'societe': 'Cliente',
        'contrat': 'Contrato',
        'expensereport': 'Despesa',
        'user': 'Usuário',
        'task': 'Tarefa',
    };
    return map[elementtype] || elementtype;
};

const ActivityView: React.FC<ActivityViewProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();
    const { data: systemLogs = [], isLoading: isLoadingLogs, refetch } = useSystemLogs(config, !!config);
    const { data: users = [] } = useUsers(config, !!config);

    const [filterUser, setFilterUser] = useState<string>('all');
    const [filterType, setFilterType] = useState<string>('all');

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
        return systemLogs
            .filter(log => {
                if (filterUser !== 'all' && log.fk_user_author !== filterUser) return false;
                if (filterType !== 'all' && log.type_code !== filterType) return false;
                return true;
            })
            .slice(0, 100); // Limit to 100 for performance
    }, [systemLogs, filterUser, filterType]);

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
            {/* Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <Activity className="text-indigo-600" /> Painel de Atividades
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {systemLogs.length.toLocaleString()} ações registradas no sistema
                        </p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        {/* User Filter */}
                        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-1.5">
                            <User size={14} className="text-slate-500" />
                            <select
                                value={filterUser}
                                onChange={(e) => setFilterUser(e.target.value)}
                                className="bg-transparent text-sm font-medium text-slate-700 dark:text-slate-300 border-none focus:ring-0 cursor-pointer"
                            >
                                <option value="all">Todos os Usuários</option>
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
                                className="bg-transparent text-sm font-medium text-slate-700 dark:text-slate-300 border-none focus:ring-0 cursor-pointer max-w-[150px]"
                            >
                                <option value="all">Todas as Ações</option>
                                {actionTypes.slice(0, 20).map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>

                        <button
                            onClick={() => refetch()}
                            disabled={isLoadingLogs}
                            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            <RefreshCw size={14} className={isLoadingLogs ? 'animate-spin' : ''} />
                            Atualizar
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Activity Feed (2 columns) */}
                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <Clock size={18} className="text-indigo-600" /> Atividades Recentes
                                </h3>
                                <span className="text-xs text-slate-400">{filteredLogs.length} itens</span>
                            </div>

                            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
                                {isLoadingLogs ? (
                                    <div className="p-8 text-center text-slate-400">
                                        <RefreshCw className="animate-spin mx-auto mb-2" />
                                        Carregando atividades...
                                    </div>
                                ) : filteredLogs.length === 0 ? (
                                    <div className="p-8 text-center text-slate-400">
                                        Nenhuma atividade encontrada
                                    </div>
                                ) : (
                                    filteredLogs.map((log) => {
                                        const { action, color, icon } = getActionDescription(log.type_code);
                                        const userName = log.fk_user_author ? userMap[log.fk_user_author] || `Usuário #${log.fk_user_author}` : 'Sistema';
                                        const entityLabel = getEntityLabel(log.elementtype);

                                        return (
                                            <div
                                                key={log.id}
                                                className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className={`p-2 rounded-lg ${color}`}>
                                                        {icon}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-slate-800 dark:text-slate-200">
                                                            <span className="font-semibold">{userName}</span>
                                                            {' '}{action}{' '}
                                                            <span className="font-medium">{entityLabel}</span>
                                                            {log.label && (
                                                                <span className="text-slate-500"> - {log.label.substring(0, 50)}{log.label.length > 50 ? '...' : ''}</span>
                                                            )}
                                                        </p>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className="text-xs text-slate-400">
                                                                {formatRelativeTime(log.date_action)}
                                                            </span>
                                                            <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">
                                                                {log.type_code}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
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
