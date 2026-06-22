import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Category, AppView } from '../types';
import { Tag, Plus, Loader2, CheckCircle2, Folder, Box, User, ArrowUpRight, StickyNote, Pencil } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useCategories } from '../hooks/dolibarr';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { useListControls } from '../hooks/useListControls';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { toast } from 'sonner';
import { logger } from '../utils/logger';
import { typeToForm, formToType, CATEGORY_TYPE_OPTIONS } from '../utils/categoryType';

const log = logger.child('CategoryList');

// Design System
import { PageHeader, MasterDetailLayout, Modal, Button, Input, Tabs, Tab, EmptyState, Card, ListToolbar, ConfirmDeleteButton } from './ui';

interface CategoryListProps {
    onRefresh?: () => void;
    onNavigate?: (view: AppView, id: string) => void;
}

// ============================================
// Shared Helpers
// ============================================

const getTypeBadge = (type: string | number) => {
    const t = String(type);
    if (t === '0' || t === 'product') return <span className="flex items-center gap-1 text-[10px] uppercase font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded"><Box size={10} /> Produto</span>;
    if (t === '2' || t === 'customer') return <span className="flex items-center gap-1 text-[10px] uppercase font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded"><User size={10} /> Cliente</span>;
    if (t === '1' || t === 'supplier') return <span className="flex items-center gap-1 text-[10px] uppercase font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded"><User size={10} /> Fornecedor</span>;
    return <span className="text-[10px] uppercase font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Outro ({t})</span>;
};

// ============================================
// Sub-components
// ============================================

/** Category row item in the list */
const CategoryRow: React.FC<{
    category: Category;
    isSelected: boolean;
    onSelect: () => void;
}> = ({ category, isSelected, onSelect }) => {
    return (
        <Card
            onClick={onSelect}
            selected={isSelected}
            hoverable
            padding="md"
            className="mb-2"
        >
            <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                        <Folder size={16} className="text-indigo-400 shrink-0" />
                        <h4 className="font-bold text-slate-800 dark:text-white truncate text-sm">{category.label}</h4>
                    </div>
                    {category.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate ml-6">
                            {category.description}
                        </p>
                    )}
                </div>
                <div className="shrink-0">
                    {getTypeBadge(category.type)}
                </div>
            </div>
        </Card>
    );
};

// ============================================
// Main Component
// ============================================

