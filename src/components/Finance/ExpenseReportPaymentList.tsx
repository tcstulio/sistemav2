import React, { useMemo, useState, useEffect } from 'react';
import { AppView, ExpenseReportPayment, ExpenseReport } from '../../types';
import { ExpenseDetailModal } from '../HR/modals/ExpenseDetailModal';

import { Calendar, FileText, Wallet, Receipt, X, CreditCard, User, Copy, Hash } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { useExpenseReportPayments, useExpenseReports, useExpenseReportPaymentLinks, useBankAccounts, useUsers, useExpenseReportLines, useProjects } from '../../hooks/dolibarr';
import { useListControls } from '../../hooks/useListControls';

import { formatDateOnly } from '../../utils/dateUtils';
import { formatCurrency, formatDate } from '../../utils/formatUtils';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { toast } from 'sonner';

// Design System
import { PageHeader, MasterDetailLayout, Card, EmptyState, ListToolbar } from '../ui';

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

    const [selectedPayment, setSelectedPayment] = useState<ExpenseReportPayment | null>(null);
    const [viewingExpenseReport, setViewingExpenseReport] = useState<ExpenseReport | null>(null);
    const [showDebug, setShowDebug] = useState(false);

    // Busca + ordenação padronizadas (#121). Pagamentos não são deletáveis (sem deleteX seguro).
    const controls = useListControls(paymentsData, {
        searchText: (p) => `${p.ref || ''} ${p.num_paiement || ''}`,
        sorts: [
            { key: 'date', label: 'Data', get: (p) => p.date_payment ?? 0 },
            { key: 'amount', label: 'Valor', get: (p) => p.amount ?? 0 },
            { key: 'ref', label: 'Referência', get: (p) => p.ref },
        ],
        initialSortKey: 'date',
        initialSortDir: 'desc',
    });
    const payments = controls.result;

    // Deep Link Effect
    useEffect(() => {
        if (initialItemId && paymentsData.length > 0) {
            const match = paymentsData.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedPayment(match);
            }
        }
    }, [initialItemId, paymentsData]);

    const totalPaid = useMemo(() => payments.reduce((acc, p) => acc + p.amount, 0), [payments]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copiado para a área de transferência');
    };

    if (!config) return <div className="p-8 text-center flex items-center justify-center gap-2 text-slate-500"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500"></div> Carregando...</div>;

    // Helper: linked reports
    const getLinkedReports = (payment: ExpenseReportPayment) => {
        const directReport = payment.fk_expensereport
            ? reports.find(r => String(r.id) === String(payment.fk_expensereport))
            : null;

        const linked = links
            .filter(l => String(l.fk_payment) === String(payment.id))
            .map(link => ({
                link,
                report: reports.find(r => String(r.id) === String(link.fk_expensereport))
            }));

        const list = [...linked];
        if (directReport && !list.find(l => l.report?.id === directReport.id)) {
            list.push({ link: { id: 'direct', amount: payment.amount } as any, report: directReport });
        }
        return list;
    };

    // Detail derived data
    const detailData = useMemo(() => {
        if (!selectedPayment) return null;

        const bankAccount = selectedPayment.fk_bank
            ? bankAccounts.find(b => String(b.id) === String(selectedPayment.fk_bank))
            : null;
        const author = selectedPayment.fk_user_creat
            ? users.find(u => String(u.id) === String(selectedPayment.fk_user_creat))
            : null;
        const linkedReports = getLinkedReports(selectedPayment);

        return { bankAccount, author, linkedReports };
    }, [selectedPayment, bankAccounts, users, links, reports]);

    return (
        <>
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">

                {/* Header */}
                <div className={selectedPayment ? 'hidden lg:block' : 'block'}>
                    <PageHeader
                        title={
                            <span className="flex items-center gap-2">
                                <Receipt className="text-purple-500" size={24} /> Pagamentos de Despesas
                            </span>
                        }
                        subtitle="Reembolsos de relatórios de despesas"
                        actions={
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 bg-purple-50 dark:bg-purple-900/20 px-4 py-2 rounded-xl border border-purple-100 dark:border-purple-800">
                                    <div className="text-purple-600 dark:text-purple-400 font-bold text-lg">{formatCurrency(totalPaid)}</div>
                                    <div className="text-xs text-purple-800 dark:text-purple-300 uppercase font-bold tracking-wide">Total</div>
                                </div>
                                <ListToolbar controls={controls} searchPlaceholder="Buscar ref/número..." />
                            </div>
                        }
                    />
                </div>

                {/* Master-Detail Layout */}
                <MasterDetailLayout
                    showDetail={!!selectedPayment}
                    onCloseDetail={() => setSelectedPayment(null)}
                    listWidth="1/3"
                    list={
                        <div className="h-full">
                            {payments.length === 0 ? (
                                <div className="p-6">
                                    <EmptyState
                                        icon={Wallet}
                                        title="Nenhum pagamento encontrado"
                                        description="Nenhum pagamento de despesa encontrado."
                                    />
                                </div>
                            ) : (
                                <AutoSizer>
                                    {({ height, width }: { height: number; width: number }) => (
                                        <ListWindow
                                            height={height}
                                            width={width}
                                            itemCount={payments.length}
                                            itemSize={100}
                                        >
                                            {({ index, style }: { index: number; style: React.CSSProperties }) => {
                                                const p = payments[index];

                                                return (
                                                    <div style={{ ...style, paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}>
                                                        <Card
                                                            onClick={() => setSelectedPayment(p)}
                                                            selected={selectedPayment?.id === p.id}
                                                            hoverable
                                                            padding="md"
                                                        >
                                                            <div className="flex items-center justify-between gap-4">
                                                                <div className="flex items-center gap-3 min-w-0">
                                                                    <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 shrink-0">
                                                                        <FileText size={16} />
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <h4 className="font-bold text-slate-800 dark:text-white text-sm truncate">{p.ref}</h4>
                                                                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                                                            <Calendar size={10} /> {formatDateOnly(p.date_payment)}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="text-right shrink-0">
                                                                    <div className="font-bold text-slate-700 dark:text-slate-300 text-sm">-{formatCurrency(p.amount)}</div>
                                                                </div>
                                                            </div>
                                                        </Card>
                                                    </div>
                                                );
                                            }}
                                        </ListWindow>
                                    )}
                                </AutoSizer>
                            )}
                        </div>
                    }
                    detail={
                        selectedPayment && detailData && (
                            <div className="flex flex-col h-full">
                                <PageHeader
                                    title={
                                        <span className="flex items-center gap-2">
                                            <Receipt className="text-purple-500" size={20} />
                                            {selectedPayment.ref}
                                        </span>
                                    }
                                    subtitle={`${formatDate(selectedPayment.date_payment)} • ${formatCurrency(selectedPayment.amount)}`}
                                    onBack={() => setSelectedPayment(null)}
                                    actions={
                                        <button onClick={() => setSelectedPayment(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                                    }
                                />

                                <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50">
                                    <div className="max-w-3xl mx-auto space-y-6">

                                        {/* Reports Card */}
                                        <Card header={
                                            <div className="flex justify-between items-center">
                                                <span className="flex items-center gap-2"><FileText size={16} className="text-purple-500" /> Relatórios de Despesas</span>
                                                <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full text-xs font-bold">
                                                    {detailData.linkedReports.length}
                                                </span>
                                            </div>
                                        }>
                                            {detailData.linkedReports.length > 0 ? (
                                                <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-4 -mb-4">
                                                    {detailData.linkedReports.map(({ link, report }, idx) => (
                                                        <div
                                                            key={idx}
                                                            className={`px-4 py-3 flex items-center justify-between transition-colors ${report ? 'hover:bg-purple-50 dark:hover:bg-purple-900/10 cursor-pointer' : ''}`}
                                                            onClick={() => report && setViewingExpenseReport(report)}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500">
                                                                    <Receipt size={18} />
                                                                </div>
                                                                <div>
                                                                    <div className="font-medium text-slate-700 dark:text-slate-300 text-sm">
                                                                        {report ? report.ref : `Relatório #${link.fk_expensereport || selectedPayment.fk_expensereport || '?'}`}
                                                                    </div>
                                                                    {report && (
                                                                        <div className="text-xs text-slate-500">
                                                                            Total: {formatCurrency(report.total_ttc)}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="font-bold text-slate-700 dark:text-slate-300 text-sm">
                                                                {formatCurrency(link.amount)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-sm text-slate-400 italic">
                                                    Este pagamento não está vinculado a nenhuma despesa conhecida.
                                                </p>
                                            )}
                                        </Card>

                                        {/* Transaction Details */}
                                        <Card header="Detalhes da Transação">
                                            <div className="space-y-4">
                                                {detailData.bankAccount ? (
                                                    <div>
                                                        <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                                            <CreditCard size={12} /> Conta Bancária
                                                        </div>
                                                        <div className="font-medium text-indigo-600 dark:text-indigo-400 text-sm">
                                                            {detailData.bankAccount.label}
                                                        </div>
                                                        <div className="text-xs text-slate-400 font-mono mt-0.5">
                                                            {detailData.bankAccount.bank} - {detailData.bankAccount.number}
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
                                                            <span className="font-mono text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-sm">
                                                                {selectedPayment.num_paiement}
                                                            </span>
                                                            <button onClick={() => copyToClipboard(selectedPayment.num_paiement!)} className="text-slate-400 hover:text-indigo-500">
                                                                <Copy size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </Card>

                                        {/* System Info */}
                                        <Card>
                                            <div className="space-y-3">
                                                {detailData.author && (
                                                    <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                                                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
                                                            <User size={16} />
                                                        </div>
                                                        <div>
                                                            <div className="text-xs text-slate-500">Registrado por</div>
                                                            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                                {detailData.author.login || `Usuário #${selectedPayment.fk_user_creat}`}
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
                                        </Card>

                                    </div>
                                </div>
                            </div>
                        )
                    }
                />
            </div>

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
