import React, { useMemo } from 'react';
import { useDolibarr } from '../context/DolibarrContext';
import { useInvoices, useSupplierInvoices, useCustomers, useProducts } from '../hooks/dolibarr';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { FileBarChart, Download, TrendingUp, Users, Package, DollarSign, Loader2 } from 'lucide-react';

const ReportsView: React.FC = () => {
    const { config } = useDolibarr();

    const { data: invoices = [], isLoading: isLoadingInvoices } = useInvoices(config || null, !!config);
    const { data: supplierInvoices = [], isLoading: isLoadingSupplierInvoices } = useSupplierInvoices(config || null, !!config);
    const { data: customers = [], isLoading: isLoadingCustomers } = useCustomers(config || null, !!config);
    const { data: products = [], isLoading: isLoadingProducts } = useProducts(config || null, !!config);

    const isLoading = isLoadingInvoices || isLoadingSupplierInvoices || isLoadingCustomers || isLoadingProducts;

    // 1. Sales by Month (Current Year)
    const salesByMonthData = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const months = Array.from({ length: 12 }, (_, i) => ({
            name: new Date(0, i).toLocaleString('default', { month: 'short' }),
            sales: 0,
            expenses: 0
        }));

        invoices.forEach(inv => {
            const dateVal = inv.date < 100000000000 ? inv.date * 1000 : inv.date;
            const date = new Date(dateVal);
            if (date.getFullYear() === currentYear) {
                months[date.getMonth()].sales += inv.total_ttc;
            }
        });

        supplierInvoices.forEach(inv => {
            const dateVal = inv.date < 100000000000 ? inv.date * 1000 : inv.date;
            const date = new Date(dateVal);
            if (date.getFullYear() === currentYear) {
                months[date.getMonth()].expenses += inv.total_ttc;
            }
        });

        return months;
    }, [invoices, supplierInvoices]);

    // 2. Top Customers
    const topCustomersData = useMemo(() => {
        const map: Record<string, number> = {};
        invoices.forEach(inv => {
            if (inv.socid) {
                map[inv.socid] = (map[inv.socid] || 0) + inv.total_ttc;
            }
        });

        return Object.entries(map)
            .map(([socid, total]) => {
                const customer = customers.find(c => String(c.id) === String(socid));
                return {
                    name: customer ? customer.name : `ID: ${socid}`,
                    value: total
                };
            })
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);
    }, [invoices, customers]);

    // 3. Product Type Distribution (Service vs Product in Catalog)
    const productTypeData = useMemo(() => {
        let services = 0;
        let physical = 0;
        products.forEach(p => {
            if (p.type === '1') services++;
            else physical++;
        });
        return [
            { name: 'Serviços', value: services },
            { name: 'Produtos', value: physical }
        ];
    }, [products]);

    // COLORS
    const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    const handleExport = () => {
        // Generate CSV Content
        const currentYear = new Date().getFullYear();
        let csvContent = `data:text/csv;charset=utf-8,Tipo de Relatorio,Mes,Valor\n`;

        // Add Sales Data
        salesByMonthData.forEach(row => {
            csvContent += `Vendas ${currentYear},${row.name},${row.sales.toFixed(2)}\n`;
            csvContent += `Despesas ${currentYear},${row.name},${row.expenses.toFixed(2)}\n`;
        });

        // Add Top Customers
        topCustomersData.forEach(row => {
            csvContent += `Top Cliente,${row.name},${row.value.toFixed(2)}\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `CoolGroove_Relatorio_${currentYear}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (!config) {
        return (
            <div className="flex items-center justify-center p-20 text-slate-400">
                <p>Carregando configurações...</p>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <Loader2 size={48} className="animate-spin mb-4 text-indigo-500" />
                <p>Carregando dados do relatório...</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">

            {/* Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <FileBarChart className={`text-${config.themeColor}-600`} /> Relatórios Avançados
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Inteligência de Negócios & Análises</p>
                    </div>
                    <button
                        onClick={handleExport}
                        className={`flex items-center gap-2 px-4 py-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg shadow-sm transition-colors`}
                    >
                        <Download size={18} /> Exportar CSV
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

                    {/* Sales vs Expenses Chart */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
                            <TrendingUp size={18} className="text-emerald-500" /> Desempenho Financeiro ({new Date().getFullYear()})
                        </h3>
                        <div className="h-72 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={salesByMonthData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.1} />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={(val) => `$${val / 1000}k`} />
                                    <Tooltip
                                        contentStyle={{ borderRadius: '8px', border: 'none', backgroundColor: '#1e293b', color: '#f8fafc' }}
                                        cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                    />
                                    <Legend />
                                    <Bar dataKey="sales" name="Vendas" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="expenses" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Top Customers */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
                            <Users size={18} className="text-blue-500" /> Top 5 Clientes
                        </h3>
                        <div className="h-72 w-full flex items-center justify-center">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={topCustomersData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {topCustomersData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', backgroundColor: '#1e293b', color: '#f8fafc' }} />
                                    <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '12px' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Product Mix */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Package size={18} className="text-indigo-500" /> Mix do Catálogo
                        </h3>
                        <div className="h-48 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={productTypeData}
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={60}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                                    >
                                        <Cell fill="#8b5cf6" />
                                        <Cell fill="#f59e0b" />
                                    </Pie>
                                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', backgroundColor: '#1e293b', color: '#f8fafc' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* KPI Cards */}
                    <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-gradient-to-br from-indigo-500 to-violet-600 p-6 rounded-xl text-white shadow-lg">
                            <div className="flex items-center gap-3 mb-2 opacity-80">
                                <DollarSign size={20} />
                                <span className="font-medium">Valor Médio da Fatura</span>
                            </div>
                            <div className="text-3xl font-bold">
                                ${invoices.length > 0 ? (invoices.reduce((a, b) => a + b.total_ttc, 0) / invoices.length).toLocaleString(undefined, { maximumFractionDigits: 0 }) : 0}
                            </div>
                            <div className="mt-4 text-xs bg-white/20 inline-block px-2 py-1 rounded">
                                Em {invoices.length} faturas
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-center items-center text-center">
                            <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full mb-3">
                                <TrendingUp size={24} />
                            </div>
                            <div className="text-2xl font-bold text-slate-800 dark:text-white">
                                {invoices.filter(i => i.statut === '2').length} / {invoices.length}
                            </div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Proporção de Faturas Pagas</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReportsView;
