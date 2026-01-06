import React, { useState, useMemo, useEffect } from 'react';
import { AppView, SupplierPayment } from '../types';
import { Search, ArrowUpRight, Calendar, TrendingDown, Wallet, Link2, X, FileText, StickyNote, Hash, CreditCard, User, ChevronLeft, Copy } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { useSupplierPayments, useSupplierInvoices, useSupplierPaymentInvoiceLinks, useBankAccounts, useUsers } from '../hooks/dolibarr';
import { formatDateOnly } from '../utils/dateUtils';
import { formatCurrency, formatDate } from '../utils/formatUtils';
import { toast } from 'sonner';
import { GenericListLayout } from './common/GenericListLayout';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

interface SupplierPaymentListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
}

// Map Dolibarr Payment Mode IDs to Labels
const PAYMENT_MODES: Record<string, string> = {
    '2': 'Transferência Bancária (VIR)',
    '3': 'Débito Automático (PR)',
    '4': 'Dinheiro (LIQ)',
    '6': 'Cartão de Crédito (CB)',
    '7': 'Cheque (CHQ)',
    '50': 'PayPal',
    '51': 'Stripe',
    '52': 'PagSeguro',
    '53': 'Pix'
};

const SupplierPaymentList: React.FC<SupplierPaymentListProps> = ({ onNavigate, initialItemId }) => {
    const { config } = useDolibarr();

    // Data Hooks
    const { data: paymentsData } = useSupplierPayments(config);
    const rawPayments = paymentsData || [];

    const { data: invoicesData } = useSupplierInvoices(config);
    const invoices = invoicesData || [];

    const { data: linksData } = useSupplierPaymentInvoiceLinks(config);
    const links = linksData || [];

    const { data: bankAccounts } = useBankAccounts(config);
    const { data: users } = useUsers(config);

    if (!config) return <div className="p-8 text-center flex items-center justify-center gap-2 text-slate-500"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500"></div> Carregando...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPayment, setSelectedPayment] = useState<SupplierPayment | null>(null);
    const [showDebug, setShowDebug] = useState(false);

    // Deep Link Effect
    useEffect(() => {
        if (initialItemId && rawPayments.length > 0) {
            const match = rawPayments.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedPayment(match);
            }
        }
    }, [initialItemId, rawPayments]);

    // Filter payments
    const payments = useMemo(() => {
        return rawPayments.filter(p => {
            const matchesSearch = p.ref.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        }).sort((a, b) => Number(b.date_payment) - Number(a.date_payment));
    }, [rawPayments, searchTerm]);

    const totalPaid = useMemo(() => payments.reduce((acc, p) => acc + Number(p.amount), 0), [payments]);

    // Helper: Find linked invoices for a payment
    const getLinkedInvoices = (paymentId: string) => {
        const paymentLinks = links.filter(l => String(l.fk_paiementfourn) === String(paymentId));
        return paymentLinks.map(link => {
            const inv = invoices.find(i => String(i.id) === String(link.fk_facturefourn));
            return {
                link,
                invoice: inv,
                amount: link.amount
            };
        }).filter(item => item.invoice); // Ensure we have the invoice object
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copiado para a área de transferência');
    };

    // --- RENDER SUB-COMPONENTS ---

    const renderHeader = (
        <div className="flex flex-col gap-4 p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <TrendingDown className="text-rose-500" /> Pagamentos de Fornecedores
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Histórico de saídas e pagamentos realizados</p>
                </div>
                <div className="flex items-center gap-4 bg-rose-50 dark:bg-rose-900/20 px-4 py-2 rounded-xl border border-rose-100 dark:border-rose-800">
                    <div className="text-rose-600 dark:text-rose-400 font-bold text-lg">-${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-rose-800 dark:text-rose-300 uppercase font-bold tracking-wide">Total Pago</div>
                </div>
            </div>

            <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                    type="text"
                    placeholder="Buscar ref..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-rose-500 outline-none w-full text-sm"
                />
            </div>
        </div>
    );

    const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
        const p = payments[index];
        const linkedInvoices = getLinkedInvoices(String(p.id));

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
                className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md group flex flex-col md:flex-row md:items-center justify-between gap-4 ${selectedPayment?.id === p.id
                        ? 'bg-rose-50 dark:bg-rose-900/10 border-rose-500 dark:border-rose-500'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-200 dark:hover:border-rose-800'
                    }`}
                onClick={() => setSelectedPayment(p)}
            >
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-full ${selectedPayment?.id === p.id
                            ? 'bg-rose-200 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'
                            : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                        }`}>
                        <ArrowUpRight size={20} />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{p.ref}</h4>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                            <Calendar size={12} /> {formatDateOnly(p.date_payment)}
                            {p.num_paiement && (
                                <>
                                    <span className="mx-1">•</span>
                                    <span>{p.num_paiement}</span>
                                </>
                            )}
                        </div>

                        {/* Linked Invoices Preview */}
                        {linkedInvoices.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {linkedInvoices.slice(0, 3).map((item, idx) => (
                                    <span
                                        key={idx}
                                        className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-[10px] text-rose-600 dark:text-rose-400 ring-1 ring-slate-200 dark:ring-slate-700"
                                    >
                                        <Link2 size={10} />
                                        <span className="font-mono">{item.invoice?.ref}</span>
                                        <span className="text-slate-400 mx-0.5">|</span>
                                        <span>${Number(item.amount).toLocaleString()}</span>
                                    </span>
                                ))}
                                {linkedInvoices.length > 3 && (
                                    <span className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-[10px] text-slate-500">
                                        +{linkedInvoices.length - 3}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div className="text-right pl-4 border-l border-slate-100 dark:border-slate-800 md:border-0 md:pl-0">
                    <div className="text-lg font-bold text-rose-600 dark:text-rose-400">-${Number(p.amount).toLocaleString()}</div>
                    <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Pago</div>
                </div>
            </div>
        );
    };

    const renderListContent = payments.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
            <Wallet size={48} className="mx-auto mb-4 opacity-50" />
            <p>Nenhum pagamento de fornecedor encontrado.</p>
        </div>
    ) : (
        <AutoSizer>
            {({ height, width }) => (
                <ListWindow
                    height={height}
                    width={width}
                    itemCount={payments.length}
                    itemSize={120} // Slightly taller for invoices chips
                >
                    {Row}
                </ListWindow>
            )}
        </AutoSizer>
    );

    // Detail Logic using selectedPayment and hooks
    const renderDetail = selectedPayment ? (() => {
        // We can safely use hooks here or calculate derived data as this function is called inside render
        // But to be consistent with React rules, ideally we extract this to a component or 
        // rely on data available in the main scope.
        // Derived data:
        const bankAccount = selectedPayment.bank_account_id || selectedPayment.fk_bank
            ? bankAccounts?.find(b => String(b.id) === String(selectedPayment.bank_account_id || selectedPayment.fk_bank))
            : null;

        const author = selectedPayment.user_author_id
            ? users?.find(u => String(u.id) === String(selectedPayment.user_author_id))
            : null;

        const paymentModeLabel = selectedPayment.mode_id
            ? (PAYMENT_MODES[String(selectedPayment.mode_id)] || `ID: ${selectedPayment.mode_id}`)
            : 'Não especificado';

        const allocations = getLinkedInvoices(String(selectedPayment.id));

        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950/50">
                {/* Detail Header */}
                <div className="flex-none bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setSelectedPayment(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ChevronLeft size={20} /></button>
                        <div>
                            <h2 className="text-lg font-bold dark:text-white leading-tight flex items-center gap-2">
                                <Wallet className="text-emerald-500" size={20} />
                                {selectedPayment.ref}
                            </h2>
                            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                <Calendar size={12} /> {formatDate(selectedPayment.date_payment)}
                            </div>
                        </div>
                    </div>
                    <div className="text-right hidden sm:block">
                        <div className="text-xs text-slate-500 uppercase font-bold">Valor Total</div>
                        <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(selectedPayment.amount)}
                        </div>
                    </div>
                    <button onClick={() => setSelectedPayment(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
                    {/* Main Info Column */}
                    <div className="space-y-6">

                        {/* Allocations Card */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <Link2 size={18} className="text-indigo-500" />
                                    Faturas Vinculadas
                                </h3>
                                <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full text-xs font-bold">
                                    {allocations.length}
                                </span>
                            </div>

                            {allocations.length > 0 ? (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {allocations.map(({ link, invoice }) => (
                                        <div key={link.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500">
                                                    <FileText size={20} />
                                                </div>
                                                <div>
                                                    <div
                                                        className="font-medium text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline"
                                                        onClick={() => {
                                                            setSelectedPayment(null);
                                                            if (onNavigate && invoice) onNavigate('supplier_invoices', invoice.id);
                                                        }}
                                                    >
                                                        {invoice ? invoice.ref : `Fatura #${link.fk_facturefourn}`}
                                                    </div>
                                                    {invoice && (
                                                        <div className="text-xs text-slate-500">
                                                            Original: {formatCurrency(invoice.total_ttc)}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold text-slate-700 dark:text-slate-300">
                                                    {formatCurrency(link.amount)}
                                                </div>
                                                <div className="text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 rounded-full inline-block mt-1">
                                                    Pago
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center text-slate-400 italic">
                                    Este pagamento não está vinculado a nenhuma fatura conhecida.
                                    <br /><span className="text-xs text-slate-300">Pode ser um adiantamento ou o vínculo ainda não foi sincronizado.</span>
                                </div>
                            )}
                        </div>

                        {/* Notes Card */}
                        {selectedPayment.note && (
                            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
                                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                                    <StickyNote size={18} className="text-amber-500" />
                                    Observações
                                </h3>
                                <div className="p-4 bg-amber-50 dark:bg-amber-900/10 text-amber-900 dark:text-amber-100 rounded-lg text-sm whitespace-pre-wrap leading-relaxed border border-amber-100 dark:border-amber-800/30">
                                    {selectedPayment.note}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Transaction Details */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5">
                        <h3 className="font-bold text-slate-800 dark:text-white mb-4 text-sm uppercase tracking-wider text-slate-500">Detalhes da Transação</h3>

                        <div className="space-y-4">
                            {selectedPayment.num_paiement && (
                                <div>
                                    <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                        <Hash size={12} /> Nº Documento / Cheque
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
                                    {selectedPayment.transaction_id && selectedPayment.transaction_id !== selectedPayment.bank_account_id && (
                                        <div className="text-[10px] text-slate-400 mt-1">
                                            Transação: {selectedPayment.transaction_id}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div>
                                    <div className="text-xs text-slate-500 mb-1">Conta Bancária</div>
                                    <div className="text-slate-400 italic text-sm">
                                        {selectedPayment.bank_account_id
                                            ? `Conta ID: ${selectedPayment.bank_account_id} (Não encontrada)`
                                            : (selectedPayment.transaction_id ? `Transação ID: ${selectedPayment.transaction_id} (Conta não identificada)` : 'Não informada')
                                        }
                                    </div>
                                </div>
                            )}

                            <div>
                                <div className="text-xs text-slate-500 mb-1">Modo de Pagamento</div>
                                <div className="text-slate-700 dark:text-slate-300 text-sm font-medium">
                                    {paymentModeLabel}
                                </div>
                            </div>
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
                                            {author.login || `Usuário #${selectedPayment.user_author_id}`}
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
        );
    })() : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Wallet size={48} className="mb-4 opacity-50" />
            <p>Selecione um pagamento para ver detalhes.</p>
        </div>
    );

    return (
        <GenericListLayout
            header={renderHeader}
            content={renderListContent}
            detail={renderDetail}
            isDetailOpen={!!selectedPayment}
        />
    );
};

export default SupplierPaymentList;
