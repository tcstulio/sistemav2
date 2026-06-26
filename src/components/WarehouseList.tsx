/**
 * WarehouseList — Estoques unificados com hierarquia (#564)
 *
 * Unifica as antigas telas "Estoque" (/inventory → InventoryView) e
 * "Estoques" (/warehouses → WarehouseList) em uma única tela (#564).
 *
 * Hierarquia: exibe armazéns raiz (sem fk_parent) no nível inicial;
 * clicar num armazém-pai navega para os sub-estoques (drill-in hierárquico
 * com breadcrumb). Clicar num armazém-folha (sem filhos) exibe os itens
 * em estoque no painel de detalhe.
 *
 * Funcionalidades preservadas de InventoryView: CRUD de armazém, Transferência,
 * Correção/Ajuste e aba de Movimentações.
 *
 * O estoque por armazém vem do Dolibarr via GET /products/{id}?includestockdata=1
 * (campo stock_warehouse: { [warehouseId]: { real } }). Como esse dado é por
 * produto, ao selecionar um armazém buscamos o estoque dos produtos físicos
 * (type === '0' com stock_reel > 0) e filtramos os que têm quantidade no armazém.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Warehouse as WarehouseType, Product, AppView } from '../types';
import {
    Warehouse, Search, MapPin, Package, Loader2, Boxes, Phone, Home,
    ArrowRightLeft, Sliders, Plus, Edit2, Trash2, Save, Truck, User, ChevronRight,
} from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useWarehouses, useProducts, useStockMovements, useUsers } from '../hooks/dolibarr';
import { logger } from '../utils/logger';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';
import { notifyError } from '../utils/notifyError';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { formatDateTime } from '../utils/dateUtils';

// #125: nº máximo de consultas simultâneas de estoque ao Dolibarr (evita fan-out N+1).
const STOCK_FETCH_CONCURRENCY = 6;

/** Static map of themeColor → Tailwind tab-active classes (avoids interpolation; Tailwind v4 needs literal classes). */
const TAB_ACTIVE_CLASSES: Record<string, string> = {
    indigo: 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400',
    emerald: 'border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400',
    blue: 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400',
    rose: 'border-rose-600 text-rose-600 dark:border-rose-400 dark:text-rose-400',
    violet: 'border-violet-600 text-violet-600 dark:border-violet-400 dark:text-violet-400',
    amber: 'border-amber-600 text-amber-600 dark:border-amber-400 dark:text-amber-400',
    teal: 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400',
    orange: 'border-orange-600 text-orange-600 dark:border-orange-400 dark:text-orange-400',
    pink: 'border-pink-600 text-pink-600 dark:border-pink-400 dark:text-pink-400',
    sky: 'border-sky-600 text-sky-600 dark:border-sky-400 dark:text-sky-400',
};
const TAB_INACTIVE_CLASSES = 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200';

import {
    PageHeader,
    MasterDetailLayout,
    Card,
    Input,
    EmptyState,
    Modal,
} from './ui';

const log = logger.child('WarehouseList');

interface WarehouseStockItem {
    product: Product;
    qty: number;
}

interface WarehouseListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
}

