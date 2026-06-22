import React, { useMemo, useState } from 'react';
import { Activity, Users, TrendingUp, Clock, FileText, Package, Receipt, Ticket, Inbox, ChevronRight, Sparkles, RefreshCw, Filter } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { useSystemLogs, useUsers, useCustomers, useProjects } from '../hooks/dolibarr';
import { SystemLog, AppView } from '../types';
import { formatRelativeTime } from '../utils/dateUtils';
import { getEntityLink, hasEntityLink } from '../utils/navigationUtils';

import ActivityReportModal from './ActivityReportModal';
import {
    PageHeader,
    Button,
    Input,
    Card,
    EmptyState,
    PageLayout,
} from './ui';

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
    let color = 'text-slate-600 bg-slate-50 dark:bg-slate-800 dark:text-slate-400';
    let icon = <Activity size={14} />;

    if (code.includes('_create')) {
        action = `Criou ${entity}`;
        color = 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400';
        icon = <Sparkles size={14} />;
    } else if (code.includes('_modify')) {
        action = `Atualizou ${entity}`;
        color = 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400';
        icon = <FileText size={14} />;
    } else if (code.includes('_validate')) {
        action = `Validou ${entity}`;
        color = 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400';
        icon = <TrendingUp size={14} />;
    } else if (code.includes('_delete')) {
        action = `Removeu ${entity}`;
        color = 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400';
        icon = <Activity size={14} />;
    } else if (code.includes('_close')) {
        action = `Fechou ${entity}`;
        color = 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300';
        icon = <Package size={14} />;
    } else if (code.includes('_payed') || code.includes('_paid')) {
        action = `Pagou ${entity}`;
        color = 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400';
        icon = <Receipt size={14} />;
    } else if (code.includes('_sentbymail')) {
        action = `Enviou ${entity} por Email`;
        color = 'text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-400';
        icon = <Inbox size={14} />;
    } else if (code.includes('ticket_msg')) {
        action = `Respondeu Ticket`;
        color = 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 dark:text-indigo-400';
        icon = <Ticket size={14} />;
    }

    return { action, color, icon };
};

