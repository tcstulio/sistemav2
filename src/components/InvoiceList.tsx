import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { Invoice, AppView } from '../types';
import { FileText, CheckCircle2, Clock, FileEdit, ExternalLink, Download, FolderKanban, Plus, Trash2, Loader2, CheckCircle, CreditCard, ShoppingCart, RefreshCcw, Truck, Copy, Eye } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { cloneInvoice } from '../services/api/commercial';
import { useInvoiceMutations } from '../hooks/useMutations';
import { useConfirm } from '../hooks/useConfirm';
import { useListControls } from '../hooks/useListControls';
import { LinkedObjects } from './common/LinkedObjects';
import { PdfPreviewModal } from './common/PdfPreviewModal';
import { ClickTarget, ClickTargetPrimary, ClickTargetSecondary } from './common/ClickTarget';
import { PaginationControls } from './common/PaginationControls';
import { useDolibarr } from '../context/DolibarrContext';
import { useInvoices, useCustomers, useProjects, useProducts, useShipments, useInvoiceLines, useUsers, usePayments, usePaymentInvoiceLinks } from '../hooks/dolibarr';
import { useDolibarrLink } from '../hooks/useDolibarrLink';
import { formatDateOnly, formatDateTime } from '../utils/dateUtils';
import { formatCurrency } from '../utils/formatUtils';
import { RichTextEditor } from './common/RichTextEditor';
import { CustomerPaymentModal } from './Modals/CustomerPaymentModal';
import { MasterDetailLayout } from './ui/MasterDetailLayout';
import { PageHeader } from './ui/PageHeader';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Tabs, Tab } from './ui/Tabs';
import { EmptyState } from './ui/EmptyState';
import { StatusBadge } from './ui/StatusBadge';
import { ListToolbar } from './ui/ListToolbar';
import { ListTotalBar } from './ui/ListTotalBar';
import { ConfirmDeleteButton } from './ui/ConfirmDeleteButton';
import { logger } from '../utils/logger';
import { notifyError } from '../utils/notifyError';

const log = logger.child('InvoiceList');

const invoiceStatuses = {
    'credit_note': { label: 'Nota de Crédito', variant: 'red' as const, icon: <RefreshCcw size={12} /> },
    '0': { label: 'Rascunho', variant: 'slate' as const, icon: <FileEdit size={12} /> },
    '1': { label: 'A Pagar', variant: 'orange' as const, icon: <Clock size={12} /> },
    '2': { label: 'Pago', variant: 'emerald' as const, icon: <CheckCircle2 size={12} /> },
};

const getInvoiceStatusKey = (inv: Invoice) => inv.type === '2' ? 'credit_note' : inv.statut;

interface InvoiceListProps {
    onNavigate?: (view: AppView, id: string) => void;
    invoices?: any[];
    customers?: any[];
    projects?: any[];
    products?: any[];
    shipments?: any[];
    config?: any;
}

