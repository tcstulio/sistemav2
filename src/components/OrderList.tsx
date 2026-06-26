import React, { useState, useMemo, useEffect, useRef } from 'react';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { toast } from 'sonner';
import { Order, AppView } from '../types';
import { ShoppingCart, ExternalLink, Package, CheckCircle, Truck, Clock, FilePlus, Download, Receipt, Lock, CheckSquare, Trash2, Plus, Pencil, Eye } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useOrders, useCustomers, useShipments, useInvoices, useUsers, useProjects } from '../hooks/dolibarr';
import { useListControls } from '../hooks/useListControls';
import { LinkedObjects } from './common/LinkedObjects';
import { PdfPreviewModal } from './common/PdfPreviewModal';
import { formatDateOnly, formatDateTime } from '../utils/dateUtils';
import { formatCurrency } from '../utils/formatUtils';
import { logger } from '../utils/logger';

const log = logger.child('OrderList');

// Design System
import { PageHeader, Card, Button, Input, Modal, Tabs, Tab, EmptyState, MasterDetailLayout, StatusBadge, ListToolbar, ConfirmDeleteButton } from './ui';
import type { StatusConfig } from './ui/StatusBadge';

interface OrderListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
    onRefresh?: () => void;
}

// Status Config
const orderStatuses: Record<string, StatusConfig> = {
    '0': { label: 'Rascunho', variant: 'slate', icon: <Clock size={12} /> },
    '1': { label: 'Validado', variant: 'blue', icon: <CheckCircle size={12} /> },
    '2': { label: 'Em Envio', variant: 'orange', icon: <Truck size={12} /> },
    '3': { label: 'Entregue', variant: 'emerald', icon: <Package size={12} /> },
};

const getShipmentStatus = (status: string) => {
    // 0=Draft, 1=Validated, 2=Closed
    switch (status) {
        case '0': return 'Rascunho';
        case '1': return 'Validado';
        case '2': return 'Entregue';
        default: return 'Desconhecido';
    }
};

// ============================================
// Sub-components
// ============================================

