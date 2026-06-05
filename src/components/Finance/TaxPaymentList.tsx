import React, { useMemo, useState, useEffect } from 'react';
import { AppView } from '../../types';
import { Calendar, Landmark, Wallet } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { useVATPayments, useSocialContributionPayments } from '../../hooks/dolibarr';
import { useListControls } from '../../hooks/useListControls';
import { formatDateOnly } from '../../utils/dateUtils';
import { MasterDetailLayout } from '../ui/MasterDetailLayout';
import { PageHeader } from '../ui/PageHeader';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ListToolbar } from '../ui/ListToolbar';
import { PaginationControls } from '../common/PaginationControls';

interface TaxPaymentListProps {
    onNavigate?: (view: AppView, id: string) => void;
}

const TaxPaymentList: React.FC<TaxPaymentListProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();

    const { data: vatPayments = [] } = useVATPayments(config);
    const { data: socialPayments = [] } = useSocialContributionPayments(config);

    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Combina IVA + Encargos antes de busca/ordenação/filtro.
    const combinedPayments = useMemo(() => [
        ...vatPayments.map(p => ({ ...p, type: 'VAT' as const, label: 'Imposto (IVA)' })),
        ...socialPayments.map(p => ({ ...p, type: 'SOCIAL' as const, label: 'Encargo Social' }))
    ], [vatPayments, socialPayments]);

    // Busca + ordenação + filtro por tipo (#121). Pagamentos não são deletáveis (sem deleteX seguro).
    const controls = useListControls(combinedPayments, {
        searchText: (p) => `${p.ref || ''} ${p.label || ''}`,
        sorts: [
            { key: 'date', label: 'Data', get: (p) => p.date_payment ?? 0 },
            { key: 'amount', label: 'Valor', get: (p) => p.amount ?? 0 },
            { key: 'ref', label: 'Referência', get: (p) => p.ref },
        ],
        filters: [
            {
                key: 'type',
                label: 'Tipo',
                get: (p) => p.type,
                options: [
                    { value: 'VAT', label: 'Imposto (IVA)' },
                    { value: 'SOCIAL', label: 'Encargo Social' },
                ],
            },
        ],
        initialSortKey: 'date',
        initialSortDir: 'desc',
    });
    const allPayments = controls.result;

    const paginatedPayments = useMemo(() => {
        return allPayments.slice(page * limit, (page + 1) * limit);
    }, [allPayments, page, limit]);

    const totalPaid = useMemo(() => allPayments.reduce((acc, p) => acc + p.amount, 0), [allPayments]);

    // Reset de página ao mudar busca/filtro/ordenação.
    useEffect(() => {
        setPage(0);
    }, [controls.search, controls.filterValues, controls.sortKey, controls.sortDir]);

    if (!config) return null;

    const renderHeader = (
        <PageHeader
            title="Impostos e Encargos"
            subtitle="Histórico de pagamentos fiscais e sociais"
            actions={
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-4 bg-orange-50 dark:bg-orange-900/20 px-4 py-2 rounded-xl border border-orange-100 dark:border-orange-800">
                        <div className="text-orange-600 dark:text-orange-400 font-bold text-lg">${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                        <div className="text-xs text-orange-800 dark:text-orange-300 uppercase font-bold tracking-wide">Total Pago</div>
                    </div>
                    <ListToolbar controls={controls} searchPlaceholder="Buscar ref..." />
                </div>
            }
        />
    );

    const renderListContent = (
        <>
            {paginatedPayments.length === 0 ? (
                <EmptyState
                    icon={Wallet}
                    title="Nenhum pagamento encontrado"
                    description="Nenhum pagamento fiscal ou social registrado."
                />
            ) : (
                <div className="grid gap-3 p-4">
                    {paginatedPayments.map(p => (
                        <Card
                            key={`${p.type}-${p.id}`}
                            onClick={() => onNavigate && onNavigate('tax_payments', p.id)}
                            hoverable
                            className="flex flex-col md:flex-row md:items-center justify-between gap-4"
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
                            <div className="text-right">
                                <div className="text-lg font-bold text-slate-700 dark:text-slate-300">-${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Pago</div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}
            <PaginationControls
                page={page}
                limit={limit}
                onPageChange={setPage}
                onLimitChange={setLimit}
                hasNext={allPayments.length > (page + 1) * limit}
                hasPrev={page > 0}
            />
        </>
    );

    return (
        <div className="flex flex-col h-full">
            {renderHeader}
            <MasterDetailLayout list={renderListContent} />
        </div>
    );
};

export default TaxPaymentList;
