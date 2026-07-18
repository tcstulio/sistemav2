import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ThirdParty, DolibarrConfig, SupplierInvoice, Product, SupplierOrder, AppView, Warehouse } from '../types';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { Truck, Search, MapPin, Mail, Phone, Package, ShoppingCart, Receipt, X, ArrowDownCircle, CheckCircle2, Loader2, CheckSquare, Clock, Pencil, Trash2, PlusCircle, FolderKanban } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useSuppliers, useProducts, useSupplierInvoices, useSupplierOrders, useWarehouses, useUsers, useContacts, useCategories, useProjects } from '../hooks/dolibarr';
import { useSupplierMutations } from '../hooks/useMutations';
import { useListControls } from '../hooks/useListControls';
import { LinkedObjects } from './common/LinkedObjects';
import { ThirdPartyContacts } from './common/ThirdPartyContacts';

import { formatDateOnly, formatDateTime } from '../utils/dateUtils';
import { formatCurrency } from '../utils/formatUtils';
import { toast } from 'sonner';
import { logger } from '../utils/logger';
import { notifyError } from '../utils/notifyError';

const log = logger.child('SupplierList');

// Design System
import { PageHeader, MasterDetailLayout, Card, Button, Input, Modal, Tabs, Tab, EmptyState, ConfirmModal, StatusBadge, ListToolbar, ConfirmDeleteButton } from './ui';
import type { StatusConfig } from './ui';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

const supplierOrderStatuses: Record<string, StatusConfig> = {
    '0': { label: 'Rascunho', variant: 'slate', icon: <Clock size={12} /> },
    '1': { label: 'Validado', variant: 'blue', icon: <CheckCircle2 size={12} /> },
    '2': { label: 'Aprovado', variant: 'orange', icon: <CheckSquare size={12} /> },
    '3': { label: 'Recebido', variant: 'emerald', icon: <ArrowDownCircle size={12} /> },
};

interface SupplierListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
}

