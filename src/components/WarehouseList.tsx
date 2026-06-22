/**
 * WarehouseList - Estoque por armazém (#125)
 *
 * Lista os armazéns (useWarehouses) e, ao selecionar um, mostra os produtos
 * com estoque naquele armazém (quantidade).
 *
 * O estoque por armazém vem do Dolibarr via GET /products/{id}?includestockdata=1
 * (campo stock_warehouse: { [warehouseId]: { real } }). Como esse dado é por
 * produto, ao selecionar um armazém buscamos o estoque dos produtos físicos
 * (type === '0' com stock_reel > 0) e filtramos os que têm quantidade no armazém.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Warehouse as WarehouseType, Product, AppView } from '../types';
import { Warehouse, Search, MapPin, Package, Loader2, Boxes, Phone, Info, Hash } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useWarehouses, useProducts } from '../hooks/dolibarr';
import { logger } from '../utils/logger';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';

// #125: nº máximo de consultas simultâneas de estoque ao Dolibarr (evita fan-out N+1).
const STOCK_FETCH_CONCURRENCY = 6;

import {
    PageHeader,
    MasterDetailLayout,
    Card,
    Input,
    EmptyState,
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

/** Row item for a warehouse in the master list */
const WarehouseRow: React.FC<{
    warehouse: WarehouseType;
    isSelected: boolean;
    onSelect: () => void;
}> = ({ warehouse, isSelected, onSelect }) => (
    <Card onClick={onSelect} selected={isSelected} hoverable padding="md" className="mb-2">
        <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
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
            </div>
        </div>
    </Card>
);

/** Detail panel: items (product + quantity) in the selected warehouse */
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
                    {/* Info block: status, description, address, phone, fax, extrafields */}
                    <Card padding="md">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Info size={14} className="text-slate-400 shrink-0" />
                                <span
                                    data-testid="warehouse-status"
                                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                                        warehouse.statut === '1'
                                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
                                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                    }`}
                                >
                                    {warehouse.statut === '1' ? 'Ativo' : 'Inativo'}
                                </span>
                            </div>
                            {warehouse.description && (
                                <p data-testid="warehouse-description" className="text-sm text-slate-600 dark:text-slate-300">
                                    {warehouse.description}
                                </p>
                            )}
                            {(warehouse.address || warehouse.zip || warehouse.town) && (
                                <p data-testid="warehouse-address" className="text-sm text-slate-500 flex items-center gap-1">
                                    <MapPin size={13} className="shrink-0" />
                                    {[warehouse.address, warehouse.zip && warehouse.town ? `${warehouse.zip} ${warehouse.town}` : (warehouse.zip || warehouse.town)].filter(Boolean).join(', ')}
                                </p>
                            )}
                            {warehouse.phone && (
                                <p data-testid="warehouse-phone" className="text-sm text-slate-500 flex items-center gap-1">
                                    <Phone size={13} className="shrink-0" />
                                    {warehouse.phone}
                                </p>
                            )}
                            {warehouse.fax && (
                                <p data-testid="warehouse-fax" className="text-sm text-slate-500 flex items-center gap-1">
                                    <Hash size={13} className="shrink-0" />
                                    {warehouse.fax}
                                </p>
                            )}
                            {warehouse.array_options && Object.entries(warehouse.array_options)
                                .filter(([, v]) => v !== null && v !== undefined && v !== '')
                                .map(([key, val]) => (
                                    <p key={key} data-testid={`extrafield-${key}`} className="text-sm text-slate-500 flex items-center gap-1">
                                        <Hash size={13} className="shrink-0" />
                                        <span className="font-medium">{key.replace('options_', '')}:</span> {String(val)}
                                    </p>
                                ))
                            }
                        </div>
                    </Card>

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

const WarehouseList: React.FC<WarehouseListProps> = ({ onNavigate, initialItemId }) => {
    const { config } = useDolibarr();
    const { data: warehouses = [], isLoading: isLoadingWarehouses } = useWarehouses(config || null, !!config);
    const { data: products = [] } = useProducts(config || null, !!config);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseType | null>(null);
    const [stockItems, setStockItems] = useState<WarehouseStockItem[]>([]);
    const [isLoadingStock, setIsLoadingStock] = useState(false);

    // Initial selection via route param
    useEffect(() => {
        if (initialItemId && warehouses.length > 0) {
            const found = warehouses.find(w => String(w.id) === String(initialItemId));
            if (found) setSelectedWarehouse(found);
        }
    }, [initialItemId, warehouses]);

    const filteredWarehouses = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return warehouses.filter(
            w =>
                (w.label || '').toLowerCase().includes(term) ||
                (w.lieu || '').toLowerCase().includes(term)
        );
    }, [warehouses, searchTerm]);

    // Fetch per-warehouse stock for the selected warehouse.
    // Dolibarr only exposes stock per product (GET /products/{id}?includestockdata=1),
    // so we only query physical products that have real stock to limit calls.
    const loadStock = useCallback(
        async (warehouse: WarehouseType) => {
            if (!config) return;
            setIsLoadingStock(true);
            setStockItems([]);
            try {
                const candidates = products.filter(p => p.type === '0' && (p.stock_reel || 0) > 0);
                // #125: limita a concorrência para não disparar centenas de chamadas simultâneas ao Dolibarr.
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

    if (!config) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400">
                <p>Carregando configurações...</p>
            </div>
        );
    }

    // IMPORTANTE: contêiner externo precisa ser `flex flex-col h-full` para o detalhe não quebrar.
    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
            <div className={selectedWarehouse ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title="Estoques"
                    subtitle="Armazéns e itens em estoque"
                    actions={
                        <Input
                            placeholder="Buscar armazém..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            icon={<Search size={16} />}
                            className="w-56"
                            fullWidth={false}
                        />
                    }
                />
            </div>

            <MasterDetailLayout
                showDetail={!!selectedWarehouse}
                onCloseDetail={() => setSelectedWarehouse(null)}
                listWidth="1/3"
                list={
                    isLoadingWarehouses && warehouses.length === 0 ? (
                        <div className="flex justify-center py-20">
                            <Loader2 className="animate-spin text-slate-400" size={32} />
                        </div>
                    ) : filteredWarehouses.length === 0 ? (
                        <EmptyState
                            icon={Warehouse}
                            title="Nenhum armazém encontrado"
                            description="Não há armazéns cadastrados ou que correspondam à busca."
                        />
                    ) : (
                        <div className="p-4">
                            {filteredWarehouses.map(w => (
                                <WarehouseRow
                                    key={w.id}
                                    warehouse={w}
                                    isSelected={selectedWarehouse?.id === w.id}
                                    onSelect={() => setSelectedWarehouse(w)}
                                />
                            ))}
                        </div>
                    )
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
        </div>
    );
};

export default WarehouseList;
