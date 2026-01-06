import React, { useMemo, useState, useEffect } from 'react';
import { AppView, ExpenseReportPayment, ExpenseReport } from '../../types';
import { ExpenseDetailModal } from '../HR/modals/ExpenseDetailModal';

import { Search, Calendar, FileText, Wallet, Receipt, X, ChevronLeft, CreditCard, User, Copy, Hash } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { useExpenseReportPayments, useExpenseReports, useExpenseReportPaymentLinks, useBankAccounts, useUsers, useExpenseReportLines, useProjects } from '../../hooks/dolibarr';

import { formatDateOnly } from '../../utils/dateUtils';
import { formatCurrency, formatDate } from '../../utils/formatUtils';
import { GenericListLayout } from '../common/GenericListLayout';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { toast } from 'sonner';

interface ExpenseReportPaymentListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
}

const ExpenseReportPaymentList: React.FC<ExpenseReportPaymentListProps> = ({ onNavigate, initialItemId }) => {
    const { config } = useDolibarr();

    // Data Hooks
    const { data: paymentsData = [] } = useExpenseReportPayments(config);
    const { data: reports = [] } = useExpenseReports(config);
    const { data: links = [] } = useExpenseReportPaymentLinks(config);
    const { data: bankAccounts = [] } = useBankAccounts(config);
    const { data: users = [] } = useUsers(config);
    const { data: expenseReportLines = [] } = useExpenseReportLines(config);
    const { data: projects = [] } = useProjects(config);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPayment, setSelectedPayment] = useState<ExpenseReportPayment | null>(null);
    const [viewingExpenseReport, setViewingExpenseReport] = useState<ExpenseReport | null>(null);
    const [showDebug, setShowDebug] = useState(false);


    // Deep Link Effect
    useEffect(() => {
        if (initialItemId && paymentsData.length > 0) {
            const match = paymentsData.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedPayment(match);
            }
        }
    }, [initialItemId, paymentsData]);

    // Filter
    const payments = useMemo(() => {
        return paymentsData.filter(p => {
            const matchesSearch = p.ref.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        }).sort((a, b) => b.date_payment - a.date_payment);
    }, [paymentsData, searchTerm]);

    const totalPaid = useMemo(() => payments.reduce((acc, p) => acc + p.amount, 0), [payments]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copiado para a área de transferência');
    };

    if (!config) return <div className="p-8 text-center flex items-center justify-center gap-2 text-slate-500"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500"></div> Carregando...</div>;


    // --- HELPERS FOR DETAIL ---
    const getLinkedReports = (payment: ExpenseReportPayment) => {
        // Direct link
        const directReport = payment.fk_expensereport
            ? reports.find(r => String(r.id) === String(payment.fk_expensereport))
            : null;

        // Link table
        const linked = links
            .filter(l => String(l.fk_payment) === String(payment.id))
            .map(link => ({
                link,
                report: reports.find(r => String(r.id) === String(link.fk_expensereport))
            }));

        // Combine
        const list = [...linked];
        if (directReport && !list.find(l => l.report?.id === directReport.id)) {
            list.push({ link: { id: 'direct', amount: payment.amount } as any, report: directReport });
        }
        return list;
    };


    // --- RENDERERS ---

    const renderHeader = (
        <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Receipt className="text-purple-500" /> Pagamentos de Despesas
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Reembolsos de relatórios de despesas</p>
                </div>
                <div className="flex items-center gap-4 bg-purple-50 dark:bg-purple-900/20 px-4 py-2 rounded-xl border border-purple-100 dark:border-purple-800">
                    <div className="text-purple-600 dark:text-purple-400 font-bold text-lg">${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-purple-800 dark:text-purple-300 uppercase font-bold tracking-wide">Total Reembolsado</div>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar ref..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 outline-none w-full text-sm"
                    />
                </div>
            </div>
        </div>
    );

    const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
        const p = payments[index];
        const itemStyle = {
            ...style,
            top: (parseFloat(style.top as string) + 8) + 'px',
            height: (parseFloat(style.height as string) - 8) + 'px',
            left: '8px',
            width: 'calc(100% - 16px)'
        };

        return (
            <div
                style={itemStyle}
                onClick={() => setSelectedPayment(p)}
                className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md group flex flex-col md:flex-row md:items-center justify-between gap-4 ${selectedPayment?.id === p.id
                    ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-500 dark:border-purple-500'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-purple-200 dark:hover:border-purple-800'
                    }`}
            >
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-full ${selectedPayment?.id === p.id
                        ? 'bg-purple-200 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'
                        : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                        }`}>
                        <FileText size={20} />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{p.ref}</h4>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                            <Calendar size={12} /> {formatDateOnly(p.date_payment)}
                        </div>
                    </div>
                </div>
                <div className="text-right pl-4 border-l border-slate-100 dark:border-slate-800 md:border-0 md:pl-0">
                    <div className="text-lg font-bold text-slate-700 dark:text-slate-300">-${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Pago</div>
                </div>
            </div>
        );
    };

    const renderListContent = payments.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
            <Wallet size={48} className="mx-auto mb-4 opacity-50" />
            <p>Nenhum pagamento de despesa encontrado.</p>
        </div>
    ) : (
        <AutoSizer>
            {({ height, width }) => (
                <ListWindow
                    height={height}
                    width={width}
                    itemCount={payments.length}
                    itemSize={100}
                >
                    {Row}
                </ListWindow>
            )}
        </AutoSizer>
    );

    const renderDetail = selectedPayment ? (() => {
        const bankAccount = selectedPayment.fk_bank
            ? bankAccounts.find(b => String(b.id) === String(selectedPayment.fk_bank))
            : null;

        const author = selectedPayment.fk_user_creat
            ? users.find(u => String(u.id) === String(selectedPayment.fk_user_creat))
            : null;

        const finalReports = getLinkedReports(selectedPayment);

        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950/50">
                {/* Header */}
                <div className="flex-none bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setSelectedPayment(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ChevronLeft size={20} /></button>
                        <div>
                            <h2 className="text-lg font-bold dark:text-white leading-tight flex items-center gap-2">
                                <Receipt className="text-purple-500" size={20} />
                                {selectedPayment.ref}
                            </h2>
                            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                <Calendar size={12} /> {formatDate(selectedPayment.date_payment)}
                            </div>
                        </div>
                    </div>
                    <div className="text-right hidden sm:block">
                        <div className="text-xs text-slate-500 uppercase font-bold">Valor Total</div>
                        <div className="text-xl font-bold text-purple-600 dark:text-purple-400">
                            {formatCurrency(selectedPayment.amount)}
                        </div>
                    </div>
                    <button onClick={() => setSelectedPayment(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
                    {/* Main Info */}
                    <div className="space-y-6">

                        {/* Reports Card */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <FileText size={18} className="text-purple-500" />
                                    Relatórios de Despesas
                                </h3>
                                <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full text-xs font-bold">
                                    {finalReports.length}
                                </span>
                            </div>

                            {finalReports.length > 0 ? (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {finalReports.map(({ link, report }, idx) => (
                                        <div
                                            key={idx}
                                            className={`p-4 flex items-center justify-between transition-colors ${report ? 'hover:bg-purple-50 dark:hover:bg-purple-900/10 cursor-pointer' : ''}`}
                                            onClick={() => report && setViewingExpenseReport(report)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500">
                                                    <Receipt size={20} />
                                                </div>
                                                <div>
                                                    <div className="font-medium text-slate-700 dark:text-slate-300">
                                                        {report ? report.ref : `Relatório #${link.fk_expensereport || selectedPayment.fk_expensereport || '?'}`}
                                                    </div>
                                                    {report && (
                                                        <div className="text-xs text-slate-500">
                                                            Total: {formatCurrency(report.total_ttc)} | Status: {report.statut}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold text-slate-700 dark:text-slate-300">
                                                    {formatCurrency(link.amount)}
                                                </div>
                                                <div className="text-xs text-purple-600 bg-purple-50 dark:bg-purple-900/20 px-2 rounded-full inline-block mt-1">
                                                    Reembolsado
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center text-slate-400 italic">
                                    Este pagamento não está vinculado a nenhuma despesa conhecida.
                                </div>
                            )}
                        </div>

                        {/* Transaction Details */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4 text-sm uppercase tracking-wider text-slate-500">Detalhes da Transação</h3>
                            <div className="space-y-4">
                                {bankAccount ? (
                                    <div>
                                        <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                            <CreditCard size={12} /> Conta Bancária
                                        </div>
                                        <div className="font-medium text-indigo-600 dark:text-indigo-400">
                                            {bankAccount.label}
                                        </div>
                                        <div className="text-xs text-slate-400 font-mono mt-0.5">
                                            {bankAccount.bank} - {bankAccount.number}
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div className="text-xs text-slate-500 mb-1">Conta Bancária</div>
                                        <div className="text-slate-400 italic text-sm">
                                            {selectedPayment.fk_bank ? `Conta ID: ${selectedPayment.fk_bank}` : 'Não informada'}
                                        </div>
                                    </div>
                                )}

                                {selectedPayment.num_paiement && (
                                    <div>
                                        <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                            <Hash size={12} /> Nº Documento
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                                                {selectedPayment.num_paiement}
                                            </span>
                                            <button onClick={() => copyToClipboard(selectedPayment.num_paiement!)} className="text-slate-400 hover:text-indigo-500">
                                                <Copy size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* System Info */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5">
                            <div className="space-y-3">
                                {author && (
                                    <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
                                            <User size={16} />
                                        </div>
                                        <div>
                                            <div className="text-xs text-slate-500">Registrado por</div>
                                            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                {author.login || `Usuário #${selectedPayment.fk_user_creat}`}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="flex justify-between items-center">
                                    <div>
                                        <div className="text-xs text-slate-400">ID Interno</div>
                                        <div className="font-mono text-xs text-slate-600 dark:text-slate-500">{selectedPayment.id}</div>
                                    </div>
                                    <button
                                        onClick={() => setShowDebug(!showDebug)}
                                        className="text-[10px] text-slate-300 hover:text-slate-500"
                                    >
                                        DEBUG
                                    </button>
                                </div>
                                {showDebug && (
                                    <textarea
                                        readOnly
                                        className="w-full h-24 text-[10px] font-mono p-1 border border-slate-200 bg-slate-50 rounded"
                                        value={JSON.stringify(selectedPayment, null, 2)}
                                    />
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        );
    })() : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Receipt size={48} className="mb-4 opacity-50" />
            <p>Selecione um pagamento para ver detalhes.</p>
        </div>
    );

    return (
        <>
            <GenericListLayout
                header={renderHeader}
                content={renderListContent}
                detail={renderDetail}
                isDetailOpen={!!selectedPayment}
            />
            {viewingExpenseReport && (
                <ExpenseDetailModal
                    expense={viewingExpenseReport}
                    onClose={() => setViewingExpenseReport(null)}
                    config={config}
                    users={users}
                    expenseReportLines={expenseReportLines}
                    expenseReportPayments={paymentsData}
                    projects={projects}
                    onNavigate={onNavigate}
                />
            )}
        </>

    );
};

export default ExpenseReportPaymentList;
