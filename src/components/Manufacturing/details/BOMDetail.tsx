import React, { useState, useMemo } from 'react';
import { BOM, DolibarrConfig, Product } from '../../../types';
import { ArrowLeft, X, Hammer, Layers, Coins, Package, Pencil } from 'lucide-react';
import { getProductName, getProductPrice } from '../utils';
import { formatCurrency } from '../../../utils/formatUtils';

interface BOMDetailProps {
    bom: BOM;
    products: Product[];
    config: DolibarrConfig;
    onClose: () => void;
    onEdit?: () => void;
}

export const BOMDetail: React.FC<BOMDetailProps> = ({
    bom,
    products,
    config,
    onClose,
    onEdit
}) => {
    const [bomDetailTab, setBomDetailTab] = useState<'overview' | 'components'>('overview');

    // Calculate estimated cost of BOM
    const bomTotalCost = useMemo(() => {
        if (!bom || !bom.lines) return 0;
        return bom.lines.reduce((total, line) => {
            const unitCost = line.cost_price || getProductPrice(line.fk_product, products);
            return total + (unitCost * line.qty);
        }, 0);
    }, [bom, products]);

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                    <div>
                        <h2 className="text-lg font-bold dark:text-white leading-tight flex items-center gap-2">{bom.ref}</h2>
                        <span className="text-xs text-slate-500">Lista de Materiais</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {onEdit && (
                        <button onClick={onEdit} className="flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 rounded font-medium transition-colors">
                            <Pencil size={12} /> Editar
                        </button>
                    )}
                    <button className="flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 px-3 py-1 rounded font-bold">
                        <Hammer size={12} /> V{1}
                    </button>
                    <button onClick={onClose} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                <button onClick={() => setBomDetailTab('overview')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${bomDetailTab === 'overview' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Visão Geral</button>
                <button onClick={() => setBomDetailTab('components')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${bomDetailTab === 'components' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Componentes & Árvore</button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                <div className="max-w-4xl mx-auto space-y-6">
                    {bomDetailTab === 'overview' && (
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <div className="flex items-start gap-6">
                                <div className="p-4 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
                                    <Layers size={32} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-1">{bom.label}</h3>
                                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">Receita de Produção</p>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                                            <span className="text-xs text-slate-500 uppercase font-bold">Produz</span>
                                            <div className="font-medium text-slate-800 dark:text-white">{getProductName(bom.product_id, products)}</div>
                                            <div className="text-xs text-slate-500">Qtd: {bom.qty}</div>
                                        </div>
                                        <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                                            <span className="text-xs text-slate-500 uppercase font-bold">Custo Estimado</span>
                                            <div className="font-medium text-slate-800 dark:text-white flex items-center gap-1">
                                                <Coins size={14} className="text-yellow-500" />
                                                {formatCurrency(bomTotalCost)}
                                            </div>
                                            <div className="text-xs text-slate-500">Baseado no custo médio dos componentes</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {bomDetailTab === 'components' && (
                        <div className="space-y-6">
                            {/* Visualization Tree */}
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
                                    <Layers size={18} className="text-indigo-500" /> Árvore de Estrutura
                                </h3>

                                <div className="relative pl-4 border-l-2 border-slate-200 dark:border-slate-700 space-y-6">
                                    {/* Parent Node */}
                                    <div className="relative">
                                        <div className="absolute -left-[25px] top-3 w-4 h-4 rounded-full bg-indigo-500 border-4 border-white dark:border-slate-900"></div>
                                        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3 rounded-lg inline-block min-w-[200px]">
                                            <div className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase">Produto Final</div>
                                            <div className="font-bold text-slate-800 dark:text-white">{getProductName(bom.product_id, products)}</div>
                                            <div className="text-xs text-slate-500">Qtd: {bom.qty}</div>
                                        </div>
                                    </div>

                                    {/* Child Nodes */}
                                    {bom.lines && bom.lines.length > 0 ? (
                                        bom.lines.map((line, idx) => (
                                            <div key={idx} className="relative pl-8">
                                                <div className="absolute -left-[2px] top-6 w-6 h-0.5 bg-slate-200 dark:bg-slate-700"></div>
                                                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-lg shadow-sm hover:shadow-md transition-shadow flex justify-between items-center gap-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded text-slate-500">
                                                            <Package size={16} />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-slate-800 dark:text-white text-sm">{getProductName(line.fk_product, products)}</div>
                                                            <div className="text-xs text-slate-500">Eficiência: {(line.efficiency || 1) * 100}%</div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-bold text-slate-700 dark:text-slate-300">x{line.qty}</div>
                                                        <div className="text-xs text-slate-400">Est: {formatCurrency(line.cost_price || getProductPrice(line.fk_product, products))}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="pl-8 text-slate-400 italic text-sm">Nenhum componente definido.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
