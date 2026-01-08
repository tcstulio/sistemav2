import React from 'react';
import { Truck, ShoppingCart, Factory, FileSignature } from 'lucide-react';
import { Shipment } from '../../../types/products';
import { ManufacturingOrder } from '../../../types/manufacturing';
import { SupplierOrder, Contract } from '../../../types/sales';
import { Intervention } from '../../../types/projects';
import { AppView } from '../../../types/common';
import { formatDateOnly } from '../../../utils/dateUtils';

// Shipments Tab
interface ProjectShipmentsTabProps {
    shipments: Shipment[];
    onNavigate?: (view: AppView, id: string) => void;
}

export const ProjectShipmentsTab: React.FC<ProjectShipmentsTabProps> = ({ shipments, onNavigate }) => (
    <div className="space-y-3">
        {shipments.length === 0 ? (
            <p className="text-center text-slate-400 py-10">Nenhum envio encontrado.</p>
        ) : (
            shipments.map(s => (
                <div
                    key={s.id}
                    className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center cursor-pointer hover:shadow-md"
                    onClick={() => onNavigate && onNavigate('shipments', s.id)}
                >
                    <div className="flex items-center gap-3">
                        <Truck size={20} className="text-blue-500" />
                        <div>
                            <div className="font-bold text-slate-800 dark:text-white text-sm">{s.ref}</div>
                            <div className="text-xs text-slate-500 flex gap-2">
                                <span>{formatDateOnly(s.date_creation)}</span>
                                {s.tracking_number && (
                                    <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">TRK: {s.tracking_number}</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${s.status === '1' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                            {s.status === '1' ? 'Enviado' : 'Aberto'}
                        </span>
                    </div>
                </div>
            ))
        )}
    </div>
);

// Purchases Tab
interface ProjectPurchasesTabProps {
    supplierOrders: SupplierOrder[];
}

export const ProjectPurchasesTab: React.FC<ProjectPurchasesTabProps> = ({ supplierOrders }) => (
    <div className="space-y-3">
        {supplierOrders.length === 0 ? (
            <p className="text-center text-slate-400 py-10">Nenhum pedido de compra encontrado.</p>
        ) : (
            supplierOrders.map(so => (
                <div key={so.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center cursor-pointer hover:shadow-md">
                    <div className="flex items-center gap-3">
                        <ShoppingCart size={20} className="text-orange-500" />
                        <div>
                            <div className="font-bold text-slate-800 dark:text-white text-sm">{so.ref}</div>
                            <div className="text-xs text-slate-500">{formatDateOnly(so.date_creation)}</div>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="font-bold text-slate-700 dark:text-slate-300">${so.total_ttc.toLocaleString()}</div>
                        <div className="text-xs text-slate-400">{so.statut}</div>
                    </div>
                </div>
            ))
        )}
    </div>
);

// Manufacturing Tab
interface ProjectManufacturingTabProps {
    manufacturingOrders: ManufacturingOrder[];
}

export const ProjectManufacturingTab: React.FC<ProjectManufacturingTabProps> = ({ manufacturingOrders }) => (
    <div className="space-y-3">
        {manufacturingOrders.length === 0 ? (
            <p className="text-center text-slate-400 py-10">Nenhuma ordem de produção vinculada.</p>
        ) : (
            manufacturingOrders.map(mo => (
                <div key={mo.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center">
                    <div>
                        <div className="font-bold text-slate-800 dark:text-white text-sm">{mo.ref}</div>
                        <div className="text-xs text-slate-500">{mo.label}</div>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <Factory size={16} className="text-orange-500" />
                        <span className="font-medium">Qtd: {mo.qty}</span>
                    </div>
                </div>
            ))
        )}
    </div>
);

// Contracts Tab
interface ProjectContractsTabProps {
    contracts: Contract[];
    onNavigate?: (view: AppView, id: string) => void;
}

export const ProjectContractsTab: React.FC<ProjectContractsTabProps> = ({ contracts, onNavigate }) => (
    <div className="space-y-3">
        {contracts.length === 0 ? (
            <p className="text-center text-slate-400 py-10">Nenhum contrato vinculado.</p>
        ) : (
            contracts.map(c => (
                <div
                    key={c.id}
                    className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center cursor-pointer hover:shadow-md"
                    onClick={() => onNavigate && onNavigate('contracts', c.id)}
                >
                    <div className="flex items-center gap-3">
                        <FileSignature size={20} className="text-indigo-500" />
                        <div>
                            <div className="font-bold text-slate-800 dark:text-white text-sm">{c.ref}</div>
                            <div className="text-xs text-slate-500">{formatDateOnly(c.date_contrat)}</div>
                        </div>
                    </div>
                </div>
            ))
        )}
    </div>
);

// Interventions Tab
interface ProjectInterventionsTabProps {
    interventions: Intervention[];
    onNavigate?: (view: AppView, id: string) => void;
}

export const ProjectInterventionsTab: React.FC<ProjectInterventionsTabProps> = ({ interventions, onNavigate }) => (
    <div className="space-y-3">
        {interventions.length === 0 ? (
            <p className="text-center text-slate-400 py-10">Nenhuma intervenção encontrada.</p>
        ) : (
            interventions.map(int => (
                <div
                    key={int.id}
                    className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center cursor-pointer hover:shadow-md"
                    onClick={() => onNavigate && onNavigate('interventions', int.id)}
                >
                    <div>
                        <div className="font-bold text-slate-800 dark:text-white text-sm">{int.ref}</div>
                        <div className="text-xs text-slate-500">{int.description}</div>
                    </div>
                    <div className="text-xs text-slate-500">{formatDateOnly(int.date)}</div>
                </div>
            ))
        )}
    </div>
);

export default {
    ProjectShipmentsTab,
    ProjectPurchasesTab,
    ProjectManufacturingTab,
    ProjectContractsTab,
    ProjectInterventionsTab
};
