import React, { useState, useMemo } from 'react';
import { Category, AppView } from '../types';
import { Tag, Search, Plus, Trash2, X, Loader2, CheckCircle2, Folder, Box, User, ArrowUpRight, ChevronLeft, StickyNote } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useCategories } from '../hooks/dolibarr';
import { GenericListLayout } from './common/GenericListLayout';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { toast } from 'sonner';

interface CategoryListProps {
    onRefresh?: () => void;
    onNavigate?: (view: AppView, id: string) => void;
}

const CategoryList: React.FC<CategoryListProps> = ({ onRefresh, onNavigate }) => {
    const { config } = useDolibarr();
    const { data: categoriesData } = useCategories(config);
    const categories = categoriesData || [];

    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'product' | 'customer' | 'supplier'>('all');
    const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

    // Create State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newCat, setNewCat] = useState({ label: '', type: 'product', description: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!config) return <div className="p-8 text-center text-slate-500">Carregando configuração...</div>;

    const filteredCategories = useMemo(() => {
        return categories.filter(c => {
            const matchesSearch = c.label.toLowerCase().includes(searchTerm.toLowerCase());

            // Dolibarr Type Mapping: 0=Product, 1=Supplier, 2=Customer, 3=Member, 4=Contact, 5=Account, 6=Project
            let matchesType = true;
            if (filterType === 'product') matchesType = String(c.type) === '0' || String(c.type) === 'product';
            if (filterType === 'customer') matchesType = String(c.type) === '2' || String(c.type) === 'customer';
            if (filterType === 'supplier') matchesType = String(c.type) === '1' || String(c.type) === 'supplier';

            return matchesSearch && matchesType;
        });
    }, [categories, searchTerm, filterType]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCat.label) return;
        setIsSubmitting(true);
        try {
            // Map string type to Dolibarr numeric type if needed, or send string if API handles it
            let typeVal = '0';
            if (newCat.type === 'supplier') typeVal = '1';
            if (newCat.type === 'customer') typeVal = '2';

            await DolibarrService.createCategory(config, { ...newCat, type: typeVal });
            toast.success("Categoria criada com sucesso!");
            setIsCreateModalOpen(false);
            setNewCat({ label: '', type: 'product', description: '' });
            if (onRefresh) onRefresh();
        } catch (e: any) {
            console.error(e);
            toast.error(`Falha ao criar categoria: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Excluir esta categoria? Objetos vinculados não serão excluídos, apenas a categoria.")) return;
        try {
            await DolibarrService.deleteCategory(config, id);
            toast.success("Categoria excluída.");
            if (onRefresh) onRefresh();
            setSelectedCategory(null);
        } catch (e) {
            console.error(e);
            toast.error("Falha ao excluir categoria");
        }
    };

    const getTypeBadge = (type: string | number) => {
        const t = String(type);
        if (t === '0' || t === 'product') return <span className="flex items-center gap-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded"><Box size={10} /> Produto</span>;
        if (t === '2' || t === 'customer') return <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded"><User size={10} /> Cliente</span>;
        if (t === '1' || t === 'supplier') return <span className="flex items-center gap-1 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded"><User size={10} /> Fornecedor</span>;
        return <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Outro ({t})</span>;
    };

    // --- RENDERERS ---

    const renderHeader = (
        <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><Tag className="text-indigo-500" /> Categorias / Tags</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Organize seus dados com tags</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar categorias..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white w-64"
                        />
                    </div>
                    <button onClick={() => setIsCreateModalOpen(true)} className={`flex items-center gap-1.5 px-3 py-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}>
                        <Plus size={18} /> Nova
                    </button>
                </div>
            </div>
            <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
                {['all', 'product', 'customer', 'supplier'].map(type => (
                    <button
                        key={type}
                        onClick={() => setFilterType(type as any)}
                        className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 capitalize whitespace-nowrap ${filterType === type ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        {type === 'all' ? 'Todas' : type === 'product' ? 'Produto' : type === 'customer' ? 'Cliente' : 'Fornecedor'}
                    </button>
                ))}
            </div>
        </div>
    );

    const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
        const cat = filteredCategories[index];
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
                onClick={() => setSelectedCategory(cat)}
                className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md group flex items-center justify-between gap-4 ${selectedCategory?.id === cat.id
                        ? 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-500 dark:border-indigo-500'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800'
                    }`}
            >
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Folder size={18} className="text-indigo-400" />
                        <h4 className="font-bold text-slate-800 dark:text-white truncate">{cat.label}</h4>
                    </div>
                    {cat.description && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 ml-6">{cat.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                    {getTypeBadge(cat.type)}
                    <div className="lg:hidden">
                        <ArrowUpRight size={16} className="text-slate-400" />
                    </div>
                </div>
            </div>
        );
    };

    const renderListContent = filteredCategories.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
            <Tag size={48} className="mx-auto mb-4 opacity-50" />
            <p>Nenhuma categoria encontrada.</p>
        </div>
    ) : (
        <AutoSizer>
            {({ height, width }) => (
                <ListWindow
                    height={height}
                    width={width}
                    itemCount={filteredCategories.length}
                    itemSize={80}
                >
                    {Row}
                </ListWindow>
            )}
        </AutoSizer>
    );

    const renderDetail = selectedCategory ? (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950/50">
            {/* Detail Header */}
            <div className="flex-none bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedCategory(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ChevronLeft size={20} /></button>
                    <div>
                        <h2 className="text-lg font-bold dark:text-white leading-tight flex items-center gap-2">
                            <Tag className="text-indigo-500" size={20} />
                            {selectedCategory.label}
                        </h2>
                        <div className="mt-1">
                            {getTypeBadge(selectedCategory.type)}
                        </div>
                    </div>
                </div>
                <button onClick={() => setSelectedCategory(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

                {/* Description */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                        <StickyNote size={18} className="text-slate-500" />
                        Descrição
                    </h3>
                    <p className="text-slate-600 dark:text-slate-300 text-sm whitespace-pre-wrap leading-relaxed">
                        {selectedCategory.description || <span className="italic text-slate-400">Sem descrição.</span>}
                    </p>
                </div>

                {/* Actions */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
                    <h3 className="font-bold text-slate-800 dark:text-white mb-4">Ações</h3>
                    <div className="space-y-3">
                        <button
                            onClick={() => {
                                const t = String(selectedCategory.type);
                                setSelectedCategory(null);
                                if ((t === '0' || t === 'product') && onNavigate) onNavigate('products', ''); // TODO: Filter by category ID if possible?
                                if ((t === '2' || t === 'customer') && onNavigate) onNavigate('customers', '');
                                if ((t === '1' || t === 'supplier') && onNavigate) onNavigate('suppliers', '');
                            }}
                            className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                            <span className="flex items-center gap-2"><ArrowUpRight size={16} /> Ver itens vinculados</span>
                        </button>

                        <button
                            onClick={() => handleDelete(selectedCategory.id)}
                            className="w-full flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors text-sm font-medium text-red-600 dark:text-red-400"
                        >
                            <span className="flex items-center gap-2"><Trash2 size={16} /> Excluir Categoria</span>
                        </button>
                    </div>
                </div>

                <div className="px-2">
                    <div className="text-xs text-slate-400">ID Interno: <span className="font-mono">{selectedCategory.id}</span></div>
                </div>

            </div>
        </div>
    ) : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Tag size={48} className="mb-4 opacity-50" />
            <p>Selecione uma categoria para ver detalhes.</p>
        </div>
    );

    return (
        <div className="h-full flex flex-col">
            <GenericListLayout
                header={renderHeader}
                content={renderListContent}
                detail={renderDetail}
                isDetailOpen={!!selectedCategory}
            />

            {/* Create Modal - Kept Global/Overlay */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm p-6 border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg dark:text-white">Nova Categoria</h3>
                            <button onClick={() => setIsCreateModalOpen(false)}><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium dark:text-slate-300">Rótulo</label>
                                <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newCat.label} onChange={e => setNewCat({ ...newCat, label: e.target.value })} required placeholder="ex: Clientes VIP" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium dark:text-slate-300">Tipo</label>
                                <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newCat.type} onChange={e => setNewCat({ ...newCat, type: e.target.value })}>
                                    <option value="product">Produto</option>
                                    <option value="customer">Cliente</option>
                                    <option value="supplier">Fornecedor</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium dark:text-slate-300">Descrição</label>
                                <textarea className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white h-20 resize-none" value={newCat.description} onChange={e => setNewCat({ ...newCat, description: e.target.value })} />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 text-white rounded flex items-center gap-2">
                                    {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Criar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CategoryList;