const ActivityView: React.FC<ActivityViewProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();
    const { data: systemLogs = [], isLoading: isLoadingLogs, refetch } = useSystemLogs(config, !!config);
    const { data: users = [] } = useUsers(config, !!config);
    const { data: customers = [] } = useCustomers(config, !!config);
    const { data: projects = [] } = useProjects(config, !!config);

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

    // Customer map: id -> name
    const customerMap = useMemo(() => {
        const map: Record<string, string> = {};
        customers.forEach(c => { map[c.id] = c.name; });
        return map;
    }, [customers]);

    // Project map: id -> title
    const projectMap = useMemo(() => {
        const map: Record<string, string> = {};
        projects.forEach(p => { map[p.id] = p.title; });
        return map;
    }, [projects]);

    // Get unique action types for filter
    const actionTypes = useMemo(() => {
        const types = new Set<string>();
        systemLogs.forEach(log => {
            if (log.type_code && log.type_code.toUpperCase() !== 'AC_CHAT') types.add(log.type_code);
        });
        return Array.from(types).sort();
    }, [systemLogs]);

    // Filter and sort logs
    const filteredLogs = useMemo(() => {
        // Chat messages (AC_CHAT) are conversations, not system activity — keep them out of the activity feed.
        let logs = systemLogs.filter(log => log.type_code?.toUpperCase() !== 'AC_CHAT');

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
    // Only navigate when there is a real fk_element (never treat log.id as entity id).
    // Falls back to client navigation when the type has no mapping but socid is present.
    const handleItemClick = (log: SystemLog) => {
        if (!onNavigate) return;

        // If the entity type is known-mapped, require a real fk_element
        if (hasEntityLink(log.elementtype)) {
            if (log.fk_element) {
                const link = getEntityLink(log.elementtype, log.fk_element, { socid: log.socid });
                if (link) { onNavigate(link.view, link.id); }
            } else if (log.socid) {
                // Has mapped type but no fk_element -> navigate to client if available
                onNavigate('customers', log.socid);
            }
        } else if (log.socid) {
            // Unknown/unmapped type: navigate to client when possible
            onNavigate('customers', log.socid);
        }
        // Otherwise: no action (item is intentionally non-clickable)
    };

    // Determine if a log item has a navigable destination (used to control cursor/affordance)
    const isClickable = (log: SystemLog): boolean => {
        if (!onNavigate) return false;
        if (hasEntityLink(log.elementtype) && log.fk_element) return true;
        if (log.socid) return true;
        return false;
    };

    // Calculate user activity stats (last 7 days) (Refactored to be cleaner)
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
            <div className="flex items-center justify-center p-20 text-slate-400">
                <RefreshCw className="animate-spin mr-2" />
                <p>Carregando configurações...</p>
            </div>
        );
    }

    return (
        <PageLayout title="Painel de Atividades" noPadding>

            {/* Report Modal */}
            <ActivityReportModal
                isOpen={isReportModalOpen}
                onClose={() => setIsReportModalOpen(false)}
                logs={filteredLogs}
                dateRange={dateRange}
                userName={filterUser !== 'all' ? userMap[filterUser] : undefined}
            />

            {/* Header */}
            <PageHeader
                title="Painel de Atividades"
                subtitle={`${filteredLogs.length} atividades encontradas`}
                actions={
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={() => setIsReportModalOpen(true)}
                            variant="secondary"
                            icon={<Sparkles size={16} />}
                        >
                            Relatório IA
                        </Button>
                        <Button
                            onClick={() => refetch()}
                            loading={isLoadingLogs}
                            variant="primary"
                            icon={<RefreshCw size={16} />}
                        >
                            Atualizar
                        </Button>
                    </div>
                }
            />

            {/* Filter Bar */}
            <div className="px-4 md:px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row gap-4 sticky top-0 z-10 shadow-sm">
                <div className="flex-1">
                    <Input
                        placeholder="Buscar por usuário, ação ou referência..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        icon={<Filter size={16} />}
                        fullWidth
                    />
                </div>
                <div className="flex gap-2 flex-wrap">
                    <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-0.5 border border-slate-200 dark:border-slate-700 h-[42px]">
                        <span className="text-xs text-slate-500">De</span>
                        <input
                            type="date"
                            value={dateRange.start}
                            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                            className="bg-transparent text-sm text-slate-700 dark:text-slate-300 border-none focus:ring-0 p-1 w-28 h-full"
                        />
                        <span className="text-xs text-slate-500">Até</span>
                        <input
                            type="date"
                            value={dateRange.end}
                            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                            className="bg-transparent text-sm text-slate-700 dark:text-slate-300 border-none focus:ring-0 p-1 w-28 h-full"
                        />
                    </div>

                    <select
                        value={filterUser}
                        onChange={(e) => setFilterUser(e.target.value)}
                        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm px-3 focus:ring-indigo-500 focus:border-indigo-500 h-[42px] min-w-[150px]"
                    >
                        <option value="all">Todos Usuários</option>
                        {users.map(u => (
                            <option key={u.id} value={u.id}>
                                {u.firstname} {u.lastname}
                            </option>
                        ))}
                    </select>

                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm px-3 focus:ring-indigo-500 focus:border-indigo-500 h-[42px] min-w-[150px]"
                    >
                        <option value="all">Todas as Ações</option>
                        {actionTypes.slice(0, 20).map(type => (
                            <option key={type} value={type}>{type}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6" id="activity-feed-container">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Activity Feed (2 columns) */}
                    <div className="lg:col-span-2 space-y-4">
                        <Card className="min-h-[200px]" padding="none">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <Clock size={16} className="text-indigo-600" /> Atividades Recentes
                                </h3>
                                {(searchText || dateRange.start || filterUser !== 'all' || filterType !== 'all') && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setSearchText('');
                                            setDateRange({ start: '', end: '' });
                                            setFilterUser('all');
                                            setFilterType('all');
                                        }}
                                        className="!px-2 !py-0.5 text-xs h-auto"
                                    >
                                        Limpar filtros
                                    </Button>
                                )}
                            </div>

                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {isLoadingLogs ? (
                                    <div className="p-12 text-center text-slate-400">
                                        <RefreshCw className="animate-spin mx-auto mb-2" />
                                        Carregando atividades...
                                    </div>
                                ) : paginatedLogs.length === 0 ? (
                                    <EmptyState
                                        icon={Inbox}
                                        title="Nenhuma atividade encontrada"
                                        description="Tente ajustar os filtros para ver mais resultados."
                                    />
                                ) : (
                                    <>
                                        {paginatedLogs.map((log) => {
                                            const { action, color, icon } = getActionDescription(log);
                                            const userName = log.fk_user_author ? userMap[log.fk_user_author] || `Usuário #${log.fk_user_author}` : 'Sistema';
                                            const entityLabel = getEntityLabel(log.elementtype);
                                            const clickable = isClickable(log);

                                            // Context: client and/or project names for this log entry
                                            const customerName = log.socid ? (customerMap[log.socid] || `#${log.socid}`) : undefined;
                                            const projectName = log.project_id ? (projectMap[log.project_id] || `#${log.project_id}`) : undefined;

                                            return (
                                                <div
                                                    key={log.id}
                                                    onClick={clickable ? () => handleItemClick(log) : undefined}
                                                    className={`p-4 transition-colors group${clickable ? ' hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer' : ''}`}
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
                                                                {clickable && (
                                                                    <ChevronRight size={14} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0" />
                                                                )}
                                                            </div>
                                                            {/* Context chips: client and/or project */}
                                                            {(customerName || projectName) && (
                                                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                                    {customerName && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={e => {
                                                                                e.stopPropagation();
                                                                                if (onNavigate && log.socid) onNavigate('customers', log.socid);
                                                                            }}
                                                                            className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                                                                            aria-label={`Cliente: ${customerName}`}
                                                                        >
                                                                            Cliente: {customerName}
                                                                        </button>
                                                                    )}
                                                                    {projectName && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={e => {
                                                                                e.stopPropagation();
                                                                                if (onNavigate && log.project_id) onNavigate('projects', log.project_id);
                                                                            }}
                                                                            className="text-[10px] bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded border border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                                                                            aria-label={`Projeto: ${projectName}`}
                                                                        >
                                                                            Projeto: {projectName}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                            <div className="flex items-center gap-2 mt-1.5">
                                                                <span className="text-xs text-slate-400 flex items-center gap-1" title={new Date(log.date_action).toLocaleString()}>
                                                                    <Clock size={10} />
                                                                    {formatRelativeTime(log.date_action)}
                                                                </span>
                                                                <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono">
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
                                                <Button
                                                    variant="ghost"
                                                    fullWidth
                                                    onClick={handleLoadMore}
                                                    className="text-xs"
                                                >
                                                    Carregar mais atividades ({filteredLogs.length - visibleItems} restantes)
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </Card>
                    </div>

                    {/* Sidebar Stats (1 column) */}
                    <div className="space-y-4">
                        {/* User Productivity */}
                        <Card padding="none">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <Users size={16} className="text-indigo-600" /> Produtividade
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
                        </Card>

                        {/* Action Distribution */}
                        <Card padding="none">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <TrendingUp size={16} className="text-indigo-600" /> Tipos de Ação
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
                        </Card>
                    </div>
                </div>
            </div>
        </PageLayout>
    );
};

export default ActivityView;
