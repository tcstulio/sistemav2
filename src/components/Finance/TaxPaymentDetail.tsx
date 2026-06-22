import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDolibarr } from '../../context/DolibarrContext';
import { useVATPayments, useSocialContributionPayments, useBankAccounts } from '../../hooks/dolibarr';
import { ArrowLeft, Calendar, Landmark, CreditCard } from 'lucide-react';
import { formatDate, formatCurrency } from '../../utils/formatUtils';
import { formatDateOnly } from '../../utils/dateUtils';

/** Exibe o bloco de Origem de forma legível: rótulo + período quando disponíveis, ID como fallback */
interface OrigemBlockProps {
    payment: {
        type: 'VAT' | 'SOCIAL';
        fk_tva?: string;
        fk_charge?: string;
        label_origem?: string;
        periodo_inicio?: number;
        periodo_fim?: number;
    };
}

const OrigemBlock: React.FC<OrigemBlockProps> = ({ payment }) => {
    const rawId = payment.fk_tva || payment.fk_charge;
    const tipoLabel = payment.type === 'VAT' ? 'IVA' : 'Encargo Social';

    // Rótulo legível: prefere label_origem (para encargos), senão usa o tipo + período
    let rotulo: string | null = null;
    if (payment.label_origem) {
        rotulo = payment.label_origem;
    } else if (payment.periodo_inicio) {
        rotulo = `${tipoLabel} — ${formatDateOnly(payment.periodo_inicio)}${payment.periodo_fim ? ` a ${formatDateOnly(payment.periodo_fim)}` : ''}`;
    }

    return (
        <div>
            {rotulo ? (
                <>
                    <div className="font-medium text-sm text-slate-800 dark:text-white" data-testid="origem-rotulo">{rotulo}</div>
                    {rawId && <div className="text-xs text-slate-400 font-mono mt-0.5">ID: {rawId}</div>}
                </>
            ) : (
                <div className="font-mono text-sm text-slate-800 dark:text-white" data-testid="origem-id-fallback">
                    {tipoLabel} #{rawId || '-'}
                </div>
            )}
        </div>
    );
};

interface TaxPaymentDetailProps {
    onNavigate?: (view: string, id: string) => void;
}

const TaxPaymentDetail: React.FC<TaxPaymentDetailProps> = ({ onNavigate }) => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { config } = useDolibarr();

    // Hooks
    const { data: vatPayments } = useVATPayments(config);
    const { data: socialPayments } = useSocialContributionPayments(config);
    const { data: bankAccounts } = useBankAccounts(config);

    // Find payment in either list
    const payment = useMemo((): {
        type: 'VAT' | 'SOCIAL'; label: string;
        id: string; ref: string; amount: number; date_payment: number; fk_bank: string;
        fk_tva?: string; fk_charge?: string;
        num_payment?: string; label_origem?: string;
        periodo_inicio?: number; periodo_fim?: number;
    } | null => {
        const vatFound = vatPayments?.find(p => String(p.id) === String(id));
        if (vatFound) return { ...vatFound, type: 'VAT' as const, label: 'Imposto (IVA)' };

        const socialFound = socialPayments?.find(p => String(p.id) === String(id));
        if (socialFound) return { ...socialFound, type: 'SOCIAL' as const, label: 'Encargo Social' };

        return null;
    }, [vatPayments, socialPayments, id]);

    // Derived Data
    const bankAccount = useMemo(() => {
        if (!payment?.fk_bank) return null;
        return bankAccounts?.find(b => String(b.id) === String(payment.fk_bank));
    }, [payment, bankAccounts]);

    if (!payment) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-slate-500">
                <div className="animate-pulse mb-4">Carregando detalhes...</div>
                <button
                    onClick={() => navigate('/tax_payments')}
                    className="text-indigo-600 hover:underline"
                >
                    Voltar para lista
                </button>
            </div>
        );
    }

    const isVAT = payment.type === 'VAT';

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="flex-none bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 flex items-center gap-4">
                <button
                    onClick={() => navigate(-1)}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Landmark className={isVAT ? "text-indigo-500" : "text-pink-500"} />
                        Pagamento {payment.ref}
                    </h1>
                    <div className="flex items-center gap-2 mt-1">
                        <span className={`px-2 py-0.5 rounded textxs font-bold uppercase ${isVAT ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300' : 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300'}`}>
                            {payment.label}
                        </span>
                        <div className="text-sm text-slate-500 flex items-center gap-1">
                            <Calendar size={12} />
                            {formatDate(payment.date_payment)}
                        </div>
                    </div>
                </div>
                <div className="ml-auto flex items-center gap-4">
                    <div className="text-right">
                        <div className="text-sm text-slate-500 uppercase font-bold text-xs">Valor Pago</div>
                        <div className={`text-2xl font-bold ${isVAT ? 'text-indigo-600 dark:text-indigo-400' : 'text-pink-600 dark:text-pink-400'}`}>
                            {formatCurrency(payment.amount)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8">
                <div className="max-w-2xl mx-auto space-y-6">

                    {/* Details Card */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                        <h3 className="font-bold text-slate-800 dark:text-white mb-4">Informações do Pagamento</h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <div className="text-xs text-slate-500">Origem</div>
                                <OrigemBlock payment={payment} />
                            </div>

                            <div>
                                <div className="text-xs text-slate-500">Data</div>
                                <div className="font-medium text-slate-800 dark:text-white">{formatDate(payment.date_payment)}</div>
                            </div>

                            {payment.num_payment && (
                                <div>
                                    <div className="text-xs text-slate-500">Comprovante / Nº Documento</div>
                                    <div className="font-mono text-sm text-slate-800 dark:text-white">{payment.num_payment}</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bank Info */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                        <h3 className="font-bold text-slate-800 dark:text-white mb-4">Conta Bancária</h3>

                        {bankAccount ? (
                            <div>
                                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                    <CreditCard size={12} /> Conta
                                </div>
                                <div className="font-medium text-indigo-600 dark:text-indigo-400">
                                    {bankAccount.label}
                                </div>
                                <div className="text-xs text-slate-400 font-mono mt-0.5">
                                    {bankAccount.bank} - {bankAccount.number}
                                </div>
                            </div>
                        ) : (
                            <div className="text-slate-400 italic">
                                Conta não identificada (ID: {payment.fk_bank})
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
};

export default TaxPaymentDetail;
