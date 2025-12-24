import React, { useMemo, useState, useEffect } from 'react';
import { BankAccount, DolibarrConfig, BankLine, Invoice, SupplierInvoice, AppView } from '../types';
import { Landmark, Wallet, CreditCard, ArrowUpRight, ArrowDownRight, TrendingUp, X, ArrowLeft, CheckCircle2, Split, Wand2, RefreshCcw, FileText, AlertCircle, Link, Plus, Loader2, ArrowRightLeft, ExternalLink, Upload, BarChart3, Sparkles, Building, Settings } from 'lucide-react';
import { BankStatementImport, CashFlowChart, BankingInsightsPanel, InterBankDashboard, ItauBankDashboard, InterSettingsTab, ItauSettingsTab } from './Banking';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useBankAccounts, useBankLines, useInvoices, useSupplierInvoices } from '../hooks/dolibarr';
import { formatDateOnly } from '../utils/dateUtils';

interface BankAccountListProps {
    onRefresh?: () => void;
    onNavigate?: (view: AppView, id: string) => void;
}

const BankAccountList: React.FC<BankAccountListProps> = ({ onRefresh, onNavigate }) => {
    const { config } = useDolibarr();

    // Navigation State
    const [activeBankTab, setActiveBankTab] = useState<'dolibarr' | 'inter' | 'itau'>('dolibarr');
    const [showSettings, setShowSettings] = useState(false);

    // --- DOLIBARR BANK ACCOUNTS LOGIC ---
    const { data: accountsData } = useBankAccounts(config);
    const accounts = accountsData || [];
    const { data: linesData } = useBankLines(config, !!config);
    const lines = linesData || [];
    const { data: invoicesData } = useInvoices(config);
    const invoices = invoicesData || [];
    const { data: supplierInvoicesData } = useSupplierInvoices(config);
    const supplierInvoices = supplierInvoicesData || [];

    const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null);
    const [activeTab, setActiveTab] = useState<'transactions' | 'reconcile' | 'cashflow' | 'insights'>('transactions');

    // Import Modal
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    // Cash Flow Data
    const [cashFlowData, setCashFlowData] = useState<Array<{ period: string; income: number; expenses: number; net: number }>>([]);
    const [filterReconciled, setFilterReconciled] = useState<'all' | 'reconciled' | 'unreconciled'>('all');
    const [reconciledLines, setReconciledLines] = useState<Set<string>>(new Set());
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Manual Link Modal
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
    const [selectedTransactionForLink, setSelectedTransactionForLink] = useState<BankLine | null>(null);
    const [linkSearchTerm, setLinkSearchTerm] = useState('');

    // Create Account Modal
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newAccountForm, setNewAccountForm] = useState<Partial<BankAccount>>({ currency_code: 'USD', solde: 0 });
    const [isCreating, setIsCreating] = useState(false);

    // Transfer Modal State
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [transferForm, setTransferForm] = useState({ fromId: '', toId: '', amount: 0, date: '', label: 'Internal Transfer' });

    // Add Line Modal State
    const [isAddLineModalOpen, setIsAddLineModalOpen] = useState(false);
    const [addLineForm, setAddLineForm] = useState({ date: '', type: 'VIR', label: '', amount: 0 });

    const totalBalance = useMemo(() => {
        return accounts.reduce((sum, acc) => sum + (acc.status === '1' ? acc.solde : 0), 0);
    }, [accounts]);

    const accountLines = useMemo(() => {
        if (!selectedAccount) return [];
        return lines.filter(l => String(l.fk_account) === String(selectedAccount.id));
    }, [lines, selectedAccount]);

    const filteredLines = useMemo(() => {
        return accountLines.filter(l => {
            if (filterReconciled === 'reconciled') return l.reconciled || reconciledLines.has(l.id);
            if (filterReconciled === 'unreconciled') return !l.reconciled && !reconciledLines.has(l.id);
            return true;
        });
    }, [accountLines, filterReconciled, reconciledLines]);

    const getPotentialMatches = (line: BankLine) => {
        if (line.amount > 0) {
            return invoices.filter(inv =>
                inv.statut === '1' && Math.abs(inv.total_ttc - line.amount) < 1
            );
        } else {
            const absAmount = Math.abs(line.amount);
            return supplierInvoices.filter(inv =>
                inv.statut === '1' && Math.abs(inv.total_ttc - absAmount) < 1
            );
        }
    };

    const getLinkableItems = useMemo(() => {
        if (!selectedTransactionForLink) return [];
        const isIncome = selectedTransactionForLink.amount > 0;

        let items: any[] = [];
        if (isIncome) {
            items = invoices.filter(i => i.statut === '1');
        } else {
            items = supplierInvoices.filter(i => i.statut === '1');
        }

        if (linkSearchTerm) {
            items = items.filter(i =>
                (i.ref || '').toLowerCase().includes(linkSearchTerm.toLowerCase()) ||
                String(i.total_ttc).includes(linkSearchTerm)
            );
        }
        return items;
    }, [selectedTransactionForLink, invoices, supplierInvoices, linkSearchTerm]);

    const handleMagicMatch = () => {
        const newMatches = new Set(reconciledLines);
        accountLines.forEach(line => {
            if (!line.reconciled) {
                const matches = getPotentialMatches(line);
                if (matches.length === 1) {
                    newMatches.add(line.id);
                }
            }
        });
        setReconciledLines(newMatches);
        alert(`Auto-conciliadas ${newMatches.size - reconciledLines.size} transações!`);
    };

    const toggleReconcile = (lineId: string) => {
        const newSet = new Set(reconciledLines);
        if (newSet.has(lineId)) {
            newSet.delete(lineId);
        } else {
            newSet.add(lineId);
        }
        setReconciledLines(newSet);
    };

    const openLinkModal = (line: BankLine) => {
        setSelectedTransactionForLink(line);
        setLinkSearchTerm('');
        setIsLinkModalOpen(true);
    };

    const handleManualLink = (invoiceId: string) => {
        if (selectedTransactionForLink) {
            toggleReconcile(selectedTransactionForLink.id);
            setIsLinkModalOpen(false);
            setSelectedTransactionForLink(null);
        }
    };

    const handleCreateAccount = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAccountForm.label || !newAccountForm.bank) return;
        setIsCreating(true);
        try {
            await DolibarrService.createBankAccount(config, newAccountForm);
            alert("Conta criada com sucesso (Mock)");
            setIsCreateModalOpen(false);
            setNewAccountForm({ currency_code: 'BRL', solde: 0 });
            if (onRefresh) onRefresh();
        } catch (e) {
            console.error(e);
        } finally {
            setIsCreating(false);
        }
    };

    const handleTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!transferForm.fromId || !transferForm.toId || !transferForm.amount) return;
        setIsSubmitting(true);
        try {
            const dateTs = transferForm.date ? new Date(transferForm.date).getTime() / 1000 : Date.now() / 1000;
            await DolibarrService.createBankTransfer(config, transferForm.fromId, transferForm.toId, transferForm.amount, dateTs, transferForm.label);
            alert("Transferência completada");
            setIsTransferModalOpen(false);
            if (onRefresh) onRefresh();
        } catch (e) { console.error(e); alert("Falha na transferência"); } finally { setIsSubmitting(false); }
    };

    const handleAddLine = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedAccount || !addLineForm.amount) return;
        setIsSubmitting(true);
        try {
            const dateTs = addLineForm.date ? new Date(addLineForm.date).getTime() / 1000 : Date.now() / 1000;
            await DolibarrService.addBankLine(config, selectedAccount.id, dateTs, addLineForm.type, addLineForm.label, addLineForm.amount);
            alert("Transação adicionada");
            setIsAddLineModalOpen(false);
            if (onRefresh) onRefresh();
        } catch (e) { console.error(e); alert("Falha ao adicionar linha"); } finally { setIsSubmitting(false); }
    };

    // Compute cash flow data whenever account lines change
    useEffect(() => {
        if (!selectedAccount || accountLines.length === 0) {
            setCashFlowData([]);
            return;
        }

        // Group by month
        const grouped = new Map<string, { income: number; expenses: number }>();

        for (const line of accountLines) {
            const d = new Date(line.date_operation < 100000000000 ? line.date_operation * 1000 : line.date_operation);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

            if (!grouped.has(key)) {
                grouped.set(key, { income: 0, expenses: 0 });
            }

            const entry = grouped.get(key)!;
            if (line.amount >= 0) {
                entry.income += line.amount;
            } else {
                entry.expenses += Math.abs(line.amount);
            }
        }

        const chartData = Array.from(grouped.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-12) // Last 12 months
            .map(([period, data]) => ({
                period,
                income: data.income,
                expenses: data.expenses,
                net: data.income - data.expenses,
            }));

        setCashFlowData(chartData);
    }, [selectedAccount, accountLines]);

    const handleImport = (transactions: any[], accountNumber?: string) => {

        // TODO: Add transactions to local state or sync with Dolibarr
        alert(`${transactions.length} transações importadas com sucesso!`);
        setIsImportModalOpen(false);
        if (onRefresh) onRefresh();
    };

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    // --- RENDER ---
    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Top Navigation Tabs */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 pt-4">
                <div className="flex items-center justify-between mb-2">
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Landmark className="text-indigo-600" /> Bancos e Financeiro
                    </h1>
                    {showSettings && (
                        <button
                            onClick={() => setShowSettings(false)}
                            className="text-sm flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <ArrowLeft size={16} /> Voltar para Dashboard
                        </button>
                    )}
                </div>

                <div className="flex gap-1">
                    <button
                        onClick={() => { setActiveBankTab('dolibarr'); setShowSettings(false); }}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${activeBankTab === 'dolibarr' && !showSettings
                            ? 'border-indigo-500 text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
                            : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                    >
                        Visão Geral
                    </button>
                    <button
                        onClick={() => { setActiveBankTab('inter'); setShowSettings(false); }}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 flex items-center gap-2 ${activeBankTab === 'inter' && !showSettings
                            ? 'border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-900/20'
                            : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-orange-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                    >
                        Banco Inter
                    </button>
                    <button
                        onClick={() => { setActiveBankTab('itau'); setShowSettings(false); }}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 flex items-center gap-2 ${activeBankTab === 'itau' && !showSettings
                            ? 'border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                    >
                        Banco Itaú
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden relative">

                {/* SETTINGS MODE */}
                {showSettings ? (
                    <div className="h-full overflow-y-auto">
                        {activeBankTab === 'inter' && <InterSettingsTab />}
                        {activeBankTab === 'itau' && <ItauSettingsTab />}
                        {activeBankTab === 'dolibarr' && (
                            <div className="p-8 text-center text-slate-500">
                                <Settings className="mx-auto h-12 w-12 mb-4 opacity-50" />
                                <p>Configurações de contas do Dolibarr são gerenciadas no painel do ERP.</p>
                            </div>
                        )}
                    </div>
                ) : (
                    /* DASHBOARD MODE */
                    <>
                        {activeBankTab === 'inter' && (
                            <div className="h-full relative">
                                <button
                                    onClick={() => setShowSettings(true)}
                                    className="absolute top-4 right-4 z-10 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600"
                                    title="Configurações do Banco Inter"
                                >
                                    <Settings size={20} />
                                </button>
                                <InterBankDashboard onOpenSettings={() => setShowSettings(true)} />
                            </div>
                        )}

                        {activeBankTab === 'itau' && (
                            <div className="h-full relative">
                                <button
                                    onClick={() => setShowSettings(true)}
                                    className="absolute top-4 right-4 z-10 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600"
                                    title="Configurações do Banco Itaú"
                                >
                                    <Settings size={20} />
                                </button>
                                <ItauBankDashboard onOpenSettings={() => setShowSettings(true)} />
                            </div>
                        )}

                        {activeBankTab === 'dolibarr' && (
                            /* EXISTING DOLIBARR CONTENT WRAPPED HERE */
                            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">
                                {/* Bank Statement Import Modal */}
                                {isImportModalOpen && (
                                    <BankStatementImport onImport={handleImport} onClose={() => setIsImportModalOpen(false)} accountId={selectedAccount?.id} />
                                )}

                                {/* Create Account Modal */}
                                {isCreateModalOpen && (
                                    <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                                                <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                                    <Landmark size={18} className="text-indigo-600" /> Nova Conta Bancária
                                                </h3>
                                                <button onClick={() => setIsCreateModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                                            </div>
                                            <form onSubmit={handleCreateAccount} className="p-6 space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rótulo</label>
                                                    <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={newAccountForm.label || ''} onChange={e => setNewAccountForm({ ...newAccountForm, label: e.target.value })} placeholder="Conta Principal" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome do Banco</label>
                                                    <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={newAccountForm.bank || ''} onChange={e => setNewAccountForm({ ...newAccountForm, bank: e.target.value })} placeholder="Itaú, Bradesco, etc." />
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Moeda</label>
                                                        <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newAccountForm.currency_code} onChange={e => setNewAccountForm({ ...newAccountForm, currency_code: e.target.value })} />
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Saldo Inicial</label>
                                                        <input type="number" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newAccountForm.solde} onChange={e => setNewAccountForm({ ...newAccountForm, solde: parseFloat(e.target.value) })} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Número da Conta</label>
                                                    <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newAccountForm.number || ''} onChange={e => setNewAccountForm({ ...newAccountForm, number: e.target.value })} />
                                                </div>
                                                <div className="flex justify-end gap-3 pt-4">
                                                    <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                                    <button type="submit" disabled={isCreating} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                                        {isCreating ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Criar
                                                    </button>
                                                </div>
                                            </form>
                                        </div>
                                    </div>
                                )}

                                {/* Transfer Modal */}
                                {isTransferModalOpen && (
                                    <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                                                <h3 className="font-bold text-lg dark:text-white flex items-center gap-2"><ArrowRightLeft size={18} className="text-indigo-600" /> Nova Transferência</h3>
                                                <button onClick={() => setIsTransferModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                                            </div>
                                            <form onSubmit={handleTransfer} className="p-6 space-y-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">De</label>
                                                        <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={transferForm.fromId} onChange={e => setTransferForm({ ...transferForm, fromId: e.target.value })}>
                                                            <option value="">Selecione...</option>
                                                            {accounts.map(a => <option key={a.id} value={a.id} disabled={a.id === transferForm.toId}>{a.label}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Para</label>
                                                        <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={transferForm.toId} onChange={e => setTransferForm({ ...transferForm, toId: e.target.value })}>
                                                            <option value="">Selecione...</option>
                                                            {accounts.map(a => <option key={a.id} value={a.id} disabled={a.id === transferForm.fromId}>{a.label}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor</label>
                                                    <input type="number" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={transferForm.amount} onChange={e => setTransferForm({ ...transferForm, amount: parseFloat(e.target.value) })} />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rótulo</label>
                                                    <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={transferForm.label} onChange={e => setTransferForm({ ...transferForm, label: e.target.value })} />
                                                </div>
                                                <div className="flex justify-end gap-3 pt-4">
                                                    <button type="button" onClick={() => setIsTransferModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                                                    <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2">{isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Confirmar</button>
                                                </div>
                                            </form>
                                        </div>
                                    </div>
                                )}

                                {/* Add Line Modal */}
                                {isAddLineModalOpen && (
                                    <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                                                <h3 className="font-bold text-lg dark:text-white flex items-center gap-2"><Plus size={18} className="text-indigo-600" /> Nova Transação</h3>
                                                <button onClick={() => setIsAddLineModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                                            </div>
                                            <form onSubmit={handleAddLine} className="p-6 space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                                                    <input type="date" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={addLineForm.date} onChange={e => setAddLineForm({ ...addLineForm, date: e.target.value })} />
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                                                        <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={addLineForm.type} onChange={e => setAddLineForm({ ...addLineForm, type: e.target.value })}>
                                                            <option value="VIR">Transferência</option>
                                                            <option value="CB">Cartão</option>
                                                            <option value="CHQ">Cheque</option>
                                                            <option value="LIQ">Dinheiro</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor</label>
                                                        <input type="number" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={addLineForm.amount} onChange={e => setAddLineForm({ ...addLineForm, amount: parseFloat(e.target.value) })} placeholder="+/-" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rótulo</label>
                                                    <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={addLineForm.label} onChange={e => setAddLineForm({ ...addLineForm, label: e.target.value })} />
                                                </div>
                                                <div className="flex justify-end gap-3 pt-4">
                                                    <button type="button" onClick={() => setIsAddLineModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                                                    <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2">{isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Adicionar</button>
                                                </div>
                                            </form>
                                        </div>
                                    </div>
                                )}

                                {/* Manual Link Modal (Existing) */}
                                {isLinkModalOpen && selectedTransactionForLink && (
                                    <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 flex flex-col max-h-[80vh]">
                                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                                                <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                                    <Link size={18} className="text-indigo-500" /> Vincular Transação
                                                </h3>
                                                <button onClick={() => setIsLinkModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                                            </div>

                                            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                                                <div className="flex justify-between font-medium text-sm mb-2">
                                                    <span className="text-slate-600 dark:text-slate-300">{selectedTransactionForLink.label}</span>
                                                    <span className={selectedTransactionForLink.amount > 0 ? 'text-emerald-600' : 'text-red-500'}>
                                                        ${Math.abs(selectedTransactionForLink.amount).toFixed(2)}
                                                    </span>
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="Buscar ref da fatura ou valor..."
                                                    className="w-full p-2 text-sm border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                    value={linkSearchTerm}
                                                    onChange={(e) => setLinkSearchTerm(e.target.value)}
                                                    autoFocus
                                                />
                                            </div>

                                            <div className="flex-1 overflow-y-auto p-2">
                                                {getLinkableItems.length === 0 ? (
                                                    <p className="text-center text-slate-400 py-8 text-sm">Nenhuma fatura não paga correspondente encontrada.</p>
                                                ) : (
                                                    <div className="space-y-1">
                                                        {getLinkableItems.map(item => (
                                                            <button
                                                                key={item.id}
                                                                onClick={() => handleManualLink(item.id)}
                                                                className="w-full text-left p-3 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border border-transparent hover:border-indigo-100 dark:hover:border-indigo-800 transition-all flex justify-between items-center group"
                                                            >
                                                                <div>
                                                                    <div className="font-bold text-slate-700 dark:text-slate-300 text-sm">{item.ref}</div>
                                                                    <div className="text-xs text-slate-500">{formatDateOnly(item.date)}</div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <div className="font-bold text-slate-800 dark:text-white text-sm">${item.total_ttc}</div>
                                                                    <span className="text-[10px] text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">Selecionar</span>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Header */}
                                <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${selectedAccount ? 'hidden lg:block' : 'block'}`}>
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                                        <div>
                                            <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Contas Bancárias Dolibarr</h2>
                                            <p className="text-sm text-slate-500 dark:text-slate-400">Visão geral financeira e saldos internos</p>
                                        </div>
                                        <div className="flex gap-2 items-center">
                                            <div className="hidden md:flex bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-xl border border-emerald-100 dark:border-emerald-800 items-center gap-2 mr-2">
                                                <div className="bg-emerald-100 dark:bg-emerald-800 p-1.5 rounded-lg">
                                                    <Wallet className="text-emerald-600 dark:text-emerald-400" size={16} />
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-emerald-800 dark:text-emerald-300 font-medium uppercase tracking-wide">Total</p>
                                                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setIsTransferModalOpen(true)}
                                                className={`flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-lg text-sm font-medium shadow-sm transition-colors`}
                                            >
                                                <ArrowRightLeft size={16} /> Transferir
                                            </button>
                                            <button
                                                onClick={() => setIsCreateModalOpen(true)}
                                                className={`flex items-center gap-1.5 px-3 py-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                                            >
                                                <Plus size={18} /> Nova Conta
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 min-h-0 flex overflow-hidden">
                                    {/* Account List */}
                                    <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${selectedAccount ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                                        {accounts.length === 0 ? (
                                            <div className="text-center py-20 text-slate-400">
                                                <Landmark size={48} className="mx-auto mb-4 opacity-50" />
                                                <p>Nenhuma conta bancária encontrada.</p>
                                            </div>
                                        ) : (
                                            <div className={`grid gap-4 ${selectedAccount ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                                                {accounts.map((account) => (
                                                    <div
                                                        key={account.id}
                                                        onClick={() => {
                                                            setSelectedAccount(account);
                                                            setActiveTab('transactions');
                                                        }}
                                                        className={`bg-white dark:bg-slate-900 rounded-xl border p-0 overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer ${selectedAccount?.id === account.id ? `border-${config.themeColor}-500 ring-1 ring-${config.themeColor}-500` : 'border-slate-200 dark:border-slate-800'}`}
                                                    >
                                                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start bg-slate-50/50 dark:bg-slate-800/50">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`p-2 rounded-lg bg-${config.themeColor}-100 dark:bg-${config.themeColor}-900/30 text-${config.themeColor}-600 dark:text-${config.themeColor}-400`}>
                                                                    <Landmark size={20} />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <h3 className="font-bold text-slate-800 dark:text-white text-base truncate pr-2">{account.label}</h3>
                                                                    <p className="text-xs text-slate-500 font-mono">{account.currency_code}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="p-4">
                                                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Saldo</p>
                                                            <div className={`text-2xl font-bold ${account.solde >= 0 ? 'text-slate-800 dark:text-white' : 'text-red-500'}`}>
                                                                ${account.solde.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Detail / Reconciliation View */}
                                    <div className={`flex-1 bg-white dark:bg-slate-900 overflow-y-auto ${selectedAccount ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                                        {selectedAccount ? (
                                            <div className="h-full flex flex-col animate-in slide-in-from-right-4 fade-in duration-300">

                                                {/* Detail Header */}
                                                <div className="sticky top-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10 flex-none">
                                                    <div className="flex items-center gap-3">
                                                        <button onClick={() => setSelectedAccount(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                                                        <div>
                                                            <h2 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">{selectedAccount.label}</h2>
                                                            <span className="text-xs text-slate-400">{selectedAccount.ref} • {selectedAccount.currency_code}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <div className="hidden md:flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
                                                            <button
                                                                onClick={() => setActiveTab('transactions')}
                                                                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'transactions' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                                                            >
                                                                Transações
                                                            </button>
                                                            <button
                                                                onClick={() => setActiveTab('reconcile')}
                                                                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${activeTab === 'reconcile' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                                                            >
                                                                <Split size={14} /> Conciliação
                                                            </button>
                                                            <button
                                                                onClick={() => setActiveTab('cashflow')}
                                                                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${activeTab === 'cashflow' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                                                            >
                                                                <BarChart3 size={14} /> Fluxo
                                                            </button>
                                                            <button
                                                                onClick={() => setActiveTab('insights')}
                                                                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${activeTab === 'insights' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                                                            >
                                                                <Sparkles size={14} /> IA
                                                            </button>
                                                        </div>
                                                        <button onClick={() => setSelectedAccount(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                                                    </div>
                                                </div>

                                                {/* Content */}
                                                <div className="flex-1 overflow-hidden flex flex-col">

                                                    {/* Filters Toolbar */}
                                                    <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30">
                                                        <div className="flex gap-2">
                                                            <button onClick={() => setFilterReconciled('all')} className={`text-xs px-2 py-1 rounded ${filterReconciled === 'all' ? 'bg-slate-200 dark:bg-slate-700 font-bold' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Todos</button>
                                                            <button onClick={() => setFilterReconciled('unreconciled')} className={`text-xs px-2 py-1 rounded ${filterReconciled === 'unreconciled' ? 'bg-orange-100 text-orange-700 font-bold' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>A Conciliar</button>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            {activeTab === 'transactions' && (
                                                                <>
                                                                    <button onClick={() => setIsImportModalOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all">
                                                                        <Upload size={12} /> Importar Extrato
                                                                    </button>
                                                                    <button onClick={() => setIsAddLineModalOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-all">
                                                                        <Plus size={12} /> Adicionar Transação
                                                                    </button>
                                                                </>
                                                            )}
                                                            {activeTab === 'reconcile' && (
                                                                <button onClick={handleMagicMatch} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white text-xs font-bold shadow-sm transition-all active:scale-95`}>
                                                                    <Wand2 size={12} /> Conciliação Mágica
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* List */}
                                                    <div className="flex-1 overflow-y-auto p-4">
                                                        {filteredLines.length === 0 ? (
                                                            <div className="text-center py-10 text-slate-400">
                                                                <p>Nenhuma transação encontrada.</p>
                                                                <p className="text-xs mt-2 opacity-70">Se você acabou de adicionar a conta, tente sincronizar dados.</p>
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-3">
                                                                {filteredLines.map(line => {
                                                                    const isReconciled = line.reconciled || reconciledLines.has(line.id);
                                                                    const potentialMatches = !isReconciled && activeTab === 'reconcile' ? getPotentialMatches(line) : [];

                                                                    return (
                                                                        <div key={line.id} className={`bg-white dark:bg-slate-800 border rounded-lg p-3 transition-all ${isReconciled ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-900/10' : 'border-slate-200 dark:border-slate-700'}`}>
                                                                            <div className="flex justify-between items-start">
                                                                                <div className="flex items-start gap-3">
                                                                                    <div className={`mt-1 p-1.5 rounded-full ${line.amount > 0 ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                                                                                        {line.amount > 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                                                                                    </div>
                                                                                    <div>
                                                                                        <div className="font-medium text-sm text-slate-800 dark:text-white">{line.label}</div>
                                                                                        <div className="text-xs text-slate-500">{formatDateOnly(line.date_operation)}</div>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="text-right">
                                                                                    <div className={`font-bold ${line.amount > 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                                                                        {line.amount > 0 ? '+' : ''}{line.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                                                    </div>
                                                                                    {activeTab === 'reconcile' && (
                                                                                        <button
                                                                                            onClick={() => toggleReconcile(line.id)}
                                                                                            className={`mt-1 text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ml-auto ${isReconciled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600'}`}
                                                                                        >
                                                                                            {isReconciled ? <CheckCircle2 size={10} /> : <RefreshCcw size={10} />}
                                                                                            {isReconciled ? 'Conciliado' : 'Não Conciliado'}
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            </div>

                                                                            {/* Suggestions in Reconcile Mode */}
                                                                            {activeTab === 'reconcile' && !isReconciled && (
                                                                                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 animate-in slide-in-from-top-2">
                                                                                    {potentialMatches.length > 0 ? (
                                                                                        <>
                                                                                            <p className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1"><Wand2 size={10} /> Correspondências Sugeridas</p>
                                                                                            <div className="space-y-2">
                                                                                                {potentialMatches.map(inv => (
                                                                                                    <div
                                                                                                        key={inv.id}
                                                                                                        className="flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 p-2 rounded border border-slate-100 dark:border-slate-800 cursor-pointer hover:border-indigo-300 transition-colors"
                                                                                                        onClick={() => onNavigate && onNavigate('invoices', inv.id)}
                                                                                                    >
                                                                                                        <div className="flex items-center gap-2">
                                                                                                            <FileText size={12} className="text-slate-400" />
                                                                                                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                                                                                                {inv.ref}
                                                                                                                <ExternalLink size={10} className="text-slate-400 opacity-50" />
                                                                                                            </span>
                                                                                                        </div>
                                                                                                        <div className="flex items-center gap-3">
                                                                                                            <span className="text-xs font-bold">${inv.total_ttc}</span>
                                                                                                            <button
                                                                                                                onClick={(e) => {
                                                                                                                    e.stopPropagation();
                                                                                                                    toggleReconcile(line.id);
                                                                                                                }}
                                                                                                                className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700"
                                                                                                            >
                                                                                                                Vincular
                                                                                                            </button>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                ))}
                                                                                            </div>
                                                                                        </>
                                                                                    ) : (
                                                                                        <div className="text-center pt-1">
                                                                                            <button
                                                                                                onClick={() => openLinkModal(line)}
                                                                                                className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-medium flex items-center justify-center gap-1 w-full p-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded"
                                                                                            >
                                                                                                <Link size={12} /> Encontrar correspondência manualmente
                                                                                            </button>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Cash Flow Tab */}
                                                    {activeTab === 'cashflow' && (
                                                        <div className="flex-1 overflow-y-auto p-4">
                                                            <CashFlowChart
                                                                data={cashFlowData}
                                                                type="bar"
                                                                title={`Fluxo de Caixa - ${selectedAccount.label}`}
                                                            />
                                                        </div>
                                                    )}

                                                    {/* Insights Tab */}
                                                    {activeTab === 'insights' && (
                                                        <div className="flex-1 overflow-y-auto p-4">
                                                            <BankingInsightsPanel
                                                                accounts={[selectedAccount]}
                                                                transactions={accountLines.map(l => ({
                                                                    date: new Date(l.date_operation).toISOString(),
                                                                    amount: l.amount,
                                                                    description: l.label,
                                                                    type: l.amount >= 0 ? 'credit' as const : 'debit' as const
                                                                }))}
                                                            />
                                                        </div>
                                                    )}

                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center p-8 max-w-sm mx-auto">
                                                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300 dark:text-slate-600"><Landmark size={32} /></div>
                                                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Selecione uma Conta Dolibarr</h3>
                                                <p className="text-slate-500 dark:text-slate-400 text-sm">Visualize detalhes e realize conciliação bancária.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default BankAccountList;
