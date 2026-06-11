/**
 * ProductListV2 - Example component using the Design System
 * 
 * This serves as a MODEL for refactoring other List components.
 * Uses: PageLayout, PageHeader, MasterDetailLayout, Card, Button, Input, Modal, Tabs, EmptyState
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { Product, AppView } from '../types';
import { Package, Box, Briefcase, AlertCircle, CheckCircle2, Warehouse, Plus, Loader2, Tag, Truck, ShoppingCart, Pencil } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useDolibarr } from '../context/DolibarrContext';
import { useProducts, useCategories, useBOMs, useSuppliers } from '../hooks/dolibarr';
import { useListControls } from '../hooks/useListControls';

// Design System Components
import {
    PageLayout,
    PageHeader,
    MasterDetailLayout,
    Card,
    Button,
    Input,
    Modal,
    Tabs,
    Tab,
    EmptyState,
    RichTextEditor,
    ListToolbar,
    ConfirmDeleteButton
} from './ui';
import { SafeHtml } from '../utils/sanitizeHtml';
import { notifyError } from '../utils/notifyError';

// ============================================
// Types
// ============================================

interface ProductListV2Props {
    onRefresh?: () => void;
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
    initialFilter?: 'product' | 'service';
}

// ============================================
// Sub-components for better organization
// ============================================

/** Product row item in the list */
const ProductRow: React.FC<{
    product: Product;
    isSelected: boolean;
    onSelect: () => void;
}> = ({ product, isSelected, onSelect }) => {
    const getStockBadge = () => {
        if (product.type === '1') {
            return <span className="text-xs text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-full font-medium">Serviço</span>;
        }
        const stock = product.stock_reel || 0;
        if (stock <= 0) {
            return <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded-full font-medium"><AlertCircle size={12} /> Sem Estoque</span>;
        }
        if (stock < 5) {
            return <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 dark:bg-orange-900/30 px-2 py-1 rounded-full font-medium"><AlertCircle size={12} /> Baixo ({stock})</span>;
        }
        return <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-full font-medium"><CheckCircle2 size={12} /> {stock}</span>;
    };

    return (
        <Card
            onClick={onSelect}
            selected={isSelected}
            hoverable
            padding="md"
            className="mb-2"
        >
            <div className="flex items-start gap-4">
                <div className={`p-3 rounded-lg ${product.type === '1' ? 'bg-blue-100 text-blue-500' : 'bg-indigo-100 text-indigo-500'}`}>
                    {product.type === '1' ? <Briefcase size={20} /> : <Box size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                        <div className="min-w-0 pr-2">
                            <h4 className="font-bold text-slate-800 dark:text-white text-sm truncate">{product.label}</h4>
                            <span className="text-xs text-slate-400 font-mono block truncate">{product.ref}</span>
                        </div>
                        <div className="shrink-0">{getStockBadge()}</div>
                    </div>
                    <div className="mt-2 font-bold text-slate-900 dark:text-white">${product.price?.toLocaleString() || 0}</div>
                </div>
            </div>
        </Card>
    );
};

/** Product detail panel */
const ProductDetail: React.FC<{
    product: Product;
    onClose: () => void;
    onEdit: () => void;
    onDelete: () => Promise<any>;
    boms: any[];
    suppliers: any[];
    onRestock: (supplierId: string) => void;
}> = ({ product, onClose, onEdit, onDelete, boms, suppliers, onRestock }) => {
    const [activeTab, setActiveTab] = useState('overview');

    const productBOMs = boms.filter(b => String(b.product_id) === String(product.id));

    return (
        <>
            {/* Detail Header */}
            <PageHeader
                title={product.label}
                subtitle={product.ref}
                onBack={onClose}
                actions={
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" icon={<Pencil size={18} />} onClick={onEdit} />
                        <ConfirmDeleteButton
                            onDelete={onDelete}
                            itemLabel={product.label}
                            iconSize={18}
                            className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                            stopPropagation={false}
                        />
                    </div>
                }
                tabs={
                    <Tabs value={activeTab} onChange={setActiveTab}>
                        <Tab value="overview">Visão Geral</Tab>
                        {product.type === '0' && <Tab value="stock">Estoque</Tab>}
                        <Tab value="suppliers">Fornecedores</Tab>
                        {productBOMs.length > 0 && <Tab value="bom">BOM</Tab>}
                    </Tabs>
                }
            />

            {/* Detail Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                <div className="max-w-3xl mx-auto space-y-6">

                    {activeTab === 'overview' && (
                        <Card padding="lg">
                            <div className="flex items-start gap-4 mb-6">
                                <div className={`p-4 rounded-xl ${product.type === '1' ? 'bg-blue-100 text-blue-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                    {product.type === '1' ? <Briefcase size={28} /> : <Box size={28} />}
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">{product.label}</h3>
                                    {product.description
                                        ? <SafeHtml html={product.description} className="text-sm text-slate-500 dark:text-slate-400 mt-1" />
                                        : <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Sem descrição.</p>}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Preço</span>
                                    <div className="font-bold text-xl dark:text-white mt-1">${product.price?.toLocaleString() || 0}</div>
                                </div>
                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Tipo</span>
                                    <div className="font-medium dark:text-white mt-1">{product.type === '0' ? 'Produto' : 'Serviço'}</div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mt-4">
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${product.tosell === '1' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {product.tosell === '1' ? '✓ À venda' : '✗ Fora de venda'}
                                </span>
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${product.tobuy === '1' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                                    {product.tobuy === '1' ? '✓ Para compra' : '✗ Sem compra'}
                                </span>
                            </div>
                        </Card>
                    )}

                    {activeTab === 'stock' && (
                        <Card padding="lg">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <Warehouse size={18} /> Detalhes de Estoque
                            </h3>
                            {product.stock_details && product.stock_details.length > 0 ? (
                                <div className="space-y-2">
                                    {product.stock_details.map((detail, idx) => (
                                        <div key={idx} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                            <span className="text-sm text-slate-700 dark:text-slate-300">{detail.warehouse}</span>
                                            <span className="font-bold text-slate-900 dark:text-white">{detail.qty}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8">
                                    <div className="text-4xl font-bold text-slate-800 dark:text-white mb-2">{product.stock_reel || 0}</div>
                                    <p className="text-sm text-slate-500">Total em Estoque</p>
                                </div>
                            )}
                        </Card>
                    )}

                    {activeTab === 'suppliers' && (
                        <Card padding="lg">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <Truck size={18} /> Fornecedores
                            </h3>
                            {suppliers.length > 0 ? (
                                <div className="space-y-2">
                                    {suppliers.map(s => (
                                        <div key={s.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                            <span className="text-sm font-medium text-slate-800 dark:text-white">{s.name}</span>
                                            <Button size="sm" variant="outline" onClick={() => onRestock(s.id)}>
                                                Repor
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptyState
                                    icon={Truck}
                                    title="Nenhum fornecedor"
                                    description="Este produto não possui fornecedores vinculados."
                                    size="sm"
                                />
                            )}
                        </Card>
                    )}

                    {activeTab === 'bom' && (
                        <Card padding="lg">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Listas de Materiais (BOM)</h3>
                            {productBOMs.map(bom => (
                                <div key={bom.id} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg mb-2">
                                    <div className="flex justify-between">
                                        <span className="font-medium text-sm text-slate-800 dark:text-white">{bom.label}</span>
                                        <span className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">
                                            {bom.status === '1' ? 'Ativo' : 'Rascunho'}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">Duração: {bom.duration}s • Qtd: {bom.qty}</div>
                                </div>
                            ))}
                        </Card>
                    )}
                </div>
            </div>
        </>
    );
};

// ============================================
// Main Component
// ============================================

const ProductListV2: React.FC<ProductListV2Props> = ({
    onRefresh,
    onNavigate,
    initialItemId,
    initialFilter
}) => {
    const { config } = useDolibarr();
    const { data: productsData, isLoading } = useProducts(config);
    const products = productsData || [];
    const { data: categoriesData } = useCategories(config);
    const categories = categoriesData || [];
    const { data: bomsData } = useBOMs(config);
    const boms = bomsData || [];
    const { data: suppliersData } = useSuppliers(config);
    const suppliers = suppliersData || [];

    // State
    const [filterType, setFilterType] = useState<'all' | 'product' | 'service'>(initialFilter || 'all');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

    // Modal State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isRestockModalOpen, setIsRestockModalOpen] = useState(false);

    // Form State
    const [productForm, setProductForm] = useState<Partial<Product>>({ type: '0', price: 0 });
    const [restockSupplierId, setRestockSupplierId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Initial item selection
    useEffect(() => {
        if (initialItemId && products.length > 0) {
            const found = products.find(p => String(p.id) === String(initialItemId));
            if (found) setSelectedProduct(found);
        }
    }, [initialItemId, products]);

    // Deeplink HITL do agente (#57/#78): create_product / edit_product abrem o modal pré-preenchido.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        const mapForm = (d: any): Partial<Product> => {
            const f: Partial<Product> = {};
            if (d.ref !== undefined) f.ref = d.ref;
            if (d.label !== undefined) f.label = d.label;
            if (d.type !== undefined) f.type = d.type;
            if (d.price !== undefined) f.price = Number(d.price);
            if (d.description !== undefined) f.description = d.description;
            return f;
        };
        if (prefill.kind === 'create_product') {
            appliedPrefillRef.current = prefill;
            setProductForm({ type: '0', price: 0, ...mapForm(prefill.data) });
            setIsCreateModalOpen(true);
            toast.info('Revise os dados e confirme a criação do produto.');
        } else if (prefill.kind === 'edit_product') {
            const prod = products.find(p => String(p.id) === String(prefill.data.id));
            if (!prod) return; // aguarda os dados
            appliedPrefillRef.current = prefill;
            setSelectedProduct(prod);
            setProductForm({ ...prod, ...mapForm(prefill.data) });
            setIsEditModalOpen(true);
            toast.info('Revise as mudanças e salve o produto.');
        }
    }, [prefill, products]);

    // Pré-filtro por tipo (tabs) e categoria (select); busca + ordenação ficam no useListControls (#121).
    const baseProducts = useMemo(() => {
        return products.filter(p => {
            let matchesType = true;
            if (filterType === 'product') matchesType = p.type === '0';
            if (filterType === 'service') matchesType = p.type === '1';

            let matchesCategory = true;
            if (selectedCategory !== 'all' && p.array_options?.category) {
                matchesCategory = p.array_options.category === selectedCategory;
            }

            return matchesType && matchesCategory;
        });
    }, [products, filterType, selectedCategory]);

    const controls = useListControls(baseProducts, {
        searchText: (p) => `${p.ref || ''} ${p.label || ''}`,
        sorts: [
            { key: 'label', label: 'Nome', get: (p) => p.label },
            { key: 'ref', label: 'Ref', get: (p) => p.ref },
            { key: 'price', label: 'Preço', get: (p) => Number(p.price) || 0 },
            { key: 'stock', label: 'Estoque', get: (p) => Number(p.stock_reel) || 0 },
        ],
        initialSortKey: 'label',
    });
    const filteredProducts = controls.result;

    // Handlers
    const handleCreate = async () => {
        if (!productForm.ref || !productForm.label) return;
        setIsSubmitting(true);
        try {
            await DolibarrService.createProduct(config!, productForm);
            setIsCreateModalOpen(false);
            setProductForm({ type: '0', price: 0 });
            onRefresh?.();
        } catch (e: any) {
            notifyError('Criar produto', e);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUpdate = async () => {
        if (!selectedProduct || !productForm.id) return;
        setIsSubmitting(true);
        try {
            await DolibarrService.updateProduct(config!, productForm.id, productForm);
            setIsEditModalOpen(false);
            setSelectedProduct({ ...selectedProduct, ...productForm } as Product);
            onRefresh?.();
        } catch (e: any) {
            notifyError('Atualizar produto', e);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Exclusão tratada pelo <ConfirmDeleteButton> (confirmação + toast); aqui só a chamada.
    const handleDelete = async () => {
        if (!selectedProduct) return;
        await DolibarrService.deleteProduct(config!, selectedProduct.id);
        setSelectedProduct(null);
        onRefresh?.();
    };

    const openEditModal = () => {
        if (selectedProduct) {
            setProductForm({ ...selectedProduct });
            setIsEditModalOpen(true);
        }
    };

    const openRestockModal = (supplierId: string) => {
        setRestockSupplierId(supplierId);
        setIsRestockModalOpen(true);
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500 opacity-50" />
            </div>
        );
    }

    if (!config) return <div className="p-8 text-center">Carregando...</div>;

    // Virtualized row renderer
    const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
        const product = filteredProducts[index];
        const itemStyle = {
            ...style,
            top: (parseFloat(style.top as string) + 8) + 'px',
            height: (parseFloat(style.height as string) - 8) + 'px',
            paddingLeft: '8px',
            paddingRight: '8px'
        };

        return (
            <div style={itemStyle}>
                <ProductRow
                    product={product}
                    isSelected={selectedProduct?.id === product.id}
                    onSelect={() => setSelectedProduct(product)}
                />
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">

            {/* Page Header - hidden on mobile when detail is open */}
            <div className={selectedProduct ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title="Produtos & Serviços"
                    subtitle="Gerencie seu catálogo e estoque"
                    actions={
                        <div className="flex items-center gap-2">
                            <ListToolbar controls={controls} searchPlaceholder="Buscar..." />

                            {categories.length > 0 && (
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    className="px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg text-sm"
                                >
                                    <option value="all">Todas Tags</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                </select>
                            )}

                            <Button icon={<Plus size={18} />} onClick={() => setIsCreateModalOpen(true)}>
                                Novo
                            </Button>
                        </div>
                    }
                    tabs={
                        <Tabs value={filterType} onChange={(v) => setFilterType(v as any)}>
                            <Tab value="all">Todos</Tab>
                            <Tab value="product">Produtos</Tab>
                            <Tab value="service">Serviços</Tab>
                        </Tabs>
                    }
                />
            </div>

            {/* Master-Detail Layout */}
            <MasterDetailLayout
                showDetail={!!selectedProduct}
                onCloseDetail={() => setSelectedProduct(null)}
                listWidth="1/3"
                list={
                    filteredProducts.length === 0 ? (
                        <EmptyState
                            icon={Package}
                            title="Nenhum produto encontrado"
                            description="Tente ajustar os filtros ou adicione um novo produto."
                            action={<Button onClick={() => setIsCreateModalOpen(true)}>Adicionar Produto</Button>}
                        />
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
                    )
                }
                detail={
                    selectedProduct && (
                        <ProductDetail
                            product={selectedProduct}
                            onClose={() => setSelectedProduct(null)}
                            onEdit={openEditModal}
                            onDelete={handleDelete}
                            boms={boms}
                            suppliers={suppliers}
                            onRestock={openRestockModal}
                        />
                    )
                }
            />

            {/* Create Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Novo Produto"
                size="md"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button loading={isSubmitting} onClick={handleCreate}>Criar</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Input label="Ref" required value={productForm.ref || ''} onChange={e => setProductForm({ ...productForm, ref: e.target.value })} placeholder="PRD-001" />
                    <Input label="Rótulo" required value={productForm.label || ''} onChange={e => setProductForm({ ...productForm, label: e.target.value })} placeholder="Nome do Produto" />
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                            <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700" value={productForm.type} onChange={e => setProductForm({ ...productForm, type: e.target.value as '0' | '1' })}>
                                <option value="0">Produto</option>
                                <option value="1">Serviço</option>
                            </select>
                        </div>
                        <Input label="Preço" type="number" value={productForm.price || 0} onChange={e => setProductForm({ ...productForm, price: parseFloat(e.target.value) })} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                        <RichTextEditor value={productForm.description || ''} onChange={html => setProductForm({ ...productForm, description: html })} placeholder="Descreva o produto ou serviço..." />
                    </div>
                </div>
            </Modal>

            {/* Edit Modal */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title={`Editar ${productForm.type === '1' ? 'Serviço' : 'Produto'}`}
                size="lg"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>Cancelar</Button>
                        <Button loading={isSubmitting} onClick={handleUpdate}>Salvar</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Input label="Ref" required value={productForm.ref || ''} onChange={e => setProductForm({ ...productForm, ref: e.target.value })} />
                    <Input label="Rótulo" required value={productForm.label || ''} onChange={e => setProductForm({ ...productForm, label: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                            <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700" value={productForm.type} onChange={e => setProductForm({ ...productForm, type: e.target.value as '0' | '1' })}>
                                <option value="0">Produto</option>
                                <option value="1">Serviço</option>
                            </select>
                        </div>
                        <Input label="Preço" type="number" value={productForm.price || 0} onChange={e => setProductForm({ ...productForm, price: parseFloat(e.target.value) })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status Venda</label>
                            <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700" value={productForm.tosell} onChange={e => setProductForm({ ...productForm, tosell: e.target.value as any })}>
                                <option value="1">Em Venda</option>
                                <option value="0">Fora de Venda</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status Compra</label>
                            <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700" value={productForm.tobuy} onChange={e => setProductForm({ ...productForm, tobuy: e.target.value as any })}>
                                <option value="1">Em Compra</option>
                                <option value="0">Fora de Compra</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                        <RichTextEditor value={productForm.description || ''} onChange={html => setProductForm({ ...productForm, description: html })} placeholder="Descreva o produto ou serviço..." />
                    </div>
                </div>
            </Modal>

            {/* Restock Modal */}
            <Modal
                isOpen={isRestockModalOpen}
                onClose={() => setIsRestockModalOpen(false)}
                title="Repor Produto"
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsRestockModalOpen(false)}>Cancelar</Button>
                        <Button icon={<ShoppingCart size={16} />}>Criar Pedido</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">
                        <span className="text-sm font-medium">{selectedProduct?.label}</span>
                    </div>
                    <Input label="Quantidade" type="number" defaultValue={10} />
                    <Input label="Entrega Esperada" type="date" />
                </div>
            </Modal>
        </div>
    );
};

export default ProductListV2;