// ---------------------------------------------------------------------------
// Row: single warehouse item in the master list
// Uses a div (not button) to avoid nested button HTML violation since
// the row contains action buttons (edit / delete / sub-estoques).
// ---------------------------------------------------------------------------
const WarehouseRow: React.FC<{
    warehouse: WarehouseType;
    isSelected: boolean;
    hasChildren: boolean;
    onSelect: () => void;
    onEdit: (e: React.MouseEvent) => void;
    onDelete: (e: React.MouseEvent) => void;
    onEnterChildren: (e: React.MouseEvent) => void;
}> = ({ warehouse, isSelected, hasChildren, onSelect, onEdit, onDelete, onEnterChildren }) => {
    const { canDo } = useDolibarr();
    return (
    <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={e => e.key === 'Enter' && onSelect()}
        data-testid={`warehouse-row-${warehouse.id}`}
        className={`
            mb-2 rounded-xl border cursor-pointer transition-all
            bg-white dark:bg-slate-900
            ${isSelected
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-slate-200 dark:border-slate-800 hover:shadow-md'
            }
        `.trim().replace(/\s+/g, ' ')}
    >
        <div className="p-4 flex items-start gap-4">
            <div className="p-3 rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300 shrink-0">
                <Warehouse size={20} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start gap-2">
                    <h4 className="font-bold text-slate-800 dark:text-white text-sm truncate">{warehouse.label}</h4>
                    <span
                        className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
                            warehouse.statut === '1'
                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                    >
                        {warehouse.statut === '1' ? 'Ativo' : 'Inativo'}
                    </span>
                </div>
                {warehouse.lieu && (
                    <span className="text-xs text-slate-400 flex items-center gap-1 mt-1 truncate">
                        <MapPin size={12} /> {warehouse.lieu}
                    </span>
                )}
                {warehouse.description && (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{warehouse.description}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                    {/* Edit / Delete actions */}
                    {canDo('edit', 'warehouses') && (
                        <button
                            onClick={onEdit}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                            data-testid={`edit-btn-${warehouse.id}`}
                            title="Editar armazém"
                        >
                            <Edit2 size={14} />
                        </button>
                    )}
                    {canDo('delete', 'warehouses') && (
                        <button
                            onClick={onDelete}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            data-testid={`delete-btn-${warehouse.id}`}
                            title="Excluir armazém"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                    {/* Navigate into children */}
                    {hasChildren && (
                        <button
                            onClick={onEnterChildren}
                            className="ml-auto flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                            data-testid={`enter-children-${warehouse.id}`}
                            title="Ver sub-estoques"
                        >
                            Sub-estoques <ChevronRight size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    </div>
    );
};

// ---------------------------------------------------------------------------
// Detail panel: items (product + quantity) in the selected warehouse
// ---------------------------------------------------------------------------
const WarehouseDetail: React.FC<{
    warehouse: WarehouseType;
    items: WarehouseStockItem[];
    isLoading: boolean;
    onClose: () => void;
    onNavigate?: (view: AppView, id: string) => void;
}> = ({ warehouse, items, isLoading, onClose, onNavigate }) => {
    const totalQty = items.reduce((sum, it) => sum + it.qty, 0);

    return (
        <>
            <PageHeader
                title={warehouse.label}
                subtitle={warehouse.lieu || 'Itens em estoque'}
                onBack={onClose}
            />

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                <div className="max-w-3xl mx-auto space-y-6">
                    {/* Summary */}
                    <div className="grid grid-cols-2 gap-4">
                        <Card padding="md">
                            <span className="text-xs text-slate-500 uppercase font-bold">Itens com estoque</span>
                            <div className="font-bold text-2xl dark:text-white mt-1">{items.length}</div>
                        </Card>
                        <Card padding="md">
                            <span className="text-xs text-slate-500 uppercase font-bold">Quantidade total</span>
                            <div className="font-bold text-2xl dark:text-white mt-1">{totalQty.toLocaleString()}</div>
                        </Card>
                    </div>

                    {/* Warehouse Info */}
                    {(warehouse.description || warehouse.address || warehouse.zip || warehouse.town || warehouse.phone || warehouse.fax || (warehouse.array_options && Object.values(warehouse.array_options).some(v => v !== '' && v !== null && v !== undefined))) && (
                        <Card padding="lg" data-testid="warehouse-info">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <Warehouse size={18} /> Informações do Armazém
                            </h3>
                            <div className="space-y-3 text-sm">
                                {/* Status */}
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500 dark:text-slate-400 w-24 shrink-0">Status</span>
                                    <span
                                        className={`text-xs px-2 py-1 rounded-full font-medium ${
                                            warehouse.statut === '1'
                                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
                                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                        }`}
                                        data-testid="warehouse-status"
                                    >
                                        {warehouse.statut === '1' ? 'Ativo' : 'Inativo'}
                                    </span>
                                </div>
                                {/* Description */}
                                {warehouse.description && (
                                    <div className="flex items-start gap-2" data-testid="warehouse-description">
                                        <span className="text-slate-500 dark:text-slate-400 w-24 shrink-0">Descrição</span>
                                        <span className="text-slate-700 dark:text-slate-300">{warehouse.description}</span>
                                    </div>
                                )}
                                {/* Address */}
                                {(warehouse.address || warehouse.zip || warehouse.town) && (
                                    <div className="flex items-start gap-2" data-testid="warehouse-address">
                                        <Home size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                        <span className="text-slate-700 dark:text-slate-300">
                                            {[warehouse.address, warehouse.zip && warehouse.town ? `${warehouse.zip} ${warehouse.town}` : (warehouse.zip || warehouse.town)].filter(Boolean).join(', ')}
                                        </span>
                                    </div>
                                )}
                                {/* Phone */}
                                {warehouse.phone && (
                                    <div className="flex items-center gap-2" data-testid="warehouse-phone">
                                        <Phone size={14} className="text-slate-400 shrink-0" />
                                        <span className="text-slate-700 dark:text-slate-300">{warehouse.phone}</span>
                                    </div>
                                )}
                                {/* Fax */}
                                {warehouse.fax && (
                                    <div className="flex items-center gap-2" data-testid="warehouse-fax">
                                        <span className="text-slate-500 dark:text-slate-400 w-24 shrink-0">Fax</span>
                                        <span className="text-slate-700 dark:text-slate-300">{warehouse.fax}</span>
                                    </div>
                                )}
                                {/* Extrafields */}
                                {warehouse.array_options && Object.entries(warehouse.array_options)
                                    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
                                    .map(([key, value]) => (
                                        <div key={key} className="flex items-start gap-2" data-testid={`extrafield-${key}`}>
                                            <span className="text-slate-500 dark:text-slate-400 w-24 shrink-0 capitalize">{key.replace(/^options_/, '').replace(/_/g, ' ')}</span>
                                            <span className="text-slate-700 dark:text-slate-300">{String(value)}</span>
                                        </div>
                                    ))
                                }
                            </div>
                        </Card>
                    )}

                    {/* Items */}
                    <Card padding="lg">
                        <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Boxes size={18} /> Itens neste armazém
                        </h3>

                        {isLoading ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="animate-spin text-slate-400" size={28} />
                            </div>
                        ) : items.length === 0 ? (
                            <EmptyState
                                icon={Package}
                                title="Nenhum item em estoque"
                                description="Este armazém não possui produtos com quantidade registrada."
                                size="sm"
                            />
                        ) : (
                            <div className="space-y-2">
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
                    </Card>
                </div>
            </div>
        </>
    );
};

// ---------------------------------------------------------------------------
// Breadcrumb strip for warehouse hierarchy navigation
// ---------------------------------------------------------------------------
const HierarchyBreadcrumb: React.FC<{
    path: WarehouseType[];
    onNavigateTo: (index: number) => void;
}> = ({ path, onNavigateTo }) => {
    if (path.length === 0) return null;
    return (
        <div className="flex items-center gap-1 flex-wrap px-4 pt-2 pb-1 text-sm" data-testid="hierarchy-breadcrumb">
            <button
                onClick={() => onNavigateTo(-1)}
                className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                data-testid="breadcrumb-root"
            >
                Raiz
            </button>
            {path.map((wh, i) => (
                <React.Fragment key={wh.id}>
                    <ChevronRight size={14} className="text-slate-400 shrink-0" />
                    <button
                        onClick={() => onNavigateTo(i)}
                        className={`hover:underline font-medium ${i === path.length - 1 ? 'text-slate-700 dark:text-slate-300' : 'text-indigo-600 dark:text-indigo-400'}`}
                        data-testid={`breadcrumb-${wh.id}`}
                    >
                        {wh.label}
                    </button>
                </React.Fragment>
            ))}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const WarehouseList: React.FC<WarehouseListProps> = ({ onNavigate, initialItemId }) => {
    const { config, refreshData, canDo } = useDolibarr();
    const { data: warehouses = [], isLoading: isLoadingWarehouses } = useWarehouses(config || null, !!config);
    const { data: products = [] } = useProducts(config || null, !!config);
    const { data: stockMovements = [], isLoading: isLoadingMovements } = useStockMovements(config || null, !!config);
    const { data: users = [] } = useUsers(config || null, !!config);

    const confirm = useConfirm();

    // Active tab: 'warehouses' | 'movements'
    const [activeTab, setActiveTab] = useState<'warehouses' | 'movements'>('warehouses');

    const [searchTerm, setSearchTerm] = useState('');

    // Hierarchy navigation path: array of warehouses we've drilled into
    const [hierarchyPath, setHierarchyPath] = useState<WarehouseType[]>([]);

    // Currently selected warehouse (for detail panel)
    const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseType | null>(null);
    const [stockItems, setStockItems] = useState<WarehouseStockItem[]>([]);
    const [isLoadingStock, setIsLoadingStock] = useState(false);

    // CRUD / modal state
    const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
    const [warehouseForm, setWarehouseForm] = useState<Partial<WarehouseType>>({ label: '', description: '', lieu: '', statut: '1' });
    const [isSubmittingWarehouse, setIsSubmittingWarehouse] = useState(false);
    const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);

    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [transferForm, setTransferForm] = useState({ productId: '', sourceWarehouse: '', targetWarehouse: '', qty: 1 });

    const [isCorrectionModalOpen, setIsCorrectionModalOpen] = useState(false);
    const [correctionForm, setCorrectionForm] = useState({ productId: '', warehouseId: '', qty: 1, type: 'add', label: 'Correção de Inventário' });

    const [isSubmitting, setIsSubmitting] = useState(false);

    // Initial selection via route param
    useEffect(() => {
        if (initialItemId && warehouses.length > 0) {
            const found = warehouses.find(w => String(w.id) === String(initialItemId));
            if (found) setSelectedWarehouse(found);
        }
    }, [initialItemId, warehouses]);

    // Compute children map for hierarchy
    const childrenMap = useMemo(() => {
        const map = new Map<string, WarehouseType[]>();
        for (const w of warehouses) {
            if (w.fk_parent) {
                const list = map.get(w.fk_parent) ?? [];
                list.push(w);
                map.set(w.fk_parent, list);
            }
        }
        return map;
    }, [warehouses]);

    // Warehouses visible at the current hierarchy level
    const currentLevelWarehouses = useMemo(() => {
        if (hierarchyPath.length === 0) {
            // Root: warehouses with no parent
            return warehouses.filter(w => !w.fk_parent);
        }
        const parentId = hierarchyPath[hierarchyPath.length - 1].id;
        return childrenMap.get(parentId) ?? [];
    }, [warehouses, hierarchyPath, childrenMap]);

    const filteredWarehouses = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return currentLevelWarehouses.filter(
            w =>
                (w.label || '').toLowerCase().includes(term) ||
                (w.lieu || '').toLowerCase().includes(term)
        );
    }, [currentLevelWarehouses, searchTerm]);

    const filteredMovements = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return stockMovements.filter(m =>
            (m.label?.toLowerCase().includes(term)) ||
            (products.find(p => String(p.id) === String(m.product_id))?.label || '').toLowerCase().includes(term)
        );
    }, [stockMovements, searchTerm, products]);

    // Fetch stock for selected warehouse
    const loadStock = useCallback(
        async (warehouse: WarehouseType) => {
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

    // Helpers
    const getProductName = (id: string) => {
        const p = products.find(prod => String(prod.id) === String(id));
        return p ? p.label : `Produto #${id}`;
    };
    const getUserName = (id: string) => {
        const u = users.find(user => String(user.id) === String(id));
        return u ? u.login : 'Sistema';
    };

    // Warehouse modal helpers
    const openWarehouseModal = (wh?: WarehouseType) => {
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
                toast.success('Armazém atualizado com sucesso');
            } else {
                await DolibarrService.createWarehouse(config, warehouseForm);
                toast.success('Armazém criado com sucesso');
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
        if (!(await confirm({ message: 'Excluir este armazém? Isso não pode ser desfeito.', danger: true, confirmText: 'Excluir' }))) return;
        try {
            await DolibarrService.deleteWarehouse(config, id);
            toast.success('Armazém excluído');
            if (selectedWarehouse?.id === id) setSelectedWarehouse(null);
            refreshData();
        } catch (e: any) {
            notifyError('Excluir armazém', e);
        }
    };

    const handleTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!config) return;
        if (!transferForm.productId || !transferForm.sourceWarehouse || !transferForm.targetWarehouse) {
            toast.warning('Por favor selecione produto e armazéns');
            return;
        }
        if (!(transferForm.qty > 0)) {
            toast.warning('A quantidade deve ser maior que zero');
            return;
        }
        setIsSubmitting(true);
        try {
            await DolibarrService.createStockTransfer(config, transferForm.productId, transferForm.sourceWarehouse, transferForm.targetWarehouse, transferForm.qty);
            toast.success('Transferência de estoque criada com sucesso');
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
            toast.warning('Por favor selecione produto e armazém');
            return;
        }
        if (!(correctionForm.qty > 0)) {
            toast.warning('A quantidade deve ser maior que zero');
            return;
        }
        setIsSubmitting(true);
        try {
            const finalQty = correctionForm.type === 'add' ? correctionForm.qty : -correctionForm.qty;
            await DolibarrService.createStockCorrection(config, {
                product_id: correctionForm.productId,
                warehouse_id: correctionForm.warehouseId,
                qty: finalQty,
                label: correctionForm.label,
            });
            toast.success('Estoque ajustado com sucesso');
            setIsCorrectionModalOpen(false);
            setCorrectionForm({ productId: '', warehouseId: '', qty: 1, type: 'add', label: 'Correção de Inventário' });
            refreshData();
        } catch (err: any) {
            notifyError('Ajuste de estoque', err);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Hierarchy navigation
    const enterWarehouseChildren = (warehouse: WarehouseType) => {
        setHierarchyPath(prev => [...prev, warehouse]);
        setSelectedWarehouse(null);
        setSearchTerm('');
    };

    const navigateToBreadcrumb = (index: number) => {
        // index === -1 → back to root
        setHierarchyPath(index < 0 ? [] : hierarchyPath.slice(0, index + 1));
        setSelectedWarehouse(null);
        setSearchTerm('');
    };

    if (!config) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400">
                <p>Carregando configurações...</p>
            </div>
        );
    }

    const activeTabClasses = TAB_ACTIVE_CLASSES[config.themeColor] ?? TAB_ACTIVE_CLASSES['indigo'];

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">

            {/* ----------------------------------------------------------------- */}
            {/* Warehouse Modal (create / edit) */}
            {/* ----------------------------------------------------------------- */}
            <Modal
                isOpen={isWarehouseModalOpen}
                onClose={() => setIsWarehouseModalOpen(false)}
                title={
                    <span className="flex items-center gap-2">
                        <Warehouse size={18} className="text-indigo-600" />
                        {editingWarehouseId ? 'Editar Armazém' : 'Novo Armazém'}
                    </span>
                }
                size="md"
                footer={
                    <>
                        <button type="button" onClick={() => setIsWarehouseModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                        <button form="warehouse-form" type="submit" disabled={isSubmittingWarehouse} className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2">
                            {isSubmittingWarehouse ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Salvar
                        </button>
                    </>
                }
            >
                <form id="warehouse-form" onSubmit={handleWarehouseSubmit} className="space-y-4">
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
                </form>
            </Modal>

            {/* ----------------------------------------------------------------- */}
            {/* Transfer Modal */}
            {/* ----------------------------------------------------------------- */}
            <Modal
                isOpen={isTransferModalOpen}
                onClose={() => setIsTransferModalOpen(false)}
                title={
                    <span className="flex items-center gap-2">
                        <Truck size={18} className="text-indigo-600" /> Nova Transferência de Estoque
                    </span>
                }
                size="md"
                footer={
                    <>
                        <button type="button" onClick={() => setIsTransferModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                        <button form="transfer-form" type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                            {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <ArrowRightLeft size={16} />} Transferir
                        </button>
                    </>
                }
            >
                <form id="transfer-form" onSubmit={handleTransfer} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Produto</label>
                        <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={transferForm.productId} onChange={e => setTransferForm({ ...transferForm, productId: e.target.value })} required>
                            <option value="">Selecione o Produto...</option>
                            {products.filter(p => p.type === '0').map(p => (
                                <option key={p.id} value={p.id}>{p.label} ({p.ref})</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Origem</label>
                            <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={transferForm.sourceWarehouse} onChange={e => setTransferForm({ ...transferForm, sourceWarehouse: e.target.value })} required>
                                <option value="">De...</option>
                                {warehouses.map(w => <option key={w.id} value={w.id} disabled={w.id === transferForm.targetWarehouse}>{w.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Destino</label>
                            <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={transferForm.targetWarehouse} onChange={e => setTransferForm({ ...transferForm, targetWarehouse: e.target.value })} required>
                                <option value="">Para...</option>
                                {warehouses.map(w => <option key={w.id} value={w.id} disabled={w.id === transferForm.sourceWarehouse}>{w.label}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantidade</label>
                        <input type="number" min="1" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={transferForm.qty} onChange={e => setTransferForm({ ...transferForm, qty: parseInt(e.target.value) })} required />
                    </div>
                </form>
            </Modal>

            {/* ----------------------------------------------------------------- */}
            {/* Correction Modal */}
            {/* ----------------------------------------------------------------- */}
            <Modal
                isOpen={isCorrectionModalOpen}
                onClose={() => setIsCorrectionModalOpen(false)}
                title={
                    <span className="flex items-center gap-2">
                        <Sliders size={18} className="text-orange-600" /> Correção de Estoque
                    </span>
                }
                size="md"
                footer={
                    <>
                        <button type="button" onClick={() => setIsCorrectionModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                        <button form="correction-form" type="submit" disabled={isSubmitting} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                            {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Ajustar
                        </button>
                    </>
                }
            >
                <form id="correction-form" onSubmit={handleCorrection} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Produto</label>
                        <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={correctionForm.productId} onChange={e => setCorrectionForm({ ...correctionForm, productId: e.target.value })} required>
                            <option value="">Selecione o Produto...</option>
                            {products.filter(p => p.type === '0').map(p => <option key={p.id} value={p.id}>{p.label} ({p.ref})</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Armazém</label>
                        <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={correctionForm.warehouseId} onChange={e => setCorrectionForm({ ...correctionForm, warehouseId: e.target.value })} required>
                            <option value="">Selecione...</option>
                            {warehouses.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                            <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={correctionForm.type} onChange={e => setCorrectionForm({ ...correctionForm, type: e.target.value })}>
                                <option value="add">Adicionar (+)</option>
                                <option value="remove">Remover (-)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantidade</label>
                            <input type="number" min="1" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={correctionForm.qty} onChange={e => setCorrectionForm({ ...correctionForm, qty: parseInt(e.target.value) })} required />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Etiqueta/Motivo</label>
                        <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={correctionForm.label} onChange={e => setCorrectionForm({ ...correctionForm, label: e.target.value })} />
                    </div>
                </form>
            </Modal>

            {/* ----------------------------------------------------------------- */}
            {/* Header (hidden when detail panel open on mobile) */}
            {/* ----------------------------------------------------------------- */}
            <div className={selectedWarehouse ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title="Estoques"
                    subtitle="Armazéns, sub-estoques e movimentações"
                    actions={
                        <>
                            <Input
                                placeholder="Buscar armazém..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                icon={<Search size={16} />}
                                className="w-52"
                                fullWidth={false}
                            />
                            {canDo('edit', 'warehouses') && (
                                <button onClick={() => setIsTransferModalOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors" data-testid="btn-transfer">
                                    <ArrowRightLeft size={16} /> Transferir
                                </button>
                            )}
                            {canDo('edit', 'warehouses') && (
                                <button onClick={() => setIsCorrectionModalOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors" data-testid="btn-adjust">
                                    <Sliders size={16} /> Ajustar
                                </button>
                            )}
                            {canDo('create', 'warehouses') && (
                                <button onClick={() => openWarehouseModal()} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors" data-testid="btn-new-warehouse">
                                    <Plus size={16} /> Armazém
                                </button>
                            )}
                        </>
                    }
                    tabs={
                        <div className="flex gap-2">
                            <button
                                onClick={() => setActiveTab('warehouses')}
                                className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'warehouses' ? activeTabClasses : TAB_INACTIVE_CLASSES}`}
                                data-testid="tab-warehouses"
                            >
                                Armazéns
                            </button>
                            <button
                                onClick={() => setActiveTab('movements')}
                                className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'movements' ? activeTabClasses : TAB_INACTIVE_CLASSES}`}
                                data-testid="tab-movements"
                            >
                                Movimentações
                            </button>
                        </div>
                    }
                />
            </div>

            {/* ----------------------------------------------------------------- */}
            {/* Tab: Movimentações */}
            {/* ----------------------------------------------------------------- */}
            {activeTab === 'movements' && (
                <div className="flex-1 overflow-y-auto p-4 md:p-6">
                    <div className="space-y-3 max-w-4xl mx-auto">
                        {isLoadingMovements ? (
                            <div className="flex justify-center py-20">
                                <Loader2 className="animate-spin text-slate-400" size={32} />
                            </div>
                        ) : filteredMovements.length === 0 ? (
                            <div className="text-center py-20 text-slate-400">
                                <ArrowRightLeft size={48} className="mx-auto mb-4 opacity-50" />
                                <p>Nenhuma movimentação encontrada.</p>
                            </div>
                        ) : (
                            filteredMovements.map(mov => (
                                <div key={mov.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div
                                            onClick={() => onNavigate?.('products', mov.product_id)}
                                            className={`p-2 rounded-lg cursor-pointer hover:scale-110 transition-transform ${mov.qty > 0 ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}
                                        >
                                            <Package size={20} />
                                        </div>
                                        <div>
                                            <div
                                                className="font-bold text-slate-800 dark:text-white cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                                onClick={() => onNavigate?.('products', mov.product_id)}
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
                </div>
            )}

            {/* ----------------------------------------------------------------- */}
            {/* Tab: Armazéns (hierarchy + master-detail) */}
            {/* ----------------------------------------------------------------- */}
            {activeTab === 'warehouses' && (
                <MasterDetailLayout
                    showDetail={!!selectedWarehouse}
                    onCloseDetail={() => setSelectedWarehouse(null)}
                    listWidth="1/3"
                    list={
                        <div className="flex flex-col h-full">
                            {/* Breadcrumb navigation */}
                            <HierarchyBreadcrumb path={hierarchyPath} onNavigateTo={navigateToBreadcrumb} />

                            <div className="flex-1 overflow-y-auto p-4">
                                {isLoadingWarehouses && warehouses.length === 0 ? (
                                    <div className="flex justify-center py-20">
                                        <Loader2 className="animate-spin text-slate-400" size={32} />
                                    </div>
                                ) : filteredWarehouses.length === 0 ? (
                                    <EmptyState
                                        icon={Warehouse}
                                        title="Nenhum armazém encontrado"
                                        description={hierarchyPath.length > 0 ? 'Este armazém não possui sub-estoques.' : 'Não há armazéns cadastrados ou que correspondam à busca.'}
                                    />
                                ) : (
                                    filteredWarehouses.map(w => (
                                        <WarehouseRow
                                            key={w.id}
                                            warehouse={w}
                                            isSelected={selectedWarehouse?.id === w.id}
                                            hasChildren={!!(childrenMap.get(w.id)?.length)}
                                            onSelect={() => setSelectedWarehouse(w)}
                                            onEdit={e => { e.stopPropagation(); openWarehouseModal(w); }}
                                            onDelete={e => { e.stopPropagation(); handleDeleteWarehouse(w.id); }}
                                            onEnterChildren={e => { e.stopPropagation(); enterWarehouseChildren(w); }}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    }
                    detail={
                        selectedWarehouse && (
                            <WarehouseDetail
                                warehouse={selectedWarehouse}
                                items={stockItems}
                                isLoading={isLoadingStock}
                                onClose={() => setSelectedWarehouse(null)}
                                onNavigate={onNavigate}
                            />
                        )
                    }
                />
            )}
        </div>
    );
};

export default WarehouseList;