const OrderDetail: React.FC<{
    order: Order;
    onClose: () => void;
    onNavigate?: (view: AppView, id: string) => void;
    customers: any[];
    users: any[];
    projects: any[];
    shipments: any[];
    invoices: any[];
    processingId: string | null;
    onValidate: (id: string) => void;
    onEdit: () => void;
    onCreateShipment: () => void;
    onClassifyDelivered: () => void;
    onDownloadPdf: (id: string | number) => void;
    onPreviewPdf: (id: string | number, ref: string) => void;
    onOpenDolibarr: (id: string) => void;
    onDeleteShipment: (id: string) => Promise<any>;
    onShipmentDeleted: () => void;
    onCreateInvoice: (id: string) => void;
    onDeleteOrder: () => Promise<any>;
    onOrderDeleted: () => void;
}> = ({
    order,
    onClose,
    onNavigate,
    customers,
    users,
    projects,
    shipments,
    invoices,
    processingId,
    onValidate,
    onEdit,
    onCreateShipment,
    onClassifyDelivered,
    onDownloadPdf,
    onPreviewPdf,
    onOpenDolibarr,
    onDeleteShipment,
    onShipmentDeleted,
    onCreateInvoice,
    onDeleteOrder,
    onOrderDeleted
}) => {
        const [activeTab, setActiveTab] = useState<'overview' | 'shipments' | 'invoices'>('overview');
        const { canDo } = useDolibarr();

        const getCustomerName = (socid: string) => {
            const customer = customers.find(c => c.id === socid);
            return customer ? customer.name : 'Cliente Desconhecido';
        };

        const getUserName = (id?: string) => {
            if (!id) return '-';
            const u = users.find(user => String(user.id) === String(id));
            return u ? (u.firstname ? `${u.firstname} ${u.lastname}` : u.login) : `User ${id}`;
        };

        const getProjectInfo = (projectId?: string) => {
            if (!projectId) return null;
            const p = projects.find((proj: any) => String(proj.id) === String(projectId));
            return p ? { id: projectId, ref: p.ref, title: p.title || p.ref } : { id: projectId, ref: projectId, title: projectId };
        };

        const currentOrderShipments = useMemo(() => {
            return shipments.filter(s => String(s.fk_commande) === String(order.id) || String(s.socid) === String(order.socid));
        }, [order, shipments]);

        const currentOrderInvoices = useMemo(() => {
            return invoices.filter(i => String(i.order_id) === String(order.id));
        }, [order, invoices]);

        return (
            <>
                <PageHeader
                    title={
                        <span className="flex items-center gap-2">
                            {order.ref}
                            <StatusBadge status={order.statut} config={orderStatuses} />
                        </span>
                    }
                    subtitle={
                        <span className="flex items-center gap-3 flex-wrap">
                            <span
                                className="cursor-pointer hover:underline hover:text-indigo-500"
                                onClick={() => onNavigate && onNavigate('customers', order.socid)}
                            >
                                Cliente: {getCustomerName(order.socid)}
                            </span>
                            {getProjectInfo(order.project_id) && (
                                <span
                                    className="cursor-pointer hover:underline hover:text-indigo-500"
                                    onClick={() => onNavigate && getProjectInfo(order.project_id) && onNavigate('projects', getProjectInfo(order.project_id)!.id)}
                                >
                                    Projeto: {getProjectInfo(order.project_id)!.title}
                                </span>
                            )}
                        </span>
                    }
                    onBack={onClose}
                    actions={
                        <div className="flex items-center gap-2">
                            {order.statut === '0' && canDo('edit', 'orders') && (
                                <Button
                                    onClick={onEdit}
                                    icon={<Pencil size={18} />}
                                    className="text-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700"
                                >
                                    Editar
                                </Button>
                            )}
                            {order.statut === '0' && canDo('validate', 'orders') && (
                                <Button
                                    onClick={() => onValidate(order.id)}
                                    disabled={!!processingId}
                                    loading={processingId === order.id}
                                    icon={<Lock size={18} />}
                                    className="hidden xl:flex text-blue-600 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                                >
                                    Validar
                                </Button>
                            )}
                            {order.statut === '0' && canDo('delete', 'orders') && (
                                <ConfirmDeleteButton
                                    withLabel
                                    onDelete={onDeleteOrder}
                                    onDeleted={onOrderDeleted}
                                    itemLabel={order.ref}
                                    className="px-2 py-1"
                                />
                            )}
                            {(order.statut === '1' || order.statut === '2') && (
                                <Button
                                    onClick={onCreateShipment}
                                    className="text-orange-600 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40 hidden xl:flex"
                                    icon={<Package size={18} />}
                                >
                                    Criar Envio
                                </Button>
                            )}
                            {order.statut === '2' && (
                                <Button
                                    onClick={onClassifyDelivered}
                                    disabled={!!processingId}
                                    className="text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 hidden xl:flex"
                                    icon={<CheckSquare size={18} />}
                                >
                                    Entregue
                                </Button>
                            )}
                            <Button variant="ghost" size="sm" icon={<Eye size={20} />} onClick={() => onPreviewPdf(order.id, order.ref)} title="Visualizar PDF" />
                            <Button variant="ghost" size="sm" icon={<Download size={20} />} onClick={() => onDownloadPdf(order.id)} title="Baixar PDF" />
                            <Button variant="ghost" size="sm" icon={<ExternalLink size={20} />} onClick={() => onOpenDolibarr(order.id)} />
                        </div>
                    }
                    tabs={
                        <Tabs value={activeTab} onChange={(v) => setActiveTab(v as any)}>
                            <Tab value="overview">Visão Geral</Tab>
                            <Tab value="shipments">Envios ({currentOrderShipments.length})</Tab>
                            <Tab value="invoices">Faturas ({currentOrderInvoices.length})</Tab>
                        </Tabs>
                    }
                />

                <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50">
                    <div className="max-w-3xl mx-auto space-y-6">

                        {activeTab === 'overview' && (
                            <>
                                <Card>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                                        <div>
                                            <p className="text-sm text-slate-500 uppercase font-bold mb-1">Valor Total</p>
                                            <p className="text-3xl font-bold text-slate-900 dark:text-white">{formatCurrency(order.total_ttc)}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-slate-500 uppercase font-bold mb-1">Data</p>
                                            <p className="text-lg font-medium text-slate-800 dark:text-white">{formatDateOnly(order.date)}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-slate-500 uppercase font-bold mb-1">Responsáveis</p>
                                            <div className="space-y-1">
                                                <div className="text-sm flex justify-between">
                                                    <span className="text-slate-500">Criado:</span> <span className="font-medium text-slate-800 dark:text-white">{getUserName(order.fk_user_author)}</span>
                                                </div>
                                                {order.fk_user_valid && (
                                                    <div className="text-sm flex justify-between">
                                                        <span className="text-slate-500">Validado:</span> <span className="font-medium text-slate-800 dark:text-white">{getUserName(order.fk_user_valid)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Itens do Pedido</h4>
                                        <div className="space-y-2">
                                            {order.lines && order.lines.length > 0 ? (
                                                order.lines.map((line: any) => (
                                                    <div key={line.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                                                        <div>
                                                            <div className="font-medium text-slate-800 dark:text-white text-sm">{line.desc || line.label}</div>
                                                            <div className="text-xs text-slate-500">Qtd: {line.qty}</div>
                                                        </div>
                                                        <div className="text-right font-medium text-slate-800 dark:text-white">{formatCurrency(line.price)}</div>
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-slate-400 italic text-center py-4">Nenhum item disponível nesta visualização.</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                                        <LinkedObjects
                                            id={order.id}
                                            type="commande"
                                            onNavigate={onNavigate}
                                        />
                                    </div>
                                </Card>
                            </>
                        )}

                        {activeTab === 'shipments' && (
                            <div className="space-y-3">
                                {currentOrderShipments.length === 0 ? (
                                    <EmptyState
                                        icon={Truck}
                                        title="Nenhum envio registrado"
                                        description="Não há envios para este pedido."
                                        action={order.statut === '1' ? <Button onClick={onCreateShipment}>Criar Primeiro Envio</Button> : undefined}
                                    />
                                ) : (
                                    currentOrderShipments.map(ship => (
                                        <div
                                            key={ship.id}
                                            className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex justify-between items-center hover:shadow-md cursor-pointer transition-all"
                                            onClick={() => onNavigate && onNavigate('shipments', ship.id)}
                                        >
                                            <div>
                                                <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                    {ship.ref}
                                                    <span className="text-xs font-normal text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">{getShipmentStatus(ship.status)}</span>
                                                </div>
                                                <div className="text-xs text-slate-500 mt-1">{formatDateTime(ship.date_creation)}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {ship.tracking_number && <span className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-600 dark:text-slate-400">{ship.tracking_number}</span>}
                                                <ConfirmDeleteButton
                                                    onDelete={() => onDeleteShipment(ship.id)}
                                                    onDeleted={onShipmentDeleted}
                                                    itemLabel={ship.ref}
                                                />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {activeTab === 'invoices' && (
                            <div className="space-y-3">
                                {currentOrderInvoices.length === 0 ? (
                                    <EmptyState
                                        icon={Receipt}
                                        title="Nenhuma fatura gerada"
                                        description="Não há faturas para este pedido."
                                        action={order.statut !== '0' ? <Button onClick={() => onCreateInvoice(order.id)}>Gerar Fatura</Button> : undefined}
                                    />
                                ) : (
                                    currentOrderInvoices.map(inv => (
                                        <div
                                            key={inv.id}
                                            className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex justify-between items-center hover:shadow-md cursor-pointer transition-all"
                                            onClick={() => onNavigate && onNavigate('invoices', inv.id)}
                                        >
                                            <div>
                                                <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                    {inv.ref}
                                                    {inv.statut === '2' ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Pago</span> : <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">Não Pago</span>}
                                                </div>
                                                <div className="text-xs text-slate-500 mt-1">{formatDateOnly(inv.date)}</div>
                                            </div>
                                            <div className="text-right font-bold text-slate-800 dark:text-white">{formatCurrency(inv.total_ttc)}</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                    </div>
                </div>
            </>
        );
    };


// ============================================
// Main Component
// ============================================

const OrderList: React.FC<OrderListProps> = ({ onNavigate, initialItemId, onRefresh }) => {
    const { config, canDo } = useDolibarr();
    const { data: ordersData, refetch: refetchOrders } = useOrders(config);
    const orders = ordersData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: shipmentsData } = useShipments(config);
    const shipments = shipmentsData || [];
    const { data: invoicesData } = useInvoices(config);
    const invoices = invoicesData || [];
    const { data: users = [] } = useUsers(config);
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];

    // Fallback if config is null
    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [filterStatus, setFilterStatus] = useState<'all' | 'validated' | 'processing' | 'delivered'>('all');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [previewOrder, setPreviewOrder] = useState<{ id: string | number; ref: string } | null>(null);

    // Shipment Creation State
    const [isShipmentModalOpen, setIsShipmentModalOpen] = useState(false);
    const [shipmentLines, setShipmentLines] = useState<{ id: string, qty: number, label: string }[]>([]);
    const [isSubmittingShipment, setIsSubmittingShipment] = useState(false);

    // Order Creation/Edit State (#57/#78/#552).
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
    const [editOrderId, setEditOrderId] = useState<string | undefined>(undefined);
    const isEditingOrder = !!editOrderId;
    // existingLines: linhas já salvas no Dolibarr (edição); rastreamos por id para diff no submit.
    const [existingLines, setExistingLines] = useState<{ id: string, desc: string, qty: number, price: number }[]>([]);
    const [newOrder, setNewOrder] = useState({
        socid: '',
        date: new Date().toISOString().split('T')[0],
        items: [] as { id?: string, uid: string, productId: string, desc: string, qty: number, price: number }[],
    });

    const closeOrderModal = () => { setIsCreateModalOpen(false); setEditOrderId(undefined); setExistingLines([]); };

    const handleAddOrderItem = () => setNewOrder(prev => ({ ...prev, items: [...prev.items, { uid: crypto.randomUUID(), productId: '', desc: '', qty: 1, price: 0 }] }));
    const handleUpdateOrderItem = (idx: number, field: 'desc' | 'qty' | 'price', value: string | number) => {
        const items = [...newOrder.items];
        (items[idx] as any)[field] = value;
        setNewOrder({ ...newOrder, items });
    };
    const handleRemoveOrderItem = (idx: number) => setNewOrder({ ...newOrder, items: newOrder.items.filter((_, i) => i !== idx) });
    const calculateOrderTotal = () => newOrder.items.reduce((acc, it) => acc + (it.price * it.qty), 0);

    // Retorna true se linha mudou em relação ao snapshot original (para edição).
    const lineChanged = (item: { id?: string, desc: string, qty: number, price: number }) => {
        if (!item.id) return false;
        const orig = existingLines.find(l => l.id === item.id);
        if (!orig) return false;
        return orig.desc !== item.desc || orig.qty !== item.qty || orig.price !== item.price;
    };

    const handleCreateOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isEditingOrder && !newOrder.socid) return toast.error('Selecione um cliente');
        const invalidItem = newOrder.items.find(it => it.qty <= 0);
        if (invalidItem) return toast.error('Quantidade deve ser maior que zero');
        setIsSubmittingOrder(true);
        try {
            if (isEditingOrder) {
                // Atualiza cabeçalho (data)
                await DolibarrService.updateObject(config, 'orders', editOrderId!, {
                    date: Math.floor(new Date(newOrder.date).getTime() / 1000),
                });

                // Linhas removidas: presentes no snapshot original mas ausentes em items
                const removedLineIds = existingLines
                    .filter(l => !newOrder.items.some(it => it.id === l.id))
                    .map(l => l.id);
                for (const lineId of removedLineIds) {
                    await DolibarrService.deleteOrderLine(config, editOrderId!, lineId);
                }

                // Linhas alteradas: presentes em items com id e com diff
                for (const item of newOrder.items) {
                    if (item.id && lineChanged(item)) {
                        await DolibarrService.updateOrderLine(config, editOrderId!, item.id, {
                            desc: item.desc,
                            qty: item.qty,
                            subprice: item.price,
                            product_type: 0,
                        });
                    }
                }

                // Novas linhas: sem id
                for (const item of newOrder.items) {
                    if (!item.id) {
                        await DolibarrService.addOrderLine(config, editOrderId!, {
                            fk_product: item.productId || undefined,
                            desc: item.desc,
                            qty: item.qty,
                            subprice: item.price,
                            product_type: 0,
                        });
                    }
                }

                toast.success('Pedido atualizado com sucesso');
                if (selectedOrder && String(selectedOrder.id) === String(editOrderId)) {
                    setSelectedOrder({ ...selectedOrder, date: Math.floor(new Date(newOrder.date).getTime() / 1000) });
                }
            } else {
                await DolibarrService.createOrder(config, {
                    socid: newOrder.socid,
                    date: new Date(newOrder.date).getTime() / 1000,
                    lines: newOrder.items.map(it => ({
                        fk_product: it.productId || undefined,
                        desc: it.desc,
                        qty: it.qty,
                        subprice: it.price,
                        product_type: 0,
                    })),
                });
                toast.success('Pedido criado com sucesso');
            }
            closeOrderModal();
            setNewOrder({ socid: '', date: new Date().toISOString().split('T')[0], items: [] });
            if (onRefresh) onRefresh();
        } catch (err) { log.error('Failed to save order', err); toast.error(isEditingOrder ? 'Erro ao atualizar pedido' : 'Erro ao criar pedido'); } finally { setIsSubmittingOrder(false); }
    };

    // Abre o modal em modo edição — inclui linhas existentes para edição (#552).
    const openOrderEditor = (ord: Order, dateOverride?: string) => {
        const dateStr = dateOverride
            || (ord.date ? new Date(ord.date * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
        const lines = Array.isArray(ord.lines) ? ord.lines : [];
        const mappedLines = lines.map((l: any) => ({
            id: String(l.id),
            uid: String(l.id),
            productId: l.fk_product ? String(l.fk_product) : '',
            desc: l.desc || l.label || '',
            qty: Number(l.qty) || 1,
            price: Number(l.price || l.subprice || 0),
        }));
        setExistingLines(mappedLines.map(l => ({ id: l.id, desc: l.desc, qty: l.qty, price: l.price })));
        setNewOrder({ socid: String(ord.socid), date: dateStr, items: mappedLines });
        setEditOrderId(String(ord.id));
        setIsCreateModalOpen(true);
    };

    // Deeplink HITL do agente (#57/#78): create_order abre o modal pré-preenchido (incl. itens);
    // edit_order abre o mesmo modal em modo edição de cabeçalho (só a data).
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_order') {
            appliedPrefillRef.current = prefill;
            const lines = Array.isArray(prefill.data.lines) ? prefill.data.lines : [];
            setNewOrder({
                socid: prefill.data.socid || '',
                date: prefill.data.date || new Date().toISOString().split('T')[0],
                items: lines.map((l: any) => ({ uid: crypto.randomUUID(), productId: l.fk_product ? String(l.fk_product) : '', desc: l.desc || '', qty: Number(l.qty) || 1, price: Number(l.subprice) || 0 })),
            });
            setIsCreateModalOpen(true);
            toast.info('Revise os itens e confirme a criação do pedido.');
        } else if (prefill.kind === 'edit_order') {
            const ord = orders.find(o => String(o.id) === String(prefill.data.id));
            if (!ord) return; // aguarda os dados carregarem
            appliedPrefillRef.current = prefill;
            openOrderEditor(ord, prefill.data.date);
            toast.info('Revise e salve as mudanças no cabeçalho do pedido.');
        }
    }, [prefill, orders]);

    // Deep Linking Effect
    useEffect(() => {
        if (initialItemId && orders.length > 0) {
            const target = orders.find(o => String(o.id) === String(initialItemId));
            if (target) {
                setSelectedOrder(target);
            }
        }
    }, [initialItemId, orders]);

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => c.id === socid);
        return customer ? customer.name : 'Cliente Desconhecido';
    };

    const getProjectName = (projectId?: string) => {
        if (!projectId) return null;
        const p = projects.find((proj: any) => String(proj.id) === String(projectId));
        return p ? (p.title || p.ref) : null;
    };

    // Filtro de status (Tabs) como pré-filtro antes de busca/ordenação (#121).
    // Status: 0=Draft, 1=Validated, 2=Processing, 3=Delivered/Closed
    const statusFilteredOrders = useMemo(() => {
        return orders.filter(o => {
            if (filterStatus === 'validated') return o.statut === '1';
            if (filterStatus === 'processing') return o.statut === '2';
            if (filterStatus === 'delivered') return o.statut === '3';
            return true;
        });
    }, [orders, filterStatus]);

    // Busca + ordenação padronizadas (#121). Busca por ref ou nome do cliente.
    const controls = useListControls(statusFilteredOrders, {
        searchText: (o) => `${o.ref || ''} ${getCustomerName(o.socid)}`,
        sorts: [
            { key: 'date', label: 'Data', get: (o) => o.date ?? 0 },
            { key: 'ref', label: 'Referência', get: (o) => o.ref },
            { key: 'total', label: 'Valor', get: (o) => o.total_ttc ?? 0 },
            { key: 'customer', label: 'Cliente', get: (o) => getCustomerName(o.socid) },
        ],
        initialSortKey: 'date',
        initialSortDir: 'desc',
    });
    const filteredOrders = controls.result;

    const openInDolibarr = (id: string) => {
        const baseUrl = config.apiUrl.replace('/api/index.php', '');
        window.open(`${baseUrl}/commande/card.php?id=${id}`, '_blank');
    };

    const handleCreateInvoice = async (id: string) => {
        setProcessingId(id);
        try {
            await DolibarrService.createInvoiceFromOrder(config, id);
            toast.success(`Fatura criada com sucesso a partir do Pedido ${id}!`);
            if (onRefresh) onRefresh();
        } catch (e: any) {
            log.error('Failed to create invoice from order', e);
            toast.error(`Falha ao gerar fatura: ${e.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const handleValidateOrder = async (id: string) => {
        setProcessingId(id);
        try {
            await DolibarrService.validateOrder(config, id);
            toast.success("Pedido Validado!");
            if (selectedOrder && selectedOrder.id === id) {
                setSelectedOrder({ ...selectedOrder, statut: '1' });
            }
            if (onRefresh) onRefresh();
        } catch (err) {
            log.error("Failed to validate order", err);
            toast.error("Falha ao validar pedido.");
        } finally {
            setProcessingId(null);
        }
    };

    const handleDownloadPdf = async (id: string | number) => {
        try {
            await DolibarrService.downloadDocument('order', id);
        } catch {
            toast.error('Erro ao baixar PDF do pedido');
        }
    };

    const handlePreviewPdf = (id: string | number, ref: string) => {
        setPreviewOrder({ id, ref });
    };

    // --- Shipment Logic ---
    const openShipmentModal = () => {
        if (!selectedOrder || !selectedOrder.lines) return;
        setShipmentLines(selectedOrder.lines.map(l => ({
            id: l.id,
            qty: l.qty, // Default to full qty
            label: l.desc || l.label
        })));
        setIsShipmentModalOpen(true);
    };

    const handleShipmentSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedOrder) return;
        setIsSubmittingShipment(true);
        try {
            const linesToShip = shipmentLines.filter(l => l.qty > 0).map(l => ({ order_line_id: l.id, qty: l.qty }));

            if (linesToShip.length === 0) {
                toast.error("Por favor, selecione pelo menos um item para enviar.");
                return;
            }

            await DolibarrService.shipOrder(config, selectedOrder.id, { lines: linesToShip });
            toast.success("Envio criado com sucesso!");
            setIsShipmentModalOpen(false);
            // Optimistic status update
            if (selectedOrder.statut === '1') {
                setSelectedOrder({ ...selectedOrder, statut: '2' });
            }
            if (onRefresh) onRefresh();
        } catch (e: any) {
            log.error("Failed to create shipment", e);
            toast.error(`Falha ao criar envio: ${e.message}`);
        } finally {
            setIsSubmittingShipment(false);
        }
    };

    // Exclusão de pedido (#121) — usada no card e no detalhe via ConfirmDeleteButton.
    const handleOrderDeleted = (id: string) => {
        if (selectedOrder && String(selectedOrder.id) === String(id)) setSelectedOrder(null);
        refetchOrders();
        if (onRefresh) onRefresh();
    };

    const handleClassifyDelivered = async () => {
        if (!selectedOrder) return;
        setProcessingId(selectedOrder.id);
        try {
            await DolibarrService.classifyOrderDelivered(config, selectedOrder.id);
            setSelectedOrder({ ...selectedOrder, statut: '3' });
            toast.success("Pedido classificado como Entregue.");
            if (onRefresh) onRefresh();
        } catch (e: any) {
            toast.error(`Erro: ${e.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    return (
        <>
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">

            {/* Create/Edit Order Modal (#57/#78) */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={closeOrderModal}
                title={isEditingOrder ? "Editar Pedido" : "Novo Pedido (Rascunho)"}
                size="xl"
            >
                <form onSubmit={handleCreateOrder} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente</label>
                            <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white disabled:opacity-60" value={newOrder.socid} onChange={e => setNewOrder({ ...newOrder, socid: e.target.value })} required={!isEditingOrder} disabled={isEditingOrder}>
                                <option value="">Selecione o Cliente...</option>
                                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            {isEditingOrder && <p className="text-xs text-slate-400 mt-1">O cliente não pode ser alterado.</p>}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                            <input type="date" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newOrder.date} onChange={e => setNewOrder({ ...newOrder, date: e.target.value })} required />
                        </div>
                    </div>
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300">Itens</h4>
                            <Button type="button" variant="ghost" size="sm" icon={<Plus size={12} />} onClick={handleAddOrderItem}>Adicionar Item</Button>
                        </div>
                        <div className="space-y-2">
                            {newOrder.items.length === 0 && <p className="text-sm text-slate-400 italic text-center py-4">Nenhum item adicionado.</p>}
                            {newOrder.items.map((item, idx) => (
                                <div key={item.uid} className="flex gap-2 items-start bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
                                    <div className="flex-1">
                                        <input className="w-full p-1 text-sm border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Descrição do item" value={item.desc} onChange={e => handleUpdateOrderItem(idx, 'desc', e.target.value)} />
                                    </div>
                                    <div className="w-20">
                                        <input type="number" className="w-full p-1 text-sm border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Qtd" value={item.qty} onChange={e => handleUpdateOrderItem(idx, 'qty', parseInt(e.target.value) || 1)} min="1" />
                                    </div>
                                    <div className="w-24">
                                        <input type="number" className="w-full p-1 text-sm border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Preço" value={item.price} onChange={e => handleUpdateOrderItem(idx, 'price', parseFloat(e.target.value) || 0)} />
                                    </div>
                                    <button type="button" onClick={() => handleRemoveOrderItem(idx)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end mt-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <div className="text-right">
                                <span className="text-xs text-slate-500 uppercase font-bold mr-2">Total (S/ Imposto)</span>
                                <span className="text-xl font-bold text-slate-800 dark:text-white">{formatCurrency(calculateOrderTotal())}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                        <Button type="button" variant="secondary" onClick={closeOrderModal}>Cancelar</Button>
                        <Button type="submit" variant="primary" loading={isSubmittingOrder} icon={<CheckCircle size={16} />}>{isEditingOrder ? 'Salvar' : 'Criar Pedido'}</Button>
                    </div>
                </form>
            </Modal>

            {/* Shipment Modal */}
            <Modal
                isOpen={isShipmentModalOpen && !!selectedOrder}
                onClose={() => setIsShipmentModalOpen(false)}
                title={
                    <span className="flex items-center gap-2">
                        <Package size={18} className="text-orange-600" /> Novo Envio
                    </span>
                }
                size="md"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsShipmentModalOpen(false)}>Cancelar</Button>
                        <Button
                            className="!bg-orange-600 hover:!bg-orange-700"
                            loading={isSubmittingShipment}
                            icon={<Truck size={16} />}
                            onClick={handleShipmentSubmit}
                        >
                            Criar Envio
                        </Button>
                    </>
                }
            >
                {selectedOrder && (
                    <>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Selecione itens e quantidades para despachar do Pedido {selectedOrder.ref}.</p>
                        <div className="space-y-2">
                            {shipmentLines.map((line, idx) => (
                                <div key={line.id} className="flex items-center gap-4 p-3 border rounded-lg bg-slate-50 dark:bg-slate-800/50 dark:border-slate-700">
                                    <div className="flex-1">
                                        <p className="font-medium text-slate-800 dark:text-white text-sm line-clamp-1">{line.label}</p>
                                    </div>
                                    <div className="w-24">
                                        <Input
                                            type="number"
                                            value={line.qty}
                                            onChange={(e) => {
                                                const newLines = [...shipmentLines];
                                                newLines[idx].qty = parseInt(e.target.value) || 0;
                                                setShipmentLines(newLines);
                                            }}
                                            className="text-center"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Modal>

            {/* Header */}
            <div className={selectedOrder ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title="Pedidos de Venda"
                    subtitle="Gerencie pedidos de clientes e envios"
                    actions={
                        <div className="flex items-center gap-2">
                            <ListToolbar controls={controls} searchPlaceholder="Buscar pedido ou cliente..." />
                            {canDo('create', 'orders') && (
                            <Button icon={<FilePlus size={18} />} onClick={() => setIsCreateModalOpen(true)}>
                                Novo
                            </Button>
                            )}
                        </div>
                    }
                    tabs={
                        <Tabs value={filterStatus} onChange={(v) => setFilterStatus(v as any)}>
                            <Tab value="all">Todos</Tab>
                            <Tab value="validated">Validados</Tab>
                            <Tab value="processing">Em Processo</Tab>
                            <Tab value="delivered">Entregues</Tab>
                        </Tabs>
                    }
                />
            </div>

            {/* Master Detail Layout */}
            <MasterDetailLayout
                showDetail={!!selectedOrder}
                onCloseDetail={() => setSelectedOrder(null)}
                listWidth="1/3"
                list={
                    filteredOrders.length === 0 ? (
                        <EmptyState
                            icon={ShoppingCart}
                            title="Nenhum pedido encontrado"
                            description="Tente ajustar os filtros ou a busca."
                        />
                    ) : (
                        <div className="grid grid-cols-1 gap-3 p-4">
                            {filteredOrders.map((ord) => (
                                <Card
                                    key={ord.id}
                                    onClick={() => setSelectedOrder(ord)}
                                    selected={selectedOrder?.id === ord.id}
                                    hoverable
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs text-slate-400">{ord.ref}</span>
                                            <StatusBadge status={ord.statut} config={orderStatuses} size="sm" />
                                        </div>
                                        {ord.statut === '0' && canDo('delete', 'orders') && (
                                            <ConfirmDeleteButton
                                                onDelete={() => DolibarrService.deleteOrder(config, ord.id)}
                                                onDeleted={() => handleOrderDeleted(ord.id)}
                                                itemLabel={ord.ref}
                                            />
                                        )}
                                    </div>
                                    <h3 className="font-bold text-slate-800 dark:text-white text-sm mb-1 line-clamp-1">{getCustomerName(ord.socid)}</h3>
                                    {getProjectName(ord.project_id) && (
                                        <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-1 line-clamp-1">Projeto: {getProjectName(ord.project_id)}</p>
                                    )}
                                    <div className="flex justify-between items-end">
                                        <span className="text-xs text-slate-500">{formatDateOnly(ord.date)}</span>
                                        <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(ord.total_ttc)}</span>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )
                }
                detail={
                    selectedOrder && (
                        <OrderDetail
                            order={selectedOrder}
                            onClose={() => setSelectedOrder(null)}
                            onNavigate={onNavigate}
                            customers={customers}
                            users={users}
                            projects={projects}
                            shipments={shipments}
                            invoices={invoices}
                            processingId={processingId}
                            onValidate={handleValidateOrder}
                            onEdit={() => openOrderEditor(selectedOrder)}
                            onCreateShipment={openShipmentModal}
                            onClassifyDelivered={handleClassifyDelivered}
                            onDownloadPdf={handleDownloadPdf}
                            onPreviewPdf={handlePreviewPdf}
                            onOpenDolibarr={openInDolibarr}
                            onDeleteShipment={(id) => DolibarrService.deleteShipment(config, id)}
                            onShipmentDeleted={() => { if (onRefresh) onRefresh(); }}
                            onCreateInvoice={handleCreateInvoice}
                            onDeleteOrder={() => DolibarrService.deleteOrder(config, selectedOrder.id)}
                            onOrderDeleted={() => handleOrderDeleted(selectedOrder.id)}
                        />
                    )
                }
            />
        </div>

        {/* PDF Preview Modal */}
        <PdfPreviewModal
            entityType="order"
            entityId={previewOrder?.id ?? ''}
            title={previewOrder?.ref}
            isOpen={!!previewOrder}
            onClose={() => setPreviewOrder(null)}
        />
        </>
    );
};

export default OrderList;
