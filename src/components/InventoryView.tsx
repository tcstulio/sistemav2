
import React, { useState, useEffect, useCallback } from 'react';
import { Warehouse, AppView, Product } from '../types';
import { Warehouse as WarehouseIcon, ArrowRightLeft, Search, MapPin, Package, User, Truck, X, Sliders, Plus, Edit2, Trash2, Loader2, Save, CalendarDays, Filter, RefreshCw, Layers, ArrowUpRight, ArrowDownRight, FileText, ArrowLeft, Boxes } from 'lucide-react';
import { formatDateTime } from '../utils/dateUtils';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useWarehouses, useStockMovements, useProducts, useUsers } from '../hooks/dolibarr';
import { logger } from '../utils/logger';
import { notifyError } from '../utils/notifyError';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';

const log = logger.child('InventoryView');

// Máximo de consultas simultâneas de estoque ao Dolibarr (evita fan-out N+1).
const STOCK_FETCH_CONCURRENCY = 6;

interface WarehouseStockItem {
    product: Product;
    qty: number;
}

/** Painel de conteúdo de um armazém: lista produtos com suas quantidades */
const WarehouseContentPanel: React.FC<{
    warehouse: Warehouse;
    items: WarehouseStockItem[];
    isLoading: boolean;
    onBack: () => void;
    onNavigate?: (view: AppView, id: string) => void;
}> = ({ warehouse, items, isLoading, onBack, onNavigate }) => {
    const totalQty = items.reduce((sum, it) => sum + it.qty, 0);

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">
            {/* Sub-header com botão voltar */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex items-center gap-3 mb-1">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors"
                        data-testid="back-button"
                    >
                        <ArrowLeft size={16} /> Armazéns
                    </button>
                </div>
                <div className="flex items-center gap-3 mt-2">
                    <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400">
                        <WarehouseIcon size={22} />
                    </div>
                    <div>
                        <h3 className="font-bold text-xl text-slate-800 dark:text-white">{warehouse.label}</h3>
                        {warehouse.lieu && (
                            <span className="text-sm text-slate-400 flex items-center gap-1 mt-0.5">
                                <MapPin size={13} /> {warehouse.lieu}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                <div className="max-w-3xl mx-auto space-y-4">
                    {/* Resumo */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold">Itens com estoque</span>
                            <div className="font-bold text-2xl text-slate-800 dark:text-white mt-1">{isLoading ? '—' : items.length}</div>
                        </div>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold">Quantidade total</span>
                            <div className="font-bold text-2xl text-slate-800 dark:text-white mt-1">{isLoading ? '—' : totalQty.toLocaleString()}</div>
                        </div>
                    </div>

                    {/* Lista de itens */}
                    <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Boxes size={18} /> Itens neste armazém
                        </h4>

                        {isLoading ? (
                            <div className="flex justify-center py-12" data-testid="loading-spinner">
                                <Loader2 className="animate-spin text-slate-400" size={28} />
                            </div>
                        ) : items.length === 0 ? (
                            <div className="flex flex-col items-center py-12 text-slate-400" data-testid="empty-state">
                                <Package size={40} className="mb-3 opacity-50" />
                                <p className="font-medium">Nenhum item em estoque</p>
                                <p className="text-sm mt-1">Este armazém não possui produtos com quantidade registrada.</p>
                            </div>
                        ) : (
                            <div className="space-y-2" data-testid="stock-items">
                                {items.map(({ product, qty }) => (
                                    <button
                                        key={product.id}
                                        type="button"
                                        onClick={() => onNavigate?.('products', product.id)}
                                        className="w-full text-left flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                    >
                                        <div className="min-w-0 pr-2">
                                            <span className="text-sm font-medium text-slate-800 dark:text-white block truncate">
                                                {product.label}
                                            </span>
                                            <span className="text-xs text-slate-400 font-mono block truncate">{product.ref}</span>
                                        </div>
                                        <span className="shrink-0 font-bold text-slate-900 dark:text-white">{qty.toLocaleString()}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface InventoryViewProps {
    onNavigate?: (view: AppView, id: string) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({ onNavigate }) => {
    const { config, refreshData } = useDolibarr();

    const { data: warehouses = [], isLoading: isLoadingWarehouses } = useWarehouses(config || null, !!config);
    const { data: stockMovements = [], isLoading: isLoadingMovements } = useStockMovements(config || null, !!config);
    const { data: products = [], isLoading: isLoadingProducts } = useProducts(config || null, !!config);
    const { data: users = [], isLoading: isLoadingUsers } = useUsers(config || null, !!config);

    const isLoading = isLoadingWarehouses || isLoadingMovements || isLoadingProducts || isLoadingUsers;

    const confirm = useConfirm();
    const [activeTab, setActiveTab] = useState<'warehouses' | 'movements'>('warehouses');
    const [searchTerm, setSearchTerm] = useState('');

    // Drill-in: armazém selecionado para ver conteúdo
    const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);
    const [stockItems, setStockItems] = useState<WarehouseStockItem[]>([]);
    const [isLoadingStock, setIsLoadingStock] = useState(false);

    const loadStock = useCallback(
        async (warehouse: Warehouse) => {
            if (!config) return;
            setIsLoadingStock(true);
            setStockItems([]);
            try {
                const candidates = products.filter(p => p.type === '0' && (p.stock_reel || 0) > 0);
                const results = await mapWithConcurrency(candidates, STOCK_FETCH_CONCURRENCY, async product => {
                    try {
                        const full: any = await DolibarrService.getProductWithStock(config, product.id);
                        const warehouseStock = full?.stock_warehouse?.[warehouse.id];
                        const qty = warehouseStock ? parseFloat(warehouseStock.real ?? warehouseStock.stock ?? '0') : 0;
                        return qty > 0 ? { product, qty } : null;
                    } catch (e) {
                        log.warn(`Falha ao buscar estoque do produto ${product.id}`, e);
                        return null;
                    }
                });
                setStockItems(
                    results
                        .filter((r): r is WarehouseStockItem => r !== null)
                        .sort((a, b) => b.qty - a.qty)
                );
            } catch (e) {
                log.error('Erro ao carregar estoque do armazém', e);
            } finally {
                setIsLoadingStock(false);
            }
        },
        [config, products]
    );

    useEffect(() => {
        if (selectedWarehouse) {
            loadStock(selectedWarehouse);
        } else {
            setStockItems([]);
        }
    }, [selectedWarehouse, loadStock]);

    // Warehouse CRUD State
    const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
    const [warehouseForm, setWarehouseForm] = useState<Partial<Warehouse>>({ label: '', description: '', lieu: '', statut: '1' });
    const [isSubmittingWarehouse, setIsSubmittingWarehouse] = useState(false);
    const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);

    // Transfer Modal State
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [transferForm, setTransferForm] = useState({
        productId: '',
        sourceWarehouse: '',
        targetWarehouse: '',
        qty: 1
    });

    // Correction Modal State
    const [isCorrectionModalOpen, setIsCorrectionModalOpen] = useState(false);
    const [correctionForm, setCorrectionForm] = useState({
        productId: '',
        warehouseId: '',
        qty: 1,
        type: 'add', // 'add' or 'remove'
        label: 'Correção de Inventário'
    });

    const [isSubmitting, setIsSubmitting] = useState(false);

    // ... helpers ...
    const getProductName = (id: string) => {
        const p = products.find(prod => String(prod.id) === String(id));
        return p ? p.label : `Produto #${id}`;
    };

    const getUserName = (id: string) => {
        const u = users.find(user => String(user.id) === String(id));
        return u ? u.login : 'Sistema';
    };

    const filteredWarehouses = warehouses.filter(w => w.label.toLowerCase().includes(searchTerm.toLowerCase()));
    const filteredMovements = stockMovements.filter(m => (m.label?.toLowerCase().includes(searchTerm.toLowerCase()) || getProductName(m.product_id).toLowerCase().includes(searchTerm.toLowerCase())));

    // ... handlers ...
    const openWarehouseModal = (wh?: Warehouse) => {
        if (wh) {
            setEditingWarehouseId(wh.id);
            setWarehouseForm({ label: wh.label, description: wh.description, lieu: wh.lieu, statut: wh.statut });
        } else {
            setEditingWarehouseId(null);
            setWarehouseForm({ label: '', description: '', lieu: '', statut: '1' });
        }
        setIsWarehouseModalOpen(true);
    };

    const handleWarehouseSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!warehouseForm.label || !config) return;
        setIsSubmittingWarehouse(true);
        try {
            if (editingWarehouseId) {
                await DolibarrService.updateWarehouse(config, editingWarehouseId, warehouseForm);
                toast.success("Armazém atualizado com sucesso");
            } else {
                await DolibarrService.createWarehouse(config, warehouseForm);
                toast.success("Armazém criado com sucesso");
            }
            setIsWarehouseModalOpen(false);
            refreshData();
        } catch (e: any) {
            notifyError('Salvar armazém', e);
        } finally {
            setIsSubmittingWarehouse(false);
        }
    };

    const handleDeleteWarehouse = async (id: string) => {
        if (!config) return;
        if (!(await confirm({ message: "Excluir este armazém? Isso não pode ser desfeito.", danger: true, confirmText: 'Excluir' }))) return;
        try {
            await DolibarrService.deleteWarehouse(config, id);
            toast.success("Armazém excluído");
            refreshData();
        } catch (e: any) {
            notifyError('Excluir armazém', e);
        }
    };

    const handleTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!config) return;
        if (!transferForm.productId || !transferForm.sourceWarehouse || !transferForm.targetWarehouse) {
            toast.warning("Por favor selecione produto e armazéns");
            return;
        }

        setIsSubmitting(true);
        try {
            await DolibarrService.createStockTransfer(
                config,
                transferForm.productId,
                transferForm.sourceWarehouse,
                transferForm.targetWarehouse,
                transferForm.qty
            );
            toast.success("Transferência de estoque criada com sucesso");
            setIsTransferModalOpen(false);
            setTransferForm({ productId: '', sourceWarehouse: '', targetWarehouse: '', qty: 1 });
            refreshData();
        } catch (err: any) {
            notifyError('Transferência de estoque', err);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCorrection = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!config) return;
        if (!correctionForm.productId || !correctionForm.warehouseId) {
            toast.warning("Por favor selecione produto e armazém");
            return;
        }

        setIsSubmitting(true);
        try {
            const finalQty = correctionForm.type === 'add' ? correctionForm.qty : -correctionForm.qty;
            await DolibarrService.createStockCorrection(config, {
                product_id: correctionForm.productId,
                warehouse_id: correctionForm.warehouseId,
                qty: finalQty,
                label: correctionForm.label
            });
            toast.success("Estoque ajustado com sucesso");
            setIsCorrectionModalOpen(false);
            setCorrectionForm({ productId: '', warehouseId: '', qty: 1, type: 'add', label: 'Correção de Inventário' });
            refreshData();
        } catch (err: any) {
            notifyError('Ajuste de estoque', err);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!config) {
        return (
            <div className="flex items-center justify-center p-20 text-slate-400">
                <p>Carregando configurações...</p>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <Loader2 size={48} className="animate-spin mb-4 text-indigo-500" />
                <p>Carregando dados de estoque...</p>
            </div>
        )
    }

    // Drill-in: mostrar conteúdo do armazém selecionado
    if (selectedWarehouse) {
        return (
            <WarehouseContentPanel
                warehouse={selectedWarehouse}
                items={stockItems}
                isLoading={isLoadingStock}
                onBack={() => setSelectedWarehouse(null)}
                onNavigate={onNavigate}
            />
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Warehouse Modal */}
            {isWarehouseModalOpen && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <WarehouseIcon size={18} className="text-indigo-600" /> {editingWarehouseId ? 'Editar Armazém' : 'Novo Armazém'}
                            </h3>
                            <button onClick={() => setIsWarehouseModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleWarehouseSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rótulo</label>
                                <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={warehouseForm.label} onChange={e => setWarehouseForm({ ...warehouseForm, label: e.target.value })} placeholder="Armazém Principal" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Localização</label>
                                <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={warehouseForm.lieu || ''} onChange={e => setWarehouseForm({ ...warehouseForm, lieu: e.target.value })} placeholder="Cidade, Prédio..." />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                                <textarea className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-20 resize-none" value={warehouseForm.description || ''} onChange={e => setWarehouseForm({ ...warehouseForm, description: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                                <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={warehouseForm.statut} onChange={e => setWarehouseForm({ ...warehouseForm, statut: e.target.value as any })}>
                                    <option value="1">Ativo</option>
                                    <option value="0">Fechado</option>
                                </select>
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsWarehouseModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                                <button type="submit" disabled={isSubmittingWarehouse} className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2">
                                    {isSubmittingWarehouse ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Salvar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Transfer Modal */}
            {isTransferModalOpen && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <Truck size={18} className="text-indigo-600" /> Nova Transferência de Estoque
                            </h3>
                            <button onClick={() => setIsTransferModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleTransfer} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Produto</label>
                                <select
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={transferForm.productId}
                                    onChange={e => setTransferForm({ ...transferForm, productId: e.target.value })}
                                    required
                                >
                                    <option value="">Selecione o Produto...</option>
                                    {products.filter(p => p.type === '0').map(p => (
                                        <option key={p.id} value={p.id}>{p.label} ({p.ref})</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Origem</label>
                                    <select
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={transferForm.sourceWarehouse}
                                        onChange={e => setTransferForm({ ...transferForm, sourceWarehouse: e.target.value })}
                                        required
                                    >
                                        <option value="">De...</option>
                                        {warehouses.map(w => (
                                            <option key={w.id} value={w.id} disabled={w.id === transferForm.targetWarehouse}>{w.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Destino</label>
                                    <select
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={transferForm.targetWarehouse}
                                        onChange={e => setTransferForm({ ...transferForm, targetWarehouse: e.target.value })}
                                        required
                                    >
                                        <option value="">Para...</option>
                                        {warehouses.map(w => (
                                            <option key={w.id} value={w.id} disabled={w.id === transferForm.sourceWarehouse}>{w.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantidade</label>
                                <input
                                    type="number"
                                    min="1"
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={transferForm.qty}
                                    onChange={e => setTransferForm({ ...transferForm, qty: parseInt(e.target.value) })}
                                    required
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsTransferModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <ArrowRightLeft size={16} />} Transferir
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Correction Modal */}
            {isCorrectionModalOpen && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <Sliders size={18} className="text-orange-600" /> Correção de Estoque
                            </h3>
                            <button onClick={() => setIsCorrectionModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCorrection} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Produto</label>
                                <select
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={correctionForm.productId}
                                    onChange={e => setCorrectionForm({ ...correctionForm, productId: e.target.value })}
                                    required
                                >
                                    <option value="">Selecione o Produto...</option>
                                    {products.filter(p => p.type === '0').map(p => (
                                        <option key={p.id} value={p.id}>{p.label} ({p.ref})</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Armazém</label>
                                <select
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={correctionForm.warehouseId}
                                    onChange={e => setCorrectionForm({ ...correctionForm, warehouseId: e.target.value })}
                                    required
                                >
                                    <option value="">Selecione...</option>
                                    {warehouses.map(w => (
                                        <option key={w.id} value={w.id}>{w.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                                    <select
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={correctionForm.type}
                                        onChange={e => setCorrectionForm({ ...correctionForm, type: e.target.value })}
                                    >
                                        <option value="add">Adicionar (+)</option>
                                        <option value="remove">Remover (-)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantidade</label>
                                    <input
                                        type="number"
                                        min="1"
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={correctionForm.qty}
                                        onChange={e => setCorrectionForm({ ...correctionForm, qty: parseInt(e.target.value) })}
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Etiqueta/Motivo</label>
                                <input
                                    type="text"
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={correctionForm.label}
                                    onChange={e => setCorrectionForm({ ...correctionForm, label: e.target.value })}
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsCorrectionModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Ajustar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Estoque e Inventário</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie armazéns e movimentações</p>
                    </div>
                    <div className="flex items-center gap-2">
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

                        <button onClick={() => setIsTransferModalOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors">
                            <ArrowRightLeft size={18} /> Transferir
                        </button>
                        <button onClick={() => setIsCorrectionModalOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors">
                            <Sliders size={18} /> Ajustar
                        </button>
                        <button onClick={() => openWarehouseModal()} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors">
                            <Plus size={18} /> Armazém
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800">
                    <button
                        onClick={() => setActiveTab('warehouses')}
                        className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'warehouses' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        Armazéns
                    </button>
                    <button
                        onClick={() => setActiveTab('movements')}
                        className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'movements' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        Movimentações
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                {activeTab === 'warehouses' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredWarehouses.length === 0 ? (
                            <div className="col-span-full text-center py-20 text-slate-400">
                                <WarehouseIcon size={48} className="mx-auto mb-4 opacity-50" />
                                <p>Nenhum armazém encontrado.</p>
                            </div>
                        ) : (
                            filteredWarehouses.map(wh => (
                                <div
                                    key={wh.id}
                                    onClick={() => setSelectedWarehouse(wh)}
                                    className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all group cursor-pointer"
                                    data-testid={`warehouse-card-${wh.id}`}
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center gap-3">
                                            <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400">
                                                <WarehouseIcon size={24} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-800 dark:text-white text-lg">{wh.label}</h3>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${wh.statut === '1' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                                    {wh.statut === '1' ? 'Ativo' : 'Fechado'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={e => { e.stopPropagation(); openWarehouseModal(wh); }}
                                                className="p-2 text-slate-400 hover:text-indigo-600 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                                                data-testid={`edit-btn-${wh.id}`}
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                            <button
                                                onClick={e => { e.stopPropagation(); handleDeleteWarehouse(wh.id); }}
                                                className="p-2 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                                                data-testid={`delete-btn-${wh.id}`}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                    {wh.lieu && <div className="flex items-center gap-2 text-sm text-slate-500 mb-2"><MapPin size={14} /> {wh.lieu}</div>}
                                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{wh.description || "Sem descrição"}</p>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'movements' && (
                    <div className="space-y-3 max-w-4xl mx-auto">
                        {filteredMovements.length === 0 ? (
                            <div className="text-center py-20 text-slate-400">
                                <ArrowRightLeft size={48} className="mx-auto mb-4 opacity-50" />
                                <p>Nenhuma movimentação encontrada.</p>
                            </div>
                        ) : (
                            filteredMovements.map(mov => (
                                <div key={mov.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div
                                            onClick={() => onNavigate && onNavigate('products', mov.product_id)}
                                            className={`p-2 rounded-lg cursor-pointer hover:scale-110 transition-transform ${mov.qty > 0 ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}
                                        >
                                            <Package size={20} />
                                        </div>
                                        <div>
                                            <div
                                                className="font-bold text-slate-800 dark:text-white cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                                onClick={() => onNavigate && onNavigate('products', mov.product_id)}
                                            >
                                                {getProductName(mov.product_id)}
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                                                <span>{formatDateTime(mov.date_creation)}</span>
                                                <span>•</span>
                                                <span>{mov.label}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`text-lg font-bold ${mov.qty > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                            {mov.qty > 0 ? '+' : ''}{mov.qty}
                                        </div>
                                        <div className="text-xs text-slate-400 flex items-center gap-1 justify-end">
                                            <User size={10} /> {getUserName(mov.fk_user_author || '')}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default InventoryView;
