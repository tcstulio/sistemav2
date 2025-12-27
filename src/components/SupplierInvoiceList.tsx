
import React, { useState, useMemo, useEffect } from 'react';
import { Invoice, AppView, SupplierInvoice } from '../types';
import { FileText, Search, CheckCircle2, Clock, FileEdit, ExternalLink, Download, FolderKanban, Plus, X, Trash2, Loader2, CheckCircle, CreditCard, ArrowDown, ArrowUp, Lock, ShoppingCart, ArrowLeft, Truck, RefreshCcw, Landmark, Receipt, User } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { GenericListLayout } from './common/GenericListLayout';
import { LinkedObjects } from './common/LinkedObjects';
import { PaginationControls } from './common/PaginationControls';
import { StatusFilterBar } from './common/StatusFilterBar';
import { useDolibarr } from '../context/DolibarrContext';
import { useSupplierInvoices, useSuppliers, useProjects, useSupplierInvoiceLines, useUsers } from '../hooks/dolibarr';
import { useDolibarrLink } from '../hooks/useDolibarrLink';
import { formatDateOnly } from '../utils/dateUtils';
import { ReceiptScanner } from './Finance/ReceiptScanner';
import { toast } from 'sonner';

interface SupplierInvoiceListProps {
    onNavigate?: (view: AppView, id: string) => void;
}

