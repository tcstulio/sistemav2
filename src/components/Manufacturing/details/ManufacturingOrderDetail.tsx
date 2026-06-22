
import React, { useState } from 'react';
import { ManufacturingOrder, DolibarrConfig, Project, Product, StockMovement } from '../../../types';
import { Package, Clock, User, AlertCircle, ArrowLeft, Settings, X, ArrowDownCircle, ArrowUpCircle, Pencil, Trash2, CheckCheck, XCircle } from 'lucide-react';
import { formatDateTime } from '../../../utils/dateUtils';
import { getProductName, getStatusBadge } from '../utils';

interface ManufacturingOrderDetailProps {
    order: ManufacturingOrder;
    products: Product[];
    stockMovements: StockMovement[];
    config: DolibarrConfig;
    onClose: () => void;
    onEdit?: () => void;
    onOpenConsume: () => void;
    onOpenProduce: () => void;
    onDelete?: () => void;
    onValidate?: () => void;
    onCancel?: () => void;
}

export const ManufacturingOrderDetail: React.FC<ManufacturingOrderDetailProps> = ({
    order,
    products,
    stockMovements,
    config,
    onClose,
    onEdit,
    onOpenConsume,
    onOpenProduce,
    onDelete,
    onValidate,
    onCancel
}) => {
    const [moDetailTab, setMoDetailTab] = useState<'overview' | 'traceability'>('overview');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const linkedMovements = stockMovements.filter(m =>
        m.label && m.label.includes(order.ref)
    );

    const isDraft = order.status === '0';
    const isValidated = order.status === '1';
    const canValidate = isDraft && onValidate;
    const canCancel = (isDraft || isValidated) && onCancel;

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
                    {onEdit && (
                        <button onClick={onEdit} className="flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 rounded font-medium transition-colors">
                            <Pencil size={12} /> Editar
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="flex items-center gap-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/40 px-3 py-1.5 rounded font-medium transition-colors"
                            data-testid="mo-delete-btn"
                        >
                            <Trash2 size={12} /> Excluir
                        </button>
                    )}
                    <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><Settings size={20} /></button>
                    <button onClick={onClose} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            {/* Delete Confirmation */}
            {showDeleteConfirm && (
                <div className="flex-none bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-3 flex items-center justify-between gap-4">
                    <span className="text-sm text-red-700 dark:text-red-300">Tem certeza que deseja excluir a ordem <strong>{order.ref}</strong>?</span>
                    <div className="flex gap-2 flex-shrink-0">
                        <button
                            onClick={() => setShowDeleteConfirm(false)}
                            className="text-xs px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={() => { setShowDeleteConfirm(false); onDelete?.(); }}
                            className="text-xs px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700"
                            data-testid="mo-delete-confirm-btn"
                        >
                            Excluir
                        </button>
                    </div>
                </div>
            )}

            {/* Status Actions */}
            {(canValidate || canCancel) && (
                <div className="flex-none bg-slate-50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800 px-4 py-2 flex items-center gap-2">
                    <span className="text-xs text-slate-500 mr-1">Ações de status:</span>
                    {canValidate && (
                        <button
                            onClick={onValidate}
                            className="flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/40 px-3 py-1.5 rounded font-medium transition-colors"
                            data-testid="mo-validate-btn"
                        >
                            <CheckCheck size={12} /> Validar
                        </button>
                    )}
                    {canCancel && (
                        <button
                            onClick={onCancel}
                            className="flex items-center gap-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/40 px-3 py-1.5 rounded font-medium transition-colors"
                            data-testid="mo-cancel-btn"
                        >
                            <XCircle size={12} /> Cancelar Ordem
                        </button>
                    )}
                </div>
            )}

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
                                                <div className="text-xs text-slate-500">{formatDateTime(mov.date_creation)} • {mov.label}</div>
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
