import React, { useState, useMemo } from 'react';
import { useDolibarr } from '../context/DolibarrContext';
import { useInvoices, useSupplierInvoices, useCustomers, useSuppliers, useProjects } from '../hooks/dolibarr';
import { ArrowUpRight, ArrowDownRight, Clock, AlertCircle, CheckCircle2, Search, Filter, Calendar, X, FileText, Briefcase, Building2 } from 'lucide-react';
import { formatDateOnly, MS_PER_DAY } from '../utils/dateUtils';
import { formatCurrency } from '../utils/formatUtils';
import { PageLayout, PageHeader } from './ui';

interface PendingPaymentsProps {
    onNavigate?: (view: string, id: string) => void;
}

export const PendingPayments: React.FC<PendingPaymentsProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();
    const [activeTab, setActiveTab] = useState<'receivables' | 'payables'>('receivables');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

    const { data: invoicesData, isLoading: isLoadingInvoices, error: errorInvoices } = useInvoices(config);
    const { data: supplierInvoicesData, isLoading: isLoadingSupplier, error: errorSupplier } = useSupplierInvoices(config);
    const { data: customers = [] } = useCustomers(config);
    const { data: suppliers = [] } = useSuppliers(config);
    const { data: projects = [] } = useProjects(config);

    // Helper to check if date is past
    const isOverdue = (date: number) => {
        const d = date < 100000000000 ? date * 1000 : date;
        return new Date(d) < new Date();
    };

    // Lookup helpers
    const getCustomerName = (socid: string) => {
        if (!socid) return null;
        const found = customers.find(c => String(c.id) === String(socid));
        return found ? found.name : null;
    };

    const getSupplierName = (socid: string) => {
        if (!socid) return null;
        const found = suppliers.find(s => String(s.id) === String(socid));
        return found ? found.name : null;
    };

    const getProjectName = (projectId?: string) => {
        if (!projectId) return null;
        const found = projects.find(p => String(p.id) === String(projectId));
        return found ? found.title : null;
    };

    // Filter Receivables (Customer Invoices)
    const receivables = useMemo(() => {
        if (!invoicesData) return [];
        return invoicesData
            .filter(inv => inv.statut === '1') // Unpaid
            .map(inv => {
                const dueDate = inv.date_lim_reglement || (inv.date + 30 * MS_PER_DAY);
                const resolvedName = getCustomerName(inv.socid) || inv.soc_name || null;
                return {
                    ...inv,
                    type: 'receivable',
                    dueDate: dueDate,
                    isOverdue: isOverdue(dueDate),
                    resolvedName,
                };
            })
            .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
    }, [invoicesData, customers]);

    // Filter Payables (Supplier Invoices)
    const payables = useMemo(() => {
        if (!supplierInvoicesData) return [];
        return supplierInvoicesData
            .filter(inv => inv.statut === '1') // Unpaid
            .map(inv => {
                const dueDate = inv.date_lim_reglement || (inv.date + 30 * MS_PER_DAY);
                const resolvedName = getSupplierName(inv.socid) || inv.soc_name || null;
                return {
                    ...inv,
                    type: 'payable',
                    dueDate: dueDate,
                    isOverdue: isOverdue(dueDate),
                    resolvedName,
                };
            })
            .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
    }, [supplierInvoicesData, suppliers]);

    const displayedItems = useMemo(() => {
        const source = activeTab === 'receivables' ? receivables : payables;
        if (!searchTerm) return source;
        const lowerTerm = searchTerm.toLowerCase();
        return source.filter(item =>
            item.ref.toLowerCase().includes(lowerTerm) ||
            (item.resolvedName || '').toLowerCase().includes(lowerTerm)
        );
    }, [activeTab, receivables, payables, searchTerm]);

    const totalReceivables = receivables.reduce((sum, item) => sum + item.total_ttc, 0);
    const totalPayables = payables.reduce((sum, item) => sum + item.total_ttc, 0);
    const totalOverdueReceivables = receivables.filter(i => i.isOverdue).reduce((sum, item) => sum + item.total_ttc, 0);
    const totalOverduePayables = payables.filter(i => i.isOverdue).reduce((sum, item) => sum + item.total_ttc, 0);

    const isLoading = activeTab === 'receivables' ? isLoadingInvoices : isLoadingSupplier;
    const error = activeTab === 'receivables' ? errorInvoices : errorSupplier;

    const selectedItem = useMemo(() => {
        if (!selectedItemId) return null;
        return displayedItems.find(i => i.id === selectedItemId) ?? null;
    }, [selectedItemId, displayedItems]);

    return (
        <PageLayout noPadding title="Pagamentos Pendentes">
            {/* Page Header */}
            <PageHeader
                title="Pagamentos Pendentes"
                subtitle="Gerencie suas contas a pagar e a receber em um só lugar."
            />

            <div className="p-4 md:p-6 space-y-4 flex flex-col flex-1">

                {/* Summary Cards — tabs de seleção A Receber / A Pagar */}
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

                {/* List + Detail Section — flex row no desktop, empilhado no mobile */}
                <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">

                    {/* List Panel */}
                    <div className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col transition-all ${selectedItem ? 'md:w-1/2 lg:w-2/5' : 'flex-1'}`}>

                        {/* Toolbar — título da lista + busca */}
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <h2 className="font-bold text-slate-800 dark:text-white truncate">
                                    {activeTab === 'receivables' ? 'Faturas de Clientes (Entrada)' : 'Faturas de Fornecedores (Saída)'}
                                </h2>
                                <span className="shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs px-2 py-1 rounded-full font-medium">
                                    {displayedItems.length}
                                </span>
                            </div>
                            <div className="relative w-full sm:max-w-xs">
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

                        {/* List Header — oculto no mobile, visível a partir de md */}
                        <div className="hidden md:grid grid-cols-12 gap-4 p-4 bg-slate-50 dark:bg-slate-950/50 text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-slate-200 dark:border-slate-800">
                            <div className="col-span-2">Referência</div>
                            <div className="col-span-4">{activeTab === 'receivables' ? 'Cliente' : 'Fornecedor'}</div>
                            <div className="col-span-2 text-right">Valor</div>
                            <div className="col-span-3">Vencimento</div>
                            <div className="col-span-1 text-center">Status</div>
                        </div>

                        {/* List Content */}
                        <div className="overflow-y-auto flex-1 p-2 space-y-2">
                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12 gap-3">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                                    <p className="text-sm">Carregando...</p>
                                </div>
                            ) : error ? (
                                <div className="flex flex-col items-center justify-center h-full text-red-400 py-12 gap-3">
                                    <AlertCircle size={32} className="opacity-50" />
                                    <p className="text-sm">Erro ao carregar dados. Tente novamente.</p>
                                </div>
                            ) : displayedItems.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                                    <CheckCircle2 size={48} className="mb-4 opacity-20" />
                                    <p>Nenhum pagamento pendente encontrado.</p>
                                </div>
                            ) : (
                                displayedItems.map((item) => (
                                    <div
                                        key={item.id}
                                        onClick={() => setSelectedItemId(item.id === selectedItemId ? null : item.id)}
                                        className={`rounded-lg border cursor-pointer transition-colors ${
                                            item.id === selectedItemId
                                                ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 ring-1 ring-indigo-300 dark:ring-indigo-700'
                                                : item.isOverdue
                                                ? 'bg-red-50/50 dark:bg-red-900/5 border-red-100 dark:border-red-900/30 hover:bg-red-50 dark:hover:bg-red-900/10'
                                                : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-900 hover:shadow-sm'
                                        }`}
                                    >
                                        {/* Desktop row — grid-cols-12, visível a partir de md */}
                                        <div className="hidden md:grid grid-cols-12 gap-4 p-3 items-center">
                                            <div className="col-span-2 font-medium text-slate-800 dark:text-white flex items-center gap-2">
                                                {item.ref}
                                            </div>
                                            <div className="col-span-4 text-sm text-slate-600 dark:text-slate-300 truncate font-medium">
                                                {item.resolvedName || '-'}
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

                                        {/* Mobile card — empilhado, visível apenas abaixo de md */}
                                        <div className="md:hidden p-3 space-y-1.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-medium text-slate-800 dark:text-white">{item.ref}</span>
                                                <div className="w-2 h-2 rounded-full bg-orange-500 shrink-0" title="Pendente"></div>
                                            </div>
                                            {item.resolvedName && (
                                                <p className="text-sm text-slate-600 dark:text-slate-300 truncate">{item.resolvedName}</p>
                                            )}
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                                <span className="font-mono font-medium text-slate-800 dark:text-white text-sm">
                                                    {formatCurrency(item.total_ttc)}
                                                </span>
                                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${item.isOverdue
                                                    ? 'text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30'
                                                    : 'text-slate-600 bg-slate-100 dark:text-slate-400 dark:bg-slate-800'
                                                    }`}>
                                                    <Calendar size={12} />
                                                    {formatDateOnly(item.dueDate)}
                                                    {item.isOverdue && (
                                                        <span className="ml-1 font-bold text-red-600 uppercase">Atrasado</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Detail Panel */}
                    {selectedItem && (
                        <div className="flex-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
                            {/* Detail Header */}
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${selectedItem.isOverdue ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'}`}>
                                        <FileText size={20} />
                                    </div>
                                    <div>
                                        <h2 className="font-bold text-slate-800 dark:text-white">{selectedItem.ref}</h2>
                                        <p className="text-xs text-slate-500">
                                            {activeTab === 'receivables' ? 'Fatura de Cliente' : 'Fatura de Fornecedor'}
                                            {selectedItem.isOverdue && (
                                                <span className="ml-2 text-red-600 font-bold uppercase">• Atrasado</span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedItemId(null)}
                                    className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    aria-label="Fechar detalhes"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Detail Content */}
                            <div className="overflow-y-auto flex-1 p-4 space-y-4">

                                {/* Amount + Due */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                                        <p className="text-xs text-slate-500 mb-1">Valor Total</p>
                                        <p className="text-xl font-bold text-slate-800 dark:text-white font-mono">{formatCurrency(selectedItem.total_ttc)}</p>
                                    </div>
                                    <div className={`rounded-xl p-4 ${selectedItem.isOverdue ? 'bg-red-50 dark:bg-red-900/20' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
                                        <p className="text-xs text-slate-500 mb-1">Vencimento</p>
                                        <p className={`text-xl font-bold font-mono ${selectedItem.isOverdue ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-white'}`}>
                                            {formatDateOnly(selectedItem.dueDate)}
                                        </p>
                                    </div>
                                </div>

                                {/* Client / Supplier */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Building2 size={14} className="text-slate-400" />
                                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                                            {activeTab === 'receivables' ? 'Cliente' : 'Fornecedor'}
                                        </p>
                                    </div>
                                    <p className="text-sm font-semibold text-slate-800 dark:text-white">
                                        {selectedItem.resolvedName || (
                                            <span className="text-slate-400 italic">
                                                {selectedItem.socid ? `ID: ${selectedItem.socid}` : 'Não informado'}
                                            </span>
                                        )}
                                    </p>
                                </div>

                                {/* Project */}
                                {selectedItem.project_id && (
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Briefcase size={14} className="text-slate-400" />
                                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Projeto</p>
                                        </div>
                                        <p className="text-sm font-semibold text-slate-800 dark:text-white">
                                            {getProjectName(selectedItem.project_id) || (
                                                <span className="text-slate-400 italic">ID: {selectedItem.project_id}</span>
                                            )}
                                        </p>
                                    </div>
                                )}

                                {/* Dates */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-3">
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Datas</p>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-slate-500">Emissão</span>
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatDateOnly(selectedItem.date)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-slate-500">Vencimento</span>
                                        <span className={`text-sm font-medium ${selectedItem.isOverdue ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {formatDateOnly(selectedItem.dueDate)}
                                        </span>
                                    </div>
                                </div>

                                {/* Open in full view button */}
                                {onNavigate && (
                                    <button
                                        onClick={() => onNavigate(activeTab === 'receivables' ? 'invoices' : 'supplier_invoices', selectedItem.id)}
                                        className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
                                    >
                                        <FileText size={16} />
                                        Ver fatura completa
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </PageLayout>
    );
};
