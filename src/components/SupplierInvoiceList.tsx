
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { AppView, SupplierInvoice } from '../types';
import { FileText, CheckCircle2, Clock, FileEdit, ExternalLink, Download, FolderKanban, Plus, X, Trash2, Loader2, CheckCircle, CreditCard, ArrowDown, RefreshCcw, Landmark, Receipt, User, Upload, Eye } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { config as AppConfig } from '../config';
import { LinkedObjects } from './common/LinkedObjects';
import { PdfPreviewModal } from './common/PdfPreviewModal';
import { PaginationControls } from './common/PaginationControls';
import { useListControls } from '../hooks/useListControls';

// Design System
import { PageHeader, MasterDetailLayout, Card, Button, Tabs, Tab, EmptyState, StatusBadge, ListToolbar, ListTotalBar, ConfirmDeleteButton } from './ui';
import type { StatusConfig } from './ui';

const supplierInvoiceStatuses: Record<string, StatusConfig> = {
    draft: { label: 'Rascunho', variant: 'slate', icon: <FileEdit size={12} /> },
    unpaid: { label: 'A Pagar', variant: 'orange', icon: <Clock size={12} /> },
    paid: { label: 'Pago', variant: 'emerald', icon: <CheckCircle2 size={12} /> },
    credit: { label: 'Nota de Crédito', variant: 'red', icon: <RefreshCcw size={12} /> },
};
import { useDolibarr } from '../context/DolibarrContext';
import { useSupplierInvoices, useSuppliers, useProjects, useSupplierInvoiceLines, useUsers, useSupplierPayments, useSupplierPaymentInvoiceLinks } from '../hooks/dolibarr';
import { useDolibarrLink } from '../hooks/useDolibarrLink';
import { formatDateOnly } from '../utils/dateUtils';
import { formatCurrency } from '../utils/formatUtils';
import { ReceiptWizard } from './Finance/ReceiptWizard';
import { RichTextEditor } from './common/RichTextEditor';
import { SupplierPaymentModal } from './Modals/SupplierPaymentModal';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { notifyError } from '../utils/notifyError';

interface SupplierInvoiceListProps {
    onNavigate?: (view: AppView, id: string) => void;
}

// Linha editável de fatura de fornecedor no modal de edição/criação.
// `_rowId` é um identificador estável (client-side) usado como React `key`,
// evitando troca de dados entre linhas ao adicionar/remover itens (#848).
export interface SupplierInvoiceEditItem {
    _rowId: string;
    id?: string;
    desc: string;
    qty: number;
    price: number;
    remise_percent: number;
}

// Cria um item de edição com `_rowId` estável gerado via crypto.randomUUID(),
// aplicando defaults sensatos. Exportado para permitir testes unitários.
export const makeEditItem = (data: Partial<Omit<SupplierInvoiceEditItem, '_rowId'>> = {}): SupplierInvoiceEditItem => ({
    _rowId: crypto.randomUUID(),
    id: data.id,
    desc: data.desc ?? '',
    qty: data.qty ?? 1,
    price: data.price ?? 0,
    remise_percent: data.remise_percent ?? 0,
});

