
import React, { useState, useMemo, useEffect } from 'react';
import { Invoice, AppView, SupplierInvoice } from '../types';
import { FileText, Search, CheckCircle2, Clock, FileEdit, ExternalLink, Download, FolderKanban, Plus, X, Trash2, Loader2, CheckCircle, CreditCard, ArrowDown, ArrowUp, Lock, ShoppingCart, ArrowLeft, Truck, RefreshCcw, Landmark, Receipt, User, Upload } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { GenericListLayout } from './common/GenericListLayout';
import { LinkedObjects } from './common/LinkedObjects';
import { PaginationControls } from './common/PaginationControls';
import { StatusFilterBar } from './common/StatusFilterBar';
import { useDolibarr } from '../context/DolibarrContext';
import { useSupplierInvoices, useSuppliers, useProjects, useSupplierInvoiceLines, useUsers, useSupplierPayments, useSupplierPaymentInvoiceLinks } from '../hooks/dolibarr';
import { useDolibarrLink } from '../hooks/useDolibarrLink';
import { formatDateOnly } from '../utils/dateUtils';
import { ReceiptWizard } from './Finance/ReceiptWizard';
import { RichTextEditor } from './common/RichTextEditor';
import { SupplierPaymentModal } from './Modals/SupplierPaymentModal';
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
    const { data: payments = [] } = useSupplierPayments(config);
    const { data: paymentLinks = [] } = useSupplierPaymentInvoiceLinks(config);

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'unpaid' | 'paid' | 'draft'>('all');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
    const [selectedInvoice, setSelectedInvoice] = useState<SupplierInvoice | null>(null);

    // Pagination State
    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Scanner State
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isSubmittingInvoice, setIsSubmittingInvoice] = useState(false);

    // Edit State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingInvoiceData, setEditingInvoiceData] = useState<{
        id: string;
        ref: string;
        socid: string;
        date: string;
        items: { id?: string, desc: string, qty: number, price: number, remise_percent: 0 }[];
        deletedLineIds: string[];
    } | null>(null);

    // Documents State
    const [documents, setDocuments] = useState<any[]>([]); // Using any for DolibarrDocument temporarily or import
    const [isLoadingDocs, setIsLoadingDocs] = useState(false);
    const [activeTab, setActiveTab] = useState<'details' | 'documents'>('details');

    // Payment Modal State
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [paymentInvoice, setPaymentInvoice] = useState<SupplierInvoice | null>(null);

    const loadDocuments = async () => {
        if (!selectedInvoice || !config) return;
        setIsLoadingDocs(true);
        try {
            // Module part for supplier invoices: 'supplier_invoice' or 'fournisseur'
            const docs = await DolibarrService.fetchDocuments(config, 'supplier_invoice', selectedInvoice.id, selectedInvoice.ref);
            setDocuments(Array.isArray(docs) ? docs : []);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingDocs(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedInvoice || !config) return;

        try {
            await DolibarrService.uploadDocument(config, file, 'supplier_invoice', selectedInvoice.ref);
            toast.success("Arquivo enviado com sucesso");
            loadDocuments();
        } catch (e) {
            console.error(e);
            toast.error("Falha no envio");
        }
    };

    const handleDeleteDocument = async (filename: string) => {
        if (!selectedInvoice || !config || !confirm(`Excluir ${filename}?`)) return;
        try {
            await DolibarrService.deleteDocument(config, 'supplier_invoice', `${selectedInvoice.ref}/${filename}`);
            loadDocuments();
        } catch (e) {
            console.error(e);
            toast.error("Falha na exclusão");
        }
    };

    useEffect(() => {
        if (selectedInvoice && activeTab === 'documents') {
            loadDocuments();
        }
    }, [selectedInvoice, activeTab]);

    // Reset tab when selection changes
    useEffect(() => {
        setActiveTab('details');
    }, [selectedInvoice?.id]);

    // Reset page on search or filter change
    useEffect(() => {
        setPage(0);
    }, [searchTerm, filterStatus]);

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



    // --- Edit Logic ---
    const handleEditClick = (e: React.MouseEvent, invoice: SupplierInvoice) => {
        e.stopPropagation();
        const lines = allInvoiceLines.filter(line => String(line.parent_id) === String(invoice.id));

        setEditingInvoiceData({
            id: invoice.id,
            ref: invoice.ref,
            socid: invoice.socid,
            date: new Date(invoice.date * 1000).toISOString().split('T')[0],
            items: lines.map(l => ({
                id: l.id,
                desc: l.description || '',
                qty: l.qty,
                price: l.subprice || 0,
                remise_percent: (l as any).remise_percent || 0
            })),
            deletedLineIds: []
        });
        setIsEditModalOpen(true);
    };

    const handleEditAddItem = () => {
        if (!editingInvoiceData) return;
        setEditingInvoiceData({
            ...editingInvoiceData,
            items: [...editingInvoiceData.items, { desc: '', qty: 1, price: 0, remise_percent: 0 }]
        });
    };

    const handleUpdateEditItem = (index: number, field: string, value: any) => {
        if (!editingInvoiceData) return;
        const updatedItems = [...editingInvoiceData.items];
        updatedItems[index] = { ...updatedItems[index], [field]: value };
        setEditingInvoiceData({ ...editingInvoiceData, items: updatedItems });
    };

    const handleRemoveEditItem = (index: number) => {
        if (!editingInvoiceData) return;
        const itemToRemove = editingInvoiceData.items[index];
        const updatedItems = editingInvoiceData.items.filter((_, i) => i !== index);

        // Track deleted lines
        const newDeletedIds = [...editingInvoiceData.deletedLineIds];
        if (itemToRemove.id) {
            newDeletedIds.push(itemToRemove.id);
        }

        setEditingInvoiceData({
            ...editingInvoiceData,
            items: updatedItems,
            deletedLineIds: newDeletedIds
        });
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingInvoiceData || !config) return;

        setIsSubmittingInvoice(true);
        try {
            if (!editingInvoiceData.id) {
                // --- CREATE MODE ---
                if (!editingInvoiceData.socid) {
                    toast.error("Selecione um fornecedor");
                    return;
                }

                await DolibarrService.createSupplierInvoice(config, {
                    socid: editingInvoiceData.socid,
                    date: new Date(editingInvoiceData.date).getTime() / 1000,
                    type: '0', // Standard Invoice
                    ref_supplier: editingInvoiceData.ref, // Use ref field for supplier ref
                    lines: editingInvoiceData.items.map(item => ({
                        desc: item.desc,
                        subprice: item.price,
                        qty: item.qty,
                        remise_percent: item.remise_percent,
                        tva_tx: 0
                    }))
                });
                toast.success("Fatura Criada com Sucesso!");
            } else {
                // --- UPDATE MODE ---
                // 1. Update Header
                await DolibarrService.updateSupplierInvoice(config, editingInvoiceData.id, {
                    date: new Date(editingInvoiceData.date).getTime() / 1000,
                    ref_supplier: editingInvoiceData.ref
                });

                // 2. Handle Lines
                // Delete removed lines
                for (const lineId of editingInvoiceData.deletedLineIds) {
                    await DolibarrService.deleteSupplierInvoiceLine(config, editingInvoiceData.id, lineId);
                }

                // Update/Create lines
                for (const item of editingInvoiceData.items) {
                    const lineData = {
                        desc: item.desc,
                        qty: item.qty,
                        subprice: item.price,
                        remise_percent: item.remise_percent,
                        tva_tx: 0
                    };

                    if (item.id) {
                        await DolibarrService.updateSupplierInvoiceLine(config, editingInvoiceData.id, item.id, lineData);
                    } else {
                        await DolibarrService.addSupplierInvoiceLine(config, editingInvoiceData.id, lineData);
                    }
                }
                toast.success("Fatura Atualizada!");
            }

            setIsEditModalOpen(false);
            refreshData();
        } catch (e: any) {
            console.error(e);
            toast.error("Erro ao salvar: " + e.message);
        } finally {
            setIsSubmittingInvoice(false);
        }
    };

    const handlePaymentSubmit = async (paymentData: any) => {
        if (!paymentInvoice || !config) return;
        try {
            await DolibarrService.paySupplierInvoice(config, paymentInvoice.id, paymentData);
            toast.success("Pagamento registrado com sucesso!");
            refreshData();
            setPaymentInvoice(null);
        } catch (e: any) {
            console.error(e);
            toast.error("Erro ao registrar pagamento: " + (e.message || "Erro desconhecido"));
            // Throw so modal stays open if needed, or handle here. 
            // Modal catches errors if we throw? No, modal handles verify logic. 
            // But my modal calls onConfirm and awaits. So if I throw here, modal catches.
            throw e;
        }
    };

    const handleCreateClick = () => {
        setEditingInvoiceData({
            id: '',
            ref: '',
            socid: '',
            date: new Date().toISOString().split('T')[0],
            items: [],
            deletedLineIds: []
        });
        setIsEditModalOpen(true);
    };

    const handleDeleteInvoice = async () => {
        if (!selectedInvoice || !config || !confirm("Tem certeza que deseja excluir esta fatura (rascunho)?")) return;
        try {
            await DolibarrService.deleteSupplierInvoice(config, selectedInvoice.id);
            toast.success("Fatura excluída");
            setSelectedInvoice(null);
            refreshData();
        } catch (e: any) {
            console.error(e);
            toast.error("Erro ao excluir: " + e.message);
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
                    <div className="flex gap-2">
                        <button
                            onClick={handleCreateClick}
                            className={`flex items-center gap-1.5 px-3 py-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                        >
                            <Plus size={18} /> Nova Fatura
                        </button>
                        <button
                            onClick={() => setIsScannerOpen(true)}
                            className={`flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                        >
                            <Receipt size={18} /> Digitalizar Recibo
                        </button>
                    </div>
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
                    {filteredInvoices.slice(page * limit, (page + 1) * limit).map((inv) => {
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
                            onClick={(e) => handleEditClick(e, selectedInvoice)}
                            className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                        >
                            <FileEdit size={14} /> Editar
                        </button>
                    )}
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
                                onClick={() => {
                                    setPaymentInvoice(selectedInvoice);
                                    setIsPaymentModalOpen(true);
                                }}
                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                            >
                                <CreditCard size={14} /> Pagar
                            </button>
                        ))}
                    {(selectedInvoice.statut === '1' || selectedInvoice.statut === '2') && (
                        <button
                            onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm("Reabrir fatura de fornecedor (voltar para rascunho)?")) return;
                                try {
                                    await DolibarrService.setSupplierInvoiceToDraft(config, selectedInvoice.id);
                                    refreshData();
                                    setSelectedInvoice(null);
                                    toast.success("Fatura reaberta (Rascunho)");
                                } catch (err: any) {
                                    console.error(err);
                                    toast.error("Erro ao reabrir fatura: " + err.message);
                                }
                            }}
                            className="p-2 rounded-lg text-xs text-slate-500 hover:text-slate-800 underline"
                        >
                            Reabrir
                        </button>
                    )}
                    <button onClick={() => openInDolibarr(selectedInvoice.id)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title="Abrir no Dolibarr"><ExternalLink size={20} /></button>
                    {selectedInvoice.statut === '0' && (
                        <button onClick={handleDeleteInvoice} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Excluir"><Trash2 size={20} /></button>
                    )}
                    <button onClick={() => setSelectedInvoice(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            {/* Content Switcher */}
            <div className="border-b border-slate-100 dark:border-slate-800 px-4 bg-white dark:bg-slate-900 border-t border-slate-50 dark:border-slate-800/50">
                <div className="flex gap-4">
                    <button
                        onClick={() => setActiveTab('details')}
                        className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'details' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400` : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                    >
                        Detalhes
                    </button>
                    <button
                        onClick={() => setActiveTab('documents')}
                        className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'documents' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400` : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                    >
                        Documentos
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50 w-full">
                {activeTab === 'details' ? (
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
                                                <th className="px-4 py-3 text-right">Desc. (%)</th>
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
                                                            <div
                                                                className="text-xs text-slate-500 mt-1 font-normal prose prose-sm max-w-none prose-p:my-0 prose-ul:my-0 prose-li:my-0"
                                                                dangerouslySetInnerHTML={{ __html: line.description }}
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                        {line.qty}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(line.subprice || 0)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                        {(line as any).remise_percent ? `${(line as any).remise_percent}%` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-white font-mono">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(line.total_ttc || 0)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="border-t border-slate-200 dark:border-slate-700">
                                            <tr>
                                                <td colSpan={4} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300 uppercase text-xs tracking-wider">Total Geral</td>
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

                        {/* Linked Payments Section */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm mt-6">
                            <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <CreditCard size={18} className="text-emerald-500" /> Pagamentos ao Fornecedor
                            </h4>

                            {(() => {
                                const linkedPayments = paymentLinks
                                    .filter(link => String(link.fk_facturefourn) === String(selectedInvoice.id))
                                    .map(link => {
                                        const payment = payments.find(p => String(p.id) === String(link.fk_paiementfourn));
                                        return { link, payment };
                                    })
                                    .filter(item => item.payment);

                                const totalPaid = linkedPayments.reduce((acc, item) => acc + (item.link.amount || 0), 0);
                                const remaining = selectedInvoice.total_ttc - totalPaid;

                                if (linkedPayments.length === 0) {
                                    return (
                                        <div className="text-center py-6 text-slate-400 italic bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                                            Nenhum pagamento registrado para esta fatura.
                                        </div>
                                    );
                                }

                                return (
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            {linkedPayments.map(({ link, payment }) => (
                                                <div
                                                    key={link.id}
                                                    className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer group"
                                                    onClick={() => onNavigate && payment && onNavigate('supplier_payments', String(payment.id))}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full group-hover:scale-110 transition-transform">
                                                            <ArrowDown size={14} />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-slate-900 dark:text-white text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                                                {payment?.ref}
                                                            </div>
                                                            <div className="text-xs text-slate-500">{formatDateOnly(payment?.date_payment)}</div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                                                            ${link.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex justify-between items-center pt-4 border-t border-slate-100 dark:border-slate-800">
                                            <div className="text-sm text-slate-500">Saldo Restante</div>
                                            <div className={`font-bold ${remaining > 0.01 ? 'text-orange-500' : 'text-emerald-500'} text-lg`}>
                                                ${remaining > 0 ? remaining.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div >
                ) : (
                    <div className="max-w-4xl mx-auto space-y-6">
                        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-slate-800 dark:text-white">Documentos Anexados</h3>
                                <div className="relative">
                                    <input
                                        type="file"
                                        id="upload-doc"
                                        className="hidden"
                                        onChange={handleFileUpload}
                                    />
                                    <label
                                        htmlFor="upload-doc"
                                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium cursor-pointer transition-colors"
                                    >
                                        <Upload size={16} /> Upload
                                    </label>
                                </div>
                            </div>

                            {isLoadingDocs ? (
                                <div className="p-8 text-center text-slate-500">
                                    <Loader2 className="animate-spin mx-auto mb-2" />
                                    Carregando documentos...
                                </div>
                            ) : documents.length === 0 ? (
                                <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                    <FileText size={48} className="mx-auto mb-4 text-slate-300 dark:text-slate-600" />
                                    <p className="text-slate-500 dark:text-slate-400">Nenhum documento encontrado.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {documents.map((doc, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 group hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="p-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                                                    <FileText size={24} className="text-indigo-500" />
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className="font-medium text-slate-800 dark:text-white text-sm truncate" title={doc.name}>{doc.name}</h4>
                                                    <p className="text-xs text-slate-500">
                                                        {doc.date ? new Date(doc.date * 1000).toLocaleDateString() : '-'} • {(doc.size / 1024).toFixed(1)} KB
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <a
                                                    href={`${config.apiUrl}/documents/download?module_part=supplier_invoice&original_file=${selectedInvoice.ref}/${doc.name}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    onClick={async (e) => {
                                                        e.preventDefault();
                                                        // Use service to handle auth headers if needed, otherwise direct link might fail if API key not in query/cookie
                                                        try {
                                                            await DolibarrService.downloadDocument(config, 'supplier_invoice', `${selectedInvoice.ref}/${doc.name}`);
                                                        } catch (err) {
                                                            console.error(err);
                                                            alert("Erro ao baixar arquivo");
                                                        }
                                                    }}
                                                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg"
                                                    title="Baixar"
                                                >
                                                    <Download size={18} />
                                                </a>
                                                <button
                                                    onClick={() => handleDeleteDocument(doc.name)}
                                                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                                                    title="Excluir"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
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
                        hasNext={(page + 1) * limit < filteredInvoices.length}
                        hasPrev={page > 0}
                    />
                }
            />
            {/* Receipt Scanner */}
            {
                isScannerOpen && (
                    <ReceiptWizard
                        onClose={() => setIsScannerOpen(false)}
                        onInvoiceCreated={() => {
                            refreshData();
                            setIsScannerOpen(false);
                        }}
                    />
                )
            }


            {/* Edit Invoice Modal */}
            {
                isEditModalOpen && editingInvoiceData && (
                    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-indigo-50 dark:bg-indigo-900/30 rounded-t-xl">
                                <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                    <FileEdit size={18} className="text-indigo-600" /> {editingInvoiceData.id ? `Editar Fatura ${editingInvoiceData.ref}` : 'Nova Fatura de Fornecedor'}
                                </h3>
                                <button onClick={() => setIsEditModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                            </div>

                            <form onSubmit={handleSaveEdit} className="flex-1 flex flex-col overflow-hidden">
                                <div className="p-6 space-y-4 overflow-y-auto">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fornecedor</label>
                                            <select
                                                className={`w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white ${editingInvoiceData.id ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                value={editingInvoiceData.socid}
                                                onChange={e => setEditingInvoiceData({ ...editingInvoiceData, socid: e.target.value })}
                                                disabled={!!editingInvoiceData.id}
                                            >
                                                <option value="">Selecione...</option>
                                                {suppliers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Ref. Fornecedor</label>
                                            <input
                                                type="text"
                                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                value={editingInvoiceData.ref}
                                                onChange={e => setEditingInvoiceData({ ...editingInvoiceData, ref: e.target.value })}
                                                placeholder="Ex: INV-2024-001"
                                                required
                                            />
                                            <div className="mt-2">
                                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                                                <input
                                                    type="date"
                                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                    value={editingInvoiceData.date}
                                                    onChange={e => setEditingInvoiceData({ ...editingInvoiceData, date: e.target.value })}
                                                    required
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                                        <div className="flex justify-between items-center mb-2">
                                            <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300">Itens</h4>
                                            <button type="button" onClick={handleEditAddItem} className="text-xs flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 px-2 py-1 rounded">
                                                <Plus size={12} /> Adicionar Item
                                            </button>
                                        </div>

                                        <div className="space-y-2">
                                            {editingInvoiceData.items.length === 0 && <p className="text-sm text-slate-400 italic text-center py-4">Nenhum item.</p>}
                                            {editingInvoiceData.items.map((item, idx) => (
                                                <div key={idx} className="flex gap-2 items-start bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
                                                    <div className="flex-1">
                                                        <RichTextEditor
                                                            value={item.desc}
                                                            onChange={val => handleUpdateEditItem(idx, 'desc', val)}
                                                            placeholder="Descrição"
                                                            className="w-full mb-1"
                                                        />
                                                    </div>
                                                    <div className="w-20">
                                                        <input
                                                            type="number"
                                                            className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                            placeholder="Qtd"
                                                            value={item.qty}
                                                            onChange={e => handleUpdateEditItem(idx, 'qty', parseInt(e.target.value))}
                                                            min="1"
                                                        />
                                                    </div>
                                                    <div className="w-24">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                            placeholder="Preço"
                                                            value={item.price}
                                                            onChange={e => handleUpdateEditItem(idx, 'price', parseFloat(e.target.value))}
                                                        />
                                                    </div>
                                                    <div className="w-20">
                                                        <input
                                                            type="number"
                                                            className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                            placeholder="Desc%"
                                                            value={item.remise_percent || ''}
                                                            onChange={e => handleUpdateEditItem(idx, 'remise_percent', parseFloat(e.target.value))}
                                                        />
                                                    </div>
                                                    <button type="button" onClick={() => handleRemoveEditItem(idx)} className="p-1 text-red-400 hover:text-red-600">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                                    <button
                                        type="button"
                                        onClick={() => setIsEditModalOpen(false)}
                                        className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSubmittingInvoice}
                                        className={`px-4 py-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg font-medium shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2`}
                                    >
                                        {isSubmittingInvoice && <Loader2 className="animate-spin" size={16} />}
                                        {editingInvoiceData.id ? 'Salvar Alterações' : 'Criar Fatura'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
            {/* Payment Modal */}
            {paymentInvoice && (
                <SupplierPaymentModal
                    invoice={paymentInvoice}
                    isOpen={isPaymentModalOpen}
                    onClose={() => {
                        setIsPaymentModalOpen(false);
                        setPaymentInvoice(null);
                    }}
                    onConfirm={handlePaymentSubmit}
                />
            )}
        </>
    );
};

export default SupplierInvoiceList;
