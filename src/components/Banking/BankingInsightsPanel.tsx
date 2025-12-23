import React, { useState, useEffect } from 'react';
import {
    Sparkles, TrendingUp, TrendingDown, AlertTriangle, Lightbulb,
    RefreshCw, Loader2, DollarSign, Shield, Target
} from 'lucide-react';

interface CashFlowInsight {
    period: string;
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
    averageDailyBalance: number;
    projectedEndBalance: number;
    trends: string[];
    recommendations: string[];
    riskFactors: string[];
}

interface SpendingAnomaly {
    transactionId: string;
    description: string;
    amount: number;
    date: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
}

interface BankingInsightsPanelProps {
    accounts: Array<{ id: string; label: string; solde: number }>;
    transactions: Array<{ date: string; amount: number; description: string; type: 'credit' | 'debit' }>;
}

const BankingInsightsPanel: React.FC<BankingInsightsPanelProps> = ({ accounts, transactions }) => {
    const [insights, setInsights] = useState<CashFlowInsight | null>(null);
    const [anomalies, setAnomalies] = useState<SpendingAnomaly[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'insights' | 'anomalies'>('insights');

    const fetchInsights = async () => {
        if (accounts.length === 0 || transactions.length === 0) return;

        setIsLoading(true);
        setError(null);

        try {
            // Fetch cash flow insights
            const insightsResponse = await fetch('/api/banking/insights/cash-flow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accounts,
                    transactions,
                    period: 'month'
                }),
            });

            if (insightsResponse.ok) {
                const insightsData = await insightsResponse.json();
                setInsights(insightsData.data);
            }

            // Fetch anomalies
            const anomaliesResponse = await fetch('/api/banking/analyze/anomalies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transactions }),
            });

            if (anomaliesResponse.ok) {
                const anomaliesData = await anomaliesResponse.json();
                setAnomalies(anomaliesData.data || []);
            }
        } catch (err: any) {
            setError(err.message || 'Erro ao carregar insights');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (accounts.length > 0 && transactions.length > 0) {
            fetchInsights();
        }
    }, [accounts.length, transactions.length]);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'high': return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800';
            case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800';
            default: return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800';
        }
    };

    if (accounts.length === 0 || transactions.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center">
                <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">Selecione uma conta e importe transações para ver os insights</p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Sparkles size={20} className="text-indigo-600" />
                        Insights com IA
                    </h3>
                    <button
                        onClick={fetchInsights}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                        {isLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Atualizar
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mt-4">
                    <button
                        onClick={() => setActiveTab('insights')}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'insights'
                                ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-600'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-white/50'
                            }`}
                    >
                        <span className="flex items-center gap-1.5">
                            <Lightbulb size={14} />
                            Insights
                        </span>
                    </button>
                    <button
                        onClick={() => setActiveTab('anomalies')}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'anomalies'
                                ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-600'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-white/50'
                            }`}
                    >
                        <span className="flex items-center gap-1.5">
                            <AlertTriangle size={14} />
                            Anomalias
                            {anomalies.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">
                                    {anomalies.length}
                                </span>
                            )}
                        </span>
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="p-4">
                {isLoading ? (
                    <div className="py-12 text-center">
                        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
                        <p className="text-slate-500">Analisando dados com IA...</p>
                    </div>
                ) : error ? (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-red-600">{error}</p>
                    </div>
                ) : activeTab === 'insights' && insights ? (
                    <div className="space-y-4">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-100 dark:border-emerald-800">
                                <div className="flex items-center gap-2 mb-1">
                                    <TrendingUp size={16} className="text-emerald-600" />
                                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Entradas</span>
                                </div>
                                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                                    {formatCurrency(insights.totalIncome)}
                                </p>
                            </div>
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-800">
                                <div className="flex items-center gap-2 mb-1">
                                    <TrendingDown size={16} className="text-red-600" />
                                    <span className="text-xs font-medium text-red-700 dark:text-red-400">Saídas</span>
                                </div>
                                <p className="text-lg font-bold text-red-700 dark:text-red-400">
                                    {formatCurrency(insights.totalExpenses)}
                                </p>
                            </div>
                            <div className={`p-4 rounded-xl border ${insights.netCashFlow >= 0
                                    ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-800'
                                    : 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800'
                                }`}>
                                <div className="flex items-center gap-2 mb-1">
                                    <DollarSign size={16} className={insights.netCashFlow >= 0 ? 'text-indigo-600' : 'text-orange-600'} />
                                    <span className={`text-xs font-medium ${insights.netCashFlow >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-orange-700 dark:text-orange-400'
                                        }`}>Fluxo Líquido</span>
                                </div>
                                <p className={`text-lg font-bold ${insights.netCashFlow >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-orange-700 dark:text-orange-400'
                                    }`}>
                                    {formatCurrency(insights.netCashFlow)}
                                </p>
                            </div>
                        </div>

                        {/* Trends */}
                        {insights.trends.length > 0 && (
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                                <h4 className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-3">
                                    <Target size={16} className="text-indigo-600" />
                                    Tendências Identificadas
                                </h4>
                                <ul className="space-y-2">
                                    {insights.trends.map((trend, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                                            <span className="text-indigo-500 mt-0.5">•</span>
                                            {trend}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Recommendations */}
                        {insights.recommendations.length > 0 && (
                            <div className="p-4 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                                <h4 className="font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-2 mb-3">
                                    <Lightbulb size={16} />
                                    Recomendações
                                </h4>
                                <ul className="space-y-2">
                                    {insights.recommendations.map((rec, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                                            <span className="mt-0.5">💡</span>
                                            {rec}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Risk Factors */}
                        {insights.riskFactors.length > 0 && (
                            <div className="p-4 bg-amber-50/50 dark:bg-amber-900/10 rounded-xl border border-amber-100 dark:border-amber-900/30">
                                <h4 className="font-medium text-amber-700 dark:text-amber-400 flex items-center gap-2 mb-3">
                                    <Shield size={16} />
                                    Riscos Potenciais
                                </h4>
                                <ul className="space-y-2">
                                    {insights.riskFactors.map((risk, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                                            <span className="mt-0.5">⚠️</span>
                                            {risk}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Projection */}
                        <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800/30">
                            <p className="text-sm text-indigo-700 dark:text-indigo-400">
                                📈 <strong>Projeção em 30 dias:</strong> Se o padrão atual continuar, seu saldo será aproximadamente {formatCurrency(insights.projectedEndBalance)}
                            </p>
                        </div>
                    </div>
                ) : activeTab === 'anomalies' ? (
                    <div className="space-y-3">
                        {anomalies.length === 0 ? (
                            <div className="py-12 text-center">
                                <Shield className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
                                <p className="text-slate-500">Nenhuma anomalia detectada nas suas transações</p>
                                <p className="text-xs text-slate-400 mt-1">Suas finanças parecem estar em ordem 👍</p>
                            </div>
                        ) : (
                            anomalies.map((anomaly, i) => (
                                <div
                                    key={i}
                                    className={`p-4 rounded-xl border ${getSeverityColor(anomaly.severity)}`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <p className="font-medium">{anomaly.description}</p>
                                            <p className="text-sm opacity-80 mt-1">{anomaly.reason}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-bold">{formatCurrency(anomaly.amount)}</p>
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${anomaly.severity === 'high' ? 'bg-red-200 text-red-700' :
                                                    anomaly.severity === 'medium' ? 'bg-yellow-200 text-yellow-700' :
                                                        'bg-blue-200 text-blue-700'
                                                }`}>
                                                {anomaly.severity === 'high' ? 'Alto Risco' :
                                                    anomaly.severity === 'medium' ? 'Médio' : 'Baixo'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default BankingInsightsPanel;
