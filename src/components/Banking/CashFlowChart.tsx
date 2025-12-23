import React, { useMemo } from 'react';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Area, AreaChart, ComposedChart
} from 'recharts';
import { TrendingUp, TrendingDown, Calendar, DollarSign } from 'lucide-react';

interface CashFlowData {
    period: string;
    income: number;
    expenses: number;
    net: number;
}

interface CashFlowChartProps {
    data: CashFlowData[];
    type?: 'bar' | 'line' | 'area';
    showLegend?: boolean;
    height?: number;
    title?: string;
}

const CashFlowChart: React.FC<CashFlowChartProps> = ({
    data,
    type = 'bar',
    showLegend = true,
    height = 300,
    title = 'Fluxo de Caixa'
}) => {
    const totals = useMemo(() => {
        const totalIncome = data.reduce((sum, d) => sum + d.income, 0);
        const totalExpenses = data.reduce((sum, d) => sum + d.expenses, 0);
        const netCashFlow = totalIncome - totalExpenses;
        return { totalIncome, totalExpenses, netCashFlow };
    }, [data]);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    };

    const formatPeriod = (period: string) => {
        // Convert YYYY-MM to Month/Year
        const parts = period.split('-');
        if (parts.length === 2) {
            const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            const monthIndex = parseInt(parts[1]) - 1;
            return `${months[monthIndex]}/${parts[0].slice(2)}`;
        }
        return period;
    };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700">
                    <p className="font-medium text-slate-700 dark:text-slate-300 mb-2">{formatPeriod(label)}</p>
                    {payload.map((entry: any, index: number) => (
                        <p key={index} className="text-sm" style={{ color: entry.color }}>
                            {entry.name}: {formatCurrency(entry.value)}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    const renderChart = () => {
        const commonProps = {
            data: data.map(d => ({ ...d, periodFormatted: formatPeriod(d.period) })),
            margin: { top: 10, right: 10, left: 0, bottom: 0 },
        };

        const xAxisProps = {
            dataKey: 'period',
            tickFormatter: formatPeriod,
            tick: { fill: '#64748b', fontSize: 12 },
            axisLine: { stroke: '#e2e8f0' },
        };

        const yAxisProps = {
            tickFormatter: (value: number) => `${(value / 1000).toFixed(0)}k`,
            tick: { fill: '#64748b', fontSize: 12 },
            axisLine: { stroke: '#e2e8f0' },
            width: 50,
        };

        switch (type) {
            case 'line':
                return (
                    <LineChart {...commonProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis {...xAxisProps} />
                        <YAxis {...yAxisProps} />
                        <Tooltip content={<CustomTooltip />} />
                        {showLegend && <Legend />}
                        <Line type="monotone" dataKey="income" name="Entradas" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="expenses" name="Saídas" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="net" name="Líquido" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4 }} />
                    </LineChart>
                );

            case 'area':
                return (
                    <AreaChart {...commonProps}>
                        <defs>
                            <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis {...xAxisProps} />
                        <YAxis {...yAxisProps} />
                        <Tooltip content={<CustomTooltip />} />
                        {showLegend && <Legend />}
                        <Area type="monotone" dataKey="income" name="Entradas" stroke="#10b981" fill="url(#colorIncome)" />
                        <Area type="monotone" dataKey="expenses" name="Saídas" stroke="#ef4444" fill="url(#colorExpenses)" />
                    </AreaChart>
                );

            case 'bar':
            default:
                return (
                    <ComposedChart {...commonProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis {...xAxisProps} />
                        <YAxis {...yAxisProps} />
                        <Tooltip content={<CustomTooltip />} />
                        {showLegend && <Legend />}
                        <Bar dataKey="income" name="Entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="expenses" name="Saídas" fill="#f87171" radius={[4, 4, 0, 0]} />
                        <Line type="monotone" dataKey="net" name="Líquido" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                );
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Calendar size={18} className="text-indigo-600" />
                        {title}
                    </h3>
                    <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1.5">
                            <TrendingUp size={14} className="text-emerald-500" />
                            <span className="text-slate-600 dark:text-slate-400">Entradas:</span>
                            <span className="font-bold text-emerald-600">{formatCurrency(totals.totalIncome)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <TrendingDown size={14} className="text-red-500" />
                            <span className="text-slate-600 dark:text-slate-400">Saídas:</span>
                            <span className="font-bold text-red-500">{formatCurrency(totals.totalExpenses)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 border-l border-slate-200 dark:border-slate-700 pl-4">
                            <DollarSign size={14} className={totals.netCashFlow >= 0 ? 'text-indigo-600' : 'text-red-500'} />
                            <span className="text-slate-600 dark:text-slate-400">Líquido:</span>
                            <span className={`font-bold ${totals.netCashFlow >= 0 ? 'text-indigo-600' : 'text-red-500'}`}>
                                {formatCurrency(totals.netCashFlow)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div className="p-4">
                {data.length === 0 ? (
                    <div className="h-[200px] flex items-center justify-center text-slate-400">
                        <p>Nenhum dado disponível para exibir</p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={height}>
                        {renderChart()}
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
};

export default CashFlowChart;
