import React from 'react';
import { ManufacturingOrder, DolibarrConfig, Project, Product } from '../../../types';
import { Factory, Package, FolderKanban } from 'lucide-react';
import { getProductName, getProjectName, getStatusBadge } from '../utils';

interface ManufacturingOrdersTabProps {
    orders: ManufacturingOrder[];
    projects: Project[];
    products: Product[];
    searchTerm: string;
    config: DolibarrConfig;
    selectedMOId?: string;
    onSelectMO: (mo: ManufacturingOrder) => void;
}

export const ManufacturingOrdersTab: React.FC<ManufacturingOrdersTabProps> = ({
    orders,
    projects,
    products,
    searchTerm,
    config,
    selectedMOId,
    onSelectMO
}) => {
    const filteredOrders = orders.filter(o =>
        o.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.label.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (filteredOrders.length === 0) {
        return (
            <div className="text-center py-20 text-slate-400">
                <Factory size={48} className="mx-auto mb-4 opacity-50" />
                <p>Nenhuma Ordem de Produção encontrada.</p>
            </div>
        );
    }

    return (
        <div className="grid gap-4">
            {filteredOrders.map(mo => (
                <div
                    key={mo.id}
                    onClick={() => onSelectMO(mo)}
                    className={`bg-white dark:bg-slate-900 p-5 rounded-xl border transition-all cursor-pointer ${selectedMOId === mo.id ? `border-${config.themeColor}-500 bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20` : 'border-slate-200 dark:border-slate-800 hover:shadow-md'}`}
                >
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex flex-col">
                            <span className="font-bold text-slate-800 dark:text-white text-lg">{mo.ref}</span>
                            <span className="text-xs text-slate-500">{mo.label}</span>
                        </div>
                        {getStatusBadge(mo.status)}
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 mb-3">
                        <Package size={20} className="text-indigo-500" />
                        <div>
                            <div className="text-xs text-slate-500 uppercase font-bold">Produzindo</div>
                            <div className="font-medium text-slate-800 dark:text-white text-sm">
                                {getProductName(mo.product_to_produce_id, products)}
                            </div>
                        </div>
                        <div className="ml-auto font-bold text-lg text-slate-700 dark:text-slate-300">x{mo.qty}</div>
                    </div>
                    {mo.project_id && (
                        <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 mb-2 cursor-pointer hover:underline">
                            <FolderKanban size={12} /> {getProjectName(mo.project_id, projects)}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
