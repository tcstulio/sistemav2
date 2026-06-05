import React, { useMemo, useState, useEffect } from 'react';
import { AppView, SalaryPayment } from '../../types';
import { Calendar, User, Wallet, DollarSign, CreditCard, Hash, Copy } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { useSalaryPayments, useUsers, useBankAccounts } from '../../hooks/dolibarr';
import { useListControls } from '../../hooks/useListControls';
import { formatDateOnly } from '../../utils/dateUtils';
import { formatCurrency, formatDate } from '../../utils/formatUtils';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { toast } from 'sonner';

// Design System
import { PageHeader, Card, EmptyState, MasterDetailLayout, ListToolbar } from '../ui';

interface SalaryPaymentListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
}

const SalaryPaymentList: React.FC<SalaryPaymentListProps> = ({ onNavigate, initialItemId }) => {
    const { config } = useDolibarr();

    // Data Hooks
    const { data: salaryPayments = [] } = useSalaryPayments(config);
    const { data: users = [] } = useUsers(config);
    const { data: bankAccounts = [] } = useBankAccounts(config);

    const [selectedPayment, setSelectedPayment] = useState<SalaryPayment | null>(null);

    // Busca + ordenação padronizadas (#121). Pagamentos não são deletáveis (sem deleteX seguro).
    const controls = useListControls(salaryPayments, {
        searchText: (p) => `${p.ref || ''} ${p.num_payment || ''}`,
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
        if (initialItemId && salaryPayments.length > 0) {
            const match = salaryPayments.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedPayment(match);
            }
        }
    }, [initialItemId, salaryPayments]);

    const totalPaid = useMemo(() => payments.reduce((acc, p) => acc + p.amount, 0), [payments]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copiado para a área de transferência');
    };

    if (!config) return null;

    // --- Virtual List Row ---
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
            <div style={itemStyle}>
                <Card
                    onClick={() => setSelectedPayment(p)}
                    selected={selectedPayment?.id === p.id}
                    hoverable
                    className="h-full flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                            <DollarSign size={20} />
                        </div>
                        <div>
                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">{p.ref}</h4>
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
            </div>
        );
    };

    // --- List Content ---
    const renderListContent = payments.length === 0 ? (
        <EmptyState
            icon={Wallet}
            title="Nenhum pagamento encontrado"
            description="Nenhum pagamento de salário registrado."
        />
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

    // --- Detail Panel ---
    const renderDetail = selectedPayment ? (() => {
        const employee = selectedPayment.fk_user
            ? users.find(u => String(u.id) === String(selectedPayment.fk_user))
            : null;

        const bankAccount = selectedPayment.fk_bank
            ? bankAccounts.find(b => String(b.id) === String(selectedPayment.fk_bank))
            : null;

        return (
            <>
                <PageHeader
                    onBack={() => setSelectedPayment(null)}
                    title={
                        <span className="flex items-center gap-2">
                            <DollarSign className="text-blue-500" size={20} />
                            {selectedPayment.ref}
                        </span>
                    }
                    subtitle={formatDate(selectedPayment.date_payment)}
                    actions={
                        <div className="text-right">
                            <div className="text-xs text-slate-500 uppercase font-bold">Valor Líquido</div>
                            <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                                {formatCurrency(selectedPayment.amount)}
                            </div>
                        </div>
                    }
                />

                <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50">
                    <div className="max-w-3xl mx-auto space-y-6">

                        {/* Employee Info */}
                        <Card>
                            <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                                <User size={18} className="text-blue-500" />
                                Colaborador
                            </h3>
                            {employee ? (
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xl font-bold text-slate-400">
                                        {employee.firstname?.[0]}{employee.lastname?.[0]}
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-lg text-slate-800 dark:text-white">
                                            {employee.firstname} {employee.lastname}
                                        </h4>
                                        <div className="text-sm text-slate-500">{employee.email}</div>
                                        <div className="text-xs text-slate-400 mt-1">
                                            Cargo: {employee.job || 'Não definido'}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-slate-500 italic">Colaborador não encontrado (ID: {selectedPayment.fk_user})</div>
                            )}
                        </Card>

                        {/* Payment Details */}
                        <Card>
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Dados do Pagamento</h3>

                            <div className="space-y-4">
                                <div>
                                    <div className="text-xs text-slate-500">Data do Pagamento</div>
                                    <div className="font-medium text-slate-800 dark:text-white">{formatDate(selectedPayment.date_payment)}</div>
                                </div>

                                {selectedPayment.num_payment && (
                                    <div>
                                        <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                                            <Hash size={12} /> Número
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-sm">
                                                {selectedPayment.num_payment}
                                            </span>
                                            <button onClick={() => copyToClipboard(selectedPayment.num_payment!)} className="text-slate-400 hover:text-blue-500">
                                                <Copy size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <div className="text-xs text-slate-500">Salário Bruto (Referência)</div>
                                    <div className="font-medium text-slate-800 dark:text-white">
                                        {selectedPayment.salary ? formatCurrency(selectedPayment.salary) : '-'}
                                    </div>
                                </div>
                            </div>
                        </Card>

                        {/* Bank Info */}
                        <Card>
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Origem dos Recursos</h3>

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
                                    <div className="text-slate-400 italic">
                                        Conta não identificada (ID: {selectedPayment.fk_bank})
                                    </div>
                                )}

                                <div>
                                    <div className="text-xs text-slate-500">ID Interno</div>
                                    <div className="font-mono text-xs text-slate-400">{selectedPayment.id}</div>
                                </div>
                            </div>
                        </Card>

                    </div>
                </div>
            </>
        );
    })() : undefined;

    return (
        <div className="flex flex-col h-full">
            <div className={selectedPayment ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title="Pagamentos de Salários"
                    subtitle="Histórico de pagamentos a funcionários"
                    actions={
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-4 bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-xl border border-blue-100 dark:border-blue-800">
                                <div className="text-blue-600 dark:text-blue-400 font-bold text-lg">${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                <div className="text-xs text-blue-800 dark:text-blue-300 uppercase font-bold tracking-wide">Total Pago</div>
                            </div>
                            <ListToolbar controls={controls} searchPlaceholder="Buscar ref/número..." />
                        </div>
                    }
                />
            </div>

            <MasterDetailLayout
                list={renderListContent}
                detail={renderDetail}
                showDetail={!!selectedPayment}
                onCloseDetail={() => setSelectedPayment(null)}
            />
        </div>
    );
};

export default SalaryPaymentList;
