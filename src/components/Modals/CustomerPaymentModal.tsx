import React, { useState, useMemo, useEffect } from 'react';
import { X, Calendar, CreditCard, Hash, DollarSign, Wallet } from 'lucide-react';
import { Invoice } from '../../types';
import { useDolibarr } from '../../context/DolibarrContext';
import { useBankAccounts } from '../../hooks/dolibarr';
import { toast } from 'sonner';

interface CustomerPaymentModalProps {
    invoice: Invoice;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (paymentData: any) => Promise<void>;
}

// Map Dolibarr Payment Mode IDs to Labels (Standard + Common BR)
// For Customers, modes are similar.
const PAYMENT_MODES: { id: string, label: string }[] = [
    { id: '2', label: 'Transferência Bancária (VIR)' },
    { id: '3', label: 'Débito Automático (PR)' },
    { id: '4', label: 'Dinheiro (LIQ)' },
    { id: '6', label: 'Cartão de Crédito (CB)' },
    { id: '7', label: 'Cheque (CHQ)' },
    { id: '50', label: 'PayPal' },
    { id: '51', label: 'Stripe' },
    { id: '53', label: 'Pix' }
];

export const CustomerPaymentModal: React.FC<CustomerPaymentModalProps> = ({ invoice, isOpen, onClose, onConfirm }) => {
    const { config } = useDolibarr();
    const { data: bankAccounts = [] } = useBankAccounts(config);

    const [amount, setAmount] = useState<number>(0);
    const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [paymentModeId, setPaymentModeId] = useState<string>('');
    const [bankAccountId, setBankAccountId] = useState<string>(''); // Receiving Account
    const [numPayment, setNumPayment] = useState<string>('');
    const [note, setNote] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Reset when modal opens
    useEffect(() => {
        if (isOpen && invoice) {
            // Calculate remaining
            // Invoice type has 'paye' (paid or not) but simpler to trust total_ttc or calculate if we had payments data.
            // For now defaults to total.
            setAmount(invoice.total_ttc);
            setDate(new Date().toISOString().split('T')[0]);
            setPaymentModeId('2');
            setNumPayment('');
            setNote('');
            if (bankAccounts.length > 0) {
                setBankAccountId(String(bankAccounts[0].id));
            }
        }
    }, [isOpen, invoice, bankAccounts]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!amount || amount <= 0) {
            toast.error("O valor deve ser maior que zero");
            return;
        }
        if (!paymentModeId) {
            toast.error("Selecione um modo de pagamento");
            return;
        }

        setIsSubmitting(true);
        try {
            const paymentData = {
                date: new Date(date).getTime() / 1000,
                amount: amount,
                payment_mode_id: paymentModeId,
                num_payment: numPayment,
                fk_account: bankAccountId,
                note: note,
                // closepicked: '1' // Optional: asking if we should close invoice if fully paid. API might handle auto.
            };

            await onConfirm(paymentData);
            onClose();
        } catch (error) {
            console.error(error);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                    <div>
                        <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                            <Wallet className="text-emerald-500" size={20} />
                            Receber Pagamento
                        </h3>
                        <p className="text-xs text-slate-500">Fatura {invoice.ref}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-500">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">

                    {/* Amount & Date Row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase">Valor Recebido</label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    type="number"
                                    step="0.01"
                                    value={amount}
                                    onChange={e => setAmount(parseFloat(e.target.value))}
                                    className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-slate-700 dark:text-white"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase">Data</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    type="date"
                                    value={date}
                                    onChange={e => setDate(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-700 dark:text-white"
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    {/* Bank Account */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Conta de Destino (Banco)</label>
                        <div className="relative">
                            <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <select
                                value={bankAccountId}
                                onChange={e => setBankAccountId(e.target.value)}
                                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none appearance-none text-slate-700 dark:text-white"
                            >
                                <option value="">Caixa / Indefinido</option>
                                {bankAccounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>
                                        {acc.label} ({acc.bank})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Payment Mode */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Modo de Pagamento</label>
                        <select
                            value={paymentModeId}
                            onChange={e => setPaymentModeId(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none appearance-none text-slate-700 dark:text-white"
                            required
                        >
                            <option value="">Selecione...</option>
                            {PAYMENT_MODES.map(mode => (
                                <option key={mode.id} value={mode.id}>{mode.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Transaction Ref */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Num. Transação / Cheque</label>
                        <div className="relative">
                            <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                value={numPayment}
                                onChange={e => setNumPayment(e.target.value)}
                                placeholder="Opcional"
                                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-700 dark:text-white"
                            />
                        </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Observações</label>
                        <textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-700 dark:text-white h-20 text-sm"
                            placeholder="Anotações internas..."
                        />
                    </div>

                </form>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700 rounded-lg font-medium transition-colors"
                        disabled={isSubmitting}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm shadow-emerald-200/50 dark:shadow-none transition-all transform active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSubmitting ? 'Processando...' : 'Confirmar Recebimento'}
                    </button>
                </div>

            </div>
        </div>
    );
};
