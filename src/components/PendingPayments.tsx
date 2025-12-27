import React, { useState, useMemo } from 'react';
import { useDolibarr } from '../context/DolibarrContext';
import { useInvoices, useSupplierInvoices } from '../hooks/dolibarr';
import { ArrowUpRight, ArrowDownRight, Clock, AlertCircle, CheckCircle2, Search, Filter, Calendar } from 'lucide-react';
import { formatDateOnly } from '../utils/dateUtils';

interface PendingPaymentsProps {
    onNavigate?: (view: string, id: string) => void;
}

export const PendingPayments: React.FC<PendingPaymentsProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();
    const [activeTab, setActiveTab] = useState<'receivables' | 'payables'>('receivables');
    const [searchTerm, setSearchTerm] = useState('');

    const { data: invoicesData, isLoading: isLoadingInvoices } = useInvoices(config);
    const { data: supplierInvoicesData, isLoading: isLoadingSupplier } = useSupplierInvoices(config);

    // Helper to check if date is past
    const isOverdue = (date: number) => {
        const d = date < 100000000000 ? date * 1000 : date;
        return new Date(d) < new Date();
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    };

    // Filter Receivables (Customer Invoices)
    const receivables = useMemo(() => {
        if (!invoicesData) return [];
        return invoicesData
            .filter(inv => inv.statut === '1') // Unpaid
            .map(inv => {
                const dueDate = inv.date_lim_reglement || (inv.date + 30 * 24 * 60 * 60);
                return {
                    ...inv,
                    type: 'receivable',
                    dueDate: dueDate,
                    isOverdue: isOverdue(dueDate)
                };
            })
            .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
    }, [invoicesData]);

    // Filter Payables (Supplier Invoices)
    const payables = useMemo(() => {
        if (!supplierInvoicesData) return [];
        return supplierInvoicesData
            .filter(inv => inv.statut === '1') // Unpaid
            .map(inv => {
                const dueDate = inv.date_lim_reglement || (inv.date + 30 * 24 * 60 * 60);
                return {
                    ...inv,
                    type: 'payable',
                    dueDate: dueDate,
                    isOverdue: isOverdue(dueDate)
                };
            })
            .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
    }, [supplierInvoicesData]);

    const displayedItems = useMemo(() => {
        const source = activeTab === 'receivables' ? receivables : payables;
        if (!searchTerm) return source;
        const lowerTerm = searchTerm.toLowerCase();
        return source.filter(item =>
            item.ref.toLowerCase().includes(lowerTerm) ||
            (item.soc_name || '').toLowerCase().includes(lowerTerm)
        );
    }, [activeTab, receivables, payables, searchTerm]);

    const totalReceivables = receivables.reduce((sum, item) => sum + item.total_ttc, 0);
    const totalPayables = payables.reduce((sum, item) => sum + item.total_ttc, 0);
    const totalOverdueReceivables = receivables.filter(i => i.isOverdue).reduce((sum, item) => sum + item.total_ttc, 0);
    const totalOverduePayables = payables.filter(i => i.isOverdue).reduce((sum, item) => sum + item.total_ttc, 0);

    return (
        <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Pagamentos Pendentes</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Gerencie suas contas a pagar e a receber em um só lugar.</p>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                    className={`p-6 rounded-xl border cursor-pointer transition-all ${activeTab === 'receivables' ? 'bg-white dark:bg-slate-900 border-emerald-500 ring-1 ring-emerald-500 shadow-md' : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 opacity-70 hover:opacity-100'}`}
                    onClick={() => setActiveTab('receivables')}
                >
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
                            <ArrowDownRight size={24} />
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-slate-500 dark:text-slate-400">Total a Receber</p>
                            <h3 className="text-2xl font-bold text-slate-800 dark:text-white">{formatCurrency(totalReceivables)}</h3>
                        </div>
                    </div>
                    {totalOverdueReceivables > 0 && (
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm font-medium bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">
                            <AlertCircle size={16} />
                            <span>{formatCurrency(totalOverdueReceivables)} em atraso</span>
                        </div>
                    )}
                </div>

                <div
                    className={`p-6 rounded-xl border cursor-pointer transition-all ${activeTab === 'payables' ? 'bg-white dark:bg-slate-900 border-red-500 ring-1 ring-red-500 shadow-md' : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 opacity-70 hover:opacity-100'}`}
                    onClick={() => setActiveTab('payables')}
                >
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg text-red-600 dark:text-red-400">
                            <ArrowUpRight size={24} />
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-slate-500 dark:text-slate-400">Total a Pagar</p>
                            <h3 className="text-2xl font-bold text-slate-800 dark:text-white">{formatCurrency(totalPayables)}</h3>
                        </div>
                    </div>
                    {totalOverduePayables > 0 && (
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm font-medium bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">
                            <AlertCircle size={16} />
                            <span>{formatCurrency(totalOverduePayables)} em atraso</span>
                        </div>
                    )}
                </div>
            </div>

            {/* List Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[calc(100%-240px)] min-h-[400px]">

                {/* Toolbar */}
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <h2 className="font-bold text-slate-800 dark:text-white">
                            {activeTab === 'receivables' ? 'Faturas de Clientes (Entrada)' : 'Faturas de Fornecedores (Saída)'}
                        </h2>
                        <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs px-2 py-1 rounded-full font-medium">
                            {displayedItems.length}
                        </span>
                    </div>
                    <div className="relative max-w-xs w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar por ref ou nome..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                {/* List Header */}
                <div className="grid grid-cols-12 gap-4 p-4 bg-slate-50 dark:bg-slate-950/50 text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-slate-200 dark:border-slate-800">
                    <div className="col-span-2">Referência</div>
                    <div className="col-span-4">{activeTab === 'receivables' ? 'Cliente' : 'Fornecedor'}</div>
                    <div className="col-span-2 text-right">Valor</div>
                    <div className="col-span-3">Vencimento</div>
                    <div className="col-span-1 text-center">Status</div>
                </div>

                {/* List Content */}
                <div className="overflow-y-auto flex-1 p-2 space-y-2">
                    {displayedItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                            <CheckCircle2 size={48} className="mb-4 opacity-20" />
                            <p>Nenhum pagamento pendente encontrado.</p>
                        </div>
                    ) : (
                        displayedItems.map((item) => (
                            <div
                                key={item.id}
                                onClick={() => onNavigate && onNavigate(activeTab === 'receivables' ? 'invoices' : 'supplier_invoices', item.id)}
                                className={`grid grid-cols-12 gap-4 p-3 rounded-lg border items-center cursor-pointer transition-colors ${item.isOverdue
                                    ? 'bg-red-50/50 dark:bg-red-900/5 border-red-100 dark:border-red-900/30 hover:bg-red-50 dark:hover:bg-red-900/10'
                                    : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-900 hover:shadow-sm'
                                    }`}
                            >
                                <div className="col-span-2 font-medium text-slate-800 dark:text-white flex items-center gap-2">
                                    {item.ref}
                                </div>
                                <div className="col-span-4 text-sm text-slate-600 dark:text-slate-300 truncate font-medium">
                                    {item.soc_name || '-'}
                                </div>
                                <div className="col-span-2 text-right font-mono font-medium text-slate-800 dark:text-white">
                                    {formatCurrency(item.total_ttc)}
                                </div>
                                <div className="col-span-3 text-sm flex items-center gap-2">
                                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${item.isOverdue
                                        ? 'text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30'
                                        : 'text-slate-600 bg-slate-100 dark:text-slate-400 dark:bg-slate-800'
                                        }`}>
                                        <Calendar size={12} />
                                        {formatDateOnly(item.dueDate)}
                                    </div>
                                    {item.isOverdue && (
                                        <span className="text-[10px] font-bold text-red-600 uppercase tracking-tighter">Atrasado</span>
                                    )}
                                </div>
                                <div className="col-span-1 flex justify-center">
                                    <div className="w-2 h-2 rounded-full bg-orange-500" title="Pendente"></div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
