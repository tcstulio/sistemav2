import React from 'react';
import { FileSignature, ShoppingCart } from 'lucide-react';
import { Proposal, Order } from '../../../types/sales';
import { AppView } from '../../../types/common';
import { formatDateOnly } from '../../../utils/dateUtils';

interface ProjectSalesTabProps {
    proposals: Proposal[];
    orders: Order[];
    onNavigate?: (view: AppView, id: string) => void;
}

export const ProjectSalesTab: React.FC<ProjectSalesTabProps> = ({
    proposals,
    orders,
    onNavigate
}) => {
    return (
        <div className="space-y-6">
            {/* Proposals */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                    <FileSignature size={18} className="text-orange-500" />
                    Propostas ({proposals.length})
                </h3>
                <div className="space-y-2">
                    {proposals.length === 0 ? (
                        <p className="text-sm text-slate-400">Nenhuma proposta encontrada.</p>
                    ) : (
                        proposals.map(p => (
                            <div
                                key={p.id}
                                className="flex justify-between items-center p-3 border border-slate-100 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                                onClick={() => onNavigate && onNavigate('proposals', p.id)}
                            >
                                <div>
                                    <div className="font-medium text-slate-800 dark:text-white text-sm">{p.ref}</div>
                                    <div className="text-xs text-slate-500">{formatDateOnly(p.date)}</div>
                                </div>
                                <div className="text-right font-bold text-slate-700 dark:text-slate-300 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-xs">
                                    ${p.total_ttc.toLocaleString()}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Orders */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                    <ShoppingCart size={18} className="text-indigo-500" />
                    Pedidos ({orders.length})
                </h3>
                <div className="space-y-2">
                    {orders.length === 0 ? (
                        <p className="text-sm text-slate-400">Nenhum pedido encontrado.</p>
                    ) : (
                        orders.map(o => (
                            <div
                                key={o.id}
                                className="flex justify-between items-center p-3 border border-slate-100 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                                onClick={() => onNavigate && onNavigate('orders', o.id)}
                            >
                                <div>
                                    <div className="font-medium text-slate-800 dark:text-white text-sm">{o.ref}</div>
                                    <div className="text-xs text-slate-500">{formatDateOnly(o.date)}</div>
                                </div>
                                <div className="text-right font-bold text-indigo-600 dark:text-indigo-400">
                                    ${o.total_ttc.toLocaleString()}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProjectSalesTab;