const InvoiceList: React.FC<InvoiceListProps> = ({ onNavigate }) => {
    const { config, refreshData } = useDolibarr();

    const { data: invoices = [], refetch: refetchInvoices } = useInvoices(config);
    const { data: customers = [] } = useCustomers(config);
    const { data: projects = [] } = useProjects(config);
    const { data: products = [] } = useProducts(config, !!config);
    const { data: shipments = [] } = useShipments(config, !!config);
    const { data: allInvoiceLines = [] } = useInvoiceLines(config);
    const { data: users = [] } = useUsers(config);
    const { data: payments = [] } = usePayments(config);
    const { data: paymentLinks = [] } = usePaymentInvoiceLinks(config);

    const [filterStatus, setFilterStatus] = useState<'all' | 'unpaid' | 'paid' | 'draft'>('all');
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [previewInvoice, setPreviewInvoice] = useState<{ id: string | number; ref: string } | null>(null);

    const { createInvoice } = useInvoiceMutations(config);

    const confirm = useConfirm();

    // Pagination
    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Creation State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [newInvoice, setNewInvoice] = useState({
        socid: '',
        date: new Date().toISOString().split('T')[0],
        items: [] as { productId: string, desc: string, qty: number, price: number, remise_percent: number }[]
    });

    // Edit State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingInvoiceData, setEditingInvoiceData] = useState<{
        id: string;
        ref: string;
        socid: string;
        date: string;
        items: { id?: string, productId: string, desc: string, qty: number, price: number, remise_percent: number }[];
        deletedLineIds: string[];
    } | null>(null);

    // Payment State
    const [isPayModalOpen, setIsPayModalOpen] = useState(false);
    const [selectedInvoiceForPay, setSelectedInvoiceForPay] = useState<Invoice | null>(null);
    const [abandonReason, setAbandonReason] = useState('');
    const [abandoningInvoiceId, setAbandoningInvoiceId] = useState<string | null>(null);

    // Deeplink HITL do agente (#57/#78): create_invoice abre o modal de nova fatura
    // pré-preenchido, incluindo as LINHAS de itens, p/ o usuário revisar e confirmar.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_invoice') {
            appliedPrefillRef.current = prefill;
            const lines = Array.isArray(prefill.data.lines) ? prefill.data.lines : [];
            setNewInvoice({
                socid: prefill.data.socid || '',
                date: prefill.data.date || new Date().toISOString().split('T')[0],
                items: lines.map((l: any) => ({
                    productId: l.fk_product ? String(l.fk_product) : '',
                    desc: l.desc || '',
                    qty: Number(l.qty) || 1,
                    price: Number(l.subprice) || 0,
                    remise_percent: Number(l.remise_percent) || 0,
                })),
            });
            setIsCreateModalOpen(true);
            toast.info('Revise os itens e confirme a criação da fatura.');
        } else if (prefill.kind === 'edit_invoice') {
            const inv = invoices.find((i: any) => String(i.id) === String(prefill.data.id));
            if (!inv) return; // aguarda os dados p/ carregar a fatura + linhas atuais
            appliedPrefillRef.current = prefill;
            handleEditClick({ stopPropagation: () => { } } as any, inv); // carrega dados + linhas + abre modal
            const extra = Array.isArray(prefill.data.lines) ? prefill.data.lines : [];
            setEditingInvoiceData(prev => prev ? {
                ...prev,
                date: prefill.data.date || prev.date,
                items: [...prev.items, ...extra.map((l: any) => ({
                    productId: l.fk_product ? String(l.fk_product) : '',
                    desc: l.desc || '',
                    qty: Number(l.qty) || 1,
                    price: Number(l.subprice) || 0,
                    remise_percent: Number(l.remise_percent) || 0,
                }))],
            } : prev);
            toast.info('Revise as mudanças e salve a fatura.');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefill, invoices, allInvoiceLines]);

    // =================================================================================================
    // HELPERS
    // =================================================================================================
    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => c.id === socid);
        return customer ? customer.name : 'Cliente Desconhecido';
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

    // Filtro de status (Tabs) aplicado como pré-filtro antes de busca/ordenação (#121).
    const statusFilteredInvoices = useMemo(() => {
        return invoices.filter(inv => {
            if (filterStatus === 'paid') return inv.statut === '2';
            if (filterStatus === 'unpaid') return inv.statut === '1';
            if (filterStatus === 'draft') return inv.statut === '0';
            return true;
        });
    }, [invoices, filterStatus]);

    // Busca + ordenação padronizadas (#121). Busca por ref ou nome do cliente.
    const controls = useListControls(statusFilteredInvoices, {
        searchText: (inv) => `${inv.ref || ''} ${getCustomerName(inv.socid)}`,
        sorts: [
            { key: 'date', label: 'Data', get: (inv) => inv.date ?? 0 },
            { key: 'ref', label: 'Referência', get: (inv) => inv.ref },
            { key: 'total', label: 'Valor', get: (inv) => inv.total_ttc ?? 0 },
            { key: 'customer', label: 'Cliente', get: (inv) => getCustomerName(inv.socid) },
        ],
        initialSortKey: 'date',
        initialSortDir: 'desc',
    });
    const filteredInvoices = controls.result;

    // Reset da paginação quando a busca muda.
    useEffect(() => { setPage(0); }, [controls.search]);

    const invoiceLines = useMemo(() => {
        if (!selectedInvoice) return [];
        return allInvoiceLines.filter(line => String(line.parent_id) === String(selectedInvoice.id));
    }, [selectedInvoice, allInvoiceLines]);

    const linkedShipments = useMemo(() => {
        if (!selectedInvoice || !selectedInvoice.order_id) return [];
        return shipments.filter(s => s.fk_commande && String(s.fk_commande) === String(selectedInvoice.order_id));
    }, [selectedInvoice, shipments]);

    const { openLink } = useDolibarrLink(config);

    // =================================================================================================
    // HANDLERS
    // =================================================================================================
    const openInDolibarr = (id: string) => openLink('invoice', id);

    const handleDownloadPdf = async (e: React.MouseEvent, id: string | number) => {
        e.stopPropagation();
        if (!config) return;
        try {
            await DolibarrService.downloadDocument('invoice', id);
        } catch {
            toast.error('Erro ao baixar PDF da fatura');
        }
    };

    const handleValidate = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!config) return;
        setProcessingId(id);
        try {
            await DolibarrService.validateInvoice(config, id);
            toast.success("Fatura Validada!");
            if (refreshData) refreshData();
        } catch (err) {
            log.error("Failed to validate invoice", err);
            toast.error("Falha ao validar fatura.");
        } finally {
            setProcessingId(null);
        }
    };

    const handleCreateCreditNote = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!config) return;
        setProcessingId(id);
        try {
            await DolibarrService.createCreditNote(config, id);
            toast.success("Nota de Crédito criada com sucesso!");
            if (refreshData) refreshData();
        } catch (err: any) {
            log.error("Failed to create credit note", err);
            toast.error(`Falha ao criar Nota de Crédito: ${err.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const handleDuplicate = async (invoiceId: string) => {
        const ok = await confirm({ message: 'Duplicar esta fatura como rascunho?' });
        if (!ok || !config) return;
        setProcessingId(invoiceId);
        try {
            await cloneInvoice(config, invoiceId);
            toast.success('Fatura duplicada com sucesso');
            refetchInvoices();
        } catch (e: any) {
            notifyError('Duplicar fatura', e);
        } finally {
            setProcessingId(null);
        }
    };

    // Creation Logic
    const handleAddItem = () => {
        setNewInvoice({
            ...newInvoice,
            items: [...newInvoice.items, { productId: '', desc: '', qty: 1, price: 0, remise_percent: 0 }]
        });
    };

    const handleUpdateItem = (index: number, field: string, value: any) => {
        const updatedItems = [...newInvoice.items];
        updatedItems[index] = { ...updatedItems[index], [field]: value };
        if (field === 'productId') {
            const prod = products.find(p => p.id === value);
            if (prod) {
                updatedItems[index].price = prod.price;
                updatedItems[index].desc = prod.label;
            }
        }
        setNewInvoice({ ...newInvoice, items: updatedItems });
    };

    const handleRemoveItem = (index: number) => {
        setNewInvoice({ ...newInvoice, items: newInvoice.items.filter((_, i) => i !== index) });
    };

    const calculateTotal = () => newInvoice.items.reduce((acc, item) => acc + (item.price * item.qty), 0);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newInvoice.socid) return toast.error("Selecione um cliente");
        setIsSubmitting(true);
        try {
            await createInvoice.mutateAsync({
                socid: newInvoice.socid,
                date: new Date(newInvoice.date).getTime() / 1000,
                type: "0",
                lines: newInvoice.items.map(item => ({
                    fk_product: item.productId || undefined,
                    desc: item.desc,
                    qty: item.qty,
                    subprice: item.price,
                    tva_tx: 0
                }))
            });
            toast.success("Fatura Criada com Sucesso");
            setIsCreateModalOpen(false);
            setNewInvoice({ socid: '', date: new Date().toISOString().split('T')[0], items: [] });
        } catch (e: any) {
            log.error("Failed to create invoice", e);
            toast.error(`Falha ao criar fatura: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Edit Logic
    const handleEditClick = (e: React.MouseEvent, invoice: Invoice) => {
        e.stopPropagation();
        const lines = allInvoiceLines.filter(line => String(line.parent_id) === String(invoice.id));
        setEditingInvoiceData({
            id: invoice.id,
            ref: invoice.ref,
            socid: invoice.socid,
            date: new Date(invoice.date * 1000).toISOString().split('T')[0],
            items: lines.map(l => ({
                id: l.id,
                productId: l.product_id || '',
                desc: l.description || '',
                qty: l.qty,
                price: l.subprice || 0,
                remise_percent: l.remise_percent || 0
            })),
            deletedLineIds: []
        });
        setIsEditModalOpen(true);
    };

    const handleEditAddItem = () => {
        if (!editingInvoiceData) return;
        setEditingInvoiceData({
            ...editingInvoiceData,
            items: [...editingInvoiceData.items, { productId: '', desc: '', qty: 1, price: 0, remise_percent: 0 }]
        });
    };

    const handleUpdateEditItem = (index: number, field: string, value: any) => {
        if (!editingInvoiceData) return;
        const updatedItems = [...editingInvoiceData.items];
        updatedItems[index] = { ...updatedItems[index], [field]: value };
        if (field === 'productId') {
            const prod = products.find(p => p.id === value);
            if (prod) {
                updatedItems[index].price = prod.price;
                updatedItems[index].desc = prod.label;
            }
        }
        setEditingInvoiceData({ ...editingInvoiceData, items: updatedItems });
    };

    const handleRemoveEditItem = (index: number) => {
        if (!editingInvoiceData) return;
        const itemToRemove = editingInvoiceData.items[index];
        const newDeletedIds = [...editingInvoiceData.deletedLineIds];
        if (itemToRemove.id) newDeletedIds.push(itemToRemove.id);
        setEditingInvoiceData({
            ...editingInvoiceData,
            items: editingInvoiceData.items.filter((_, i) => i !== index),
            deletedLineIds: newDeletedIds
        });
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingInvoiceData || !config) return;
        setIsSubmitting(true);
        try {
            await DolibarrService.updateInvoice(config, editingInvoiceData.id, {
                date: new Date(editingInvoiceData.date).getTime() / 1000,
                socid: editingInvoiceData.socid
            });

            for (const lineId of editingInvoiceData.deletedLineIds) {
                await DolibarrService.deleteInvoiceLine(config, editingInvoiceData.id, lineId);
            }
            for (const item of editingInvoiceData.items) {
                const lineData = {
                    fk_product: item.productId || undefined,
                    desc: item.desc,
                    qty: item.qty,
                    subprice: item.price,
                    tva_tx: 0
                };
                if (item.id) {
                    await DolibarrService.updateInvoiceLine(config, editingInvoiceData.id, item.id, lineData);
                } else {
                    await DolibarrService.addInvoiceLine(config, editingInvoiceData.id, lineData);
                }
            }

            toast.success("Fatura Atualizada com Sucesso");
            setIsEditModalOpen(false);
            if (refreshData) refreshData();
        } catch (e: any) {
            log.error("Failed to update invoice", e);
            toast.error(`Falha ao atualizar fatura: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Payment Logic
    const handlePayClick = (e: React.MouseEvent, invoice: Invoice) => {
        e.stopPropagation();
        setSelectedInvoiceForPay(invoice);
        setIsPayModalOpen(true);
    };

    const handleRegisterPayment = async (paymentData: any) => {
        if (!selectedInvoiceForPay || !config) return;
        try {
            await DolibarrService.setPayment(config, selectedInvoiceForPay.id, paymentData);
            toast.success("Pagamento Registrado com Sucesso");
            selectedInvoiceForPay.statut = '2';
            selectedInvoiceForPay.paye = '1';
            if (refreshData) refreshData();
            setIsPayModalOpen(false);
            setSelectedInvoiceForPay(null);
        } catch (err) {
            log.error("Failed to register payment", err);
            toast.error("Falha ao registrar pagamento");
            throw err;
        }
    };

    if (!config) return null;

    // =================================================================================================
    // RENDER SECTIONS
    // =================================================================================================

    const renderHeader = (
        <div className={selectedInvoice ? 'hidden lg:block' : 'block'}>
            <PageHeader
                title="Faturas"
                subtitle="Acompanhe pagamentos e receita"
                actions={
                    <div className="flex items-center gap-2">
                        <ListToolbar controls={controls} searchPlaceholder="Buscar ref ou cliente..." />
                        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setIsCreateModalOpen(true)}>
                            Novo
                        </Button>
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

    const renderListContent = (
        <>
            {filteredInvoices.length === 0 ? (
                <EmptyState
                    icon={FileText}
                    title="Nenhuma fatura encontrada"
                    description="Nenhuma fatura encontrada com estes critérios."
                />
            ) : (
                <div className="grid grid-cols-1 gap-3 p-4">
                    {filteredInvoices.map((inv) => {
                        const projectName = getProjectName(inv.project_id);
                        const isDraft = inv.statut === '0';
                        const customerName = getCustomerName(inv.socid);
                        return (
                            <ClickTarget
                                key={inv.id}
                                selected={selectedInvoice?.id === inv.id}
                                hoverable
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        {/* Alvo primário (esticado sobre todo o card): abrir a FATURA */}
                                        <ClickTargetPrimary
                                            onClick={() => setSelectedInvoice(inv)}
                                            aria-label={`Abrir fatura ${inv.ref}`}
                                            className="font-mono text-xs text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors inline-flex items-center gap-1"
                                        >
                                            <FileText size={12} aria-hidden="true" /> {inv.ref}
                                        </ClickTargetPrimary>
                                        <StatusBadge status={getInvoiceStatusKey(inv)} config={invoiceStatuses} />
                                    </div>
                                    {/* Alvos secundários: ficam acima do ::after do primário (z-10) */}
                                    <ClickTargetSecondary className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={<Copy size={16} />}
                                            onClick={() => handleDuplicate(inv.id)}
                                            title="Duplicar"
                                            aria-label="Duplicar"
                                            loading={processingId === inv.id}
                                            disabled={!!processingId}
                                        />
                                        {isDraft ? (
                                            <ConfirmDeleteButton
                                                onDelete={() => DolibarrService.deleteInvoice(config, inv.id)}
                                                onDeleted={() => {
                                                    if (selectedInvoice?.id === inv.id) setSelectedInvoice(null);
                                                    refetchInvoices();
                                                }}
                                                itemLabel={inv.ref}
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                disabled
                                                aria-label="Excluir indisponível"
                                                title="Apenas faturas em rascunho podem ser excluídas. Reabra como rascunho ou use 'Abandonar/Cancelar' no detalhe."
                                                className="p-1 text-slate-300 dark:text-slate-600 cursor-not-allowed"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </ClickTargetSecondary>
                                </div>
                                {/* Alvo secundário distinto: nome do CLIENTE como link próprio */}
                                <ClickTargetSecondary className="block mb-1">
                                    <button
                                        type="button"
                                        onClick={() => onNavigate?.('customers', inv.socid)}
                                        aria-label={`Abrir cliente ${customerName}`}
                                        className="inline-flex items-center gap-1 font-bold text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                                    >
                                        {customerName}
                                        <ExternalLink size={12} aria-hidden="true" />
                                    </button>
                                </ClickTargetSecondary>
                                {projectName && (
                                    <div className="text-xs text-indigo-500 mb-2 flex items-center gap-1">
                                        <FolderKanban size={10} /> {projectName}
                                    </div>
                                )}
                                <div className="flex justify-between items-end">
                                    <span className="text-xs text-slate-500">{formatDateOnly(inv.date)}</span>
                                    <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(inv.total_ttc)}</span>
                                </div>
                            </ClickTarget>
                        );
                    })}
                </div>
            )}
            <ListTotalBar total={filteredInvoices.reduce((sum, inv) => sum + (inv.total_ttc ?? 0), 0)} />
            <PaginationControls
                page={page}
                limit={limit}
                onPageChange={setPage}
                onLimitChange={setLimit}
                hasNext={filteredInvoices.length >= limit}
                hasPrev={page > 0}
            />
        </>
    );

    const renderDetail = selectedInvoice ? (
        <div className="flex flex-col h-full">
            <PageHeader
                onBack={() => setSelectedInvoice(null)}
                title={
                    <span className="flex items-center gap-2">
                        {selectedInvoice.ref}
                        <StatusBadge status={getInvoiceStatusKey(selectedInvoice)} config={invoiceStatuses} />
                    </span>
                }
                subtitle={
                    <button
                        type="button"
                        onClick={() => onNavigate?.('customers', selectedInvoice.socid)}
                        className="cursor-pointer hover:underline hover:text-indigo-500 text-left inline-flex items-center gap-1"
                    >
                        Cliente: {getCustomerName(selectedInvoice.socid)}
                        <ExternalLink size={12} aria-hidden="true" />
                    </button>
                }
                actions={
                    <div className="flex items-center gap-2">
                        {selectedInvoice.statut === '0' && (
                            <>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    icon={<CheckCircle size={16} />}
                                    onClick={(e) => handleValidate(e, selectedInvoice.id)}
                                    loading={processingId === selectedInvoice.id}
                                    disabled={!!processingId}
                                >
                                    Validar
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={<FileEdit size={16} />}
                                    onClick={(e) => handleEditClick(e, selectedInvoice)}
                                    disabled={!!processingId}
                                >
                                    Editar
                                </Button>
                            </>
                        )}
                        {selectedInvoice.statut === '0' ? (
                            <ConfirmDeleteButton
                                withLabel
                                onDelete={() => DolibarrService.deleteInvoice(config, selectedInvoice.id)}
                                onDeleted={() => { setSelectedInvoice(null); refetchInvoices(); }}
                                itemLabel={selectedInvoice.ref}
                                className="px-2 py-1"
                            />
                        ) : (
                            <Button
                                variant="ghost"
                                size="sm"
                                icon={<Trash2 size={16} />}
                                disabled
                                title="Apenas faturas em rascunho podem ser excluídas. Reabra como rascunho ou use 'Abandonar/Cancelar'."
                                className="!text-slate-300 dark:!text-slate-600 cursor-not-allowed"
                            >
                                Excluir
                            </Button>
                        )}
                        {selectedInvoice.statut === '1' && selectedInvoice.type !== '2' && (
                            <>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    icon={<CreditCard size={16} />}
                                    onClick={(e) => handlePayClick(e, selectedInvoice)}
                                    className="!bg-emerald-600 hover:!bg-emerald-700"
                                >
                                    Pagar
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon={processingId === selectedInvoice.id ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                                    onClick={(e) => handleCreateCreditNote(e, selectedInvoice.id)}
                                    disabled={!!processingId}
                                    className="!text-red-600 !border-red-200"
                                >
                                    Nota Crédito
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<CheckCircle size={16} />}
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        setProcessingId(selectedInvoice.id);
                                        try {
                                            await DolibarrService.markInvoiceAsPaid(config, selectedInvoice.id);
                                            if (refreshData) refreshData();
                                            toast.success("Fatura classificada como paga.");
                                        } catch (err) { log.error("Failed to mark invoice as paid", err); toast.error("Erro ao classificar como paga."); }
                                        finally { setProcessingId(null); }
                                    }}
                                    title="Classificar como Paga"
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<Trash2 size={16} />}
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        setAbandoningInvoiceId(selectedInvoice.id);
                                    }}
                                    className="!text-red-600"
                                    title="Abandonar / Cancelar"
                                />
                            </>
                        )}
                        {(selectedInvoice.statut === '1' || selectedInvoice.statut === '2') && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    setProcessingId(selectedInvoice.id);
                                    try {
                                        await DolibarrService.setInvoiceToDraft(config, selectedInvoice.id);
                                        if (refreshData) refreshData();
                                        toast.success("Fatura retornada para rascunho.");
                                    } catch (err) { log.error("Failed to reopen invoice", err); toast.error("Erro ao reabrir fatura."); }
                                    finally { setProcessingId(null); }
                                }}
                            >
                                Reabrir
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" icon={<Eye size={16} />} onClick={() => setPreviewInvoice({ id: selectedInvoice.id, ref: selectedInvoice.ref })} title="Visualizar PDF" />
                        <Button variant="ghost" size="sm" icon={<Download size={16} />} onClick={(e) => handleDownloadPdf(e, selectedInvoice.id)} title="Baixar PDF" />
                        <Button variant="ghost" size="sm" icon={<ExternalLink size={16} />} onClick={() => openInDolibarr(selectedInvoice.id)} title="Abrir no Dolibarr" />
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50 w-full">
                <div className="max-w-3xl mx-auto space-y-6">
                    {/* Summary Card */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <p className="text-sm text-slate-500 uppercase font-bold mb-1">Valor da Fatura</p>
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
                                    <span className="text-sm text-slate-400 italic">Nenhum vinculado</span>
                                )}
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Pedido de Origem</p>
                                {selectedInvoice.order_id ? (
                                    <div
                                        className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-indigo-300 transition-colors"
                                        onClick={() => onNavigate && onNavigate('orders', selectedInvoice.order_id!)}
                                    >
                                        <ShoppingCart size={16} className="text-orange-500" />
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Ver Pedido de Venda</span>
                                        <ExternalLink size={12} className="ml-auto text-slate-400" />
                                    </div>
                                ) : (
                                    <span className="text-sm text-slate-400 italic">Fatura Direta</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Linked Shipments */}
                    {linkedShipments.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <Truck size={18} className="text-indigo-500" /> Envios Vinculados
                            </h4>
                            <div className="space-y-2">
                                {linkedShipments.map(ship => (
                                    <div
                                        key={ship.id}
                                        className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 cursor-pointer hover:border-indigo-300 transition-colors"
                                        onClick={() => onNavigate && onNavigate('shipments', ship.id)}
                                    >
                                        <div>
                                            <div className="text-sm font-medium text-slate-800 dark:text-white">{ship.ref}</div>
                                            <div className="text-xs text-slate-500">Enviado: {formatDateTime(ship.date_creation)}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {ship.tracking_number && (
                                                <span className="text-xs font-mono bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">
                                                    {ship.tracking_number}
                                                </span>
                                            )}
                                            <ExternalLink size={14} className="text-slate-400" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Invoice Lines */}
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
                                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">{line.qty}</td>
                                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">{formatCurrency(line.subprice)}</td>
                                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">{line.remise_percent ? `${line.remise_percent}%` : '-'}</td>
                                                <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-white font-mono">{formatCurrency(line.total_ttc)}</td>
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
                    <LinkedObjects id={selectedInvoice.id} type="facture" onNavigate={onNavigate} />

                    {/* Linked Payments */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <CreditCard size={18} className="text-emerald-500" /> Pagamentos Vinculados
                        </h4>

                        {(() => {
                            const linkedPayments = paymentLinks
                                .filter(link => String(link.fk_facture) === String(selectedInvoice.id))
                                .map(link => {
                                    const payment = payments.find(p => String(p.id) === String(link.fk_paiement));
                                    return { link, payment };
                                });

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
                                <div className="space-y-3">
                                    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-medium border-b border-slate-200 dark:border-slate-700">
                                                <tr>
                                                    <th className="px-4 py-2">Ref. Pagamento</th>
                                                    <th className="px-4 py-2">Data</th>
                                                    <th className="px-4 py-2 text-right">Valor Pago</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                                                {linkedPayments.map(({ link, payment }) => (
                                                    <tr key={link.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                        <td className="px-4 py-2 font-medium text-indigo-600 dark:text-indigo-400">
                                                            {payment ? (
                                                                <span
                                                                    className="cursor-pointer hover:underline"
                                                                    onClick={() => onNavigate && onNavigate('payments', String(payment.id))}
                                                                >
                                                                    {payment.ref}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400 italic" title="Detalhes do pagamento não encontrados localmente">
                                                                    Pagamento #{link.fk_paiement}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                                                            {payment ? formatDateOnly(payment.date_payment) : '-'}
                                                        </td>
                                                        <td className="px-4 py-2 text-right font-mono text-slate-700 dark:text-slate-300">
                                                            {formatCurrency(link.amount)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="flex justify-end gap-6 pt-2">
                                        <div className="text-right">
                                            <p className="text-xs text-slate-500 uppercase font-bold">Total Pago</p>
                                            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                                                {formatCurrency(totalPaid)}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-slate-500 uppercase font-bold">Saldo Restante</p>
                                            <p className={`text-lg font-bold ${remaining > 0.01 ? 'text-red-500' : 'text-slate-400'}`}>
                                                {formatCurrency(Math.max(0, remaining))}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </div>
    ) : undefined;

    // =================================================================================================
    // MAIN RETURN
    // =================================================================================================
    return (
        <>
            <div className="flex flex-col h-full">
                {renderHeader}
                <MasterDetailLayout
                    list={renderListContent}
                    detail={renderDetail}
                    showDetail={!!selectedInvoice}
                    onCloseDetail={() => setSelectedInvoice(null)}
                />
            </div>

            {/* PDF Preview Modal */}
            <PdfPreviewModal
                entityType="invoice"
                entityId={previewInvoice?.id ?? ''}
                title={previewInvoice?.ref}
                isOpen={!!previewInvoice}
                onClose={() => setPreviewInvoice(null)}
            />

            {/* Create Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Nova Fatura (Rascunho)"
                size="xl"
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente</label>
                            <select
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={newInvoice.socid}
                                onChange={e => setNewInvoice({ ...newInvoice, socid: e.target.value })}
                                required
                            >
                                <option value="">Selecione o Cliente...</option>
                                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
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

                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300">Itens</h4>
                            <Button type="button" variant="ghost" size="sm" icon={<Plus size={12} />} onClick={handleAddItem}>
                                Adicionar Item
                            </Button>
                        </div>

                        <div className="space-y-2">
                            {newInvoice.items.length === 0 && <p className="text-sm text-slate-400 italic text-center py-4">Nenhum item adicionado.</p>}
                            {newInvoice.items.map((item, idx) => (
                                <div key={idx} className="flex gap-2 items-start bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
                                    <div className="flex-1">
                                        <select
                                            className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            value={item.productId}
                                            onChange={e => handleUpdateItem(idx, 'productId', e.target.value)}
                                        >
                                            <option value="">Item Personalizado</option>
                                            {products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                        </select>
                                        <RichTextEditor
                                            value={item.desc}
                                            onChange={val => handleUpdateItem(idx, 'desc', val)}
                                            placeholder="Descrição"
                                            className="w-full"
                                        />
                                    </div>
                                    <div className="w-20">
                                        <input type="number" className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Qtd"
                                            value={item.qty} onChange={e => handleUpdateItem(idx, 'qty', parseInt(e.target.value))} min="1" />
                                    </div>
                                    <div className="w-24">
                                        <input type="number" className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Preço"
                                            value={item.price} onChange={e => handleUpdateItem(idx, 'price', parseFloat(e.target.value))} />
                                    </div>
                                    <div className="w-20">
                                        <input type="number" className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Desc%"
                                            value={item.remise_percent || ''} onChange={e => handleUpdateItem(idx, 'remise_percent', parseFloat(e.target.value))} />
                                    </div>
                                    <button type="button" onClick={() => handleRemoveItem(idx)} className="p-1 text-red-400 hover:text-red-600">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-end mt-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <div className="text-right">
                                <span className="text-xs text-slate-500 uppercase font-bold mr-2">Total (S/ Imposto)</span>
                                <span className="text-xl font-bold text-slate-800 dark:text-white">{formatCurrency(calculateTotal())}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                        <Button type="button" variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button type="submit" variant="primary" loading={isSubmitting} icon={<CheckCircle size={16} />}>Criar Fatura</Button>
                    </div>
                </form>
            </Modal>

            {/* Edit Modal */}
            <Modal
                isOpen={isEditModalOpen && !!editingInvoiceData}
                onClose={() => setIsEditModalOpen(false)}
                title={`Editar Fatura ${editingInvoiceData?.ref || ''}`}
                size="xl"
            >
                {editingInvoiceData && (
                    <form onSubmit={handleSaveEdit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente</label>
                                <select
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white opacity-60 cursor-not-allowed"
                                    value={editingInvoiceData.socid}
                                    disabled
                                >
                                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div>
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

                        <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300">Itens</h4>
                                <Button type="button" variant="ghost" size="sm" icon={<Plus size={12} />} onClick={handleEditAddItem}>
                                    Adicionar Item
                                </Button>
                            </div>

                            <div className="space-y-2">
                                {editingInvoiceData.items.length === 0 && <p className="text-sm text-slate-400 italic text-center py-4">Nenhum item.</p>}
                                {editingInvoiceData.items.map((item, idx) => (
                                    <div key={idx} className="flex gap-2 items-start bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
                                        <div className="flex-1">
                                            <select
                                                className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                value={item.productId}
                                                onChange={e => handleUpdateEditItem(idx, 'productId', e.target.value)}
                                            >
                                                <option value="">Item Personalizado</option>
                                                {products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                            </select>
                                            <RichTextEditor
                                                value={item.desc}
                                                onChange={val => handleUpdateEditItem(idx, 'desc', val)}
                                                placeholder="Descrição"
                                                className="w-full"
                                            />
                                        </div>
                                        <div className="w-20">
                                            <input type="number" className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Qtd"
                                                value={item.qty} onChange={e => handleUpdateEditItem(idx, 'qty', parseInt(e.target.value))} min="1" />
                                        </div>
                                        <div className="w-24">
                                            <input type="number" className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Preço"
                                                value={item.price} onChange={e => handleUpdateEditItem(idx, 'price', parseFloat(e.target.value))} />
                                        </div>
                                        <div className="w-20">
                                            <input type="number" className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Desc%"
                                                value={item.remise_percent || ''} onChange={e => handleUpdateEditItem(idx, 'remise_percent', parseFloat(e.target.value))} />
                                        </div>
                                        <button type="button" onClick={() => handleRemoveEditItem(idx)} className="p-1 text-red-400 hover:text-red-600">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                            <Button type="button" variant="secondary" onClick={() => setIsEditModalOpen(false)}>Cancelar</Button>
                            <Button type="submit" variant="primary" loading={isSubmitting} icon={<CheckCircle size={16} />}>Salvar Alterações</Button>
                        </div>
                    </form>
                )}
            </Modal>

            {/* Pay Modal */}
            {selectedInvoiceForPay && (
                <CustomerPaymentModal
                    invoice={selectedInvoiceForPay}
                    isOpen={isPayModalOpen}
                    onClose={() => {
                        setIsPayModalOpen(false);
                        setSelectedInvoiceForPay(null);
                    }}
                    onConfirm={handleRegisterPayment}
                />
            )}

            <Modal
                isOpen={!!abandoningInvoiceId}
                onClose={() => { setAbandoningInvoiceId(null); setAbandonReason(''); }}
                title="Abandonar / Cancelar Fatura"
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-sm text-slate-600 dark:text-slate-400">Informe o motivo do abandono:</p>
                    <textarea
                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                        rows={3}
                        value={abandonReason}
                        onChange={e => setAbandonReason(e.target.value)}
                        placeholder="Motivo..."
                    />
                    <div className="flex justify-end gap-3">
                        <Button variant="secondary" onClick={() => { setAbandoningInvoiceId(null); setAbandonReason(''); }}>Cancelar</Button>
                        <Button
                            variant="primary"
                            className="!bg-red-600 hover:!bg-red-700"
                            loading={!!processingId}
                            onClick={async () => {
                                if (!abandoningInvoiceId || !config) return;
                                setProcessingId(abandoningInvoiceId);
                                try {
                                    await DolibarrService.abandonInvoice(config, abandoningInvoiceId, abandonReason || 'Sem motivo informado');
                                    if (refreshData) refreshData();
                                    toast.success("Fatura abandonada/cancelada.");
                                } catch (err) {
                                    log.error("Failed to abandon invoice", err);
                                    toast.error("Erro ao abandonar fatura.");
                                } finally {
                                    setProcessingId(null);
                                    setAbandoningInvoiceId(null);
                                    setAbandonReason('');
                                }
                            }}
                        >
                            Abandonar
                        </Button>
                    </div>
                </div>
            </Modal>
        </>
    );
};

export default InvoiceList;
