import React, { useMemo, useState, useEffect } from 'react';
import { AppView, SalaryPayment } from '../../types';
import { Search, Calendar, User, Wallet, DollarSign, ArrowUpRight, X, ChevronLeft, CreditCard, Hash, Copy } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { useSalaryPayments, useUsers, useBankAccounts } from '../../hooks/dolibarr';
import { formatDateOnly } from '../../utils/dateUtils';
import { formatCurrency, formatDate } from '../../utils/formatUtils';
import { GenericListLayout } from '../common/GenericListLayout';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { toast } from 'sonner';

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

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPayment, setSelectedPayment] = useState<SalaryPayment | null>(null);

    // Deep Link Effect
    useEffect(() => {
        if (initialItemId && salaryPayments.length > 0) {
            const match = salaryPayments.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedPayment(match);
            }
        }
    }, [initialItemId, salaryPayments]);

    // Filter
    const payments = useMemo(() => {
        return salaryPayments.filter(p => {
            const matchesSearch = p.ref.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        }).sort((a, b) => b.date_payment - a.date_payment);
    }, [salaryPayments, searchTerm]);

    const totalPaid = useMemo(() => payments.reduce((acc, p) => acc + p.amount, 0), [payments]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copiado para a área de transferência');
    };

    if (!config) return <div className="p-8 text-center flex items-center justify-center gap-2 text-slate-500"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500"></div> Carregando...</div>;

    // --- RENDERERS ---

    const renderHeader = (
        <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <User className="text-blue-500" /> Pagamentos de Salários
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Histórico de pagamentos a funcionários</p>
                </div>
                <div className="flex items-center gap-4 bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-xl border border-blue-100 dark:border-blue-800">
                    <div className="text-blue-600 dark:text-blue-400 font-bold text-lg">${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-blue-800 dark:text-blue-300 uppercase font-bold tracking-wide">Total Pago</div>
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
                        className="pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-full text-sm"
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

        return (
            <div
                style={itemStyle}
                onClick={() => setSelectedPayment(p)}
                className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md group flex flex-col md:flex-row md:items-center justify-between gap-4 ${selectedPayment?.id === p.id
                        ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-500 dark:border-blue-500'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-200 dark:hover:border-blue-800'
                    }`}
            >
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-full ${selectedPayment?.id === p.id
                            ? 'bg-blue-200 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        }`}>
                        <DollarSign size={20} />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{p.ref}</h4>
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
        );
    };

    const renderListContent = payments.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
            <Wallet size={48} className="mx-auto mb-4 opacity-50" />
            <p>Nenhum pagamento de salário encontrado.</p>
        </div>
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

    const renderDetail = selectedPayment ? (() => {
        const employee = selectedPayment.fk_user
            ? users.find(u => String(u.id) === String(selectedPayment.fk_user))
            : null;

        const bankAccount = selectedPayment.fk_bank
            ? bankAccounts.find(b => String(b.id) === String(selectedPayment.fk_bank))
            : null;

        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950/50">
                {/* Header */}
                <div className="flex-none bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setSelectedPayment(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ChevronLeft size={20} /></button>
                        <div>
                            <h2 className="text-lg font-bold dark:text-white leading-tight flex items-center gap-2">
                                <DollarSign className="text-blue-500" size={20} />
                                {selectedPayment.ref}
                            </h2>
                            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                <Calendar size={12} /> {formatDate(selectedPayment.date_payment)}
                            </div>
                        </div>
                    </div>
                    <div className="text-right hidden sm:block">
                        <div className="text-xs text-slate-500 uppercase font-bold">Valor Líquido</div>
                        <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                            {formatCurrency(selectedPayment.amount)}
                        </div>
                    </div>
                    <button onClick={() => setSelectedPayment(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
                    <div className="max-w-3xl mx-auto space-y-6">

                        {/* Employee Info */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
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
                        </div>

                        {/* Payment Details */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Dados do Pagamento</h3>

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

                        {/* Bank Info */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Origem dos Recursos</h3>

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

                    </div>
                </div>
            </div>
        );
    })() : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <DollarSign size={48} className="mb-4 opacity-50" />
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

export default SalaryPaymentList;
