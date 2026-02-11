
import React, { useState, useMemo, useEffect } from 'react';
import { Order, AppView } from '../types';
import { ShoppingCart, Search, ExternalLink, Package, CheckCircle, Truck, Clock, FilePlus, Download, Receipt, ArrowDown, ArrowUp, Lock, CheckSquare, Trash2 } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useOrders, useCustomers, useShipments, useInvoices, useUsers } from '../hooks/dolibarr';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly, formatDateTime } from '../utils/dateUtils';
import { logger } from '../utils/logger';

const log = logger.child('OrderList');

// Design System
import { PageHeader, Card, Button, Input, Modal, Tabs, Tab, EmptyState, MasterDetailLayout, StatusBadge } from './ui';
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
    shipments: any[];
    invoices: any[];
    processingId: string | null;
    onValidate: (id: string) => void;
    onCreateShipment: () => void;
    onClassifyDelivered: () => void;
    onDownloadPdf: (ref: string) => void;
    onOpenDolibarr: (id: string) => void;
    onDeleteShipment: (id: string) => void;
    onCreateInvoiceLike: (id: string) => void;
}> = ({
    order,
    onClose,
    onNavigate,
    customers,
    users,
    shipments,
    invoices,
    processingId,
    onValidate,
    onCreateShipment,
    onClassifyDelivered,
    onDownloadPdf,
    onOpenDolibarr,
    onDeleteShipment,
    onCreateInvoiceLike
}) => {
        const [activeTab, setActiveTab] = useState<'overview' | 'shipments' | 'invoices'>('overview');

        const getCustomerName = (socid: string) => {
            const customer = customers.find(c => c.id === socid);
            return customer ? customer.name : 'Cliente Desconhecido';
        };

        const getUserName = (id?: string) => {
            if (!id) return '-';
            const u = users.find(user => String(user.id) === String(id));
            return u ? (u.firstname ? `${u.firstname} ${u.lastname}` : u.login) : `User ${id}`;
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
                        <span
                            className="cursor-pointer hover:underline hover:text-indigo-500"
                            onClick={() => onNavigate && onNavigate('customers', order.socid)}
                        >
                            Cliente: {getCustomerName(order.socid)}
                        </span>
                    }
                    onBack={onClose}
                    actions={
                        <div className="flex items-center gap-2">
                            {order.statut === '0' && (
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
                            <Button variant="ghost" size="sm" icon={<Download size={20} />} onClick={() => onDownloadPdf(order.ref)} />
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
                                            <p className="text-3xl font-bold text-slate-900 dark:text-white">${order.total_ttc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
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
                                                order.lines.map((line: any, idx: number) => (
                                                    <div key={idx} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                                                        <div>
                                                            <div className="font-medium text-slate-800 dark:text-white text-sm">{line.desc || line.label}</div>
                                                            <div className="text-xs text-slate-500">Qtd: {line.qty}</div>
                                                        </div>
                                                        <div className="text-right font-medium text-slate-800 dark:text-white">${line.price.toLocaleString()}</div>
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
                                                <button onClick={(e) => { e.stopPropagation(); onDeleteShipment(ship.id); }} className="p-2 text-slate-400 hover:text-red-500 rounded"><Trash2 size={16} /></button>
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
                                        action={<Button onClick={() => onCreateInvoiceLike(order.id)}>Gerar Fatura (Simulação)</Button>}
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
                                            <div className="text-right font-bold text-slate-800 dark:text-white">${inv.total_ttc.toLocaleString()}</div>
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
    const { config } = useDolibarr();
    const { data: ordersData } = useOrders(config);
    const orders = ordersData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: shipmentsData } = useShipments(config);
    const shipments = shipmentsData || [];
    const { data: invoicesData } = useInvoices(config);
    const invoices = invoicesData || [];
    const { data: users = [] } = useUsers(config);

    // Fallback if config is null
    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'validated' | 'processing' | 'delivered'>('all');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Shipment Creation State
    const [isShipmentModalOpen, setIsShipmentModalOpen] = useState(false);
    const [shipmentLines, setShipmentLines] = useState<{ id: string, qty: number, label: string }[]>([]);
    const [isSubmittingShipment, setIsSubmittingShipment] = useState(false);

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

    const filteredOrders = useMemo(() => {
        let result = orders.filter(o => {
            const customerName = getCustomerName(o.socid).toLowerCase();
            const matchesSearch =
                o.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                customerName.includes(searchTerm.toLowerCase());

            // Status: 0=Draft, 1=Validated, 2=Processing, 3=Delivered/Closed
            if (filterStatus === 'validated') return matchesSearch && o.statut === '1';
            if (filterStatus === 'processing') return matchesSearch && o.statut === '2';
            if (filterStatus === 'delivered') return matchesSearch && o.statut === '3';

            return matchesSearch;
        });

        return result.sort((a, b) => {
            return sortOrder === 'desc' ? b.date - a.date : a.date - b.date;
        });
    }, [orders, customers, searchTerm, filterStatus, sortOrder]);

    const openInDolibarr = (id: string) => {
        const baseUrl = config.apiUrl.replace('/api/index.php', '');
        window.open(`${baseUrl}/commande/card.php?id=${id}`, '_blank');
    };

    const handleCreateInvoice = (id: string) => {
        setProcessingId(id);
        setTimeout(() => {
            setProcessingId(null);
            alert(`Fatura criada com sucesso a partir do Pedido ${id}!`);
        }, 1500);
    };

    const handleValidateOrder = async (id: string) => {
        if (!confirm("Validar este pedido?")) return;
        setProcessingId(id);
        try {
            await DolibarrService.validateOrder(config, id);
            alert("Pedido Validado!");
            if (selectedOrder && selectedOrder.id === id) {
                setSelectedOrder({ ...selectedOrder, statut: '1' });
            }
            if (onRefresh) onRefresh();
        } catch (err) {
            log.error("Failed to validate order", err);
            alert("Falha ao validar pedido.");
        } finally {
            setProcessingId(null);
        }
    };

    const handleDownloadPdf = (ref: string) => {
        DolibarrService.downloadDocument(config, 'order', ref);
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
                alert("Por favor, selecione pelo menos um item para enviar.");
                return;
            }

            await DolibarrService.shipOrder(config, selectedOrder.id, { lines: linesToShip });
            alert("Envio criado com sucesso!");
            setIsShipmentModalOpen(false);
            // Optimistic status update
            if (selectedOrder.statut === '1') {
                setSelectedOrder({ ...selectedOrder, statut: '2' });
            }
            if (onRefresh) onRefresh();
        } catch (e: any) {
            log.error("Failed to create shipment", e);
            alert(`Falha ao criar envio: ${e.message}`);
        } finally {
            setIsSubmittingShipment(false);
        }
    };

    const handleDeleteShipment = async (id: string) => {
        if (!confirm("Tem certeza que deseja excluir este envio?")) return;
        try {
            await DolibarrService.deleteShipment(config, id);
            alert("Envio excluído");
            if (onRefresh) onRefresh();
        } catch (e) {
            log.error("Failed to delete shipment", e);
            alert("Falha ao excluir envio");
        }
    };

    const handleClassifyDelivered = async () => {
        if (!selectedOrder) return;
        if (!confirm("Marcar este pedido como completamente entregue?")) return;
        setProcessingId(selectedOrder.id);
        try {
            await DolibarrService.classifyOrderDelivered(config, selectedOrder.id);
            setSelectedOrder({ ...selectedOrder, statut: '3' });
            alert("Pedido classificado como Entregue.");
            if (onRefresh) onRefresh();
        } catch (e: any) {
            alert(`Erro: ${e.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">

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
                            <Input
                                placeholder="Buscar pedido ou cliente..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                icon={<Search size={16} />}
                                className="w-48"
                                fullWidth={false}
                            />
                            <Button
                                variant="secondary"
                                icon={sortOrder === 'desc' ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
                                onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                                title={sortOrder === 'desc' ? "Mais recentes" : "Mais antigos"}
                            />
                            <Button icon={<FilePlus size={18} />} onClick={() => alert("Não implementado nesta demo.")}>
                                Novo
                            </Button>
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
                                    </div>
                                    <h3 className="font-bold text-slate-800 dark:text-white text-sm mb-1 line-clamp-1">{getCustomerName(ord.socid)}</h3>
                                    <div className="flex justify-between items-end">
                                        <span className="text-xs text-slate-500">{formatDateOnly(ord.date)}</span>
                                        <span className="font-bold text-slate-800 dark:text-white">${ord.total_ttc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
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
                            shipments={shipments}
                            invoices={invoices}
                            processingId={processingId}
                            onValidate={handleValidateOrder}
                            onCreateShipment={openShipmentModal}
                            onClassifyDelivered={handleClassifyDelivered}
                            onDownloadPdf={handleDownloadPdf}
                            onOpenDolibarr={openInDolibarr}
                            onDeleteShipment={handleDeleteShipment}
                            onCreateInvoiceLike={handleCreateInvoice}
                        />
                    )
                }
            />
        </div>
    );
};

export default OrderList;