const SupplierInvoiceList: React.FC<SupplierInvoiceListProps> = ({ onNavigate }) => {
    const { config, refreshData, canDo } = useDolibarr();
    const confirm = useConfirm();

    // Data Hooks
    const { data: invoices = [], refetch: refetchInvoices } = useSupplierInvoices(config);
    const { data: suppliers = [] } = useSuppliers(config);
    const { data: projects = [] } = useProjects(config);
    const { data: allInvoiceLines = [] } = useSupplierInvoiceLines(config);
    const { data: users = [] } = useUsers(config);
    const { data: payments = [] } = useSupplierPayments(config);
    const { data: paymentLinks = [] } = useSupplierPaymentInvoiceLinks(config);

    const [filterStatus, setFilterStatus] = useState<'all' | 'unpaid' | 'paid' | 'draft'>('all');
    const [selectedInvoice, setSelectedInvoice] = useState<SupplierInvoice | null>(null);
    const [previewSupplierInvoice, setPreviewSupplierInvoice] = useState<{ id: string | number; ref: string } | null>(null);

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
        items: SupplierInvoiceEditItem[];
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
            notifyError('Carregar documentos', e);
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
            notifyError('Envio de documento', e);
        }
    };

    const handleDeleteDocument = async (filename: string) => {
        if (!selectedInvoice || !config) return;
        if (!(await confirm({ message: `Excluir ${filename}?`, danger: true }))) return;
        try {
            await DolibarrService.deleteDocument(config, 'supplier_invoice', `${selectedInvoice.ref}/${filename}`);
            loadDocuments();
        } catch (e) {
            notifyError('Excluir documento', e);
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

    // Filtro de status (Tabs) aplicado antes de busca/ordenação (#121).
    // 0=Draft, 1=Unpaid, 2=Paid
    const statusFilteredInvoices = useMemo(() => {
        return invoices.filter(inv => {
            if (filterStatus === 'paid') return inv.statut === '2';
            if (filterStatus === 'unpaid') return inv.statut === '1';
            if (filterStatus === 'draft') return inv.statut === '0';
            return true;
        });
    }, [invoices, filterStatus]);

    // Busca + ordenação padronizadas (#121). Busca por ref/fornecedor; ordena por data (desc por padrão).
    const controls = useListControls(statusFilteredInvoices, {
        searchText: (inv) => `${inv.ref || ''} ${getSupplierName(inv.socid) || ''}`,
        sorts: [
            { key: 'date', label: 'Data', get: (inv) => inv.date ?? 0 },
            { key: 'ref', label: 'Referência', get: (inv) => inv.ref },
            { key: 'total', label: 'Valor', get: (inv) => inv.total_ttc ?? 0 },
        ],
        initialSortKey: 'date',
        initialSortDir: 'desc',
    });
    const filteredInvoices = controls.result;
    const searchTerm = controls.search;

    // Reset page on search or filter change
    useEffect(() => {
        setPage(0);
    }, [searchTerm, filterStatus]);

    const invoiceLines = useMemo(() => {
        if (!selectedInvoice) return [];
        return allInvoiceLines.filter(line => String(line.parent_id) === String(selectedInvoice.id));
    }, [selectedInvoice, allInvoiceLines]);

    const getStatusBadge = (invoice: SupplierInvoice) => {
        const key = invoice.type === '2' ? 'credit' : invoice.statut === '0' ? 'draft' : invoice.statut === '2' ? 'paid' : 'unpaid';
        return <StatusBadge status={key} config={supplierInvoiceStatuses} />;
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
            items: lines.map(l => makeEditItem({
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
            items: [...editingInvoiceData.items, makeEditItem()]
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
        } catch (e) {
            notifyError('Salvar fatura', e);
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
        } catch (e) {
            notifyError('Registrar pagamento', e);
            throw e;
        }
    };

    // Deeplink HITL do agente (#57/#78): create_supplier_invoice abre o modal pré-preenchido
    // (incl. linhas livres) p/ o usuário revisar e confirmar.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_supplier_invoice') {
            appliedPrefillRef.current = prefill;
            const lines = Array.isArray(prefill.data.lines) ? prefill.data.lines : [];
            setEditingInvoiceData({
                id: '',
                ref: '',
                socid: prefill.data.socid || '',
                date: prefill.data.date || new Date().toISOString().split('T')[0],
                items: lines.map((l: any) => makeEditItem({ desc: l.desc || '', qty: Number(l.qty) || 1, price: Number(l.subprice) || 0, remise_percent: Number(l.remise_percent) || 0 })),
                deletedLineIds: [],
            });
            setIsEditModalOpen(true);
            toast.info('Revise os itens e confirme a criação da fatura de fornecedor.');
        } else if (prefill.kind === 'edit_supplier_invoice') {
            const inv = invoices.find((i: any) => String(i.id) === String(prefill.data.id));
            if (!inv) return; // aguarda os dados
            appliedPrefillRef.current = prefill;
            handleEditClick({ stopPropagation: () => { } } as any, inv); // carrega dados + linhas + abre modal
            const extra = Array.isArray(prefill.data.lines) ? prefill.data.lines : [];
            setEditingInvoiceData(prev => prev ? {
                ...prev,
                date: prefill.data.date || prev.date,
                items: [...prev.items, ...extra.map((l: any) => makeEditItem({ desc: l.desc || '', qty: Number(l.qty) || 1, price: Number(l.subprice) || 0, remise_percent: Number(l.remise_percent) || 0 }))],
            } : prev);
            toast.info('Revise as mudanças e salve a fatura de fornecedor.');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefill, invoices, allInvoiceLines]);

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

    if (!config) return null;

    // 1. Header
    const renderHeader = (
        <div className={selectedInvoice ? 'hidden lg:block' : 'block'}>
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        <FileText className="text-orange-500" size={24} /> Faturas de Fornecedor
                    </span>
                }
                subtitle="Gerencie contas a pagar e despesas"
                actions={
                    <div className="flex items-center gap-2">
                        <ListToolbar controls={controls} searchPlaceholder="Buscar ref ou fornecedor..." />
                        {canDo('create', 'supplier_invoices') && (
                        <Button icon={<Plus size={16} />} onClick={handleCreateClick}>
                            Nova Fatura
                        </Button>
                        )}
                        {canDo('create', 'supplier_invoices') && (
                        <Button variant="secondary" icon={<Receipt size={16} />} onClick={() => setIsScannerOpen(true)}>
                            Digitalizar
                        </Button>
                        )}
                    </div>
                }
                tabs={
                    <Tabs value={filterStatus} onChange={(v) => setFilterStatus(v as any)}>
                        <Tab value="all">Todas</Tab>
                        <Tab value="unpaid">A Pagar</Tab>
                        <Tab value="paid">Pagas</Tab>
                        <Tab value="draft">Rascunhos</Tab>
                    </Tabs>
                }
            />
        </div>
    );

    // 2. List Content
    const renderListContent = (
        <>
            {filteredInvoices.length === 0 ? (
                <EmptyState icon={FileText} title="Nenhuma fatura encontrada" description="Nenhuma fatura encontrada com estes critérios." />
            ) : (
                <div className="grid grid-cols-1 gap-3">
                    {filteredInvoices.slice(page * limit, (page + 1) * limit).map((inv) => {
                        const projectName = getProjectName(inv.project_id);
                        const isSelected = selectedInvoice?.id === inv.id;
                        return (
                            <div
                                key={inv.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedInvoice(inv)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedInvoice(inv); } }}
                                className={`bg-white dark:bg-slate-900 border rounded-xl p-4 hover:shadow-md cursor-pointer transition-all ${isSelected ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-800'}`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs text-slate-400">{inv.ref}</span>
                                        {getStatusBadge(inv)}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                        <span className="flex items-center"><Landmark size={12} className="mr-1" /> Fornecedor</span>
                                        {canDo('delete', 'supplier_invoices') && inv.statut === '0' && (
                                            <span onClick={(e) => e.stopPropagation()}>
                                                <ConfirmDeleteButton
                                                    onDelete={() => DolibarrService.deleteSupplierInvoice(config, inv.id)}
                                                    onDeleted={() => { if (selectedInvoice?.id === inv.id) setSelectedInvoice(null); refetchInvoices(); }}
                                                    itemLabel={inv.ref}
                                                />
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="font-bold text-indigo-600 dark:text-indigo-400 text-sm mb-1 hover:underline cursor-pointer text-left"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (onNavigate) onNavigate('suppliers', inv.socid);
                                    }}
                                >
                                    {getSupplierName(inv.socid)}
                                </button>
                                {projectName && (
                                    <div className="text-xs text-indigo-500 mb-2 flex items-center gap-1">
                                        <FolderKanban size={10} /> {projectName}
                                    </div>
                                )}
                                <div className="flex justify-between items-end">
                                    <span className="text-xs text-slate-500">{formatDateOnly(inv.date)}</span>
                                    <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(inv.total_ttc)}</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
            <ListTotalBar total={filteredInvoices.reduce((sum, inv) => sum + (inv.total_ttc ?? 0), 0)} />
        </>
    );

    // 3. Detail Content
    const renderDetailContent = selectedInvoice ? (
        <>
            <PageHeader
                onBack={() => setSelectedInvoice(null)}
                title={
                    <span className="flex items-center gap-2">
                        {selectedInvoice.ref}
                        {getStatusBadge(selectedInvoice)}
                    </span>
                }
                subtitle={
                    <span
                        className="cursor-pointer hover:underline hover:text-indigo-500"
                        onClick={() => onNavigate && onNavigate('suppliers', selectedInvoice.socid)}
                    >
                        Fornecedor: {getSupplierName(selectedInvoice.socid)}
                    </span>
                }
                actions={
                    <div className="flex items-center gap-2">
                        {canDo('edit', 'supplier_invoices') && selectedInvoice.statut === '0' && (
                            <Button variant="secondary" size="sm" icon={<FileEdit size={14} />} onClick={(e) => handleEditClick(e, selectedInvoice)}>
                                Editar
                            </Button>
                        )}
                        {canDo('validate', 'supplier_invoices') && selectedInvoice.statut === '0' && (
                            <Button size="sm" icon={<CheckCircle size={14} />} onClick={async () => {
                                if (!(await confirm('Confirma a validação desta fatura?'))) return;
                                try {
                                    await DolibarrService.validateSupplierInvoice(config, selectedInvoice.id);
                                    refreshData();
                                    setSelectedInvoice(null);
                                } catch (e) {
                                    notifyError('Validar fatura', e);
                                }
                            }}>
                                Validar
                            </Button>
                        )}
                        {canDo('pay', 'supplier_invoices') && selectedInvoice.statut === '1' && (
                            <Button variant="secondary" size="sm" icon={<CreditCard size={14} />} onClick={() => {
                                setPaymentInvoice(selectedInvoice);
                                setIsPaymentModalOpen(true);
                            }}>
                                Pagar
                            </Button>
                        )}
                        {canDo('reopen', 'supplier_invoices') && (selectedInvoice.statut === '1' || selectedInvoice.statut === '2') && (
                            <Button variant="ghost" size="sm" onClick={async () => {
                                if (!(await confirm('Reabrir fatura de fornecedor (voltar para rascunho)?'))) return;
                                try {
                                    await DolibarrService.setSupplierInvoiceToDraft(config, selectedInvoice.id);
                                    refreshData();
                                    setSelectedInvoice(null);
                                    toast.success("Fatura reaberta (Rascunho)");
                                } catch (err) {
                                    notifyError('Reabrir fatura', err);
                                }
                            }}>
                                Reabrir
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" icon={<Eye size={16} />} onClick={() => setPreviewSupplierInvoice({ id: selectedInvoice.id, ref: selectedInvoice.ref })} title="Visualizar PDF" />
                        <Button variant="ghost" size="sm" icon={<Download size={16} />} onClick={async () => { try { await DolibarrService.downloadDocument('supplier_invoice', selectedInvoice.id); } catch { toast.error('Erro ao baixar PDF'); } }} title="Baixar PDF" />
                        <Button variant="ghost" size="sm" icon={<ExternalLink size={16} />} onClick={() => openInDolibarr(selectedInvoice.id)} title="Abrir no Dolibarr" />
                        {canDo('delete', 'supplier_invoices') && selectedInvoice.statut === '0' && (
                            <ConfirmDeleteButton
                                onDelete={() => DolibarrService.deleteSupplierInvoice(config, selectedInvoice.id)}
                                onDeleted={() => { setSelectedInvoice(null); refetchInvoices(); }}
                                itemLabel={selectedInvoice.ref}
                            />
                        )}
                    </div>
                }
                tabs={
                    <Tabs value={activeTab} onChange={(v) => setActiveTab(v as any)}>
                        <Tab value="details">Detalhes</Tab>
                        <Tab value="documents">Documentos</Tab>
                    </Tabs>
                }
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50 w-full">
                {activeTab === 'details' ? (
                    <div className="max-w-3xl mx-auto space-y-6">
                        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <p className="text-sm text-slate-500 uppercase font-bold mb-1">Valor Total</p>
                                    <p className="text-3xl font-bold text-slate-900 dark:text-white">{formatCurrency(selectedInvoice.total_ttc)}</p>
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
                                                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(line.description) }}
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                        {line.qty}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                        {formatCurrency(line.subprice || 0)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                        {(line as any).remise_percent ? `${(line as any).remise_percent}%` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-white font-mono">
                                                        {formatCurrency(line.total_ttc || 0)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="border-t border-slate-200 dark:border-slate-700">
                                            <tr>
                                                <td colSpan={4} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300 uppercase text-xs tracking-wider">Total Geral</td>
                                                <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 font-mono text-base">
                                                    {formatCurrency(selectedInvoice.total_ttc)}
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
                                                            {formatCurrency(link.amount)}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex justify-between items-center pt-4 border-t border-slate-100 dark:border-slate-800">
                                            <div className="text-sm text-slate-500">Saldo Restante</div>
                                            <div className={`font-bold ${remaining > 0.01 ? 'text-orange-500' : 'text-emerald-500'} text-lg`}>
                                                {formatCurrency(Math.max(0, remaining))}
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
                                        <div key={doc.name ?? `doc-${idx}`} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 group hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
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
                                                    href={`${AppConfig.API_BASE_URL}/api/documents/supplier_invoice/${selectedInvoice.id}/pdf`}
                                                    download={doc.name}
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
    ) : null;

    return (
        <>
            <div className="flex flex-col h-full">
                {renderHeader}
                <MasterDetailLayout
                    list={
                        <>
                            {renderListContent}
                            <PaginationControls
                                page={page}
                                limit={limit}
                                onPageChange={setPage}
                                onLimitChange={setLimit}
                                hasNext={(page + 1) * limit < filteredInvoices.length}
                                hasPrev={page > 0}
                            />
                        </>
                    }
                    detail={renderDetailContent}
                    showDetail={!!selectedInvoice}
                    onCloseDetail={() => setSelectedInvoice(null)}
                />
            </div>
            {/* PDF Preview Modal */}
            <PdfPreviewModal
                entityType="supplier_invoice"
                entityId={previewSupplierInvoice?.id ?? ''}
                title={previewSupplierInvoice?.ref}
                isOpen={!!previewSupplierInvoice}
                onClose={() => setPreviewSupplierInvoice(null)}
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
                                                <div key={item._rowId} className="flex gap-2 items-start bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
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
                                                    <button type="button" aria-label="Remover item" onClick={() => handleRemoveEditItem(idx)} className="p-1 text-red-400 hover:text-red-600">
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
                                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
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