export const SupplierList: React.FC<SupplierListProps> = ({ onNavigate, onRefresh }) => {
    const { config, canDo } = useDolibarr();
    const { data: suppliersData, refetch: refetchSuppliers } = useSuppliers(config);
    const suppliers = suppliersData || [];
    const { data: productsData } = useProducts(config);
    const products = productsData || [];
    const { data: supplierInvoicesData } = useSupplierInvoices(config);
    const supplierInvoices = supplierInvoicesData || [];
    const { data: supplierOrdersData } = useSupplierOrders(config);
    const supplierOrders = supplierOrdersData || [];
    const { data: warehousesData } = useWarehouses(config);
    const warehouses = warehousesData || [];
    const { data: users = [] } = useUsers(config);
    const { data: categoriesData } = useCategories(config);
    const categories = categoriesData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];

    // Mutations
    const { createSupplier, updateSupplier } = useSupplierMutations(config);

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const { data: contacts = [] } = useContacts(config);

    const [selectedSupplier, setSelectedSupplier] = useState<ThirdParty | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'contacts' | 'orders' | 'invoices' | 'products'>('overview');

    // Category filter state (#555)
    const [selectedCategory, setSelectedCategory] = useState<string>('all');

    // CRUD State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createForm, setCreateForm] = useState<Partial<ThirdParty>>({ name: '', email: '', phone: '', address: '', town: '', zip: '' });
    const [isCreating, setIsCreating] = useState(false);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editForm, setEditForm] = useState<Partial<ThirdParty>>({});
    const [isSaving, setIsSaving] = useState(false);

    // Deeplink HITL do agente (#57): create_supplier / edit_supplier (aplica 1x por token).
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_supplier') {
            appliedPrefillRef.current = prefill;
            setCreateForm(prev => ({ ...prev, ...prefill.data }));
            setIsCreateModalOpen(true);
            toast.info('Revise os dados e confirme o cadastro do fornecedor.');
        } else if (prefill.kind === 'edit_supplier') {
            if (suppliers.length === 0) return; // aguarda carregar
            appliedPrefillRef.current = prefill;
            const { id, ...changes } = prefill.data;
            const current = suppliers.find(s => String(s.id) === String(id));
            if (!current) { toast.error('Fornecedor não encontrado para edição.'); return; }
            setSelectedSupplier(current);
            setEditForm({ ...current, ...changes });
            setIsEditModalOpen(true);
            toast.info('Revise as mudanças sugeridas e salve.');
        }
    }, [prefill, suppliers]);

    // Order Detail State
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [isProcessingOrder, setIsProcessingOrder] = useState(false);

    // Reception Modal State
    const [isReceptionModalOpen, setIsReceptionModalOpen] = useState(false);
    const [receptionForm, setReceptionForm] = useState({
        orderId: '',
        warehouseId: '',
        productId: '',
        qty: 1
    });
    const [isSubmittingReception, setIsSubmittingReception] = useState(false);


    const getUserName = (id?: string) => {
        if (!id) return '-';
        const u = users.find(user => String(user.id) === String(id));
        return u ? (u.firstname ? `${u.firstname} ${u.lastname}` : u.login) : `User ${id}`;
    };

    // Helper to resolve project name (#555)
    const getProjectName = (projId?: string) => {
        if (!projId) return null;
        const p = projects.find(proj => String(proj.id) === String(projId));
        return p ? p.title : null;
    };

    // Pré-filtro por categoria (#555); busca + ordenação ficam no useListControls (#121).
    const baseSuppliers = useMemo(() => {
        if (selectedCategory === 'all') return suppliers;
        return suppliers.filter(s => s.category_ids?.includes(selectedCategory) ?? false);
    }, [suppliers, selectedCategory]);

    // Busca + ordenação padronizadas (#121).
    const controls = useListControls(baseSuppliers, {
        searchText: (s) => `${s.name || ''} ${s.email || ''} ${s.town || ''} ${s.code_fournisseur || ''}`,
        sorts: [
            { key: 'name', label: 'Nome', get: (s) => s.name },
            { key: 'town', label: 'Cidade', get: (s) => s.town },
            { key: 'date', label: 'Atualizado', get: (s) => s.date_modification ?? 0 },
        ],
        initialSortKey: 'name',
    });
    const filteredSuppliers = controls.result;

    // Derived data for selected supplier
    const currentSupplierInvoices = useMemo(() => selectedSupplier ? supplierInvoices.filter(i => String(i.socid) === String(selectedSupplier.id)) : [], [selectedSupplier, supplierInvoices]);
    const currentSupplierOrders = useMemo(() => selectedSupplier ? supplierOrders.filter(o => String(o.socid) === String(selectedSupplier.id)) : [], [selectedSupplier, supplierOrders]);
    const currentSupplierContacts = useMemo(() => selectedSupplier ? contacts.filter(c => String(c.socid) === String(selectedSupplier.id)) : [], [selectedSupplier, contacts]);

    // Selected Order Object
    const selectedOrder = useMemo(() => {
        if (!selectedOrderId) return null;
        return currentSupplierOrders.find(o => o.id === selectedOrderId);
    }, [selectedOrderId, currentSupplierOrders]);

    // Logic to identify products provided by this supplier based on purchase history
    const currentSupplierProducts = useMemo(() => {
        if (!selectedSupplier) return [];

        const suppliedProductIds = new Set<string>();

        currentSupplierOrders.forEach(order => {
            if (order.lines) {
                order.lines.forEach((line: any) => {
                    if (line.fk_product) suppliedProductIds.add(String(line.fk_product));
                });
            }
        });

        return products.filter(p => suppliedProductIds.has(String(p.id)));
    }, [selectedSupplier, currentSupplierOrders, products]);

    const openReceptionModal = (orderId: string, prefillProduct?: string) => {
        setReceptionForm({
            orderId,
            warehouseId: warehouses.length > 0 ? warehouses[0].id : '',
            productId: prefillProduct || (products.length > 0 ? products[0].id : ''),
            qty: 1
        });
        setIsReceptionModalOpen(true);
    };

    const handleReceptionSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!receptionForm.warehouseId || !receptionForm.productId) {
            toast.warning("Por favor, selecione armazém e produto");
            return;
        }
        if (!Number.isFinite(receptionForm.qty)) {
            toast.error("Quantidade inválida. Informe um número válido.");
            return;
        }
        setIsSubmittingReception(true);
        try {
            // Create stock movement (In)
            await DolibarrService.createStockCorrection(config, {
                product_id: receptionForm.productId,
                warehouse_id: receptionForm.warehouseId,
                qty: receptionForm.qty,
                label: `Recebimento do Pedido de Fornecedor ${receptionForm.orderId}`
            });

            toast.success("Itens recebidos no estoque com sucesso!");
            setIsReceptionModalOpen(false);
            if (onRefresh) onRefresh();
        } catch (e: any) {
            notifyError('Receber itens', e);
        } finally {
            setIsSubmittingReception(false);
        }
    };

    const handleValidateOrder = async () => {
        if (!selectedOrderId) return;
        setIsProcessingOrder(true);
        try {
            await DolibarrService.validateSupplierOrder(config, selectedOrderId);
            toast.success("Pedido validado!");
            if (onRefresh) onRefresh();
        } catch (e: any) {
            notifyError('Validar pedido', e);
        } finally {
            setIsProcessingOrder(false);
        }
    };

    const handleApproveOrder = async () => {
        if (!selectedOrderId) return;
        setIsProcessingOrder(true);
        try {
            await DolibarrService.approveSupplierOrder(config, selectedOrderId);
            toast.success("Pedido aprovado!");
            if (onRefresh) onRefresh();
        } catch (e: any) {
            notifyError('Aprovar pedido', e);
        } finally {
            setIsProcessingOrder(false);
        }
    };



    // CRUD Handlers
    const handleCreateSupplier = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!createForm.name) {
            toast.error("Nome é obrigatório");
            return;
        }
        setIsCreating(true);
        try {
            await createSupplier.mutateAsync(createForm);
            toast.success("Fornecedor criado com sucesso!");
            setIsCreateModalOpen(false);
            setCreateForm({ name: '', email: '', phone: '', address: '', town: '', zip: '' });
        } catch (e: any) {
            toast.error("Erro ao criar fornecedor: " + e.message);
        } finally {
            setIsCreating(false);
        }
    };

    const handleEditClick = () => {
        if (!selectedSupplier) return;
        setEditForm({
            name: selectedSupplier.name,
            name_alias: selectedSupplier.name_alias,
            address: selectedSupplier.address,
            zip: selectedSupplier.zip,
            town: selectedSupplier.town,
            phone: selectedSupplier.phone,
            phone_mobile: selectedSupplier.phone_mobile,
            fax: selectedSupplier.fax,
            email: selectedSupplier.email,
            url: selectedSupplier.url,
            idprof1: selectedSupplier.idprof1,
            typent_id: selectedSupplier.typent_id,
            socialnetworks: selectedSupplier.socialnetworks,
            code_fournisseur: selectedSupplier.code_fournisseur,
            array_options: selectedSupplier.array_options,
        });
        setIsEditModalOpen(true);
    };

    const handleUpdateSupplier = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedSupplier || !editForm.name) return;
        setIsSaving(true);
        try {
            await updateSupplier.mutateAsync({ id: selectedSupplier.id, data: editForm });
            // Update local state is handled by hook invalidation, but we can optimistically update selectedSupplier
            setSelectedSupplier({ ...selectedSupplier, ...editForm } as ThirdParty);
            toast.success("Fornecedor atualizado com sucesso!");
            setIsEditModalOpen(false);
        } catch (e: any) {
            toast.error("Erro ao atualizar: " + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Create Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Novo Fornecedor"
                size="md"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button loading={isCreating} onClick={handleCreateSupplier}>Criar</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Pessoa</label>
                        <select
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={createForm.typent_id || ''}
                            onChange={e => setCreateForm({ ...createForm, typent_id: e.target.value || undefined })}
                        >
                            <option value="">Não definido</option>
                            <option value="8">Pessoa Física</option>
                            <option value="5">Empresa (PJ)</option>
                        </select>
                    </div>
                    <Input label="Nome *" required value={createForm.name || ''} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Nome Fantasia / Complemento" value={createForm.name_alias || ''} onChange={e => setCreateForm({ ...createForm, name_alias: e.target.value })} />
                        <Input label="CNPJ / CPF" value={createForm.idprof1 || ''} onChange={e => setCreateForm({ ...createForm, idprof1: e.target.value })} placeholder="00.000.000/0001-00" />
                    </div>
                    {createForm.typent_id !== '8' && (
                        <Input
                            label="Responsável Legal (Assinante de Contrato)"
                            value={createForm.array_options?.options_assinante || ''}
                            onChange={e => setCreateForm({
                                ...createForm,
                                array_options: { ...createForm.array_options, options_assinante: e.target.value }
                            })}
                            placeholder="Nome de quem assina os contratos"
                        />
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Email" type="email" value={createForm.email || ''} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} />
                        <Input label="Telefone" value={createForm.phone || ''} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="WhatsApp / Celular" value={createForm.phone_mobile || ''} onChange={e => setCreateForm({ ...createForm, phone_mobile: e.target.value })} placeholder="+55 11 99999-9999" />
                        <Input label="Outro Telefone / Fax" value={createForm.fax || ''} onChange={e => setCreateForm({ ...createForm, fax: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Site" value={createForm.url || ''} onChange={e => setCreateForm({ ...createForm, url: e.target.value })} placeholder="https://..." />
                        <Input
                            label="LinkedIn / Rede Social"
                            value={createForm.socialnetworks?.linkedin || ''}
                            onChange={e => setCreateForm({
                                ...createForm,
                                socialnetworks: { ...createForm.socialnetworks, linkedin: e.target.value }
                            })}
                            placeholder="URL do perfil"
                        />
                    </div>
                    <Input label="Endereço" value={createForm.address || ''} onChange={e => setCreateForm({ ...createForm, address: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Cidade" value={createForm.town || ''} onChange={e => setCreateForm({ ...createForm, town: e.target.value })} />
                        <Input label="CEP" value={createForm.zip || ''} onChange={e => setCreateForm({ ...createForm, zip: e.target.value })} />
                    </div>
                </div>
            </Modal>

            {/* Edit Modal */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title="Editar Fornecedor"
                size="md"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>Cancelar</Button>
                        <Button loading={isSaving} onClick={handleUpdateSupplier}>Salvar</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Pessoa</label>
                        <select
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={editForm.typent_id || ''}
                            onChange={e => setEditForm({ ...editForm, typent_id: e.target.value || undefined })}
                        >
                            <option value="">Não definido</option>
                            <option value="8">Pessoa Física</option>
                            <option value="5">Empresa (PJ)</option>
                        </select>
                    </div>
                    <Input label="Nome *" required value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Nome Fantasia / Complemento" value={editForm.name_alias || ''} onChange={e => setEditForm({ ...editForm, name_alias: e.target.value })} />
                        <Input label="CNPJ / CPF" value={editForm.idprof1 || ''} onChange={e => setEditForm({ ...editForm, idprof1: e.target.value })} placeholder="00.000.000/0001-00" />
                    </div>
                    {editForm.typent_id !== '8' && (
                        <Input
                            label="Responsável Legal (Assinante de Contrato)"
                            value={editForm.array_options?.options_assinante || ''}
                            onChange={e => setEditForm({
                                ...editForm,
                                array_options: { ...editForm.array_options, options_assinante: e.target.value }
                            })}
                            placeholder="Nome de quem assina os contratos"
                        />
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Email" type="email" value={editForm.email || ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                        <Input label="Telefone" value={editForm.phone || ''} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="WhatsApp / Celular" value={editForm.phone_mobile || ''} onChange={e => setEditForm({ ...editForm, phone_mobile: e.target.value })} placeholder="+55 11 99999-9999" />
                        <Input label="Outro Telefone / Fax" value={editForm.fax || ''} onChange={e => setEditForm({ ...editForm, fax: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Site" value={editForm.url || ''} onChange={e => setEditForm({ ...editForm, url: e.target.value })} placeholder="https://..." />
                        <Input
                            label="LinkedIn / Rede Social"
                            value={editForm.socialnetworks?.linkedin || ''}
                            onChange={e => setEditForm({
                                ...editForm,
                                socialnetworks: { ...editForm.socialnetworks, linkedin: e.target.value }
                            })}
                            placeholder="URL do perfil"
                        />
                    </div>
                    <Input label="Endereço" value={editForm.address || ''} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Cidade" value={editForm.town || ''} onChange={e => setEditForm({ ...editForm, town: e.target.value })} />
                        <Input label="CEP" value={editForm.zip || ''} onChange={e => setEditForm({ ...editForm, zip: e.target.value })} />
                    </div>
                    <Input label="Cód. Fornecedor" value={editForm.code_fournisseur || ''} onChange={e => setEditForm({ ...editForm, code_fournisseur: e.target.value })} />
                </div>
            </Modal>

            {/* Reception Modal */}
            <Modal
                isOpen={isReceptionModalOpen}
                onClose={() => setIsReceptionModalOpen(false)}
                title={
                    <span className="flex items-center gap-2">
                        <ArrowDownCircle size={18} className="text-emerald-600" /> Receber Itens
                    </span>
                }
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsReceptionModalOpen(false)}>Cancelar</Button>
                        <Button
                            className="!bg-emerald-600 hover:!bg-emerald-700"
                            loading={isSubmittingReception}
                            icon={<CheckCircle2 size={16} />}
                            onClick={handleReceptionSubmit}
                        >
                            Confirmar Recibo
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-slate-500 mb-4">Receber itens do Pedido para o estoque.</p>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Armazém de Destino</label>
                        <select
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={receptionForm.warehouseId}
                            onChange={e => setReceptionForm({ ...receptionForm, warehouseId: e.target.value })}
                            required
                        >
                            <option value="">Selecione o Armazém...</option>
                            {warehouses.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Produto Recebido</label>
                        <select
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={receptionForm.productId}
                            onChange={e => setReceptionForm({ ...receptionForm, productId: e.target.value })}
                            required
                        >
                            <option value="">Selecione o Produto...</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.label} ({p.ref})</option>)}
                        </select>
                    </div>
                    <Input
                        label="Quantidade"
                        type="number"
                        value={receptionForm.qty}
                        onChange={e => setReceptionForm({
                            ...receptionForm,
                            qty: e.target.value === '' ? 0 : parseInt(e.target.value) || 0
                        })}
                        required
                    />
                </div>
            </Modal>

            {/* Header */}
            <div className={selectedSupplier ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title="Fornecedores"
                    subtitle="Gerencie vendedores e pedidos de compra"
                    actions={
                        <div className="flex items-center gap-2 flex-wrap">
                            <ListToolbar controls={controls} searchPlaceholder="Buscar fornecedor..." />
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg text-sm"
                                aria-label="Filtrar por categoria"
                            >
                                <option value="all">Todas Categorias</option>
                                {categories
                                    .filter(c => c.type === 'supplier' || c.type === '1')
                                    .map(c => (
                                        <option key={c.id} value={c.id}>{c.label}</option>
                                    ))}
                            </select>
                            {canDo('create', 'suppliers') && (
                            <Button icon={<PlusCircle size={18} />} onClick={() => setIsCreateModalOpen(true)}>
                                Novo Fornecedor
                            </Button>
                            )}
                        </div>
                    }
                />
            </div>

            {/* Master-Detail Layout */}
            <MasterDetailLayout
                showDetail={!!selectedSupplier}
                onCloseDetail={() => setSelectedSupplier(null)}
                listWidth="1/3"
                list={
                    <div className="p-4 md:p-6 h-full">
                        {filteredSuppliers.length === 0 ? (
                            <EmptyState
                                icon={Truck}
                                title="Nenhum fornecedor encontrado"
                                description="Tente ajustar a busca ou adicione um novo fornecedor."
                                action={canDo('create', 'suppliers') ? <Button onClick={() => setIsCreateModalOpen(true)}>Novo Fornecedor</Button> : undefined}
                            />
                        ) : (
                            <div className="h-full">
                                <AutoSizer>
                                    {({ height, width }: { height: number; width: number }) => (
                                        <ListWindow
                                            height={height}
                                            width={width}
                                            itemCount={filteredSuppliers.length}
                                            itemSize={90}
                                        >
                                            {({ index, style }: { index: number; style: React.CSSProperties }) => {
                                                const sup = filteredSuppliers[index];
                                                return (
                                                    <div style={{ ...style, paddingBottom: 8 }}>
                                                        <Card
                                                            onClick={() => setSelectedSupplier(sup)}
                                                            selected={selectedSupplier?.id === sup.id}
                                                            hoverable
                                                            padding="md"
                                                            className="mb-2"
                                                        >
                                                            <div className="flex items-start justify-between gap-2">
                                                                <h4 className="font-bold text-slate-800 dark:text-white truncate text-sm flex-1">{sup.name}</h4>
                                                                {canDo('delete', 'suppliers') && (
                                                                <ConfirmDeleteButton
                                                                    onDelete={() => DolibarrService.deleteThirdParty(config, sup.id)}
                                                                    onDeleted={() => { if (selectedSupplier?.id === sup.id) setSelectedSupplier(null); refetchSuppliers(); }}
                                                                    itemLabel={sup.name}
                                                                />
                                                                )}
                                                            </div>
                                                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{sup.email}</div>
                                                            {sup.phone && <div className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Phone size={12} /> {sup.phone}</div>}
                                                        </Card>
                                                    </div>
                                                );
                                            }}
                                        </ListWindow>
                                    )}
                                </AutoSizer>
                            </div>
                        )}
                    </div>
                }
                detail={
                    selectedSupplier && (
                        <div className="flex flex-col h-full">
                            <PageHeader
                                title={selectedSupplier.name}
                                subtitle="Detalhes do Fornecedor"
                                onBack={() => setSelectedSupplier(null)}
                                actions={
                                    <div className="flex items-center gap-2">
                                        {canDo('edit', 'suppliers') && (
                                        <Button variant="ghost" size="sm" icon={<Pencil size={18} />} onClick={handleEditClick} title="Editar" />
                                        )}
                                        {canDo('delete', 'suppliers') && (
                                        <ConfirmDeleteButton
                                            onDelete={() => DolibarrService.deleteThirdParty(config, selectedSupplier.id)}
                                            onDeleted={() => { setSelectedSupplier(null); refetchSuppliers(); }}
                                            itemLabel={selectedSupplier.name}
                                            iconSize={18}
                                        />
                                        )}
                                        <Button variant="ghost" size="sm" icon={<X size={18} />} onClick={() => setSelectedSupplier(null)} className="hidden lg:flex" />
                                    </div>
                                }
                                tabs={
                                    <Tabs value={activeTab} onChange={(v) => setActiveTab(v as any)}>
                                        <Tab value="overview">Visão Geral</Tab>
                                        <Tab value="contacts" badge={currentSupplierContacts.length}>Responsáveis</Tab>
                                        <Tab value="orders">Pedidos ({currentSupplierOrders.length})</Tab>
                                        <Tab value="invoices">Faturas ({currentSupplierInvoices.length})</Tab>
                                        <Tab value="products">Produtos ({currentSupplierProducts.length})</Tab>
                                    </Tabs>
                                }
                            />

                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">
                                    {activeTab === 'contacts' && (
                                        <ThirdPartyContacts socid={selectedSupplier.id} config={config} />
                                    )}

                                    {activeTab === 'overview' && (
                                        <>
                                            <Card header="Contatos">
                                                <div className="space-y-3">
                                                    <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                                                        <MapPin size={16} className="text-slate-400" />
                                                        {selectedSupplier.address || 'Sem endereço'}, {selectedSupplier.zip} {selectedSupplier.town}
                                                    </div>
                                                    <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                                                        <Mail size={16} className="text-slate-400" />
                                                        {selectedSupplier.email || 'Sem email'}
                                                    </div>
                                                    <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                                                        <Phone size={16} className="text-slate-400" />
                                                        {selectedSupplier.phone || 'Sem telefone'}
                                                    </div>
                                                </div>
                                            </Card>
                                            <LinkedObjects
                                                id={selectedSupplier.id}
                                                type="societe"
                                                onNavigate={onNavigate}
                                            />
                                        </>
                                    )}

                                    {activeTab === 'orders' && (
                                        <div className="space-y-3">
                                            {currentSupplierOrders.length === 0 ? (
                                                <EmptyState icon={ShoppingCart} title="Nenhum pedido de compra" description="Não há pedidos de compra para este fornecedor." />
                                            ) : (
                                                currentSupplierOrders.map(order => (
                                                    <Card key={order.id} padding="md">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">{order.ref}</h4>
                                                            <StatusBadge status={order.statut} config={supplierOrderStatuses} />
                                                        </div>
                                                        <div className="flex justify-between items-end">
                                                            <div className="text-xs text-slate-500">{formatDateTime(order.date_creation)}</div>
                                                            <div className="font-bold text-slate-800 dark:text-white">{formatCurrency(order.total_ttc)}</div>
                                                        </div>

                                                        <div className="text-xs text-slate-500 mt-2 space-y-0.5 border-t border-slate-100 dark:border-slate-800 pt-2">
                                                            <div className="flex justify-between">
                                                                <span>Criado por:</span>
                                                                <span className="font-medium">{getUserName(order.fk_user_author)}</span>
                                                            </div>
                                                            {order.fk_user_approve && (
                                                                <div className="flex justify-between">
                                                                    <span>Aprovado por:</span>
                                                                    <span className="font-medium">{getUserName(order.fk_user_approve)}</span>
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-2">
                                                            {order.statut === '0' && canDo('validate', 'suppliers') && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => { setSelectedOrderId(order.id); handleValidateOrder(); }}
                                                                    disabled={isProcessingOrder}
                                                                    loading={isProcessingOrder && selectedOrderId === order.id}
                                                                    icon={<CheckCircle2 size={12} />}
                                                                    className="!text-blue-700 hover:!bg-blue-100"
                                                                >
                                                                    Validar
                                                                </Button>
                                                            )}
                                                            {order.statut === '1' && canDo('approve', 'supplier_orders') && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => { setSelectedOrderId(order.id); handleApproveOrder(); }}
                                                                    disabled={isProcessingOrder}
                                                                    loading={isProcessingOrder && selectedOrderId === order.id}
                                                                    icon={<CheckSquare size={12} />}
                                                                    className="!text-orange-700 hover:!bg-orange-100"
                                                                >
                                                                    Aprovar
                                                                </Button>
                                                            )}
                                                            {order.statut === '2' && canDo('receive', 'supplier_orders') && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => openReceptionModal(order.id, order.lines && order.lines.length > 0 ? order.lines[0].fk_product : undefined)}
                                                                    icon={<ArrowDownCircle size={12} />}
                                                                    className="!text-emerald-700 hover:!bg-emerald-100"
                                                                >
                                                                    Receber
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </Card>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'invoices' && (
                                        <div className="space-y-3">
                                            {currentSupplierInvoices.length === 0 ? (
                                                <EmptyState icon={Receipt} title="Nenhuma fatura encontrada" description="Não há faturas de fornecedor registradas." />
                                            ) : (
                                                currentSupplierInvoices.map(inv => {
                                                    const projectName = getProjectName(inv.project_id);
                                                    return (
                                                        <Card key={inv.id} padding="md">
                                                            <div className="flex justify-between items-center">
                                                                <div>
                                                                    <div className="font-bold text-slate-800 dark:text-white text-sm">{inv.ref}</div>
                                                                    <div className="text-xs text-slate-500 mt-1">{inv.label || 'Fatura'}</div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <div className="font-bold text-slate-800 dark:text-white">{formatCurrency(inv.total_ttc)}</div>
                                                                    <StatusBadge
                                                                        status={inv.paye === '1' ? 'paid' : 'open'}
                                                                        config={{
                                                                            paid: { label: 'Pago', variant: 'emerald' },
                                                                            open: { label: 'Aberto', variant: 'orange' },
                                                                        }}
                                                                        size="sm"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="text-xs mt-2 flex items-center gap-1 text-indigo-500">
                                                                <FolderKanban size={12} />
                                                                {projectName ?? <span className="text-slate-400">Sem projeto</span>}
                                                            </div>
                                                        </Card>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'products' && (
                                        <div className="space-y-3">
                                            {currentSupplierProducts.length === 0 ? (
                                                <EmptyState icon={Package} title="Nenhum produto associado" description="Não há produtos no histórico de compras." />
                                            ) : (
                                                currentSupplierProducts.map(p => (
                                                    <Card key={p.id} padding="md">
                                                        <div className="flex justify-between items-center">
                                                            <div>
                                                                <div className="font-bold text-slate-800 dark:text-white text-sm">{p.label}</div>
                                                                <div className="text-xs text-slate-500">{p.ref}</div>
                                                            </div>
                                                            <div className="text-sm font-mono text-slate-600 dark:text-slate-400">{formatCurrency(p.price)}</div>
                                                        </div>
                                                    </Card>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                }
            />
        </div>
    );
};