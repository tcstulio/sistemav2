
import React, { useState, useMemo, useEffect } from 'react';
import { Order, ThirdParty, DolibarrConfig, AppView, Shipment, Invoice } from '../types';
import { ShoppingCart, Search, ExternalLink, Package, CheckCircle, Truck, X, Clock, FilePlus, Loader2, Download, ArrowLeft, Info, Receipt, ArrowDown, ArrowUp, Lock, Box, CheckSquare, Trash2, FileText, User } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useOrders, useCustomers, useShipments, useInvoices, useUsers } from '../hooks/dolibarr';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly, formatDateTime } from '../utils/dateUtils';

interface OrderListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
    onRefresh?: () => void;
}

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

    // Fallback if config is null (should rely on context handling login, but specific hooks handle null config gracefully returning empty array)
    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'validated' | 'processing' | 'delivered'>('all');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'shipments' | 'invoices'>('overview');
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
                setActiveTab('overview');
            }
        }
    }, [initialItemId, orders]);

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => c.id === socid);
        return customer ? customer.name : 'Cliente Desconhecido';
    };

    const getUserName = (id?: string) => {
        if (!id) return '-';
        const u = users.find(user => String(user.id) === String(id));
        return u ? (u.firstname ? `${u.firstname} ${u.lastname}` : u.login) : `User ${id}`;
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

    const currentOrderShipments = useMemo(() => {
        if (!selectedOrder) return [];
        return shipments.filter(s => String(s.fk_commande) === String(selectedOrder.id) || String(s.socid) === String(selectedOrder.socid));
        // Note: In real API, link via fk_commande is reliable. Fallback to customer if missing for demo.
    }, [selectedOrder, shipments]);

    const currentOrderInvoices = useMemo(() => {
        if (!selectedOrder) return [];
        // Note: Dolibarr API invoice object usually has fk_commande or order_id
        return invoices.filter(i => String(i.order_id) === String(selectedOrder.id));
    }, [selectedOrder, invoices]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case '0':
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"><Clock size={12} /> Rascunho</span>;
            case '1':
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"><CheckCircle size={12} /> Validado</span>;
            case '2':
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800"><Truck size={12} /> Em Envio</span>;
            case '3':
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><Package size={12} /> Entregue</span>;
            default:
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Desconhecido</span>;
        }
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

    const openInDolibarr = (id: string) => {
        const baseUrl = config.apiUrl.replace('/api/index.php', '');
        window.open(`${baseUrl}/commande/card.php?id=${id}`, '_blank');
    };

    const handleCreateInvoice = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setProcessingId(id);
        setTimeout(() => {
            setProcessingId(null);
            // TODO: Implement real invoice creation from order
            alert(`Fatura criada com sucesso a partir do Pedido ${id}!`);
        }, 1500);
    };

    const handleValidateOrder = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm("Validar este pedido?")) return;
        setProcessingId(id);
        try {
            await DolibarrService.validateOrder(config, id);
            alert("Pedido Validado!");
            if (selectedOrder && selectedOrder.id === id) {
                setSelectedOrder({ ...selectedOrder, statut: '1' });
            }
        } catch (err) {
            console.error(err);
            alert("Falha ao validar pedido.");
        } finally {
            setProcessingId(null);
        }
    };

    const handleDownloadPdf = (e: React.MouseEvent, ref: string) => {
        e.stopPropagation();
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
            console.error(e);
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
            console.error(e);
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
            {isShipmentModalOpen && selectedOrder && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <Package size={18} className="text-orange-600" /> Novo Envio
                            </h3>
                            <button onClick={() => setIsShipmentModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleShipmentSubmit} className="flex-1 flex flex-col overflow-hidden">
                            <div className="p-6 space-y-4 overflow-y-auto">
                                <p className="text-sm text-slate-500 dark:text-slate-400">Selecione itens e quantidades para despachar do Pedido {selectedOrder.ref}.</p>
                                <div className="space-y-2">
                                    {shipmentLines.map((line, idx) => (
                                        <div key={line.id} className="flex items-center gap-4 p-3 border rounded-lg bg-slate-50 dark:bg-slate-800/50 dark:border-slate-700">
                                            <div className="flex-1">
                                                <p className="font-medium text-slate-800 dark:text-white text-sm line-clamp-1">{line.label}</p>
                                            </div>
                                            <div className="w-24">
                                                <input
                                                    type="number"
                                                    className="w-full p-1.5 text-sm border rounded dark:bg-slate-900 dark:border-slate-600 dark:text-white text-center"
                                                    value={line.qty}
                                                    min={0}
                                                    onChange={(e) => {
                                                        const newLines = [...shipmentLines];
                                                        newLines[idx].qty = parseInt(e.target.value) || 0;
                                                        setShipmentLines(newLines);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                                <button type="button" onClick={() => setIsShipmentModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmittingShipment} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmittingShipment ? <Loader2 className="animate-spin" size={16} /> : <Truck size={16} />} Criar Envio
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${selectedOrder ? 'hidden lg:block' : 'block'}`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Pedidos de Venda</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie pedidos de clientes e envios</p>
                    </div>
                    <div className="relative flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar pedido ou cliente..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className={`pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-${config.themeColor}-500 focus:border-${config.themeColor}-500 outline-none w-full md:w-64 text-sm transition-all`}
                            />
                        </div>

                        {/* Sort Button */}
                        <button
                            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                            className={`p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 text-sm font-medium`}
                            title={sortOrder === 'desc' ? "Mais recentes" : "Mais antigos"}
                        >
                            {sortOrder === 'desc' ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
                        </button>

                        <button
                            onClick={() => alert("Não implementado nesta demo.")}
                            className={`flex items-center gap-1.5 px-3 py-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                        >
                            <FilePlus size={18} /> Novo
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
                    {['all', 'validated', 'processing', 'delivered'].map(status => (
                        <button
                            key={status}
                            onClick={() => setFilterStatus(status as any)}
                            className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 capitalize whitespace-nowrap ${filterStatus === status ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                        >
                            {status === 'all' ? 'Todos' : status === 'validated' ? 'Validados' : status === 'processing' ? 'Em Processo' : 'Entregues'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">

                {/* List Section */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${selectedOrder ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {filteredOrders.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <ShoppingCart size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Nenhum pedido encontrado com estes critérios.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3">
                            {filteredOrders.map((ord) => (
                                <div
                                    key={ord.id}
                                    onClick={() => { setSelectedOrder(ord); setActiveTab('overview'); }}
                                    className={`p-4 rounded-xl border transition-all cursor-pointer ${selectedOrder?.id === ord.id ? `border-${config.themeColor}-500 ring-1 ring-${config.themeColor}-500 shadow-sm dark:bg-slate-800` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-700'}`}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs text-slate-400">{ord.ref}</span>
                                            {getStatusBadge(ord.statut)}
                                        </div>
                                    </div>
                                    <h3 className="font-bold text-slate-800 dark:text-white text-sm mb-1 line-clamp-1">{getCustomerName(ord.socid)}</h3>
                                    <div className="flex justify-between items-end">
                                        <span className="text-xs text-slate-500">{formatDateOnly(ord.date)}</span>
                                        <span className="font-bold text-slate-800 dark:text-white">${ord.total_ttc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detail Section */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${selectedOrder ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {selectedOrder ? (
                        <>
                            {/* Detail Header */}
                            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSelectedOrder(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                                    <div>
                                        <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight flex items-center gap-2">
                                            {selectedOrder.ref}
                                            {getStatusBadge(selectedOrder.statut)}
                                        </h2>
                                        <span
                                            className="text-xs text-slate-400 cursor-pointer hover:underline hover:text-indigo-500"
                                            onClick={() => onNavigate && onNavigate('customers', selectedOrder.socid)}
                                        >
                                            Cliente: {getCustomerName(selectedOrder.socid)}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedOrder.statut === '0' && (
                                        <button
                                            onClick={(e) => handleValidateOrder(e, selectedOrder.id)}
                                            disabled={!!processingId}
                                            className="p-2 rounded-lg text-blue-600 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors text-sm font-medium flex items-center gap-1"
                                        >
                                            {processingId === selectedOrder.id ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
                                            <span className="hidden xl:inline">Validar</span>
                                        </button>
                                    )}
                                    {(selectedOrder.statut === '1' || selectedOrder.statut === '2') && (
                                        <button
                                            onClick={openShipmentModal}
                                            className="p-2 rounded-lg text-orange-600 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors text-sm font-medium flex items-center gap-1"
                                        >
                                            <Package size={18} />
                                            <span className="hidden xl:inline">Criar Envio</span>
                                        </button>
                                    )}
                                    {selectedOrder.statut === '2' && (
                                        <button
                                            onClick={handleClassifyDelivered}
                                            disabled={!!processingId}
                                            className="p-2 rounded-lg text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors text-sm font-medium flex items-center gap-1"
                                        >
                                            <CheckSquare size={18} />
                                            <span className="hidden xl:inline">Entregue</span>
                                        </button>
                                    )}
                                    <button onClick={(e) => handleDownloadPdf(e, selectedOrder.ref)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><Download size={20} /></button>
                                    <button onClick={() => openInDolibarr(selectedOrder.id)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><ExternalLink size={20} /></button>
                                    <button onClick={() => setSelectedOrder(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                                <button onClick={() => setActiveTab('overview')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'overview' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Visão Geral</button>
                                <button onClick={() => setActiveTab('shipments')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'shipments' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Envios ({currentOrderShipments.length})</button>
                                <button onClick={() => setActiveTab('invoices')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'invoices' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Faturas ({currentOrderInvoices.length})</button>
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">

                                    {activeTab === 'overview' && (
                                        <>
                                            {/* Key Info Card */}
                                            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                                                    <div>
                                                        <p className="text-sm text-slate-500 uppercase font-bold mb-1">Valor Total</p>
                                                        <p className="text-3xl font-bold text-slate-900 dark:text-white">${selectedOrder.total_ttc.toLocaleString()}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-sm text-slate-500 uppercase font-bold mb-1">Data</p>
                                                        <p className="text-lg font-medium text-slate-800 dark:text-white">{formatDateOnly(selectedOrder.date)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-sm text-slate-500 uppercase font-bold mb-1">Responsáveis</p>
                                                        <div className="space-y-1">
                                                            <div className="text-sm flex justify-between">
                                                                <span className="text-slate-500">Criado:</span> <span className="font-medium text-slate-800 dark:text-white">{getUserName(selectedOrder.fk_user_author)}</span>
                                                            </div>
                                                            {selectedOrder.fk_user_valid && (
                                                                <div className="text-sm flex justify-between">
                                                                    <span className="text-slate-500">Validado:</span> <span className="font-medium text-slate-800 dark:text-white">{getUserName(selectedOrder.fk_user_valid)}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                                                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Itens do Pedido</h4>
                                                    <div className="space-y-2">
                                                        {selectedOrder.lines && selectedOrder.lines.length > 0 ? (
                                                            selectedOrder.lines.map((line: any, idx: number) => (
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

                                                {/* Linked Objects */}
                                                <LinkedObjects
                                                    id={selectedOrder.id}
                                                    type="commande"
                                                    onNavigate={onNavigate}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {activeTab === 'shipments' && (
                                        <div className="space-y-3">
                                            {currentOrderShipments.length === 0 ? (
                                                <div className="text-center py-10 text-slate-400 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                                    <Truck size={48} className="mx-auto mb-4 opacity-50" />
                                                    <p>Nenhum envio registrado para este pedido.</p>
                                                    {selectedOrder.statut === '1' && (
                                                        <button onClick={openShipmentModal} className="mt-4 text-indigo-600 dark:text-indigo-400 hover:underline">Criar Primeiro Envio</button>
                                                    )}
                                                </div>
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
                                                            <button onClick={() => handleDeleteShipment(ship.id)} className="p-2 text-slate-400 hover:text-red-500 rounded"><Trash2 size={16} /></button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'invoices' && (
                                        <div className="space-y-3">
                                            {currentOrderInvoices.length === 0 ? (
                                                <div className="text-center py-10 text-slate-400 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                                    <Receipt size={48} className="mx-auto mb-4 opacity-50" />
                                                    <p>Nenhuma fatura gerada para este pedido.</p>
                                                    <button onClick={(e) => handleCreateInvoice(e, selectedOrder.id)} className="mt-4 text-indigo-600 dark:text-indigo-400 hover:underline">Gerar Fatura (Simulação)</button>
                                                </div>
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
                    ) : (
                        <div className="text-center p-8 max-w-sm mx-auto">
                            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300 dark:text-slate-600"><ShoppingCart size={32} /></div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Selecione um Pedido</h3>
                            <p className="text-slate-500 dark:text-slate-400 text-sm">Ver detalhes, criar envios ou faturas.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OrderList;
