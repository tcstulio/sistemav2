import React, { useState, useMemo } from 'react';
import { Payment, DolibarrConfig, AppView } from '../types';
import { Search, ArrowDownLeft, Calendar, FileText, TrendingUp, Wallet } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { usePayments, useInvoices } from '../hooks/dolibarr';

interface PaymentListProps {
    onNavigate?: (view: AppView, id: string) => void;
}

const PaymentList: React.FC<PaymentListProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();

    // Switch to usePayments hook
    const { data: paymentsData } = usePayments(config);
    const rawPayments = paymentsData || [];

    const { data: invoicesData } = useInvoices(config);
    const invoices = invoicesData || [];

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    // Removed type filter as Payment module doesn't typically expose "type" (Card/Transfer) directly in the list
    // unless extra fields are fetched or mapped. Standard Payment object has ref, amount, date.

    // Filter payments
    const payments = useMemo(() => {
        return rawPayments.filter(p => {
            const matchesSearch = p.ref.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        }).sort((a, b) => b.date_payment - a.date_payment);
    }, [rawPayments, searchTerm]);

    const totalReceived = useMemo(() => payments.reduce((acc, p) => acc + p.amount, 0), [payments]);

    // Try to find matching invoice for context (linked via ref or amount heuristic if link missing)
    const getInvoiceRef = (p: Payment) => {
        // Precise matching if we had linked object IDs, but for now simple heuristic or ref matching
        // Many payments in Dolibarr are linked to invoices. 
        // Ideally we'd use a `getPaymentDistributed` or similar to know deeper links, but here we can try:
        // 1. Is the payment ref containing invoice ref? (Rare)
        // 2. Is there an invoice with this exact amount and mostly same date?
        const match = invoices.find(inv =>
            // Basic amount match
            Math.abs(inv.total_ttc - p.amount) < 0.05 &&
            // Date proximity (within 30 days?)
            Math.abs((inv.date || 0) - p.date_payment) < 30 * 24 * 3600 * 1000
        );
        return match;
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">
            {/* Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <TrendingUp className="text-emerald-500" /> Pagamentos
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Histórico de pagamentos recebidos</p>
                    </div>
                    <div className="flex items-center gap-4 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-xl border border-emerald-100 dark:border-emerald-800">
                        <div className="text-emerald-600 dark:text-emerald-400 font-bold text-lg">${totalReceived.toLocaleString()}</div>
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

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                {payments.length === 0 ? (
                    <div className="text-center py-20 text-slate-400">
                        <Wallet size={48} className="mx-auto mb-4 opacity-50" />
                        <p>Nenhum pagamento encontrado.</p>
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {payments.map(p => {
                            const inv = getInvoiceRef(p);
                            return (
                                <div key={p.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full">
                                            <ArrowDownLeft size={20} />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">{p.ref}</h4>
                                            <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                                                <Calendar size={12} /> {new Date(p.date_payment).toLocaleDateString()}
                                                {inv && (
                                                    <span
                                                        className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline"
                                                        onClick={() => onNavigate && onNavigate('invoices', inv.id)}
                                                    >
                                                        <FileText size={10} /> {inv.ref}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">+${p.amount.toLocaleString()}</div>
                                        <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Recebido</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PaymentList;