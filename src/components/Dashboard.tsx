
import React, { useState, useMemo, useEffect } from 'react';
import { AppView } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { useInvoices, useSupplierInvoices, useTasks, useProducts, useBankAccounts, useInterventions, useTickets, useBankLines, useProjects, useCustomers } from '../hooks/dolibarr';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from 'recharts';
import { DollarSign, Users, FileText, TrendingUp, Sparkles, Loader2, Minus, FolderKanban, AlertOctagon, Clock, Package, Landmark, ClipboardList, Wrench, Ticket as TicketIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { AiService } from '../services/aiService';
import { FinancialHealthWidget } from './Finance/FinancialHealthWidget';
import { getDashboardArtifacts, saveSalesForecast } from '../services/dashboardArtifacts';
import { formatDateOnly, formatDateTime } from '../utils/dateUtils';
import { logger } from '../utils/logger';
import { useOrgBranding } from '../hooks/useOrgBranding';
import { applyOrderVisibility, getUserPrefs, OrderVisibilityPrefs } from '../utils/orderVisibility';
import { buildCashFlowBuckets } from '../utils/cashFlowBuckets';
import { DASHBOARD_WIDGETS } from '../config/dashboardWidgets';
import { AgentActivityFeed } from './Agent/AgentActivityFeed';
import { resolveScreenAccess } from '../utils/screenPermissions';

const DASHBOARD_PREFS_KEY = 'coolgroove_dashboard_prefs';

const log = logger.child('Dashboard');

interface DashboardProps {
    onNavigate?: (view: AppView, id: string) => void;
}

interface ForecastData {
    forecast: Array<{
        month: string;
        predicted_revenue: number;
        confidence: string;
    }>;
    summary: string;
    trend: 'up' | 'down' | 'stable';
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
    const { config, canAccess, previewTarget, orgScreenPerms, userGroupIds } = useDolibarr();
    const currentUser = config?.currentUser;
    // admin pode vir como número 1, string "1" ou boolean (Dolibarr/refresh gravam cru em config.currentUser).
    // O `=== 1` estrito tratava admins reais (admin:"1") como não-admin e ESCONDIA os widgets financeiros (#535).
    const isAdmin = !previewTarget && (currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true);

    // canSeeWidget: combines existing screen-based canAccess guard + a widget-level override
    // via synthetic key `dashboard:<widgetId>`. Admin sees all; group/user overrides respected (#541).
    // Financial widgets have a secure default (base=false for non-admin); others default to visible (base=true).
    const FINANCIAL_WIDGETS = new Set(['kpis', 'cashflow', 'cashflow-forecast', 'financial-health', 'sales-forecast']);
    const canSeeWidget = (widgetId: string): boolean => {
        if (isAdmin) return true;
        const base = !FINANCIAL_WIDGETS.has(widgetId); // non-financial default visible; financial default hidden
        const effectiveUserId = previewTarget?.type === 'user' ? previewTarget.id : currentUser?.id;
        const effectiveGroupIds = previewTarget ? previewTarget.groupIds : userGroupIds;
        return resolveScreenAccess({
            screenId: `dashboard:${widgetId}`,
            base,
            isAdmin: false,
            userId: effectiveUserId,
            groupIds: effectiveGroupIds,
            perms: orgScreenPerms,
        });
    };

    // #111 — ordem + visibilidade dos widgets (admin define o padrão da org; usuário personaliza localmente).
    const orgBranding = useOrgBranding();
    const orgPrefs = orgBranding?.dashboard;
    const [userPrefs, setUserPrefsState] = useState<OrderVisibilityPrefs>(() => getUserPrefs(DASHBOARD_PREFS_KEY));
    useEffect(() => {
        const onPrefsChanged = () => setUserPrefsState(getUserPrefs(DASHBOARD_PREFS_KEY));
        window.addEventListener('dashboard-prefs-changed', onPrefsChanged);
        return () => window.removeEventListener('dashboard-prefs-changed', onPrefsChanged);
    }, []);

    // Data Hooks
    const { data: invoicesData } = useInvoices(config);
    const invoices = invoicesData || [];
    const { data: supplierInvoicesData } = useSupplierInvoices(config);
    const supplierInvoices = supplierInvoicesData || [];
    const { data: tasksData } = useTasks(config);
    const tasks = tasksData || [];
    const { data: productsData } = useProducts(config);
    const products = productsData || [];
    const { data: bankAccountsData } = useBankAccounts(config);
    const bankAccounts = bankAccountsData || [];
    const { data: bankLinesData } = useBankLines(config);
    const bankLines = bankLinesData || [];
    const { data: interventionsData } = useInterventions(config);
    const interventions = interventionsData || [];
    const { data: ticketsData } = useTickets(config);
    const tickets = ticketsData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];

    const [forecast, setForecast] = useState<ForecastData | null>(null);
    const [forecastError, setForecastError] = useState<string | null>(null);
    const [loadingForecast, setLoadingForecast] = useState(false);
    const [cashFlowMonths, setCashFlowMonths] = useState(12);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-slate-800 text-white p-3 rounded-lg shadow-lg border border-slate-700 text-sm">
                    <p className="font-bold mb-2">{label}</p>
                    {payload.map((entry: any) => (
                        <p key={entry.dataKey ?? entry.name} className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                            <span className="opacity-70">{entry.name}:</span>
                            <span className="font-mono font-medium">{formatCurrency(entry.value)}</span>
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };
    const metrics = useMemo(() => {
        // Calculate based on REAL bank movements
        const totalRevenue = bankLines.filter(l => l.amount > 0).reduce((acc, curr) => acc + curr.amount, 0);
        const totalExpense = Math.abs(bankLines.filter(l => l.amount < 0).reduce((acc, curr) => acc + curr.amount, 0));
        const totalCash = bankAccounts.reduce((acc, curr) => acc + (curr.solde || 0), 0);

        const unpaidInvoices = invoices.filter(i => i.statut === '1').length
            + supplierInvoices.filter(i => i.statut === '1').length;

        return { totalRevenue, totalExpense, totalCash, unpaidInvoices };
    }, [invoices, supplierInvoices, bankAccounts, bankLines]);

    const cashFlowData = useMemo(
        () => buildCashFlowBuckets(bankLines, cashFlowMonths, new Date(), metrics.totalCash),
        [bankLines, cashFlowMonths, metrics.totalCash]
    );

    const recentActivityData = useMemo(() => {
        return invoices.slice(0, 5).map(inv => ({
            name: inv.ref,
            amount: inv.total_ttc,
            status: inv.statut === '2' ? 'Pago' : 'Pendente',
            id: inv.id // for navigation
        }));
    }, [invoices]);

    const lowStockItems = useMemo(() => {
        return products.filter(p => (p.stock_reel || 0) < (5)).slice(0, 5);
    }, [products]);

    const lateTasks = useMemo(() => {
        return tasks.filter(t => t.date_end && new Date(t.date_end < 100000000000 ? t.date_end * 1000 : t.date_end) < new Date() && t.progress < 100).slice(0, 5);
    }, [tasks]);

    const cashFlowForecast = useMemo(() => {
        const forecastDays = 90;
        const days = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Initial Balance
        let currentBalance = bankAccounts.reduce((acc, curr) => acc + Number(curr.solde || 0), 0);

        // Map of date string -> { inflow, outflow }
        const transactions = new Map<string, { inflow: number; outflow: number }>();

        // Helper to get date key YYYY-MM-DD
        const getDateKey = (date: Date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        // Populate Inflows (Customer Invoices)
        invoices.forEach(inv => {
            if (inv.statut === '1' && Number(inv.total_ttc) > 0) { // Unpaid
                const dateVal = inv.date_lim_reglement || (inv.date + 30 * 24 * 60 * 60);
                const timestamp = dateVal < 100000000000 ? dateVal * 1000 : dateVal;
                const dueDate = new Date(timestamp);
                dueDate.setHours(0, 0, 0, 0);

                if (dueDate >= today) {
                    const key = getDateKey(dueDate);
                    const curr = transactions.get(key) || { inflow: 0, outflow: 0 };
                    curr.inflow += Number(inv.total_ttc);
                    transactions.set(key, curr);
                }
            }
        });

        // Populate Outflows (Supplier Invoices)
        supplierInvoices.forEach(inv => {
            if (inv.statut === '1' && Number(inv.total_ttc) > 0) {
                const dateVal = inv.date_lim_reglement || (inv.date + 30 * 24 * 60 * 60);
                const timestamp = dateVal < 100000000000 ? dateVal * 1000 : dateVal;
                const dueDate = new Date(timestamp);
                dueDate.setHours(0, 0, 0, 0);

                if (dueDate >= today) {
                    const key = getDateKey(dueDate);
                    const curr = transactions.get(key) || { inflow: 0, outflow: 0 };
                    curr.outflow += Number(inv.total_ttc);
                    transactions.set(key, curr);
                }
            }
        });

        // Generate daily forecast
        for (let i = 0; i <= forecastDays; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            const key = getDateKey(d);
            const dayTrans = transactions.get(key) || { inflow: 0, outflow: 0 };

            // Update balance
            currentBalance += dayTrans.inflow - dayTrans.outflow;

            days.push({
                date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                fullDate: key,
                balance: currentBalance,
                inflow: dayTrans.inflow,
                outflow: dayTrans.outflow
            });
        }

        return days;
    }, [invoices, supplierInvoices, bankAccounts]);

    // My Assignments
    const myAssignments = useMemo(() => {
        if (!config?.currentUser?.id) return { tasks: [], interventions: [], tickets: [] };
        const uid = String(config.currentUser.id);

        return {
            tasks: canAccess('tasks') ? tasks.filter(t =>
                String(t.fk_user_assign) === uid &&
                t.progress < 100
            ).slice(0, 5) : [],
            interventions: canAccess('interventions') ? interventions.filter(i => String(i.fk_user_author) === uid && i.statut !== '2') : [],
            tickets: canAccess('tickets') ? tickets.filter(t => String(t.fk_user_assign) === uid && t.statut !== '8' && t.statut !== 'CLOSED') : []
        };
    }, [tasks, interventions, tickets, config, canAccess]);

    // #599 — lookup maps para projeto/cliente sem N+1
    const projectMap = useMemo(() => new Map(projects.map(p => [String(p.id), p.title])), [projects]);
    const customerMap = useMemo(() => new Map(customers.map(c => [String(c.id), c.name])), [customers]);

    // Prepare Financial Context for AI
    const financialContext = useMemo(() => {
        return {
            period: formatDateOnly(Date.now()),
            metrics,
            cashFlowTrend: cashFlowData,
            recentInvoices: recentActivityData,
            unpaidCount: metrics.unpaidInvoices,
            totalCash: metrics.totalCash
        };
    }, [metrics, cashFlowData, recentActivityData]);

    // Carrega a previsão de vendas já gerada (org-wide) — fica pra todos até alguém regerar (#124).
    useEffect(() => {
        getDashboardArtifacts().then((a) => {
            if (a?.salesForecast?.value) setForecast(a.salesForecast.value);
        });
    }, []);

    const handleGenerateForecast = async () => {
        // #908: sem faturas carregadas (ex.: login novo antes do sync do IndexedDB no mobile)
        // → não chamamos a IA; damos feedback claro em vez do genérico "dados insuficientes".
        if (!invoices || invoices.length === 0) {
            log.warn('Forecast abortado: nenhuma fatura carregada', { invoices: invoices?.length ?? 0 });
            setForecastError('Sem faturas carregadas ainda. Aguarde a sincronização e tente novamente.');
            return;
        }
        setLoadingForecast(true);
        setForecastError(null);
        try {
            const result = await AiService.generateSalesForecast(invoices);
            if (result) {
                const parsed = JSON.parse(result);
                // Empty forecast array means IA not configured or no data
                if (!parsed.forecast || parsed.forecast.length === 0) {
                    setForecastError(parsed.summary || 'Não há faturas suficientes no período para gerar a previsão.');
                } else {
                    setForecast(parsed);
                    void saveSalesForecast(parsed); // persiste pra todos (org-wide)
                }
            } else {
                setForecastError('Não foi possível gerar a previsão. Verifique se a IA está configurada.');
            }
        } catch (e: any) {
            log.error("Failed to generate forecast", e);
            // #908: distingue timeout (geração lenta / conexão instável) de erro genérico.
            setForecastError(e?.isTimeout
                ? 'A previsão demorou mais que o normal. Tente novamente em uma conexão mais estável.'
                : 'Erro ao gerar previsão de vendas. Tente novamente.');
        } finally {
            setLoadingForecast(false);
        }
    };

    // #111 — cada widget de topo vira um nó identificado por id; a ordem/visibilidade
    // é aplicada por região (full/main/sidebar) preservando o grid responsivo.
    // Cada nó mantém seu próprio guard de permissão (canAccess) e pode renderizar null.
    const widgetNodes: Record<string, React.ReactNode> = {
        kpis: (
            <div key="kpis" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                {canAccess('invoices') && (
                    <Card
                        title="Receita Total"
                        value={formatCurrency(metrics.totalRevenue)}
                        icon={DollarSign}
                        color="bg-emerald-500"
                        onClick={() => onNavigate && onNavigate('invoices', '')}
                    />
                )}
                {canAccess('supplier_invoices') && (
                    <Card
                        title="Despesas"
                        value={formatCurrency(metrics.totalExpense)}
                        icon={TrendingUp}
                        color="bg-red-500"
                        subValue={`Líquido: ${formatCurrency(metrics.totalRevenue - metrics.totalExpense)}`}
                        onClick={() => onNavigate && onNavigate('supplier_invoices', '')}
                    />
                )}
                {canAccess('bank_accounts') && (
                    <Card
                        title="Saldo em Caixa"
                        value={formatCurrency(metrics.totalCash)}
                        icon={Landmark}
                        color="bg-indigo-500"
                        onClick={() => onNavigate && onNavigate('bank_accounts', '')}
                    />
                )}
                {(canAccess('invoices') || canAccess('supplier_invoices')) && (
                    <Card
                        title="Pagamentos Pendentes"
                        value={metrics.unpaidInvoices}
                        icon={Users}
                        color="bg-orange-500"
                        onClick={() => onNavigate && onNavigate('pending_payments', '')}
                    />
                )}
            </div>
        ),

        // ----- Coluna principal (gráficos / análise) -----

        'cashflow': (
            <React.Fragment key="cashflow">
                {/* Cash Flow Chart */}
                {canAccess('bank_accounts') && (
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col transition-colors min-w-0">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Fluxo de Caixa — últimos {cashFlowMonths} meses</h3>
                                <div className="flex gap-1">
                                    {[6, 12, 24].map(m => (
                                        <button
                                            key={m}
                                            onClick={() => setCashFlowMonths(m)}
                                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                                cashFlowMonths === m
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                                            }`}
                                        >
                                            {m} meses
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="w-full h-[300px] min-w-0" style={{ width: '100%', height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                                    <AreaChart data={cashFlowData}>
                                        <defs>
                                            <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorCashBalance" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.6} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.2} />
                                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} dy={10} />
                                        <YAxis
                                            width={60}
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#94a3b8', fontSize: 12 }}
                                            tickFormatter={(value) => new Intl.NumberFormat('pt-BR', { notation: 'compact', compactDisplay: 'short', style: 'currency', currency: 'BRL' }).format(value)}
                                        />
                                        <Tooltip content={<CustomTooltip />} />
                                        {/* Saldo em Caixa derivado do saldo atual regredido pelos fluxos mensais (#535) */}
                                        <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2} strokeDasharray="4 2" fillOpacity={1} fill="url(#colorCashBalance)" name="Saldo em Caixa" />
                                        <Area type="monotone" dataKey="income" stroke="#10b981" fillOpacity={1} fill="url(#colorIncome)" name="Receita" />
                                        <Area type="monotone" dataKey="expense" stroke="#ef4444" fillOpacity={1} fill="url(#colorExpense)" name="Despesas" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
            </React.Fragment>
        ),

        'cashflow-forecast': (
            <React.Fragment key="cashflow-forecast">
                {/* Cash Flow Forecast Chart - 90 Days */}
                {(canAccess('invoices') || canAccess('supplier_invoices')) && (
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col transition-colors min-w-0">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-6">Projeção de Fluxo de Caixa (90 dias)</h3>
                            <div className="w-full h-[250px] min-w-0" style={{ width: '100%', height: 250 }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                                    <AreaChart data={cashFlowForecast}>
                                        <defs>
                                            <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.2} />
                                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} interval={6} dy={10} />
                                        <YAxis
                                            width={60}
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#94a3b8', fontSize: 12 }}
                                            tickFormatter={(value) => new Intl.NumberFormat('pt-BR', { notation: 'compact', compactDisplay: 'short', style: 'currency', currency: 'BRL' }).format(value)}
                                        />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Area type="monotone" dataKey="balance" stroke="#3b82f6" fillOpacity={1} fill="url(#colorBalance)" name="Saldo Previsto" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
            </React.Fragment>
        ),

        // Análise Financeira IA — reposicionada para depois da Projeção de Fluxo (#124)
        'financial-health': (canAccess('invoices') || canAccess('bank_accounts')) ? (
            <FinancialHealthWidget key="financial-health" data={financialContext} />
        ) : null,

        // ----- Coluna lateral -----

        'my-pending': (
            <React.Fragment key="my-pending">
                {/* My Pending Items Widget */}
                {(myAssignments.tasks.length > 0 || myAssignments.interventions.length > 0 || myAssignments.tickets.length > 0) && (
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 transition-colors">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <ClipboardList size={18} className="text-orange-500" /> Minhas Pendências
                            </h3>
                            <div className="space-y-3">
                                {myAssignments.tasks.map(task => {
                                    const taskProjectTitle = task.project_title || task.project_ref || (task.project_id ? projectMap.get(String(task.project_id)) : undefined);
                                    return (
                                        <div key={task.id} className="p-3 bg-violet-50 dark:bg-violet-900/10 rounded-lg border border-violet-100 dark:border-violet-800 cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-900/20" onClick={() => onNavigate && onNavigate('tasks', task.id)}>
                                            <div className="flex justify-between items-start">
                                                <span className="text-xs font-bold text-violet-700 dark:text-violet-400 flex items-center gap-1"><FolderKanban size={10} /> {task.ref}</span>
                                                <span className="text-[10px] text-slate-500">{task.progress}%</span>
                                            </div>
                                            <div className="text-sm font-medium text-slate-800 dark:text-white mt-1 line-clamp-1">{task.label}</div>
                                            <div className="mt-1">
                                                {task.project_id ? (
                                                    <span
                                                        role="link"
                                                        tabIndex={0}
                                                        className="text-[10px] text-violet-600 dark:text-violet-400 truncate max-w-full inline-block cursor-pointer hover:underline"
                                                        onClick={(e) => { e.stopPropagation(); onNavigate && onNavigate('projects', task.project_id); }}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onNavigate && onNavigate('projects', task.project_id); } }}
                                                    >
                                                        {taskProjectTitle ?? 'Sem projeto'}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-slate-400 dark:text-slate-500">Sem projeto</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {myAssignments.interventions.map(i => (
                                    <div key={i.id} className="p-3 bg-orange-50 dark:bg-orange-900/10 rounded-lg border border-orange-100 dark:border-orange-800 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/20" onClick={() => onNavigate && onNavigate('interventions', i.id)}>
                                        <div className="flex justify-between items-start">
                                            <span className="text-xs font-bold text-orange-700 dark:text-orange-400 flex items-center gap-1"><Wrench size={10} /> {i.ref}</span>
                                            <span className="text-[10px] text-slate-500">{formatDateOnly(i.date)}</span>
                                        </div>
                                        <div className="text-sm font-medium text-slate-800 dark:text-white mt-1 line-clamp-1">{i.description || 'Intervenção'}</div>
                                        <div className="flex gap-2 mt-1 flex-wrap">
                                            <span className="text-[10px] text-orange-600 dark:text-orange-400 truncate max-w-[45%]">{i.project_id ? projectMap.get(String(i.project_id)) ?? 'Sem projeto' : 'Sem projeto'}</span>
                                            <span className="text-[10px] text-slate-500 truncate max-w-[45%]">{i.socid ? customerMap.get(String(i.socid)) ?? 'Sem cliente' : 'Sem cliente'}</span>
                                        </div>
                                    </div>
                                ))}
                                {myAssignments.tickets.map(t => (
                                    <div key={t.id} className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-800 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/20" onClick={() => onNavigate && onNavigate('tickets', t.id)}>
                                        <div className="flex justify-between items-start">
                                            <span className="text-xs font-bold text-blue-700 dark:text-blue-400 flex items-center gap-1"><TicketIcon size={10} /> {t.ref}</span>
                                            <span className="text-[10px] text-slate-500">{formatDateTime(t.datec)}</span>
                                        </div>
                                        <div className="text-sm font-medium text-slate-800 dark:text-white mt-1 line-clamp-1">{t.subject}</div>
                                        <div className="flex gap-2 mt-1 flex-wrap">
                                            <span className="text-[10px] text-blue-600 dark:text-blue-400 truncate max-w-[45%]">{t.project_id ? projectMap.get(String(t.project_id)) ?? 'Sem projeto' : 'Sem projeto'}</span>
                                            <span className="text-[10px] text-slate-500 truncate max-w-[45%]">{t.socid ? customerMap.get(String(t.socid)) ?? 'Sem cliente' : 'Sem cliente'}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
            </React.Fragment>
        ),

        'sales-forecast': (
            <React.Fragment key="sales-forecast">
                {/* Sales Forecast Widget */}
                {canAccess('invoices') && (
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 relative overflow-hidden transition-colors">
                            <div className="absolute top-0 right-0 p-3 opacity-10">
                                <TrendingUp size={100} className="text-indigo-600 dark:text-indigo-400" />
                            </div>

                            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2 relative z-10">
                                <Sparkles size={18} className="text-violet-500" /> Previsão de Vendas
                            </h3>

                            {!forecast ? (
                                <div className="text-center py-6 relative z-10">
                                    {forecastError ? (
                                        <p className="text-sm text-amber-600 dark:text-amber-400 mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">{forecastError}</p>
                                    ) : (
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Preveja a receita do próximo mês usando análise de IA.</p>
                                    )}
                                    <button
                                        onClick={handleGenerateForecast}
                                        disabled={loadingForecast}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mx-auto shadow-md shadow-indigo-200 dark:shadow-none"
                                    >
                                        {loadingForecast ? <Loader2 className="animate-spin" size={16} /> : <TrendingUp size={16} />}
                                        Gerar Previsão
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4 relative z-10 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-slate-500 dark:text-slate-400">Receita Projetada ({forecast.forecast[0]?.month})</span>
                                        <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${forecast.trend === 'up' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                            forecast.trend === 'down' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                            }`}>
                                            tendência {forecast.trend}
                                        </span>
                                    </div>
                                    <div className="flex items-end gap-2">
                                        <span className="text-3xl font-bold text-slate-800 dark:text-white">
                                            {formatCurrency(forecast.forecast[0]?.predicted_revenue || 0)}
                                        </span>
                                        <span className="mb-1 text-slate-400 text-sm">/ próximo mês</span>
                                    </div>
                                    <div className={`p-3 rounded-lg text-sm border ${forecast.trend === 'up' ? 'bg-green-50 border-green-100 text-green-800 dark:bg-green-900/20 dark:border-green-900/30 dark:text-green-300' :
                                        forecast.trend === 'down' ? 'bg-red-50 border-red-100 text-red-800 dark:bg-red-900/20 dark:border-red-900/30 dark:text-red-300' :
                                            'bg-slate-50 border-slate-100 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                                        }`}>
                                        <div className="flex items-start gap-2">
                                            {forecast.trend === 'up' ? <ArrowUpRight size={16} className="mt-0.5" /> :
                                                forecast.trend === 'down' ? <ArrowDownRight size={16} className="mt-0.5" /> :
                                                    <Minus size={16} className="mt-0.5" />}
                                            {forecast.summary}
                                        </div>

                                        {/* Mini table for next 3 months */}
                                        {forecast.forecast.length > 0 && (
                                            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 grid grid-cols-3 gap-2">
                                                {forecast.forecast.map((f, i) => (
                                                    <div key={i} className={`text-center ${i === 0 ? 'bg-indigo-50 dark:bg-indigo-900/20 rounded py-1 border border-indigo-100 dark:border-indigo-800' : ''}`}>
                                                        <div className="text-[10px] uppercase text-slate-500">{f.month.split(' ')[0]} {i === 0 ? '(Atual)' : ''}</div>
                                                        <div className={`text-xs font-bold ${i === 0 ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'}`}>
                                                            {formatCurrency(f.predicted_revenue)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="mt-2 text-xs text-center text-slate-400">
                                        * Mês atual ({forecast.forecast[0]?.month}) exibe previsão de fechamento (Realizado + Tendência).
                                    </div>

                                    <button
                                        onClick={() => setForecast(null)}
                                        className="text-xs text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 underline"
                                    >
                                        Resetar Previsão
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
            </React.Fragment>
        ),

        'operational-alerts': (
            <React.Fragment key="operational-alerts">
                {/* Operational Alerts / Late Tasks / Low Stock */}
                {((lateTasks.length > 0 && canAccess('tasks')) || (lowStockItems.length > 0 && canAccess('products'))) && (
                        <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-xl shadow-sm border border-red-100 dark:border-red-900/30 transition-colors animate-in fade-in">
                            <h3 className="text-lg font-bold text-red-800 dark:text-red-300 mb-4 flex items-center gap-2">
                                <AlertOctagon size={18} /> Alertas Operacionais
                            </h3>

                            <div className="space-y-4">
                                {(lateTasks.length > 0 && canAccess('tasks')) && (
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wide">TAREFAS ATRASADAS</h4>
                                        {lateTasks.map(task => (
                                            <div
                                                key={task.id}
                                                className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-red-100 dark:border-red-900/30 shadow-sm cursor-pointer hover:shadow-md transition-all"
                                                onClick={() => onNavigate && onNavigate('tasks', task.id)}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="font-medium text-slate-800 dark:text-white text-sm line-clamp-1">{task.label}</div>
                                                    <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Atrasado</span>
                                                </div>
                                                <div className="flex items-center gap-2 mt-1 text-xs text-red-500">
                                                    <Clock size={12} /> Prazo: {formatDateOnly(task.date_end)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {(lowStockItems.length > 0 && canAccess('products')) && (
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-orange-700 dark:text-orange-400 uppercase tracking-wide">ESTOQUE BAIXO</h4>
                                        {lowStockItems.map(prod => (
                                            <div
                                                key={prod.id}
                                                className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-orange-100 dark:border-orange-900/30 shadow-sm cursor-pointer hover:shadow-md transition-all"
                                                onClick={() => onNavigate && onNavigate('products', prod.id)}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="font-medium text-slate-800 dark:text-white text-sm line-clamp-1 flex items-center gap-2">
                                                        <Package size={14} className="text-orange-500" /> {prod.label}
                                                    </div>
                                                    <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">{prod.stock_reel} rest.</span>
                                                </div>
                                                <div className="text-xs text-slate-500 mt-1">Ref: {prod.ref}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
            </React.Fragment>
        ),

        'agent-activity': (
            <AgentActivityFeed key="agent-activity" />
        ),
    };

    // Ordena/filtra os widgets de cada região respeitando o padrão da org + override do usuário.
    // canSeeWidget gate is applied AFTER ordering so group-hidden widgets never render,
    // even if local user prefs mark them visible (#541).
    const orderedRegion = (region: 'full' | 'main' | 'sidebar') =>
        applyOrderVisibility(
            DASHBOARD_WIDGETS.filter((w) => w.region === region),
            (w) => w.id,
            orgPrefs,
            userPrefs,
        )
        .filter((w) => canSeeWidget(w.id))
        .map((w) => <React.Fragment key={w.id}>{widgetNodes[w.id]}</React.Fragment>);

    return (
        <div className="p-4 md:p-6 space-y-6 overflow-y-auto h-full">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Visão Geral</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">O que está acontecendo com seu negócio hoje.</p>
                </div>
            </div>

            {/* Faixa superior (largura total) */}
            {orderedRegion('full')}

            {/* Charts & Forecast Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
                <div className="lg:col-span-2 space-y-6 min-w-0 min-h-0">
                    {orderedRegion('main')}
                </div>

                <div className="space-y-6 min-h-0">
                    {orderedRegion('sidebar')}
                </div>
            </div>
        </div >
    );
};

interface CardProps {
    title: string;
    value: string | number;
    icon: React.ElementType;
    color: string;
    onClick?: () => void;
    subValue?: string;
}

const Card: React.FC<CardProps> = ({ title, value, icon: Icon, color, onClick, subValue }) => (
    <div onClick={onClick} className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 cursor-pointer hover:shadow-md transition-all min-w-0">
        <div className="flex justify-between items-start gap-2">
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">{title}</p>
                <h3 className="text-2xl font-bold text-slate-800 dark:text-white mt-1 truncate">{value}</h3>
                {subValue && <p className="text-xs text-slate-400 mt-1 truncate">{subValue}</p>}
            </div>
            <div className={`p-3 rounded-lg ${color} bg-opacity-10 shrink-0`}>
                <Icon size={24} className={color.replace('bg-', 'text-')} />
            </div>
        </div>
    </div>
);

export default Dashboard;