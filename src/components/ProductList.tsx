
import React, { useState, useMemo } from 'react';
import { Product, DolibarrConfig, Category, AppView, BOM, SupplierOrder, ThirdParty } from '../types';
import { Package, Search, Box, Briefcase, AlertCircle, CheckCircle2, Warehouse, X, Plus, Loader2, CheckCircle, Tag, ArrowLeft, Truck, ShoppingCart } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useDolibarr } from '../context/DolibarrContext';
import { useProducts, useCategories, useBOMs, useSupplierOrders, useSuppliers } from '../hooks/dolibarr';

interface ProductListProps {
    onRefresh?: () => void;
    onNavigate?: (view: AppView, id: string) => void;
}

const ProductList: React.FC<ProductListProps> = ({ onRefresh, onNavigate }) => {
    const { config } = useDolibarr();
    const { data: productsData } = useProducts(config);
    const products = productsData || [];
    const { data: categoriesData } = useCategories(config);
    const categories = categoriesData || [];
    const { data: bomsData } = useBOMs(config);
    const boms = bomsData || [];
    const { data: supplierOrdersData } = useSupplierOrders(config);
    const supplierOrders = supplierOrdersData || [];
    const { data: suppliersData } = useSuppliers(config);
    const suppliers = suppliersData || [];

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'product' | 'service'>('all');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'stock' | 'manufacturing' | 'suppliers'>('overview');

    // Creation State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newProductForm, setNewProductForm] = useState<Partial<Product>>({ type: '0', price: 0 });
    const [isCreating, setIsCreating] = useState(false);

    // Restock State
    const [isRestockModalOpen, setIsRestockModalOpen] = useState(false);
    const [restockForm, setRestockForm] = useState({ supplierId: '', qty: 1, date_livraison: '' });
    const [isRestocking, setIsRestocking] = useState(false);

    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            const matchesSearch =
                p.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.label.toLowerCase().includes(searchTerm.toLowerCase());

            let matchesType = true;
            if (filterType === 'product') matchesType = p.type === '0';
            if (filterType === 'service') matchesType = p.type === '1';

            // Category Filtering Logic
            let matchesCategory = true;
            if (selectedCategory !== 'all') {
                if (p.array_options && p.array_options.category) {
                    matchesCategory = p.array_options.category === selectedCategory;
                } else {
                    matchesCategory = true;
                }
            }

            return matchesSearch && matchesType && matchesCategory;
        });
    }, [products, searchTerm, filterType, selectedCategory]);

    const productBOMs = useMemo(() => {
        if (!selectedProduct) return [];
        return boms.filter(b => String(b.product_id) === String(selectedProduct.id));
    }, [selectedProduct, boms]);

    const productSuppliers = useMemo(() => {
        if (!selectedProduct) return [];
        return suppliers;
    }, [selectedProduct, suppliers]);

    const handleCreateProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProductForm.ref || !newProductForm.label) return;
        setIsCreating(true);
        try {
            await DolibarrService.createProduct(config, newProductForm);
            alert("Produto criado com sucesso");
            setIsCreateModalOpen(false);
            setNewProductForm({ type: '0', price: 0 });
            if (onRefresh) onRefresh();
        } catch (e: any) {
            console.error(e);
            alert(`Falha ao criar produto: ${e.message}`);
        } finally {
            setIsCreating(false);
        }
    };

    const openRestockModal = (supplierId: string) => {
        setRestockForm({ supplierId, qty: 10, date_livraison: new Date().toISOString().split('T')[0] });
        setIsRestockModalOpen(true);
    };

    const handleRestock = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct || !restockForm.supplierId) return;
        setIsRestocking(true);
        try {
            const payload = {
                socid: restockForm.supplierId,
                date_creation: Date.now() / 1000,
                date_livraison: new Date(restockForm.date_livraison).getTime() / 1000,
                lines: [
                    { fk_product: selectedProduct.id, qty: restockForm.qty, subprice: selectedProduct.price }
                ],
                note_public: "Restock via App"
            };

            await DolibarrService.createSupplierOrder(config, payload);
            alert("Pedido de Compra Criado com Sucesso!");
            setIsRestockModalOpen(false);
            if (onNavigate) onNavigate('suppliers', restockForm.supplierId);
        } catch (e: any) {
            console.error(e);
            alert(`Falha ao criar PO: ${e.message}`);
        } finally {
            setIsRestocking(false);
        }
    };

    const getStockBadge = (product: Product) => {
        if (product.type === '1') {
            return <span className="text-xs text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-full font-medium">Serviço</span>;
        }

        const stock = product.stock_reel || 0;
        if (stock <= 0) {
            return (
                <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded-full font-medium">
                    <AlertCircle size={12} /> Sem Estoque ({stock})
                </span>
            );
        }
        if (stock < 5) {
            return (
                <span className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/30 px-2 py-1 rounded-full font-medium">
                    <AlertCircle size={12} /> Estoque Baixo ({stock})
                </span>
            );
        }
        return (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-full font-medium">
                <CheckCircle2 size={12} /> Em Estoque ({stock})
            </span>
        );
    };

    const getPlaceholderColor = (id: string) => {
        const colors = [
            'bg-blue-100 text-blue-400 dark:bg-blue-900/40 dark:text-blue-300',
            'bg-indigo-100 text-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-300',
            'bg-emerald-100 text-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-300',
            'bg-violet-100 text-violet-400 dark:bg-violet-900/40 dark:text-violet-300',
        ];
        return colors[parseInt(id) % colors.length] || colors[0];
    };

    // Virtualized Row Component
    const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
        const product = filteredProducts[index];
        // Adjust style for spacing
        const itemStyle = {
            ...style,
            top: (parseFloat(style.top as string) + 8) + 'px',
            height: (parseFloat(style.height as string) - 8) + 'px',
            left: '8px',
            width: 'calc(100% - 16px)'
        };

        return (
            <div
                style={itemStyle}
                onClick={() => { setSelectedProduct(product); setActiveTab('overview'); }}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedProduct?.id === product.id ? `border-${config.themeColor}-500 bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'}`}
            >
                <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${getPlaceholderColor(product.id)}`}>
                        {product.type === '1' ? <Briefcase size={20} /> : <Box size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                            <div className="min-w-0 pr-2">
                                <h4 className="font-bold text-slate-800 dark:text-white text-sm truncate">{product.label}</h4>
                                <span className="text-xs text-slate-400 font-mono block truncate">{product.ref}</span>
                            </div>
                            <div className="shrink-0">
                                {getStockBadge(product)}
                            </div>
                        </div>
                        <div className="mt-2 font-bold text-slate-900 dark:text-white">${product.price.toLocaleString()}</div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Restock Modal */}
            {isRestockModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <ShoppingCart size={18} className="text-orange-600" /> Repor Produto
                            </h3>
                            <button onClick={() => setIsRestockModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleRestock} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Produto</label>
                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300 font-medium">{selectedProduct?.label}</div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Qtd a Pedir</label>
                                <input type="number" min="1" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={restockForm.qty} onChange={e => setRestockForm({ ...restockForm, qty: parseInt(e.target.value) })} required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Entrega Esperada</label>
                                <input type="date" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={restockForm.date_livraison} onChange={e => setRestockForm({ ...restockForm, date_livraison: e.target.value })} required />
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsRestockModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isRestocking} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isRestocking ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} Criar Pedido
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Create Product Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <Package size={18} className="text-indigo-600" /> Novo Produto
                            </h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreateProduct} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Ref</label>
                                <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={newProductForm.ref || ''} onChange={e => setNewProductForm({ ...newProductForm, ref: e.target.value })} placeholder="PRD-001" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rótulo</label>
                                <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={newProductForm.label || ''} onChange={e => setNewProductForm({ ...newProductForm, label: e.target.value })} placeholder="Nome do Produto" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                                    <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newProductForm.type} onChange={e => setNewProductForm({ ...newProductForm, type: e.target.value as any })}>
                                        <option value="0">Produto</option>
                                        <option value="1">Serviço</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Preço</label>
                                    <input type="number" step="0.01" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newProductForm.price} onChange={e => setNewProductForm({ ...newProductForm, price: parseFloat(e.target.value) })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                                <textarea className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-20 resize-none" value={newProductForm.description || ''} onChange={e => setNewProductForm({ ...newProductForm, description: e.target.value })} />
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isCreating} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isCreating ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} Criar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${selectedProduct ? 'hidden lg:block' : 'block'}`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Produtos & Serviços</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie seu catálogo e estoque</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar ref ou nome..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className={`pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-${config.themeColor}-500 focus:border-${config.themeColor}-500 outline-none w-full md:w-64 text-sm transition-all`}
                            />
                        </div>

                        {categories.length > 0 && (
                            <div className="relative group">
                                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    className="pl-9 pr-8 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg outline-none text-sm appearance-none cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
                                >
                                    <option value="all">Todas Tags</option>
                                    {categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <button
                            onClick={() => setIsCreateModalOpen(true)}
                            className={`flex items-center gap-1.5 px-3 py-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                        >
                            <Plus size={18} /> Novo
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800">
                    <button
                        onClick={() => setFilterType('all')}
                        className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 ${filterType === 'all' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        Todos
                    </button>
                    <button
                        onClick={() => setFilterType('product')}
                        className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 ${filterType === 'product' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        Produtos
                    </button>
                    <button
                        onClick={() => setFilterType('service')}
                        className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 ${filterType === 'service' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        Serviços
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">

                {/* List - Virtualized */}
                <div className={`flex-1 p-0 ${selectedProduct ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {filteredProducts.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <Package size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Nenhum produto encontrado com seus critérios.</p>
                        </div>
                    ) : (
                        <AutoSizer>
                            {({ height, width }) => (
                                <List
                                    height={height}
                                    width={width}
                                    itemCount={filteredProducts.length}
                                    itemSize={100}
                                >
                                    {Row}
                                </List>
                            )}
                        </AutoSizer>
                    )}
                </div>

                {/* Detail Panel */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${selectedProduct ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {selectedProduct ? (
                        <>
                            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSelectedProduct(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                                    <div>
                                        <h2 className="text-lg font-bold dark:text-white leading-tight">{selectedProduct.label}</h2>
                                        <span className="text-xs text-slate-500 font-mono">{selectedProduct.ref}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {getStockBadge(selectedProduct)}
                                    <button onClick={() => setSelectedProduct(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                                </div>
                            </div>

                            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                                <button onClick={() => setActiveTab('overview')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'overview' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Visão Geral</button>
                                {selectedProduct.type === '0' && <button onClick={() => setActiveTab('stock')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'stock' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Estoque & Armazéns</button>}
                                <button onClick={() => setActiveTab('suppliers')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'suppliers' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Fornecedores</button>
                                {productBOMs.length > 0 && <button onClick={() => setActiveTab('manufacturing')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'manufacturing' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Produção (BOM)</button>}
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">

                                    {activeTab === 'overview' && (
                                        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                                            <div className="flex items-start gap-4 mb-4">
                                                <div className={`p-3 rounded-lg ${getPlaceholderColor(selectedProduct.id)}`}>
                                                    {selectedProduct.type === '1' ? <Briefcase size={24} /> : <Box size={24} />}
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">{selectedProduct.label}</h3>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400">{selectedProduct.description || "Sem descrição."}</p>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                                    <span className="text-xs text-slate-500 uppercase font-bold">Preço</span>
                                                    <div className="font-bold text-lg dark:text-white">${selectedProduct.price.toLocaleString()}</div>
                                                </div>
                                                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                                    <span className="text-xs text-slate-500 uppercase font-bold">Ref</span>
                                                    <div className="font-mono text-sm dark:text-white">{selectedProduct.ref}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'stock' && (
                                        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                                            <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><Warehouse size={18} /> Detalhes de Estoque</h3>
                                            {selectedProduct.stock_details && selectedProduct.stock_details.length > 0 ? (
                                                <div className="space-y-2">
                                                    {selectedProduct.stock_details.map((detail, idx) => (
                                                        <div key={idx} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                                                            <span className="text-sm text-slate-700 dark:text-slate-300">{detail.warehouse}</span>
                                                            <span className="font-bold text-slate-900 dark:text-white">{detail.qty}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-center py-4">
                                                    <div className="text-3xl font-bold text-slate-800 dark:text-white mb-1">{selectedProduct.stock_reel}</div>
                                                    <p className="text-sm text-slate-500">Total em Estoque</p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'suppliers' && (
                                        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                                            <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><Truck size={18} /> Fornecedores</h3>
                                            {productSuppliers.length > 0 ? (
                                                <div className="space-y-2">
                                                    {productSuppliers.map(s => (
                                                        <div key={s.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                                                            <span className="text-sm font-medium text-slate-800 dark:text-white">{s.name}</span>
                                                            <button onClick={() => openRestockModal(s.id)} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded border border-indigo-100 hover:bg-indigo-100 transition-colors">Repor</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-slate-400 italic text-sm">Nenhum fornecedor vinculado.</p>
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'manufacturing' && (
                                        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Listas de Materiais (BOM)</h3>
                                            {productBOMs.map(bom => (
                                                <div key={bom.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 mb-2">
                                                    <div className="flex justify-between">
                                                        <span className="font-medium text-sm text-slate-800 dark:text-white">{bom.label}</span>
                                                        <span className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">{bom.status === '1' ? 'Ativo' : 'Rascunho'}</span>
                                                    </div>
                                                    <div className="text-xs text-slate-500 mt-1">Duração: {bom.duration}s • Qtd: {bom.qty}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="text-center p-8 max-w-sm mx-auto">
                            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300 dark:text-slate-600"><Package size={32} /></div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Selecione um Produto</h3>
                            <p className="text-slate-500 dark:text-slate-400 text-sm">Ver detalhes, estoque e produção.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProductList;
