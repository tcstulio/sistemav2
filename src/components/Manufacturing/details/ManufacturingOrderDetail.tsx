import React, { useState } from 'react';
import { ManufacturingOrder, DolibarrConfig, Project, Product, StockMovement } from '../../../types';
import { ArrowLeft, Settings, X, Package, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { getProductName, getStatusBadge } from '../utils';

interface ManufacturingOrderDetailProps {
    order: ManufacturingOrder;
    products: Product[];
    stockMovements: StockMovement[];
    config: DolibarrConfig;
    onClose: () => void;
    onOpenConsume: () => void;
    onOpenProduce: () => void;
}

export const ManufacturingOrderDetail: React.FC<ManufacturingOrderDetailProps> = ({
    order,
    products,
    stockMovements,
    config,
    onClose,
    onOpenConsume,
    onOpenProduce
}) => {
    const [moDetailTab, setMoDetailTab] = useState<'overview' | 'traceability'>('overview');

    const linkedMovements = stockMovements.filter(m =>
        m.label && m.label.includes(order.ref)
    );

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                    <div>
                        <h2 className="text-lg font-bold dark:text-white leading-tight flex items-center gap-2">{order.ref} {getStatusBadge(order.status)}</h2>
                        <span className="text-xs text-slate-500">{order.label}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><Settings size={20} /></button>
                    <button onClick={onClose} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                <button onClick={() => setMoDetailTab('overview')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${moDetailTab === 'overview' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Visão Geral</button>
                <button onClick={() => setMoDetailTab('traceability')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${moDetailTab === 'traceability' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Rastreabilidade (Estoque)</button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                {moDetailTab === 'overview' && (
                    <div className="max-w-3xl mx-auto space-y-6">
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="p-4 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-xl">
                                    <Package size={32} />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500 uppercase font-bold">Produzindo</p>
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">{getProductName(order.product_to_produce_id, products)}</h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">Qtd Alvo: {order.qty}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={onOpenConsume}
                                    className="flex items-center justify-center gap-2 p-3 rounded-lg border border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-700 dark:text-red-400 transition-colors"
                                >
                                    <ArrowDownCircle size={18} /> Consumir Materiais
                                </button>
                                <button
                                    onClick={onOpenProduce}
                                    className="flex items-center justify-center gap-2 p-3 rounded-lg border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 transition-colors"
                                >
                                    <ArrowUpCircle size={18} /> Produzir Saída
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {moDetailTab === 'traceability' && (
                    <div className="max-w-3xl mx-auto space-y-6">
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                <h3 className="font-bold text-slate-800 dark:text-white">Movimentações de Estoque</h3>
                                <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-500">{linkedMovements.length} Registros</span>
                            </div>
                            {linkedMovements.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 italic">
                                    Nenhuma movimentação de estoque registrada para esta ordem ainda.
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {linkedMovements.map(mov => (
                                        <div key={mov.id} className="p-4 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                            <div>
                                                <div className="font-medium text-slate-800 dark:text-white text-sm">{getProductName(mov.product_id, products)}</div>
                                                <div className="text-xs text-slate-500">{new Date(mov.date_creation * 1000).toLocaleString()} • {mov.label}</div>
                                            </div>
                                            <div className={`font-bold text-sm ${mov.qty > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                {mov.qty > 0 ? '+' : ''}{mov.qty}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
