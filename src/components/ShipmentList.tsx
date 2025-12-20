
import React, { useState, useMemo } from 'react';
import { Shipment, ThirdParty, DolibarrConfig, AppView, Order } from '../types';
import { Truck, Search, ExternalLink, Calendar, Package, ArrowLeft, ArrowRight, Loader2, Info, X, FilePlus } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useShipments } from '../hooks/dolibarr/useShipments';
import { useCustomers } from '../hooks/dolibarr/useCustomers';
import { useOrders } from '../hooks/dolibarr/useOrders';

interface ShipmentListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
}

const ShipmentList: React.FC<ShipmentListProps> = ({ onNavigate, onRefresh }) => {
    const { config } = useDolibarr();
    const { data: shipmentsData } = useShipments(config);
    const shipments = shipmentsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: ordersData } = useOrders(config);
    const orders = ordersData || [];

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'lines'>('overview');
    const [isProcessing, setIsProcessing] = useState(false);

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => String(c.id) === String(socid));
        return customer ? customer.name : 'Cliente Desconhecido';
    };

    const getOrderRef = (orderId?: string) => {
        if (!orderId) return null;
        const order = orders.find(o => String(o.id) === String(orderId));
        return order ? order.ref : `Pedido #${orderId}`;
    };

    const filteredShipments = useMemo(() => {
        return shipments.filter(s => {
            const customerName = getCustomerName(s.socid).toLowerCase();
            const orderRef = getOrderRef(s.fk_commande)?.toLowerCase() || '';
            const matchesSearch =
                s.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                customerName.includes(searchTerm.toLowerCase()) ||
                orderRef.includes(searchTerm.toLowerCase()) ||
                (s.tracking_number && s.tracking_number.toLowerCase().includes(searchTerm.toLowerCase()));

            return matchesSearch;
        }).sort((a, b) => b.date_creation - a.date_creation);
    }, [shipments, customers, orders, searchTerm]);

    const getStatusBadge = (status: string) => {
        // 0=Draft, 1=Validated, 2=Closed/Delivered
        switch (status) {
            case '0': return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">Rascunho</span>;
            case '1': return <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">Validado</span>;
            case '2': return <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">Entregue</span>;
            default: return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500">Desconhecido</span>;
        }
    };

    const handleDownloadPdf = (e: React.MouseEvent, ref: string) => {
        e.stopPropagation();
        DolibarrService.downloadDocument(config, 'shipment', ref);
    };

    const handleCreateInvoice = async () => {
        if (!selectedShipment || !selectedShipment.fk_commande) return;
        setIsProcessing(true);

        // Simulated invoice creation logic (since real API might differ slightly based on module setup)
        // We essentially just call createInvoice on the order
        try {
            // If we had the real endpoint for creating invoice from shipment: /invoices/createfromshipment/{id}
            // For now we simulate success
            await new Promise(r => setTimeout(r, 1000));
            alert("Fatura criada a partir do Envio (Ação Mock)!");
            if (onNavigate) onNavigate('orders', selectedShipment.fk_commande); // Redirect to order to see new invoice
        } catch (e) {
            console.error(e);
            alert("Falha ao criar fatura");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Header */}
            <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${selectedShipment ? 'hidden lg:block' : 'block'}`}>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Envios/Expedições</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Rastreie entregas e despachos</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar envio, rastreio..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 pr-4 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white w-64"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* List */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${selectedShipment ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {filteredShipments.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <Truck size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Nenhum envio encontrado.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredShipments.map(ship => (
                                <div key={ship.id} onClick={() => setSelectedShipment(ship)} className={`p-4 border rounded-xl cursor-pointer transition-all ${selectedShipment?.id === ship.id ? `border-${config.themeColor}-500 bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'}`}>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <Truck size={16} className="text-slate-400" />
                                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">{ship.ref}</h4>
                                        </div>
                                        {getStatusBadge(ship.status)}
                                    </div>
                                    <div className="text-sm text-slate-600 dark:text-slate-300 font-medium mb-1">
                                        {getCustomerName(ship.socid)}
                                    </div>
                                    <div className="flex justify-between items-center mt-2 text-xs text-slate-500">
                                        <span>{new Date(ship.date_creation * 1000).toLocaleDateString()}</span>
                                        {ship.fk_commande && <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">{getOrderRef(ship.fk_commande)}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detail */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${selectedShipment ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {selectedShipment ? (
                        <>
                            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                                <div>
                                    <h2 className="text-lg font-bold dark:text-white flex items-center gap-2">{selectedShipment.ref} {getStatusBadge(selectedShipment.status)}</h2>
                                    <span className="text-xs text-slate-500">Detalhes de Logística</span>
                                </div>
                                <div className="flex gap-2">
                                    {selectedShipment.status === '2' && (
                                        <button
                                            onClick={handleCreateInvoice}
                                            disabled={isProcessing}
                                            className="p-2 text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-lg flex items-center gap-1 transition-colors"
                                            title="Faturar Envio"
                                        >
                                            {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <FilePlus size={18} />}
                                            <span className="hidden sm:inline text-sm font-medium">Faturar</span>
                                        </button>
                                    )}
                                    <button onClick={(e) => handleDownloadPdf(e, selectedShipment.ref)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title="Baixar PDF"><ExternalLink size={20} /></button>
                                    <button onClick={() => setSelectedShipment(null)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                                </div>
                            </div>

                            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                                <button onClick={() => setActiveTab('overview')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'overview' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Visão Geral</button>
                                {/* Lines tab would go here if we fetched lines detail */}
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">
                                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                        <h3 className="font-bold text-slate-800 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Informações</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="text-xs text-slate-500 uppercase font-bold">Cliente</label>
                                                <div
                                                    className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium cursor-pointer hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                                                    onClick={() => onNavigate && onNavigate('customers', selectedShipment.socid)}
                                                >
                                                    {getCustomerName(selectedShipment.socid)}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-slate-500 uppercase font-bold">Data Criação</label>
                                                <div className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium">
                                                    <Calendar size={16} className="text-indigo-500" />
                                                    {new Date(selectedShipment.date_creation * 1000).toLocaleDateString()}
                                                </div>
                                            </div>
                                            {selectedShipment.date_delivery && (
                                                <div>
                                                    <label className="text-xs text-slate-500 uppercase font-bold">Data Entrega</label>
                                                    <div className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium">
                                                        <Calendar size={16} className="text-emerald-500" />
                                                        {new Date(selectedShipment.date_delivery * 1000).toLocaleDateString()}
                                                    </div>
                                                </div>
                                            )}
                                            {selectedShipment.fk_commande && (
                                                <div>
                                                    <label className="text-xs text-slate-500 uppercase font-bold">Pedido Origem</label>
                                                    <div
                                                        className="flex items-center gap-2 mt-1 text-indigo-600 dark:text-indigo-400 font-medium cursor-pointer hover:underline"
                                                        onClick={() => onNavigate && onNavigate('orders', selectedShipment.fk_commande!)}
                                                    >
                                                        <Package size={16} /> {getOrderRef(selectedShipment.fk_commande)}
                                                    </div>
                                                </div>
                                            )}
                                            {selectedShipment.tracking_number && (
                                                <div className="col-span-2">
                                                    <label className="text-xs text-slate-500 uppercase font-bold">Número de Rastreio</label>
                                                    <div className="mt-1 p-2 bg-slate-100 dark:bg-slate-800 rounded font-mono text-slate-800 dark:text-white select-all">
                                                        {selectedShipment.tracking_number}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <Truck size={48} className="mb-4 opacity-50" />
                            <p>Selecione um envio para ver detalhes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ShipmentList;
