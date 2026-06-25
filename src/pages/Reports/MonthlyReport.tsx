import React, { useState } from 'react';
import { useDolibarr } from '../../context/DolibarrContext';
import {
    usePayments, useSupplierPayments, useSalaryPayments, useSocialContributionPayments, useVATPayments,
    useProposals, useOrders, useUsers, useLeaveRequests, useProjects, useTasks
} from '../../hooks/dolibarr/hooks';
import { AiService } from '../../services/aiService';
import { getMonthlyCashFlow } from '../../utils/analytics/financial';
import { getSalesPerformance } from '../../utils/analytics/commercial';
import { getTeamHealth } from '../../utils/analytics/hr';
import { getProjectActivity } from '../../utils/analytics/projects';
import ReactMarkdown from 'react-markdown';
import { Loader2, TrendingUp, DollarSign, Users, Briefcase, FileText, PlayCircle } from 'lucide-react';
import { logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/formatUtils';
import { PageLayout, PageHeader, Skeleton, ErrorState } from '../../components/ui';

const log = logger.child('MonthlyReport');

// Tabs
import { FinanceTab } from '../../components/Reports/FinanceTab';
import { SalesTab } from '../../components/Reports/SalesTab';
import { ProjectsTab } from '../../components/Reports/ProjectsTab';
import { HRTab } from '../../components/Reports/HRTab';

const CURRENT_YEAR = new Date().getFullYear();
const MONTHS = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export const MonthlyReport: React.FC = () => {
    const { config } = useDolibarr();
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1); // 1-12
    const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
    const [activeTab, setActiveTab] = useState('overview');
    const [summary, setSummary] = useState<string>('');
    const [loadingAI, setLoadingAI] = useState(false);

    // Fetch Data — destructure isLoading and error from all hooks
    const { data: payments, isLoading: loadingPayments, error: errorPayments } = usePayments(config);
    const { data: supplierPayments, isLoading: loadingSupplierPayments, error: errorSupplierPayments } = useSupplierPayments(config);
    const { data: salaries, isLoading: loadingSalaries, error: errorSalaries } = useSalaryPayments(config);
    const { data: taxes, isLoading: loadingTaxes, error: errorTaxes } = useSocialContributionPayments(config);
    const { data: vat, isLoading: loadingVat, error: errorVat } = useVATPayments(config);

    const { data: proposals, isLoading: loadingProposals, error: errorProposals } = useProposals(config);
    const { data: orders, isLoading: loadingOrders, error: errorOrders } = useOrders(config);

    const { data: users, isLoading: loadingUsers, error: errorUsers } = useUsers(config);
    const { data: leaves, isLoading: loadingLeaves, error: errorLeaves } = useLeaveRequests(config);

    const { data: projects, isLoading: loadingProjects, error: errorProjects } = useProjects(config);
    const { data: tasks, isLoading: loadingTasks, error: errorTasks } = useTasks(config);

    const isLoading = loadingPayments || loadingSupplierPayments || loadingSalaries || loadingTaxes || loadingVat
        || loadingProposals || loadingOrders || loadingUsers || loadingLeaves || loadingProjects || loadingTasks;

    const hasError = !!(errorPayments || errorSupplierPayments || errorSalaries || errorTaxes || errorVat
        || errorProposals || errorOrders || errorUsers || errorLeaves || errorProjects || errorTasks);

    // Calculated Stats
    const financialStats = getMonthlyCashFlow(selectedMonth, selectedYear, payments || [], supplierPayments || [], salaries || [], taxes || [], vat || []);
    const salesStats = getSalesPerformance(selectedMonth, selectedYear, proposals || [], orders || []);
    const hrStats = getTeamHealth(selectedMonth, selectedYear, users || [], leaves || []);
    const projectStats = getProjectActivity(selectedMonth, selectedYear, projects || [], tasks || []);

    const generateReport = async () => {
        setLoadingAI(true);
        setActiveTab('overview'); // Switch to overview to show result
        const dataPayload = {
            period: `${selectedMonth}/${selectedYear}`,
            financial: financialStats,
            sales: salesStats,
            hr: hrStats,
            projects: projectStats
        };

        try {
            const report = await AiService.analyzeMonthlyReport(dataPayload);
            setSummary(report);
        } catch (error) {
            log.error('Failed to generate report', error);
            setSummary("**Erro ao gerar relatório.** Verifique os logs.");
        } finally {
            setLoadingAI(false);
        }
    };

    const tabs = [
        { id: 'overview', label: 'Visão Geral', icon: FileText },
        { id: 'finance', label: 'Financeiro', icon: DollarSign },
        { id: 'sales', label: 'Comercial', icon: TrendingUp },
        { id: 'projects', label: 'Projetos', icon: Briefcase },
        { id: 'hr', label: 'RH & Equipe', icon: Users },
    ];

    const periodActions = (
        <div className="flex flex-wrap gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200">
            <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="p-2 border-r border-slate-200 bg-transparent focus:outline-none text-slate-700 font-medium cursor-pointer"
            >
                {MONTHS.map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                ))}
            </select>
            <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="p-2 bg-transparent focus:outline-none text-slate-700 font-medium cursor-pointer"
            >
                {Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 3 + i).map(y => (
                    <option key={y} value={y}>{y}</option>
                ))}
            </select>
            <button
                onClick={generateReport}
                disabled={loadingAI}
                className="ml-2 px-4 py-2 bg-indigo-600 text-white rounded-md shadow hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
                {loadingAI ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                {loadingAI ? 'Analisando...' : 'Gerar Análise IA'}
            </button>
        </div>
    );

    return (
        <div className="h-full flex flex-col overflow-hidden">
            <PageHeader
                title="Relatório Mensal"
                subtitle="Análise de desempenho e indicadores chave"
                actions={periodActions}
            />
            <PageLayout>
                {/* Error Banner */}
                {hasError && (
                    <div className="mb-6">
                        <ErrorState message="Falha ao carregar alguns dados. Verifique a conexão e tente novamente." />
                    </div>
                )}

                {/* KPI Summary (Always Visible) */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    {isLoading ? (
                        <>
                            <Skeleton className="h-24 rounded-lg" />
                            <Skeleton className="h-24 rounded-lg" />
                            <Skeleton className="h-24 rounded-lg" />
                            <Skeleton className="h-24 rounded-lg" />
                        </>
                    ) : (
                        <>
                            <Card title="Resultado Líquido" value={formatCurrency(financialStats.net)} color={financialStats.net >= 0 ? 'green' : 'red'} />
                            <Card title="Receita Vendas" value={formatCurrency(salesStats.ordersValue)} subValue={`${salesStats.ordersCount} pedidos`} subtitle="faturado" color="blue" />
                            <Card title="Projetos Ativos" value={projectStats.activeCount.toString()} subValue={`${projectStats.tasksCompleted} tarefas entr.`} color="purple" />
                            <Card title="Equipe Ativa" value={hrStats.headcount.toString()} subValue={`${hrStats.activeLeaves} em licença`} color="orange" />
                        </>
                    )}
                </div>

                {/* Tabs Navigation */}
                <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors border-b-2 whitespace-nowrap
                                    ${activeTab === tab.id
                                        ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                    }`}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Tab Content */}
                <div className="min-h-[400px]">
                    {activeTab === 'overview' && (
                        <div className="space-y-6">
                            {summary ? (
                                <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200">
                                    <div className="flex items-center gap-2 mb-6 pb-4 border-b border-gray-100">
                                        <div className="p-2 bg-indigo-100 rounded-lg">
                                            <TrendingUp className="w-5 h-5 text-indigo-600" />
                                        </div>
                                        <h2 className="text-xl font-semibold text-gray-800">Resumo Executivo (IA)</h2>
                                    </div>
                                    <div className="prose prose-indigo max-w-none text-gray-600">
                                        <ReactMarkdown>{summary}</ReactMarkdown>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center p-12 bg-white rounded-lg border-dashed border-2 border-gray-200 text-center">
                                    <div className="p-4 bg-indigo-50 rounded-full mb-4">
                                        <FileText className="w-8 h-8 text-indigo-600" />
                                    </div>
                                    <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhuma análise gerada</h3>
                                    <p className="text-gray-500 max-w-md mb-6">
                                        Selecione o período desejado e clique em "Gerar Análise IA" para obter um relatório completo.
                                    </p>
                                    <button
                                        onClick={generateReport}
                                        className="px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-700 hover:bg-gray-50 font-medium"
                                    >
                                        Gerar Agora
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'finance' && (
                        <FinanceTab
                            financialStats={financialStats}
                            payments={payments || []}
                            supplierPayments={supplierPayments || []}
                            salaries={salaries || []}
                        />
                    )}

                    {activeTab === 'sales' && (
                        <SalesTab
                            salesStats={salesStats}
                            proposals={proposals || []}
                            orders={orders || []}
                        />
                    )}

                    {activeTab === 'projects' && (
                        <ProjectsTab
                            projectStats={projectStats}
                            projects={projects || []}
                            tasks={tasks || []}
                        />
                    )}

                    {activeTab === 'hr' && (
                        <HRTab
                            hrStats={hrStats}
                            users={users || []}
                            leaves={leaves || []}
                        />
                    )}
                </div>
            </PageLayout>
        </div>
    );
};

// Simple Icon Card Component
const Card = ({ title, value, subValue, subtitle, color }: any) => {
    const colors: any = {
        green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        red: 'bg-rose-50 text-rose-700 border-rose-200',
        blue: 'bg-blue-50 text-blue-700 border-blue-200',
        purple: 'bg-purple-50 text-purple-700 border-purple-200',
        orange: 'bg-orange-50 text-orange-700 border-orange-200'
    };

    return (
        <div className={`p-6 rounded-lg border ${colors[color] || 'bg-white border-gray-200'}`}>
            <h3 className="text-xs font-semibold uppercase opacity-70 mb-1">{title}</h3>
            {subtitle && <p className="text-xs opacity-60 mb-1">{subtitle}</p>}
            <p className="text-2xl font-bold">{value}</p>
            {subValue && <p className="text-sm opacity-80 mt-1">{subValue}</p>}
        </div>
    );
};

