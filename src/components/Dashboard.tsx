
import React, { useState, useMemo } from 'react';
import { AppView } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { useInvoices, useSupplierInvoices, useTasks, useProducts, useBankAccounts, useInterventions, useTickets } from '../hooks/dolibarr';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from 'recharts';
import { DollarSign, Users, FileText, TrendingUp, Sparkles, Loader2, Minus, FolderKanban, Pencil, Save, X, AlertOctagon, Clock, Package, Landmark, MessageSquare, ClipboardList, Wrench, Ticket as TicketIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { AiService } from '../services/aiService';
import { FinancialHealthWidget } from './Finance/FinancialHealthWidget';
import { formatDateOnly, formatDateTime } from '../utils/dateUtils';

interface DashboardProps {
    onNavigate?: (view: AppView, id: string) => void;
}

interface ForecastData {
    forecastAmount: number;
    trend: 'up' | 'down' | 'stable';
    reasoning: string;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();

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
    const { data: interventionsData } = useInterventions(config);
    const interventions = interventionsData || [];
    const { data: ticketsData } = useTickets(config);
    const tickets = ticketsData || [];

    const [forecast, setForecast] = useState<ForecastData | null>(null);
    const [loadingForecast, setLoadingForecast] = useState(false);

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
                    {payload.map((entry: any, index: number) => (
                        <p key={index} className="flex items-center gap-2">
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
        const totalRevenue = invoices.filter(i => i.statut === '2').reduce((acc, curr) => acc + curr.total_ttc, 0);
        const totalExpense = supplierInvoices.filter(i => i.statut === '2').reduce((acc, curr) => acc + curr.total_ttc, 0);
        const totalCash = bankAccounts.reduce((acc, curr) => acc + (curr.solde || 0), 0);
        const now = new Date();
        const unpaidInvoices = invoices.filter(i => {
            if (i.statut !== '1') return false;
            const dueDate = i.date_lim_reglement || (i.date + 30 * 24 * 60 * 60);
            const d = dueDate < 100000000000 ? dueDate * 1000 : dueDate;
            return d < now.getTime();
        }).length + supplierInvoices.filter(i => {
            if (i.statut !== '1') return false;
            const dueDate = i.date_lim_reglement || (i.date + 30 * 24 * 60 * 60);
            const d = dueDate < 100000000000 ? dueDate * 1000 : dueDate;
            return d < now.getTime();
        }).length;

        return { totalRevenue, totalExpense, totalCash, unpaidInvoices };
    }, [invoices, supplierInvoices, bankAccounts]);

    const cashFlowData = useMemo(() => {
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const currentYear = new Date().getFullYear();

        // Initialize 12 months
        const monthlyData = months.map(m => ({ month: m, income: 0, expense: 0 }));

        // Process Invoices (Income) - Only Paid (statut = 2)
        invoices.forEach(inv => {
            if (inv.statut === '2') {
                const dateVal = inv.date < 100000000000 ? inv.date * 1000 : inv.date;
                const d = new Date(dateVal);
                if (d.getFullYear() === currentYear) {
                    monthlyData[d.getMonth()].income += inv.total_ttc;
                }
            }
        });

        // Process Supplier Invoices (Expense) - Only Paid (statut = 2)
        supplierInvoices.forEach(inv => {
            if (inv.statut === '2') {
                const dateVal = inv.date < 100000000000 ? inv.date * 1000 : inv.date;
                const d = new Date(dateVal);
                if (d.getFullYear() === currentYear) {
                    monthlyData[d.getMonth()].expense += inv.total_ttc;
                }
            }
        });

        return monthlyData;
    }, [invoices, supplierInvoices]);

    const recentActivityData = useMemo(() => {
        return invoices.slice(0, 5).map(inv => ({
            name: inv.ref,
            amount: inv.total_ttc,
            status: inv.statut === '2' ? 'Pago' : 'Pendente',
            id: inv.id // for navigation
        }));
    }, [invoices]);

    const lowStockItems = useMemo(() => {
        return products.filter(p => p.stock_reel < (5)).slice(0, 5);
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
            tasks: tasks.filter(t => false), // Logic pending Task assignation
            // Simplified: Tasks don't have user assign in list usually unless joined.
            // Will skip tasks for now or use simplified logic if available
            interventions: interventions.filter(i => String(i.fk_user_author) === uid && i.statut !== '2'),
            tickets: tickets.filter(t => String(t.fk_user_assign) === uid && t.statut !== '8' && t.statut !== 'CLOSED')
        };
    }, [tasks, interventions, tickets, config]);


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

    const handleGenerateForecast = async () => {
        setLoadingForecast(true);
        try {
            const result = await AiService.generateSalesForecast(invoices);
            if (result) {
                setForecast(JSON.parse(result));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingForecast(false);
        }
    };

    return (
        <div className="p-4 md:p-6 space-y-6 overflow-y-auto h-full">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Visão Geral</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">O que está acontecendo com seu negócio hoje.</p>
                </div>

                {/* Gemini Insight Widget */}
                <div className="w-full xl:max-w-2xl">
                    <FinancialHealthWidget data={financialContext} />
                </div>
            </div>


            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                <Card
                    title="Receita Total"
                    value={formatCurrency(metrics.totalRevenue)}
                    icon={DollarSign}
                    color="bg-emerald-500"
                    onClick={() => onNavigate && onNavigate('invoices', '')}
                />
                <Card
                    title="Despesas"
                    value={formatCurrency(metrics.totalExpense)}
                    icon={TrendingUp}
                    color="bg-red-500"
                    subValue={`Líquido: ${formatCurrency(metrics.totalRevenue - metrics.totalExpense)}`}
                    onClick={() => onNavigate && onNavigate('supplier_invoices', '')}
                />
                <Card
                    title="Saldo em Caixa"
                    value={formatCurrency(metrics.totalCash)}
                    icon={Landmark}
                    color="bg-indigo-500"
                    onClick={() => onNavigate && onNavigate('bank_accounts', '')}
                />
                <Card
                    title="Pagamentos Pendentes"
                    value={metrics.unpaidInvoices}
                    icon={Users}
                    color="bg-orange-500"
                    onClick={() => onNavigate && onNavigate('pending_payments', '')}
                />
            </div>

            {/* Charts & Forecast Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Main Chart Column */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Cash Flow Chart */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col transition-colors">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-6">Fluxo de Caixa (Receita vs Despesas)</h3>
                        <div className="w-full h-[300px]" style={{ width: '100%', height: 300 }}>
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
                                    <Area type="monotone" dataKey="income" stroke="#10b981" fillOpacity={1} fill="url(#colorIncome)" name="Receita" />
                                    <Area type="monotone" dataKey="expense" stroke="#ef4444" fillOpacity={1} fill="url(#colorExpense)" name="Despesas" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Cash Flow Forecast Chart - 90 Days */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col transition-colors">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-6">Projeção de Fluxo de Caixa (90 dias)</h3>
                        <div className="w-full h-[250px]" style={{ width: '100%', height: 250 }}>
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
                </div>

                {/* Sidebar Widgets */}
                <div className="space-y-6">

                    {/* My Pending Items Widget */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 transition-colors">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <ClipboardList size={18} className="text-orange-500" /> Minhas Pendências
                        </h3>
                        <div className="space-y-3">
                            {myAssignments.tickets.length === 0 && myAssignments.interventions.length === 0 ? (
                                <p className="text-sm text-slate-500 dark:text-slate-400 italic">Nada pendente. Bom trabalho!</p>
                            ) : (
                                <>
                                    {myAssignments.interventions.map(i => (
                                        <div key={i.id} className="p-3 bg-orange-50 dark:bg-orange-900/10 rounded-lg border border-orange-100 dark:border-orange-800 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/20" onClick={() => onNavigate && onNavigate('interventions', i.id)}>
                                            <div className="flex justify-between items-start">
                                                <span className="text-xs font-bold text-orange-700 dark:text-orange-400 flex items-center gap-1"><Wrench size={10} /> {i.ref}</span>
                                                <span className="text-[10px] text-slate-500">{formatDateOnly(i.date)}</span>
                                            </div>
                                            <div className="text-sm font-medium text-slate-800 dark:text-white mt-1 line-clamp-1">{i.description || 'Intervenção'}</div>
                                        </div>
                                    ))}
                                    {myAssignments.tickets.map(t => (
                                        <div key={t.id} className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-800 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/20" onClick={() => onNavigate && onNavigate('tickets', t.id)}>
                                            <div className="flex justify-between items-start">
                                                <span className="text-xs font-bold text-blue-700 dark:text-blue-400 flex items-center gap-1"><TicketIcon size={10} /> {t.ref}</span>
                                                <span className="text-[10px] text-slate-500">{formatDateTime(t.date_c)}</span>
                                            </div>
                                            <div className="text-sm font-medium text-slate-800 dark:text-white mt-1 line-clamp-1">{t.subject}</div>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Sales Forecast Widget */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 relative overflow-hidden transition-colors">
                        <div className="absolute top-0 right-0 p-3 opacity-10">
                            <TrendingUp size={100} className="text-indigo-600 dark:text-indigo-400" />
                        </div>

                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2 relative z-10">
                            <Sparkles size={18} className="text-violet-500" /> Previsão de Vendas
                        </h3>

                        {!forecast ? (
                            <div className="text-center py-6 relative z-10">
                                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Preveja a receita do próximo mês usando análise de IA.</p>
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
                                    <span className="text-sm text-slate-500 dark:text-slate-400">Receita Projetada</span>
                                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${forecast.trend === 'up' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                        forecast.trend === 'down' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                            'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                        }`}>
                                        tendência {forecast.trend}
                                    </span>
                                </div>
                                <div className="flex items-end gap-2">
                                    <span className="text-3xl font-bold text-slate-800 dark:text-white">
                                        ${forecast.forecastAmount.toLocaleString()}
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
                                        {forecast.reasoning}
                                    </div>
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

                    {/* Operational Alerts / Late Tasks / Low Stock */}

                    {/* Operational Alerts / Late Tasks / Low Stock */}
                    {(lateTasks.length > 0 || lowStockItems.length > 0) && (
                        <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-xl shadow-sm border border-red-100 dark:border-red-900/30 transition-colors animate-in fade-in">
                            <h3 className="text-lg font-bold text-red-800 dark:text-red-300 mb-4 flex items-center gap-2">
                                <AlertOctagon size={18} /> Alertas Operacionais
                            </h3>

                            <div className="space-y-4">
                                {lateTasks.length > 0 && (
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

                                {lowStockItems.length > 0 && (
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



                    {/* Quick Actions */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 transition-colors">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Ações Rápidas</h3>
                        <div className="space-y-3">
                            <button
                                className="w-full text-left p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-indigo-100 dark:hover:border-indigo-900 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all flex items-center gap-3 group"
                                onClick={() => onNavigate && onNavigate('invoices', '')}
                            >
                                <div className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 p-2 rounded-lg group-hover:bg-white dark:group-hover:bg-slate-800 transition-colors">
                                    <FileText size={18} />
                                </div>
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Criar Nova Fatura</span>
                            </button>
                            <button
                                className="w-full text-left p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-indigo-100 dark:hover:border-indigo-900 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all flex items-center gap-3 group"
                                onClick={() => onNavigate && onNavigate('customers', '')}
                            >
                                <div className="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 p-2 rounded-lg group-hover:bg-white dark:group-hover:bg-slate-800 transition-colors">
                                    <Users size={18} />
                                </div>
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Adicionar Cliente</span>
                            </button>
                            <button
                                className="w-full text-left p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-indigo-100 dark:hover:border-indigo-900 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all flex items-center gap-3 group"
                                onClick={() => onNavigate && onNavigate('projects', '')}
                            >
                                <div className="bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 p-2 rounded-lg group-hover:bg-white dark:group-hover:bg-slate-800 transition-colors">
                                    <FolderKanban size={18} />
                                </div>
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Novo Projeto</span>
                            </button>
                            {/* WhatsApp Quick Action */}
                            <button
                                className="w-full text-left p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-green-100 dark:hover:border-green-900 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all flex items-center gap-3 group"
                                onClick={() => onNavigate && onNavigate('whatsapp', '')}
                            >
                                <div className="bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 p-2 rounded-lg group-hover:bg-white dark:group-hover:bg-slate-800 transition-colors">
                                    <MessageSquare size={18} />
                                </div>
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Abrir WhatsApp</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Card = ({ title, value, icon: Icon, color, onClick, subValue }: any) => (
    <div onClick={onClick} className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 cursor-pointer hover:shadow-md transition-all">
        <div className="flex justify-between items-start">
            <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
                <h3 className="text-2xl font-bold text-slate-800 dark:text-white mt-1">{value}</h3>
                {subValue && <p className="text-xs text-slate-400 mt-1">{subValue}</p>}
            </div>
            <div className={`p-3 rounded-lg ${color} bg-opacity-10`}>
                <Icon size={24} className={color.replace('bg-', 'text-')} />
            </div>
        </div>
    </div>
);

export default Dashboard;