const CategoryList: React.FC<CategoryListProps> = ({ onRefresh, onNavigate }) => {
    const { config } = useDolibarr();
    const { data: categoriesData, isLoading } = useCategories(config);
    const categories = categoriesData || [];

    const [filterType, setFilterType] = useState<'all' | 'product' | 'customer' | 'supplier'>('all');
    const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

    // Create State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newCat, setNewCat] = useState({ label: '', type: 'product', description: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Edit State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editCat, setEditCat] = useState({ label: '', type: 'product', description: '' });
    const [isEditSubmitting, setIsEditSubmitting] = useState(false);

    // Deeplink HITL do agente (#57): create_category / edit_category (aplica 1x por token).
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);

    // Pré-filtro por tipo (tabs); busca + ordenação ficam no useListControls (#121).
    const baseCategories = useMemo(() => {
        return categories.filter(c => {
            // Dolibarr Type Mapping: 0=Product, 1=Supplier, 2=Customer, 3=Member, 4=Contact, 5=Account, 6=Project
            let matchesType = true;
            if (filterType === 'product') matchesType = String(c.type) === '0' || String(c.type) === 'product';
            if (filterType === 'customer') matchesType = String(c.type) === '2' || String(c.type) === 'customer';
            if (filterType === 'supplier') matchesType = String(c.type) === '1' || String(c.type) === 'supplier';

            return matchesType;
        });
    }, [categories, filterType]);

    const controls = useListControls(baseCategories, {
        searchText: (c) => `${c.label || ''} ${c.description || ''}`,
        sorts: [
            { key: 'label', label: 'Nome', get: (c) => c.label },
        ],
        initialSortKey: 'label',
    });
    const filteredCategories = controls.result;

    const handleCreate = async () => {
        if (!newCat.label) return;
        setIsSubmitting(true);
        try {
            const typeVal = formToType(newCat.type);
            await DolibarrService.createCategory(config!, { ...newCat, type: typeVal });
            toast.success("Categoria criada com sucesso!");
            setIsCreateModalOpen(false);
            setNewCat({ label: '', type: 'product', description: '' });
            if (onRefresh) onRefresh();
        } catch (e: any) {
            log.error(e);
            toast.error(`Falha ao criar categoria: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Exclusão tratada pelo <ConfirmDeleteButton> (confirmação + toast); aqui só a chamada.
    const handleDelete = async (id: string) => {
        await DolibarrService.deleteCategory(config!, id);
        if (onRefresh) onRefresh();
        setSelectedCategory(null);
    };

    const handleEdit = async () => {
        if (!selectedCategory) return;
        setIsEditSubmitting(true);
        try {
            const typeVal = formToType(editCat.type);
            await DolibarrService.updateObject(config!, 'categories', selectedCategory.id, { ...editCat, type: typeVal });
            toast.success("Categoria atualizada com sucesso!");
            setIsEditModalOpen(false);
            if (onRefresh) onRefresh();
        } catch (e: any) {
            log.error(e);
            toast.error(`Falha ao atualizar categoria: ${e.message}`);
        } finally {
            setIsEditSubmitting(false);
        }
    };

    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_category') {
            appliedPrefillRef.current = prefill;
            setNewCat({
                label: prefill.data.label || '',
                type: typeToForm(prefill.data.type || 'product'),
                description: prefill.data.description || '',
            });
            setIsCreateModalOpen(true);
            toast.info('Revise os dados e confirme a criação da categoria.');
        } else if (prefill.kind === 'edit_category') {
            if (categories.length === 0) return; // aguarda carregar
            appliedPrefillRef.current = prefill;
            const { id, ...changes } = prefill.data;
            const current = categories.find(c => String(c.id) === String(id));
            if (!current) { toast.error('Categoria não encontrada para edição.'); return; }
            setSelectedCategory(current);
            setEditCat({
                label: changes.label ?? current.label,
                type: changes.type ?? typeToForm(current.type),
                description: changes.description ?? (current.description || ''),
            });
            setIsEditModalOpen(true);
            toast.info('Revise as mudanças sugeridas e salve.');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefill, categories]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500 opacity-50" />
            </div>
        );
    }

    if (!config) return <div className="p-8 text-center text-slate-500">Carregando configuração...</div>;

    const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
        const cat = filteredCategories[index];
        const itemStyle = {
            ...style,
            top: (parseFloat(style.top as string) + 8) + 'px',
            height: (parseFloat(style.height as string) - 8) + 'px',
            paddingLeft: '8px',
            paddingRight: '8px'
        };

        return (
            <div style={itemStyle}>
                <CategoryRow
                    category={cat}
                    isSelected={selectedCategory?.id === cat.id}
                    onSelect={() => setSelectedCategory(cat)}
                />
            </div>
        );
    };



    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">
            {/* Create Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Nova Categoria"
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button
                            loading={isSubmitting}
                            icon={<CheckCircle2 size={16} />}
                            onClick={handleCreate}
                        >
                            Criar
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Input
                        label="Rótulo"
                        required
                        value={newCat.label}
                        onChange={e => setNewCat({ ...newCat, label: e.target.value })}
                        placeholder="Ex: Clientes VIP"
                    />
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                        <select
                            className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={newCat.type}
                            onChange={e => setNewCat({ ...newCat, type: e.target.value })}
                        >
                            {CATEGORY_TYPE_OPTIONS.map(o => (
                                <option key={o.code} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                        <textarea
                            className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white text-sm h-24 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                            value={newCat.description}
                            onChange={e => setNewCat({ ...newCat, description: e.target.value })}
                            placeholder="Descrição opcional..."
                        />
                    </div>
                </div>
            </Modal>

            {/* Edit Modal */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title={`Editar: ${selectedCategory?.label || ''}`}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>Cancelar</Button>
                        <Button loading={isEditSubmitting} icon={<CheckCircle2 size={16} />} onClick={handleEdit}>Salvar</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Input
                        label="Rótulo"
                        required
                        value={editCat.label}
                        onChange={e => setEditCat({ ...editCat, label: e.target.value })}
                        placeholder="Ex: Clientes VIP"
                    />
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                        <select
                            className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={editCat.type}
                            onChange={e => setEditCat({ ...editCat, type: e.target.value })}
                        >
                            {CATEGORY_TYPE_OPTIONS.map(o => (
                                <option key={o.code} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                        <textarea
                            className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white text-sm h-24 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                            value={editCat.description}
                            onChange={e => setEditCat({ ...editCat, description: e.target.value })}
                            placeholder="Descrição opcional..."
                        />
                    </div>
                </div>
            </Modal>

            {/* List Header */}
            <div className={selectedCategory ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title="Categorias & Tags"
                    subtitle="Organize seus dados com etiquetas"
                    actions={
                        <div className="flex items-center gap-2">
                            <ListToolbar controls={controls} searchPlaceholder="Buscar..." />
                            <Button icon={<Plus size={18} />} onClick={() => setIsCreateModalOpen(true)}>
                                Nova
                            </Button>
                        </div>
                    }
                    tabs={
                        <Tabs value={filterType} onChange={(v) => setFilterType(v as any)}>
                            <Tab value="all">Todas</Tab>
                            <Tab value="product">Produtos</Tab>
                            <Tab value="customer">Clientes</Tab>
                            <Tab value="supplier">Fornecedores</Tab>
                        </Tabs>
                    }
                />
            </div>

            <MasterDetailLayout
                showDetail={!!selectedCategory}
                onCloseDetail={() => setSelectedCategory(null)}
                listWidth="1/3"
                list={
                    filteredCategories.length === 0 ? (
                        <EmptyState
                            icon={Tag}
                            title="Nenhuma categoria encontrada"
                            description="Tente ajustar a busca ou filtros."
                            action={<Button onClick={() => setIsCreateModalOpen(true)}>Adicionar Categoria</Button>}
                        />
                    ) : (
                        <AutoSizer>
                            {({ height, width }) => (
                                <ListWindow
                                    height={height}
                                    width={width}
                                    itemCount={filteredCategories.length}
                                    itemSize={90}
                                >
                                    {Row}
                                </ListWindow>
                            )}
                        </AutoSizer>
                    )
                }
                detail={
                    selectedCategory && (
                        <div className="flex flex-col h-full">
                            <PageHeader
                                title={selectedCategory.label}
                                subtitle={getTypeBadge(selectedCategory.type)}
                                onBack={() => setSelectedCategory(null)}
                                actions={
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={<Pencil size={18} />}
                                            onClick={() => {
                                                setEditCat({ label: selectedCategory.label, type: typeToForm(selectedCategory.type), description: selectedCategory.description || '' });
                                                setIsEditModalOpen(true);
                                            }}
                                            title="Editar"
                                        />
                                        <ConfirmDeleteButton
                                            onDelete={() => handleDelete(selectedCategory.id)}
                                            itemLabel={selectedCategory.label}
                                            message="Excluir esta categoria? Objetos vinculados não serão excluídos, apenas a categoria."
                                            iconSize={18}
                                            className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                                            stopPropagation={false}
                                        />
                                    </>
                                }
                            />

                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-2xl mx-auto space-y-6">
                                    <Card padding="lg">
                                        <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                                            <StickyNote size={18} className="text-indigo-500" />
                                            Descrição
                                        </h3>
                                        <p className="text-slate-600 dark:text-slate-300 text-sm whitespace-pre-wrap leading-relaxed">
                                            {selectedCategory.description || <span className="italic text-slate-400">Sem descrição definida.</span>}
                                        </p>
                                    </Card>

                                    <div className="space-y-4">
                                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Ações Relacionadas</h4>
                                        <Button
                                            fullWidth
                                            variant="outline"
                                            className="justify-between"
                                            iconRight={<ArrowUpRight size={16} />}
                                            onClick={() => {
                                                const t = String(selectedCategory.type);
                                                if ((t === '0' || t === 'product') && onNavigate) onNavigate('products', '');
                                                if ((t === '2' || t === 'customer') && onNavigate) onNavigate('customers', '');
                                                if ((t === '1' || t === 'supplier') && onNavigate) onNavigate('suppliers', '');
                                            }}
                                        >
                                            Ver itens desta categoria
                                        </Button>
                                    </div>

                                    <div className="pt-6 border-t border-slate-200 dark:border-slate-800">
                                        <div className="text-xs text-slate-400">ID Interno: <span className="font-mono">{selectedCategory.id}</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }
            />
        </div>
    );
};

export default CategoryList;

