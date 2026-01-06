import React, { useMemo, useState } from 'react';
import { AppView } from '../../types';
import { Search, Calendar, TrendingUp, Wallet, Landmark } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { useVATPayments, useSocialContributionPayments } from '../../hooks/dolibarr';
import { formatDateOnly } from '../../utils/dateUtils';
import { GenericListLayout } from '../common/GenericListLayout';
import { PaginationControls } from '../common/PaginationControls';

interface TaxPaymentListProps {
    onNavigate?: (view: AppView, id: string) => void;
}

const TaxPaymentList: React.FC<TaxPaymentListProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();

    // Data Hooks
    const { data: vatPayments = [] } = useVATPayments(config);
    const { data: socialPayments = [] } = useSocialContributionPayments(config);

    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Combine and Filter
    const allPayments = useMemo(() => {
        const combined = [
            ...vatPayments.map(p => ({ ...p, type: 'VAT' as const, label: 'Imposto (IVA)' })),
            ...socialPayments.map(p => ({ ...p, type: 'SOCIAL' as const, label: 'Encargo Social' }))
        ];

        return combined.filter(p => {
            const matchesSearch = p.ref.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        }).sort((a, b) => b.date_payment - a.date_payment);
    }, [vatPayments, socialPayments, searchTerm]);

    const paginatedPayments = useMemo(() => {
        return allPayments.slice(page * limit, (page + 1) * limit);
    }, [allPayments, page, limit]);

    const totalPaid = useMemo(() => allPayments.reduce((acc, p) => acc + p.amount, 0), [allPayments]);

    if (!config) return null;

    const renderHeader = (
        <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Landmark className="text-orange-500" /> Impostos e Encargos
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Histórico de pagamentos fiscais e sociais</p>
                </div>
                <div className="flex items-center gap-4 bg-orange-50 dark:bg-orange-900/20 px-4 py-2 rounded-xl border border-orange-100 dark:border-orange-800">
                    <div className="text-orange-600 dark:text-orange-400 font-bold text-lg">${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-orange-800 dark:text-orange-300 uppercase font-bold tracking-wide">Total Pago</div>
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
                        className="pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-orange-500 outline-none w-full text-sm"
                    />
                </div>
            </div>
        </div>
    );

    const renderListContent = (
        <div className="p-4 md:p-6">
            {paginatedPayments.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <Wallet size={48} className="mx-auto mb-4 opacity-50" />
                    <p>Nenhum pagamento encontrado.</p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {paginatedPayments.map(p => (
                        <div
                            key={`${p.type}-${p.id}`}
                            className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer"
                            onClick={() => onNavigate && onNavigate('tax_payments', p.id)}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-full ${p.type === 'VAT' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400'}`}>
                                    <Landmark size={20} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{p.ref}</h4>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${p.type === 'VAT' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300' : 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300'}`}>
                                            {p.label}
                                        </span>
                                    </div>
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
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <GenericListLayout
            header={renderHeader}
            content={renderListContent}
            pagination={
                <PaginationControls
                    page={page}
                    limit={limit}
                    onPageChange={setPage}
                    onLimitChange={setLimit}
                    hasNext={allPayments.length > (page + 1) * limit}
                    hasPrev={page > 0}
                />
            }
        />
    );
};

export default TaxPaymentList;
