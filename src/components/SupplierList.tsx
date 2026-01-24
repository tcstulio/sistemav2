import React, { useState, useMemo } from 'react';
import { ThirdParty, DolibarrConfig, SupplierInvoice, Product, SupplierOrder, AppView, Warehouse } from '../types';
import { Truck, Search, Plus, MapPin, Mail, Phone, ExternalLink, Package, ShoppingCart, Receipt, X, ArrowDownCircle, CheckCircle2, Loader2, ArrowLeft, Lock, CheckSquare, Clock, Pencil, Trash2, PlusCircle } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useSuppliers, useProducts, useSupplierInvoices, useSupplierOrders, useWarehouses, useUsers } from '../hooks/dolibarr';
import { useSupplierMutations } from '../hooks/useMutations';
import { LinkedObjects } from './common/LinkedObjects';

import { formatDateOnly, formatDateTime } from '../utils/dateUtils';
import { toast } from 'sonner';

// Design System
import { PageHeader, MasterDetailLayout, Card, Button, Input, Modal, Tabs, Tab, EmptyState } from './ui';

interface SupplierListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
}

export const SupplierList: React.FC<SupplierListProps> = ({ onNavigate, onRefresh }) => {
    const { config } = useDolibarr();
    const { data: suppliersData } = useSuppliers(config);
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

    // Mutations
    const { createSupplier, updateSupplier, deleteSupplier } = useSupplierMutations(config);

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSupplier, setSelectedSupplier] = useState<ThirdParty | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'invoices' | 'products'>('overview');

    // CRUD State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createForm, setCreateForm] = useState<Partial<ThirdParty>>({ name: '', email: '', phone: '', address: '', town: '', zip: '' });
    const [isCreating, setIsCreating] = useState(false);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editForm, setEditForm] = useState<Partial<ThirdParty>>({});
    const [isSaving, setIsSaving] = useState(false);

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

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

    const filteredSuppliers = useMemo(() => {
        return suppliers.filter(s =>
            s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (s.email && s.email.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [suppliers, searchTerm]);

    // Derived data for selected supplier
    const currentSupplierInvoices = useMemo(() => selectedSupplier ? supplierInvoices.filter(i => String(i.socid) === String(selectedSupplier.id)) : [], [selectedSupplier, supplierInvoices]);
    const currentSupplierOrders = useMemo(() => selectedSupplier ? supplierOrders.filter(o => String(o.socid) === String(selectedSupplier.id)) : [], [selectedSupplier, supplierOrders]);

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
            alert("Por favor, selecione armazém e produto");
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

            alert("Itens Recebidos no Estoque com sucesso!");
            setIsReceptionModalOpen(false);
            if (onRefresh) onRefresh();
        } catch (e: any) {
            console.error(e);
            alert(`Falha ao receber itens: ${e.message}`);
        } finally {
            setIsSubmittingReception(false);
        }
    };

    const handleValidateOrder = async () => {
        if (!selectedOrderId) return;
        setIsProcessingOrder(true);
        try {
            await DolibarrService.validateSupplierOrder(config, selectedOrderId);
            alert("Pedido Validado!");
            if (onRefresh) onRefresh();
        } catch (e: any) {
            alert(`Erro: ${e.message}`);
        } finally {
            setIsProcessingOrder(false);
        }
    };

    const handleApproveOrder = async () => {
        if (!selectedOrderId) return;
        setIsProcessingOrder(true);
        try {
            await DolibarrService.approveSupplierOrder(config, selectedOrderId);
            alert("Pedido Aprovado!");
            if (onRefresh) onRefresh();
        } catch (e: any) {
            alert(`Erro: ${e.message}`);
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
            address: selectedSupplier.address,
            zip: selectedSupplier.zip,
            town: selectedSupplier.town,
            phone: selectedSupplier.phone,
            email: selectedSupplier.email,
            code_fournisseur: selectedSupplier.code_fournisseur
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

    const handleDeleteClick = () => {
        setIsDeleteModalOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!selectedSupplier) return;
        setIsDeleting(true);
        try {
            await deleteSupplier.mutateAsync(selectedSupplier.id);
            toast.success("Fornecedor removido com sucesso!");
            setIsDeleteModalOpen(false);
            setSelectedSupplier(null);
        } catch (e: any) {
            toast.error("Erro ao remover: " + e.message);
        } finally {
            setIsDeleting(false);
        }
    };

    const getOrderStatusBadge = (status: string) => {
        // 0=Draft, 1=Validated, 2=Approved, 3=Received/Closed (Approximate mapping)
        switch (status) {
            case '0': return <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600 font-medium"><Clock size={12} /> Rascunho</span>;
            case '1': return <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium"><CheckCircle2 size={12} /> Validado</span>;
            case '2': return <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-700 font-medium"><CheckSquare size={12} /> Aprovado</span>;
            case '3': return <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 font-medium"><ArrowDownCircle size={12} /> Recebido</span>;
            default: return <span className="text-xs bg-slate-100 text-slate-500">Desconhecido</span>;
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
                    <Input label="Nome *" required value={createForm.name || ''} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Email" type="email" value={createForm.email || ''} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} />
                        <Input label="Telefone" value={createForm.phone || ''} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} />
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
                    <Input label="Nome *" required value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Email" type="email" value={editForm.email || ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                        <Input label="Telefone" value={editForm.phone || ''} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
                    </div>
                    <Input label="Endereço" value={editForm.address || ''} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Cidade" value={editForm.town || ''} onChange={e => setEditForm({ ...editForm, town: e.target.value })} />
                        <Input label="CEP" value={editForm.zip || ''} onChange={e => setEditForm({ ...editForm, zip: e.target.value })} />
                    </div>
                    <Input label="Cód. Fornecedor" value={editForm.code_fournisseur || ''} onChange={e => setEditForm({ ...editForm, code_fournisseur: e.target.value })} />
                </div>
            </Modal>

            {/* Delete Modal */}
            <Modal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                title="Remover Fornecedor?"
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)}>Cancelar</Button>
                        <Button variant="danger" loading={isDeleting} onClick={handleDeleteConfirm}>Confirmar Remoção</Button>
                    </>
                }
            >
                <div className="text-center">
                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Trash2 size={24} />
                    </div>
                    <p className="text-slate-500 text-sm">
                        Tem certeza que deseja remover <b>{selectedSupplier?.name}</b>? Esta ação não pode ser desfeita.
                    </p>
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
                        onChange={e => setReceptionForm({ ...receptionForm, qty: parseInt(e.target.value) })}
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
                        <div className="flex items-center gap-2">
                            <Input
                                placeholder="Buscar..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                icon={<Search size={16} />}
                                className="w-48"
                                fullWidth={false}
                            />
                            <Button icon={<PlusCircle size={18} />} onClick={() => setIsCreateModalOpen(true)}>
                                Novo Fornecedor
                            </Button>
                        </div>
                    }
                />
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* List */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${selectedSupplier ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {filteredSuppliers.length === 0 ? (
                        <EmptyState
                            icon={Truck}
                            title="Nenhum fornecedor encontrado"
                            description="Tente ajustar a busca ou adicione um novo fornecedor."
                            action={<Button onClick={() => setIsCreateModalOpen(true)}>Novo Fornecedor</Button>}
                        />
                    ) : (
                        <div className="space-y-3">
                            {filteredSuppliers.map(sup => (
                                <div key={sup.id} onClick={() => setSelectedSupplier(sup)} className={`p-4 border rounded-xl cursor-pointer transition-all ${selectedSupplier?.id === sup.id ? `border-${config.themeColor}-500 bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'}`}>
                                    <h4 className="font-bold text-slate-800 dark:text-white">{sup.name}</h4>
                                    <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">{sup.email}</div>
                                    {sup.phone && <div className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Phone size={12} /> {sup.phone}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detail */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${selectedSupplier ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {selectedSupplier ? (
                        <>
                            <PageHeader
                                title={selectedSupplier.name}
                                subtitle="Detalhes do Fornecedor"
                                onBack={() => setSelectedSupplier(null)}
                                actions={
                                    <div className="flex items-center gap-2">
                                        <Button variant="ghost" size="sm" icon={<Pencil size={18} />} onClick={handleEditClick} title="Editar" />
                                        <Button variant="ghost" size="sm" icon={<Trash2 size={18} />} onClick={handleDeleteClick} title="Remover" className="hover:!text-red-600" />
                                        <Button variant="ghost" size="sm" icon={<X size={18} />} onClick={() => setSelectedSupplier(null)} className="hidden lg:flex" />
                                    </div>
                                }
                                tabs={
                                    <Tabs value={activeTab} onChange={(v) => setActiveTab(v as any)}>
                                        <Tab value="overview">Visão Geral</Tab>
                                        <Tab value="orders">Pedidos de Compra ({currentSupplierOrders.length})</Tab>
                                        <Tab value="invoices">Faturas de Fornecedor ({currentSupplierInvoices.length})</Tab>
                                        <Tab value="products">Produtos Fornecidos ({currentSupplierProducts.length})</Tab>
                                    </Tabs>
                                }
                            />

                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">
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
                                            <div className="mt-6">
                                                <LinkedObjects
                                                    id={selectedSupplier.id}
                                                    type="societe"
                                                    onNavigate={onNavigate}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {activeTab === 'orders' && (
                                        <div className="space-y-3">
                                            {currentSupplierOrders.length === 0 ? (
                                                <EmptyState icon={ShoppingCart} title="Nenhum pedido de compra" description="Não há pedidos de compra para este fornecedor." />
                                            ) : (
                                                currentSupplierOrders.map(order => (
                                                    <div key={order.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">{order.ref}</h4>
                                                            {getOrderStatusBadge(order.statut)}
                                                        </div>
                                                        <div className="flex justify-between items-end">
                                                            <div className="text-xs text-slate-500">{formatDateTime(order.date_creation)}</div>
                                                            <div className="font-bold text-slate-800 dark:text-white">${order.total_ttc.toLocaleString()}</div>
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
                                                            {order.statut === '0' && (
                                                                <button
                                                                    onClick={() => { setSelectedOrderId(order.id); handleValidateOrder(); }}
                                                                    disabled={isProcessingOrder}
                                                                    className="text-xs px-3 py-1.5 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg flex items-center gap-1 font-medium"
                                                                >
                                                                    {isProcessingOrder && selectedOrderId === order.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Validar
                                                                </button>
                                                            )}
                                                            {order.statut === '1' && (
                                                                <button
                                                                    onClick={() => { setSelectedOrderId(order.id); handleApproveOrder(); }}
                                                                    disabled={isProcessingOrder}
                                                                    className="text-xs px-3 py-1.5 bg-orange-100 text-orange-700 hover:bg-orange-200 rounded-lg flex items-center gap-1 font-medium"
                                                                >
                                                                    {isProcessingOrder && selectedOrderId === order.id ? <Loader2 size={12} className="animate-spin" /> : <CheckSquare size={12} />} Aprovar
                                                                </button>
                                                            )}
                                                            {order.statut === '2' && (
                                                                <button
                                                                    onClick={() => openReceptionModal(order.id, order.lines && order.lines.length > 0 ? order.lines[0].fk_product : undefined)}
                                                                    className="text-xs px-3 py-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg flex items-center gap-1 font-medium"
                                                                >
                                                                    <ArrowDownCircle size={12} /> Receber
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'invoices' && (
                                        <div className="space-y-3">
                                            {currentSupplierInvoices.length === 0 ? (
                                                <EmptyState icon={Receipt} title="Nenhuma fatura encontrada" description="Não há faturas de fornecedor registradas." />
                                            ) : (
                                                currentSupplierInvoices.map(inv => (
                                                    <div key={inv.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex justify-between items-center">
                                                        <div>
                                                            <div className="font-bold text-slate-800 dark:text-white text-sm">{inv.ref}</div>
                                                            <div className="text-xs text-slate-500 mt-1">{inv.label || 'Fatura'}</div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-bold text-slate-800 dark:text-white">${inv.total_ttc.toLocaleString()}</div>
                                                            <span className={`text-[10px] px-2 py-0.5 rounded ${inv.paye === '1' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                                                                {inv.paye === '1' ? 'Pago' : 'Aberto'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'products' && (
                                        <div className="grid grid-cols-1 gap-3">
                                            {currentSupplierProducts.length === 0 ? (
                                                <EmptyState icon={Package} title="Nenhum produto associado" description="Não há produtos no histórico de compras." />
                                            ) : (
                                                currentSupplierProducts.map(p => (
                                                    <div key={p.id} className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                                        <div>
                                                            <div className="font-bold text-slate-800 dark:text-white text-sm">{p.label}</div>
                                                            <div className="text-xs text-slate-500">{p.ref}</div>
                                                        </div>
                                                        <div className="text-sm font-mono text-slate-600 dark:text-slate-400">${p.price.toLocaleString()}</div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <EmptyState
                            icon={Truck}
                            title="Selecione um fornecedor"
                            description="Escolha um fornecedor da lista para ver detalhes."
                        />
                    )}
                </div>
            </div>
        </div>
    );
};