const SupplierInvoiceList: React.FC<SupplierInvoiceListProps> = ({ onNavigate }) => {
    const { config, refreshData } = useDolibarr();

    // Data Hooks
    const { data: invoices = [] } = useSupplierInvoices(config);
    const { data: suppliers = [] } = useSuppliers(config);
    const { data: projects = [] } = useProjects(config);
    const { data: allInvoiceLines = [] } = useSupplierInvoiceLines(config);
    const { data: users = [] } = useUsers(config);

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'unpaid' | 'paid' | 'draft'>('all');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
    const [selectedInvoice, setSelectedInvoice] = useState<SupplierInvoice | null>(null);

    // Pagination State
    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Scanner State
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannedData, setScannedData] = useState<any>(null);
    const [isCreateInvoiceOpen, setIsCreateInvoiceOpen] = useState(false);
    const [newInvoice, setNewInvoice] = useState({
        socid: '',
        ref: '',
        date: new Date().toISOString().split('T')[0],
        total: 0,
        label: ''
    });
    const [isSubmittingInvoice, setIsSubmittingInvoice] = useState(false);

    // Reset page on search
    useEffect(() => {
        setPage(0);
    }, [searchTerm]);

    // Helper to find supplier name
    const getSupplierName = (socid: string) => {
        const supplier = suppliers.find(s => s.id === socid);
        return supplier ? supplier.name : 'Fornecedor Desconhecido';
    };

    const getUserName = (id?: string) => {
        if (!id) return '-';
        const u = users.find(user => String(user.id) === String(id));
        return u ? (u.firstname ? `${u.firstname} ${u.lastname}` : u.login) : `User ${id}`;
    };

    const getProjectName = (projId?: string) => {
        if (!projId) return null;
        const p = projects.find(proj => String(proj.id) === String(projId));
        return p ? p.title : null;
    };

    const filteredInvoices = useMemo(() => {
        let result = invoices.filter(inv => {
            const supplierName = getSupplierName(inv.socid).toLowerCase();
            const matchesSearch =
                inv.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                supplierName.includes(searchTerm.toLowerCase());

            // Status mapping for Supplier Invoices might differ slightly, but assuming standard:
            // 0=Draft, 1=Unpaid, 2=Paid
            if (filterStatus === 'paid') return matchesSearch && inv.statut === '2';
            if (filterStatus === 'unpaid') return matchesSearch && inv.statut === '1';
            if (filterStatus === 'draft') return matchesSearch && inv.statut === '0';

            return matchesSearch;
        });

        // Client-side Sort
        return result.sort((a, b) => {
            return sortOrder === 'desc' ? b.date - a.date : a.date - b.date;
        });
    }, [invoices, suppliers, searchTerm, filterStatus, sortOrder]);

    const invoiceLines = useMemo(() => {
        if (!selectedInvoice) return [];
        return allInvoiceLines.filter(line => String(line.parent_id) === String(selectedInvoice.id));
    }, [selectedInvoice, allInvoiceLines]);

    const getStatusBadge = (invoice: SupplierInvoice) => {
        if (invoice.type === '2') {
            return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"><RefreshCcw size={12} /> Nota de Crédito</span>;
        }
        if (invoice.statut === '0') {
            return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"><FileEdit size={12} /> Rascunho</span>;
        }
        if (invoice.statut === '2') {
            return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><CheckCircle2 size={12} /> Pago</span>;
        }
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800"><Clock size={12} /> A Pagar</span>;
    };

    const { openLink } = useDolibarrLink(config);

    const openInDolibarr = (id: string) => {
        openLink('supplier_invoice', id); // Adjust link type if needed
    };

    // Scanner Handlers
    const handleScanComplete = (data: any) => {
        setIsScannerOpen(false);
        setScannedData(data);

        // Auto-match vendor
        let matchedSupplierId = '';
        if (data.vendor) {
            const match = suppliers.find(s => s.name.toLowerCase().includes(data.vendor.toLowerCase()));
            if (match) matchedSupplierId = match.id;
        }

        setNewInvoice({
            socid: matchedSupplierId,
            ref: '',
            date: data.date || new Date().toISOString().split('T')[0],
            total: data.total || 0,
            label: data.category ? `${data.category} (Digitalizado)` : 'Despesa Digitalizada'
        });
        setIsCreateInvoiceOpen(true);
    };

    const handleCreateInvoice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newInvoice.socid) {
            alert("Selecione um fornecedor");
            return;
        }
        setIsSubmittingInvoice(true);
        try {
            await DolibarrService.createSupplierInvoice(config, {
                socid: newInvoice.socid,
                date: new Date(newInvoice.date).getTime() / 1000,
                type: '0',
                libelle: newInvoice.label,
                ref_supplier: newInvoice.ref || `AUTO-${Date.now()}`,
                lines: [{
                    desc: newInvoice.label,
                    subprice: newInvoice.total,
                    qty: 1,
                    tva_tx: 0
                }]
            });
            toast.success("Fatura de Fornecedor Criada!");
            setIsCreateInvoiceOpen(false);
            refreshData();
        } catch (e: any) {
            console.error(e);
            toast.error("Erro ao criar fatura: " + e.message);
        } finally {
            setIsSubmittingInvoice(false);
        }
    };

    if (!config) return null;

    // 1. Header
    const renderHeader = (
        <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <FileText className="text-orange-500" /> Faturas de Fornecedor
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie contas a pagar e despesas</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar ref ou fornecedor..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className={`pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-${config.themeColor}-500 focus:border-${config.themeColor}-500 outline-none w-full md:w-64 text-sm transition-all`}
                        />
                    </div>
                    <button
                        onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                        className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 text-sm font-medium"
                        title={sortOrder === 'desc' ? "Mais recentes" : "Mais antigos"}
                    >
                        {sortOrder === 'desc' ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
                    </button>
                    <button
                        onClick={() => setIsScannerOpen(true)}
                        className={`flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                    >
                        <Receipt size={18} /> Digitalizar Recibo
                    </button>
                </div>
            </div>

            <StatusFilterBar
                filters={[
                    { id: 'all', label: 'Todas' },
                    { id: 'unpaid', label: 'A Pagar', color: 'orange' },
                    { id: 'paid', label: 'Pagas', color: 'emerald' },
                    { id: 'draft', label: 'Rascunhos', color: 'slate' }
                ]}
                activeFilter={filterStatus}
                onFilterChange={(id) => setFilterStatus(id as any)}
                themeColor={config.themeColor}
            />
        </div>
    );

    // 2. List Content
    const renderListContent = (
        <>
            {filteredInvoices.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <FileText size={48} className="mx-auto mb-4 opacity-50" />
                    <p>Nenhuma fatura encontrada com estes critérios.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-3">
                    {filteredInvoices.map((inv) => {
                        const projectName = getProjectName(inv.project_id);
                        return (
                            <div
                                key={inv.id}
                                onClick={() => setSelectedInvoice(inv)}
                                className={`p-4 rounded-xl border transition-all cursor-pointer ${selectedInvoice?.id === inv.id ? `border-${config.themeColor}-500 ring-1 ring-${config.themeColor}-500 shadow-sm dark:bg-slate-800` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-700'} `}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs text-slate-400">{inv.ref}</span>
                                        {getStatusBadge(inv)}
                                    </div>
                                    <div className="flex items-center text-xs text-slate-500">
                                        <Landmark size={12} className="mr-1" />
                                        Fornecedor
                                    </div>
                                </div>
                                <h3
                                    className="font-bold text-slate-800 dark:text-white text-sm mb-1 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (onNavigate) onNavigate('suppliers', inv.socid);
                                    }}
                                >
                                    {getSupplierName(inv.socid)}
                                </h3>
                                {projectName && (
                                    <div className="text-xs text-indigo-500 mb-2 flex items-center gap-1">
                                        <FolderKanban size={10} /> {projectName}
                                    </div>
                                )}
                                <div className="flex justify-between items-end">
                                    <span className="text-xs text-slate-500">{formatDateOnly(inv.date)}</span>
                                    <span className="font-bold text-slate-800 dark:text-white">${inv.total_ttc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </>
    );

    // 3. Detail Content
    const renderDetailContent = selectedInvoice ? (
        <>
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10 w-full">
                <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedInvoice(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight flex items-center gap-2">
                            {selectedInvoice.ref}
                            {getStatusBadge(selectedInvoice)}
                        </h2>
                        <span
                            className="text-xs text-slate-400 cursor-pointer hover:underline hover:text-indigo-500"
                            onClick={() => onNavigate && onNavigate('suppliers', selectedInvoice.socid)}
                        >
                            Fornecedor: {getSupplierName(selectedInvoice.socid)}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {selectedInvoice.statut === '0' && (
                        <button
                            onClick={async () => {
                                if (!window.confirm('Confirma a validação desta fatura?')) return;
                                try {
                                    await DolibarrService.validateSupplierInvoice(config, selectedInvoice.id);
                                    refreshData(); // Trigger sync/refresh
                                    setSelectedInvoice(null);
                                } catch (e) {
                                    console.error(e);
                                    alert('Erro ao validar fatura. Verifique permissões.');
                                }
                            }}
                            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                        >
                            <CheckCircle size={14} /> Validar
                        </button>
                    )}
                    {(selectedInvoice.statut === '1' || selectedInvoice.statut === '0') && ( // 0=Draft can sometimes be paid directly in flexible workflows, but usually 1=Unpaid
                        // Showing 'Pagar' for Unpaid ('1') specifically. If user wants to skip validate, logic might fail on API.
                        // Let's stick to Unpaid ('1').
                        selectedInvoice.statut === '1' && (
                            <button
                                onClick={async () => {
                                    if (!window.confirm('Marcar esta fatura como paga?')) return;
                                    try {
                                        await DolibarrService.markSupplierInvoiceAsPaid(config, selectedInvoice.id);
                                        refreshData();
                                        setSelectedInvoice(null);
                                    } catch (e) {
                                        console.error(e);
                                        alert('Erro ao marcar como pago. Verifique permissões.');
                                    }
                                }}
                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                            >
                                <CreditCard size={14} /> Pagar
                            </button>
                        )
                    )}
                    <button onClick={() => openInDolibarr(selectedInvoice.id)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><ExternalLink size={20} /></button>
                    <button onClick={() => setSelectedInvoice(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50 w-full">
                <div className="max-w-3xl mx-auto space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <p className="text-sm text-slate-500 uppercase font-bold mb-1">Valor Total</p>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white">${selectedInvoice.total_ttc.toLocaleString()}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-slate-500 uppercase font-bold mb-1">Data</p>
                                <p className="text-lg font-medium text-slate-800 dark:text-white">{formatDateOnly(selectedInvoice.date)}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Projeto Vinculado</p>
                                {selectedInvoice.project_id ? (
                                    <div
                                        className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-indigo-300 transition-colors"
                                        onClick={() => onNavigate && onNavigate('projects', selectedInvoice.project_id!)}
                                    >
                                        <FolderKanban size={16} className="text-indigo-500" />
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{getProjectName(selectedInvoice.project_id)}</span>
                                        <ExternalLink size={12} className="ml-auto text-slate-400" />
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-400 italic">Nenhum projeto vinculado</p>
                                )}
                            </div>

                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Responsáveis</p>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center text-sm p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-2"><User size={14} /> Criado por:</span>
                                        <span className="font-medium text-slate-800 dark:text-white">{getUserName(selectedInvoice.fk_user_author)}</span>
                                    </div>
                                    {selectedInvoice.fk_user_valid && (
                                        <div className="flex justify-between items-center text-sm p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-2"><CheckCircle size={14} /> Validado por:</span>
                                            <span className="font-medium text-slate-800 dark:text-white">{getUserName(selectedInvoice.fk_user_valid)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h4 className="font-bold text-slate-800 dark:text-white mb-4">Itens da Fatura</h4>
                        {invoiceLines.length === 0 ? (
                            <div className="text-center py-8 text-slate-400 italic bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                                Nenhum item encontrado.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-medium">
                                        <tr>
                                            <th className="px-4 py-3 rounded-l-lg">Descrição</th>
                                            <th className="px-4 py-3 text-right">Qtd</th>
                                            <th className="px-4 py-3 text-right">Preço Un.</th>
                                            <th className="px-4 py-3 text-right rounded-r-lg">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {invoiceLines.map((line) => (
                                            <tr key={line.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                <td className="px-4 py-3 max-w-xs">
                                                    <div className="font-medium text-slate-800 dark:text-slate-200">
                                                        {line.label || (line.product_ref ? `${line.product_ref} - ${line.product_label || ''}` : null) || <span className="italic text-slate-400">Item {line.id}</span>}
                                                    </div>
                                                    {line.description && (
                                                        <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap font-normal">
                                                            {line.description}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                    {line.qty}
                                                </td>
                                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(line.subprice || 0)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-white font-mono">
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(line.total_ttc || 0)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="border-t border-slate-200 dark:border-slate-700">
                                        <tr>
                                            <td colSpan={3} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300 uppercase text-xs tracking-wider">Total Geral</td>
                                            <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 font-mono text-base">
                                                ${selectedInvoice.total_ttc?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Linked Objects */}
                    <LinkedObjects
                        id={selectedInvoice.id}
                        type="facture_fourn"
                        onNavigate={onNavigate}
                    />
                </div >
            </div >
        </>
    ) : (
        <div className="text-center p-8 max-w-sm mx-auto">
            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300 dark:text-slate-600"><FileText size={32} /></div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Selecione uma Fatura</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Ver detalhes da fatura do fornecedor.</p>
        </div>
    );

    return (
        <>
            <GenericListLayout
                header={renderHeader}
                content={renderListContent}
                detail={renderDetailContent}
                isDetailOpen={!!selectedInvoice}
                pagination={
                    <PaginationControls
                        page={page}
                        limit={limit}
                        onPageChange={setPage}
                        onLimitChange={setLimit}
                        hasNext={filteredInvoices.length >= limit}
                        hasPrev={page > 0}
                    />
                }
            />
            {/* Receipt Scanner */}
            {
                isScannerOpen && (
                    <ReceiptScanner
                        onScanComplete={handleScanComplete}
                        onClose={() => setIsScannerOpen(false)}
                    />
                )
            }

            {/* Create Invoice Modal */}
            {
                isCreateInvoiceOpen && (
                    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                                <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                    <Receipt size={18} className="text-indigo-600" /> Nova Fatura (Via Scanner)
                                </h3>
                                <button onClick={() => setIsCreateInvoiceOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                            </div>
                            <form onSubmit={handleCreateInvoice} className="flex flex-col max-h-[85vh]">
                                <div className="p-6 space-y-4 overflow-y-auto">
                                    {scannedData && (
                                        <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-lg text-sm text-indigo-800 dark:text-indigo-200 mb-4 border border-indigo-100 dark:border-indigo-800/50">
                                            <p className="font-bold mb-1">Dados Extraídos:</p>
                                            <ul className="list-disc list-inside opacity-80">
                                                <li>Fornecedor: {scannedData.vendor || '?'}</li>
                                                <li>Total: {scannedData.total}</li>
                                                <li>Data: {scannedData.date}</li>
                                            </ul>
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fornecedor</label>
                                        <select
                                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            value={newInvoice.socid}
                                            onChange={e => setNewInvoice({ ...newInvoice, socid: e.target.value })}
                                            required
                                        >
                                            <option value="">Selecione...</option>
                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Ref. Fornecedor</label>
                                            <input
                                                type="text"
                                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                value={newInvoice.ref}
                                                onChange={e => setNewInvoice({ ...newInvoice, ref: e.target.value })}
                                                placeholder="Ex: NF-1234"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                                            <input
                                                type="date"
                                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                value={newInvoice.date}
                                                onChange={e => setNewInvoice({ ...newInvoice, date: e.target.value })}
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Total</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white font-bold"
                                                value={newInvoice.total}
                                                onChange={e => setNewInvoice({ ...newInvoice, total: parseFloat(e.target.value) })}
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                                            <input
                                                type="text"
                                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                value={newInvoice.label}
                                                onChange={e => setNewInvoice({ ...newInvoice, label: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                                    <button type="button" onClick={() => setIsCreateInvoiceOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                    <button type="submit" disabled={isSubmittingInvoice} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                        {isSubmittingInvoice ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Criar Fatura
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </>
    );
};

export default SupplierInvoiceList;
