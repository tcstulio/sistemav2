import React, { useState, useMemo, useEffect } from 'react';
import { Payment, DolibarrConfig, AppView, Invoice } from '../types';
import { Search, ArrowDownLeft, Calendar, FileText, TrendingUp, Wallet, Link2, X, ChevronLeft, CreditCard, Copy, StickyNote, Hash, User } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { usePayments, useInvoices, usePaymentInvoiceLinks, useBankAccounts, useUsers } from '../hooks/dolibarr';
import { formatDateOnly } from '../utils/dateUtils';
import { formatDate, formatCurrency } from '../utils/formatUtils';
import { GenericListLayout } from './common/GenericListLayout';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { toast } from 'sonner';

// Map Dolibarr Payment Mode IDs to Labels (copied from PaymentDetail)
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

interface PaymentListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
}

const PaymentList: React.FC<PaymentListProps> = ({ onNavigate, initialItemId }) => {
    const { config } = useDolibarr();

    // Data Hooks
    const { data: paymentsData } = usePayments(config);
    const rawPayments = paymentsData || [];

    const { data: invoicesData } = useInvoices(config);
    const invoices = invoicesData || [];

    const { data: linksData } = usePaymentInvoiceLinks(config);
    const links = linksData || [];

    const { data: bankAccounts } = useBankAccounts(config);
    const { data: users } = useUsers(config);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

    // Deep Link Effect
    useEffect(() => {
        if (initialItemId && rawPayments.length > 0) {
            const match = rawPayments.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedPayment(match);
            }
        }
    }, [initialItemId, rawPayments]);

    if (!config) return <div className="p-8 text-center flex items-center justify-center gap-2 text-slate-500"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500"></div> Carregando...</div>;

    // Filter payments
    const payments = useMemo(() => {
        return rawPayments.filter(p => {
            const matchesSearch = p.ref.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        }).sort((a, b) => b.date_payment - a.date_payment);
    }, [rawPayments, searchTerm]);

    const totalReceived = useMemo(() => payments.reduce((acc, p) => acc + p.amount, 0), [payments]);

    // Find linked invoices for a payment
    const getLinkedInvoices = (paymentId: string) => {
        const paymentLinks = links.filter(l => String(l.fk_paiement) === String(paymentId));
        return paymentLinks.map(link => {
            const inv = invoices.find(i => String(i.id) === String(link.fk_facture));
            return {
                invoice: inv,
                amount: link.amount,
                linkId: link.id
            };
        }).filter(item => item.invoice);
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copiado para a área de transferência');
    };

    // --- Sub-components ---

    const renderHeader = (
        <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <TrendingUp className="text-emerald-500" /> Pagamentos
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Histórico de pagamentos recebidos</p>
                </div>
                <div className="flex items-center gap-4 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-xl border border-emerald-100 dark:border-emerald-800">
                    <div className="text-emerald-600 dark:text-emerald-400 font-bold text-lg">${totalReceived.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-emerald-800 dark:text-emerald-300 uppercase font-bold tracking-wide">Total</div>
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
                        className="pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none w-full text-sm"
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

        const linkedInvoices = getLinkedInvoices(p.id);

        return (
            <div
                style={itemStyle}
                onClick={() => setSelectedPayment(p)}
                className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group ${selectedPayment?.id === p.id
                    ? `border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20`
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'
                    }`}
            >
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-full ${selectedPayment?.id === p.id ? 'bg-emerald-200 text-emerald-700' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'}`}>
                        <ArrowDownLeft size={20} />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{p.ref}</h4>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                            <Calendar size={12} /> {formatDateOnly(p.date_payment)}
                        </div>

                        {/* Linked Invoices (Collapsed View) */}
                        {linkedInvoices.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {linkedInvoices.slice(0, 3).map((link, idx) => (
                                    <span
                                        key={idx}
                                        className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-xs text-indigo-600 dark:text-indigo-400 ring-1 ring-slate-200 dark:ring-slate-700"
                                        title={`Pago ${link.amount.toLocaleString()}`}
                                    >
                                        <Link2 size={10} />
                                        <span className="font-mono">{link.invoice?.ref}</span>
                                    </span>
                                ))}
                                {linkedInvoices.length > 3 && (
                                    <span className="text-xs text-slate-400">+{linkedInvoices.length - 3}</span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div className="text-right pl-4 border-l border-slate-100 dark:border-slate-800 md:border-0 md:pl-0">
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">+${p.amount.toLocaleString()}</div>
                    <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Recebido</div>
                </div>
            </div>
        );
    };

    const renderListContent = payments.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
            <Wallet size={48} className="mx-auto mb-4 opacity-50" />
            <p>Nenhum pagamento encontrado.</p>
        </div>
    ) : (
        <AutoSizer>
            {({ height, width }) => (
                <ListWindow
                    height={height}
                    width={width}
                    itemCount={payments.length}
                    itemSize={120} // Slightly taller to accommodate potential tags
                >
                    {Row}
                </ListWindow>
            )}
        </AutoSizer>
    );

    // Detail Panel
    const renderDetail = selectedPayment ? (
        <div className="flex flex-col h-full">
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedPayment(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ChevronLeft size={20} /></button>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold dark:text-white leading-tight">{selectedPayment.ref}</h2>
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                            <Calendar size={10} />
                            {formatDate(selectedPayment.date_payment)}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <div className="text-[10px] text-slate-500 uppercase font-bold">Valor</div>
                        <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(selectedPayment.amount)}
                        </div>
                    </div>
                    <button onClick={() => setSelectedPayment(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">

                {/* Allocations Card */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden mb-6">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <Link2 size={18} className="text-indigo-500" />
                            Faturas Vinculadas
                        </h3>
                    </div>

                    {(() => {
                        const linkedInvoices = getLinkedInvoices(selectedPayment.id);
                        return linkedInvoices.length > 0 ? (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {linkedInvoices.map(({ invoice, amount, linkId }) => (
                                    <div key={linkId} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500">
                                                <FileText size={20} />
                                            </div>
                                            <div>
                                                <div
                                                    className="font-medium text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline"
                                                    onClick={() => onNavigate && invoice && onNavigate('invoices', invoice.id)}
                                                >
                                                    {invoice ? invoice.ref : `Fatura não encontrada`}
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
                                                {formatCurrency(amount)}
                                            </div>
                                            <div className="text-[10px] text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full inline-block mt-1">
                                                Pago
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-8 text-center text-slate-400 italic">
                                Este pagamento não está vinculado a nenhuma fatura conhecida.
                            </div>
                        );
                    })()}
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-1 gap-6">

                    {/* Transaction Details */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5">
                        <h3 className="font-bold text-slate-800 dark:text-white mb-4 text-xs uppercase tracking-wider text-slate-500">Detalhes da Transação</h3>

                        <div className="space-y-4">
                            {selectedPayment.num_paiement && (
                                <div>
                                    <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                        <Hash size={12} /> Nº Documento / Cheque
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

                            {/* Bank Account Logic */}
                            {(() => {
                                const targetId = selectedPayment.bank_account_id || selectedPayment.fk_bank;
                                const bankAccount = bankAccounts?.find(b => String(b.id) === String(targetId));

                                return bankAccount ? (
                                    <div>
                                        <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                            <CreditCard size={12} /> Conta Bancária
                                        </div>
                                        <div className="font-medium text-indigo-600 dark:text-indigo-400 text-sm">
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
                                            {targetId ? `ID: ${targetId} (Desconhecida)` : 'Não informada'}
                                        </div>
                                    </div>
                                );
                            })()}

                            <div>
                                <div className="text-xs text-slate-500 mb-1">Modo de Pagamento</div>
                                <div className="text-slate-700 dark:text-slate-300 text-sm font-medium">
                                    {selectedPayment.mode_id ? (PAYMENT_MODES[String(selectedPayment.mode_id)] || `ID: ${selectedPayment.mode_id}`) : 'Não especificado'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Notes */}
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

                    {/* System Info */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5">
                        {(() => {
                            const author = users?.find(u => String(u.id) === String(selectedPayment.user_author_id));
                            return (
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

                                    <div>
                                        <div className="text-xs text-slate-400">ID Interno</div>
                                        <div className="font-mono text-xs text-slate-600 dark:text-slate-500">{selectedPayment.id}</div>
                                    </div>
                                    {selectedPayment.date_creation && (
                                        <div>
                                            <div className="text-xs text-slate-400">Criado em</div>
                                            <div className="text-xs text-slate-600 dark:text-slate-500">{formatDate(selectedPayment.date_creation)}</div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>

                </div>
            </div>
        </div>
    ) : (
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

export default PaymentList;