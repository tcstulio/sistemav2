import React, { useState, useMemo, useEffect } from 'react';
import { Payment, AppView } from '../types';
import { ArrowDownLeft, Calendar, FileText, TrendingUp, Wallet, Link2, X, CreditCard, Copy, StickyNote, Hash, User, Building2, CalendarDays } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { usePayments, useInvoices, usePaymentInvoiceLinks, useBankAccounts, useUsers, useCustomers, useProjects } from '../hooks/dolibarr';
import { useListControls } from '../hooks/useListControls';
import { formatDateOnly } from '../utils/dateUtils';
import { formatDate, formatCurrency } from '../utils/formatUtils';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { toast } from 'sonner';

// Design System
import { PageHeader, MasterDetailLayout, Card, EmptyState, ListToolbar, Spinner, ErrorState } from './ui';

// Safety-net: garante uma altura mínima para a lista virtualizada mesmo quando o
// AutoSizer ainda reporta height = 0 (cadeia flex sem altura resolvida). Evita que
// o react-window não renderize nenhuma linha e a página fique travada (#651).
const MIN_LIST_HEIGHT = 400;

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

interface PaymentListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
}

const PaymentList: React.FC<PaymentListProps> = ({ onNavigate, initialItemId }) => {
    const { config, isLoading: configLoading, error: configError } = useDolibarr();

    // Data Hooks
    const {
        data: paymentsData,
        isLoading: paymentsLoading,
        isError,
        isFetching,
        error: paymentsError,
        refetch,
    } = usePayments(config);
    const rawPayments = paymentsData || [];

    const { data: invoicesData } = useInvoices(config);
    const invoices = invoicesData || [];

    const { data: linksData } = usePaymentInvoiceLinks(config);
    const links = linksData || [];

    const { data: bankAccounts } = useBankAccounts(config);
    const { data: users } = useUsers(config);
    const { data: customers } = useCustomers(config);
    const { data: projects } = useProjects(config);

    const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

    // Busca + ordenação + filtro padronizados (#121).
    const controls = useListControls(rawPayments, {
        searchText: (p) => {
            // Resolve cliente e evento para inclusão na busca textual
            const socId = p.fk_soc ?? p.socid;
            const projId = p.project_id ?? p.fk_projet;
            let custName = '';
            let projTitle = '';

            if (socId != null) {
                const c = customers?.find(c => String(c.id) === String(socId));
                if (c) custName = c.name;
            }
            if (projId != null) {
                const pr = projects?.find(pr => String(pr.id) === String(projId));
                if (pr) projTitle = pr.title;
            }
            // Fallback via fatura vinculada quando os campos diretos não existem
            if (!custName || !projTitle) {
                const paymentLinks = links.filter(l => String(l.fk_paiement) === String(p.id));
                for (const link of paymentLinks) {
                    const inv = invoices.find(i => String(i.id) === String(link.fk_facture));
                    if (inv) {
                        if (!custName && inv.socid) {
                            const c = customers?.find(c => String(c.id) === String(inv.socid));
                            if (c) custName = c.name;
                        }
                        if (!projTitle && inv.project_id) {
                            const pr = projects?.find(pr => String(pr.id) === String(inv.project_id));
                            if (pr) projTitle = pr.title;
                        }
                        if (custName && projTitle) break;
                    }
                }
            }
            return `${p.ref || ''} ${p.num_paiement || ''} ${p.note || ''} ${custName} ${projTitle}`;
        },
        sorts: [
            { key: 'date', label: 'Data', get: (p) => new Date(p.date_payment).getTime() || 0 },
            { key: 'amount', label: 'Valor', get: (p) => p.amount ?? 0 },
            { key: 'ref', label: 'Referência', get: (p) => p.ref },
        ],
        filters: [
            {
                key: 'mode',
                label: 'Modo',
                get: (p) => (p.mode_id != null ? String(p.mode_id) : ''),
                options: Object.entries(PAYMENT_MODES).map(([value, label]) => ({ value, label })),
            },
        ],
        initialSortKey: 'date',
        initialSortDir: 'desc',
    });
    const payments = controls.result;

    // Deep Link Effect
    useEffect(() => {
        if (initialItemId && rawPayments.length > 0) {
            const match = rawPayments.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedPayment(match);
            }
        }
    }, [initialItemId, rawPayments]);

    const totalReceived = useMemo(() => payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0), [payments]);

    // Find linked invoices for a payment
    const getLinkedInvoices = (paymentId: number | string) => {
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

    // Deriva cliente e evento para um pagamento.
    // Fonte primária: campos fk_soc/project_id do próprio Payment (quando disponíveis).
    // Fallback: primeira fatura vinculada (socid + project_id).
    const getPaymentContext = (payment: Payment) => {
        const socId = payment.fk_soc ?? payment.socid;
        const projId = payment.project_id ?? payment.fk_projet;

        let customerId: string | undefined = socId != null ? String(socId) : undefined;
        let projectId: string | undefined = projId != null ? String(projId) : undefined;

        // Fallback via fatura vinculada
        if (!customerId || !projectId) {
            const linked = getLinkedInvoices(payment.id);
            if (linked.length > 0 && linked[0].invoice) {
                const inv = linked[0].invoice;
                if (!customerId && inv.socid) customerId = String(inv.socid);
                if (!projectId && inv.project_id) projectId = String(inv.project_id);
            }
        }

        const customer = customerId ? customers?.find(c => String(c.id) === customerId) : undefined;
        const project = projectId ? projects?.find(p => String(p.id) === projectId) : undefined;

        return {
            customer: customer ? { id: customer.id, name: customer.name } : (customerId ? { id: customerId, name: `Cliente #${customerId}` } : undefined),
            project: project ? { id: project.id, title: project.title } : (projectId ? { id: projectId, title: `Evento #${projectId}` } : undefined),
        };
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copiado para a área de transferência');
    };

    // Detail derived data (calculado antes dos guards p/ manter a ordem dos hooks do React)
    const detailData = useMemo(() => {
        if (!selectedPayment) return null;

        const targetId = selectedPayment.bank_account_id || selectedPayment.fk_bank;
        const bankAccount = targetId ? bankAccounts?.find(b => String(b.id) === String(targetId)) : null;
        const author = selectedPayment.user_author_id ? users?.find(u => String(u.id) === String(selectedPayment.user_author_id)) : null;
        const paymentModeLabel = selectedPayment.mode_id
            ? (PAYMENT_MODES[String(selectedPayment.mode_id)] || `ID: ${selectedPayment.mode_id}`)
            : 'Não especificado';
        const linkedInvoices = getLinkedInvoices(selectedPayment.id);

        const context = getPaymentContext(selectedPayment);

        return { bankAccount, author, paymentModeLabel, linkedInvoices, context };
    }, [selectedPayment, bankAccounts, users, links, invoices, customers, projects]);

    // ---- Guards: loading / error (#648) ----
    // Config ainda não resolvido (ex.: hidratação do IndexedDB pendente).
    if (!config || configLoading) {
        return (
            <div className="p-8 text-center flex items-center justify-center gap-2 text-slate-500">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500" /> Carregando...
            </div>
        );
    }

    // Primeira carga dos pagamentos (sem dados ainda) -> spinner centralizado.
    if (paymentsLoading && !paymentsData) {
        return (
            <div className="flex flex-col h-full items-center justify-center gap-3 p-8 bg-slate-50 dark:bg-slate-950">
                <Spinner size="lg" />
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Carregando pagamentos…</p>
            </div>
        );
    }

    // Erro na query -> card de erro amigável + botão de retry.
    if (isError) {
        const errorMessage =
            (paymentsError instanceof Error ? paymentsError.message : (paymentsError ? String(paymentsError) : '')) ||
            configError ||
            'Não foi possível carregar os pagamentos.';
        return (
            <div className="flex flex-col h-full items-center justify-center p-8 bg-slate-50 dark:bg-slate-950">
                <ErrorState message={errorMessage} onRetry={() => refetch()} />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">

            {/* Header */}
            <div className={selectedPayment ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title={
                        <span className="flex items-center gap-2">
                            <TrendingUp className="text-emerald-500" size={24} /> Pagamentos
                        </span>
                    }
                    subtitle="Histórico de pagamentos recebidos"
                    actions={
                        <div className="flex items-center gap-3">
                            {isFetching && (
                                <span
                                    data-testid="payments-fetching-indicator"
                                    className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500"
                                    title="Atualizando pagamentos…"
                                >
                                    <Spinner size="sm" className="text-slate-400 dark:text-slate-500" />
                                </span>
                            )}
                            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-xl border border-emerald-100 dark:border-emerald-800">
                                <div className="text-emerald-600 dark:text-emerald-400 font-bold text-lg">{formatCurrency(totalReceived)}</div>
                                <div className="text-xs text-emerald-800 dark:text-emerald-300 uppercase font-bold tracking-wide">Total</div>
                            </div>
                            <ListToolbar controls={controls} searchPlaceholder="Buscar pagamento..." />
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
                    <div className={`h-full transition-opacity ${isFetching ? 'opacity-60 pointer-events-none' : 'opacity-100'}`} style={{ minHeight: MIN_LIST_HEIGHT }}>
                        {payments.length === 0 ? (
                            <div className="p-6">
                                <EmptyState
                                    icon={Wallet}
                                    title="Nenhum pagamento encontrado"
                                    description="Nenhum pagamento registrado."
                                />
                            </div>
                        ) : (
                            <AutoSizer>
                                {({ height, width }: { height: number; width: number }) => (
                                    <ListWindow
                                        height={Math.max(height, MIN_LIST_HEIGHT)}
                                        width={width}
                                        itemCount={payments.length}
                                        itemSize={160}
                                    >
                                        {({ index, style }: { index: number; style: React.CSSProperties }) => {
                                            const p = payments[index];
                                            const linkedInvoices = getLinkedInvoices(p.id);
                                            const ctx = getPaymentContext(p);

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
                                                                <div className="p-2 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 shrink-0">
                                                                    <ArrowDownLeft size={16} />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <h4 className="font-bold text-slate-800 dark:text-white text-sm truncate">{p.ref}</h4>
                                                                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                                                        <Calendar size={10} /> {formatDateOnly(p.date_payment)}
                                                                    </div>
                                                                    <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-500 truncate">
                                                                        <Building2 size={10} className="shrink-0" />
                                                                        {ctx.customer
                                                                            ? <span className="truncate">{ctx.customer.name}</span>
                                                                            : <span className="italic text-slate-400">Cliente não informado</span>
                                                                        }
                                                                    </div>
                                                                    <div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-500 truncate">
                                                                        <CalendarDays size={10} className="shrink-0" />
                                                                        {ctx.project
                                                                            ? <span className="truncate">{ctx.project.title}</span>
                                                                            : <span className="italic text-slate-400">Sem evento</span>
                                                                        }
                                                                    </div>
                                                                    {linkedInvoices.length > 0 && (
                                                                        <div className="flex items-center gap-1 mt-1 text-[10px] text-indigo-500">
                                                                            <Link2 size={10} /> {linkedInvoices.length} fatura{linkedInvoices.length > 1 ? 's' : ''}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <div className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">+{formatCurrency(p.amount)}</div>
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
                                title={selectedPayment.ref}
                                subtitle={`${formatDate(selectedPayment.date_payment)} • ${formatCurrency(selectedPayment.amount)}`}
                                onBack={() => setSelectedPayment(null)}
                                actions={
                                    <button onClick={() => setSelectedPayment(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                                }
                            />

                            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">

                                    {/* Allocations Card */}
                                    <Card header={
                                        <div className="flex justify-between items-center">
                                            <span className="flex items-center gap-2"><Link2 size={16} className="text-indigo-500" /> Faturas Vinculadas</span>
                                            <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full text-xs font-bold">
                                                {detailData.linkedInvoices.length}
                                            </span>
                                        </div>
                                    }>
                                        {detailData.linkedInvoices.length > 0 ? (
                                            <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-4 -mb-4">
                                                {detailData.linkedInvoices.map(({ invoice, amount, linkId }) => (
                                                    <div key={linkId} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                                        <div className="flex items-center gap-3">
                                                            <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500">
                                                                <FileText size={18} />
                                                            </div>
                                                            <div>
                                                                <div
                                                                    className="font-medium text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline text-sm"
                                                                    onClick={() => onNavigate && invoice && onNavigate('invoices', invoice.id)}
                                                                >
                                                                    {invoice ? invoice.ref : 'Fatura não encontrada'}
                                                                </div>
                                                                {invoice && (
                                                                    <div className="text-xs text-slate-500">
                                                                        Original: {formatCurrency(invoice.total_ttc)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="font-bold text-slate-700 dark:text-slate-300 text-sm">
                                                            {formatCurrency(amount)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-slate-400 italic">
                                                Este pagamento não está vinculado a nenhuma fatura conhecida.
                                            </p>
                                        )}
                                    </Card>

                                    {/* Cliente e Evento */}
                                    <Card header="Cliente e Evento">
                                        <div className="space-y-4">
                                            <div>
                                                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                                    <Building2 size={12} /> Cliente
                                                </div>
                                                {detailData.context.customer ? (
                                                    <div
                                                        className="font-medium text-indigo-600 dark:text-indigo-400 text-sm cursor-pointer hover:underline"
                                                        onClick={() => onNavigate && detailData.context.customer && onNavigate('customers', detailData.context.customer.id)}
                                                    >
                                                        {detailData.context.customer.name}
                                                    </div>
                                                ) : (
                                                    <div className="text-slate-400 italic text-sm">Cliente não informado</div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                                    <CalendarDays size={12} /> Evento / Projeto
                                                </div>
                                                {detailData.context.project ? (
                                                    <div
                                                        className="font-medium text-indigo-600 dark:text-indigo-400 text-sm cursor-pointer hover:underline"
                                                        onClick={() => onNavigate && detailData.context.project && onNavigate('projects', detailData.context.project.id)}
                                                    >
                                                        {detailData.context.project.title}
                                                    </div>
                                                ) : (
                                                    <div className="text-slate-400 italic text-sm">Sem evento</div>
                                                )}
                                            </div>
                                        </div>
                                    </Card>

                                    {/* Transaction Details */}
                                    <Card header="Detalhes da Transação">
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
                                                    <div className="text-slate-400 italic text-sm">Não informada</div>
                                                </div>
                                            )}

                                            <div>
                                                <div className="text-xs text-slate-500 mb-1">Modo de Pagamento</div>
                                                <div className="text-slate-700 dark:text-slate-300 text-sm font-medium">
                                                    {detailData.paymentModeLabel}
                                                </div>
                                            </div>
                                        </div>
                                    </Card>

                                    {/* Notes */}
                                    {selectedPayment.note && (
                                        <Card header={<span className="flex items-center gap-2"><StickyNote size={16} className="text-amber-500" /> Observações</span>}>
                                            <div className="p-3 bg-amber-50 dark:bg-amber-900/10 text-amber-900 dark:text-amber-100 rounded-lg text-sm whitespace-pre-wrap leading-relaxed border border-amber-100 dark:border-amber-800/30">
                                                {selectedPayment.note}
                                            </div>
                                        </Card>
                                    )}

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
                                                            {detailData.author.login || `Usuário #${selectedPayment.user_author_id}`}
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
                                    </Card>

                                </div>
                            </div>
                        </div>
                    )
                }
            />
        </div>
    );
};

export default PaymentList;
