import React, { useState, useMemo } from 'react';
import { ThirdParty, DolibarrConfig, SupplierInvoice, Product, SupplierOrder, AppView, Warehouse } from '../types';
import { Truck, Search, Plus, MapPin, Mail, Phone, ExternalLink, Package, ShoppingCart, Receipt, X, ArrowDownCircle, CheckCircle2, Loader2, ArrowLeft, Lock, CheckSquare, Clock } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useSuppliers, useProducts, useSupplierInvoices, useSupplierOrders, useWarehouses } from '../hooks/dolibarr';
import { LinkedObjects } from './common/LinkedObjects';
import { ReceiptScanner } from './Finance/ReceiptScanner';
import { toast } from 'sonner';

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

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSupplier, setSelectedSupplier] = useState<ThirdParty | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'invoices' | 'products'>('overview');

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
            if (onRefresh) onRefresh();
        } catch (e: any) {
            console.error(e);
            toast.error("Erro ao criar fatura: " + e.message);
        } finally {
            setIsSubmittingInvoice(false);
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

            {/* Receipt Scanner */}
            {isScannerOpen && (
                <ReceiptScanner
                    onScanComplete={handleScanComplete}
                    onClose={() => setIsScannerOpen(false)}
                />
            )}

            {/* Create Invoice Modal */}
            {isCreateInvoiceOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
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
            )}

            {/* Reception Modal */}
            {isReceptionModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <ArrowDownCircle size={18} className="text-emerald-600" /> Receber Itens
                            </h3>
                            <button onClick={() => setIsReceptionModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleReceptionSubmit} className="p-6 space-y-4">
                            <p className="text-sm text-slate-500 mb-2">Receber itens do Pedido para o estoque.</p>

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

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantidade</label>
                                <input
                                    type="number"
                                    min="1"
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={receptionForm.qty}
                                    onChange={e => setReceptionForm({ ...receptionForm, qty: parseInt(e.target.value) })}
                                    required
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsReceptionModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmittingReception} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmittingReception ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Confirmar Recibo
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${selectedSupplier ? 'hidden lg:block' : 'block'}`}>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Fornecedores</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie vendedores e pedidos de compra</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsScannerOpen(true)}
                            className={`flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                        >
                            <Receipt size={18} /> Digitalizar Recibo
                        </button>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar..."
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
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${selectedSupplier ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {filteredSuppliers.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <Truck size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Nenhum fornecedor encontrado.</p>
                        </div>
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
                            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSelectedSupplier(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                                    <div>
                                        <h2 className="text-lg font-bold dark:text-white">{selectedSupplier.name}</h2>
                                        <span className="text-xs text-slate-500">Detalhes do Fornecedor</span>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedSupplier(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                            </div>

                            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                                <button onClick={() => setActiveTab('overview')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'overview' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Visão Geral</button>
                                <button onClick={() => setActiveTab('orders')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'orders' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Pedidos de Compra ({currentSupplierOrders.length})</button>
                                <button onClick={() => setActiveTab('invoices')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'invoices' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Faturas de Fornecedor ({currentSupplierInvoices.length})</button>
                                <button onClick={() => setActiveTab('products')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'products' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Produtos Fornecidos ({currentSupplierProducts.length})</button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">
                                    {activeTab === 'overview' && (
                                        <>
                                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Contatos</h3>
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
                                            </div>
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
                                                <div className="text-center py-10 text-slate-400">
                                                    <ShoppingCart size={48} className="mx-auto mb-4 opacity-50" />
                                                    <p>Nenhum pedido de compra.</p>
                                                </div>
                                            ) : (
                                                currentSupplierOrders.map(order => (
                                                    <div key={order.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">{order.ref}</h4>
                                                            {getOrderStatusBadge(order.statut)}
                                                        </div>
                                                        <div className="flex justify-between items-end">
                                                            <div className="text-xs text-slate-500">{new Date(order.date_creation < 100000000000 ? order.date_creation * 1000 : order.date_creation).toLocaleDateString()}</div>
                                                            <div className="font-bold text-slate-800 dark:text-white">${order.total_ttc.toLocaleString()}</div>
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
                                                <div className="text-center py-10 text-slate-400">
                                                    <Receipt size={48} className="mx-auto mb-4 opacity-50" />
                                                    <p>Nenhuma fatura encontrada.</p>
                                                </div>
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
                                                <div className="text-center py-10 text-slate-400">
                                                    <Package size={48} className="mx-auto mb-4 opacity-50" />
                                                    <p>Nenhum produto associado no histórico.</p>
                                                </div>
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
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <Truck size={48} className="mb-4 opacity-50" />
                            <p>Selecione um fornecedor para ver detalhes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};