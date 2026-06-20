import React from 'react';
import { Receipt } from 'lucide-react';
import { Invoice, SupplierInvoice } from '../../../types/sales';
import { AppView } from '../../../types/common';
import { formatDateOnly } from '../../../utils/dateUtils';
import { formatCurrency } from '../../../utils/formatUtils';

interface ProjectFinancialsTabProps {
    invoices: Invoice[];
    supplierInvoices: SupplierInvoice[];
    onNavigate?: (view: AppView, id: string) => void;
}

export const ProjectFinancialsTab: React.FC<ProjectFinancialsTabProps> = ({
    invoices,
    supplierInvoices,
    onNavigate
}) => {
    return (
        <div className="space-y-6">
            {/* Customer Invoices */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                    <Receipt size={18} className="text-emerald-500" />
                    Faturas de Cliente ({invoices.length})
                </h3>
                <div className="space-y-2">
                    {invoices.length === 0 ? (
                        <p className="text-sm text-slate-400">Nenhuma fatura de cliente encontrada.</p>
                    ) : (
                        invoices.map(inv => (
                            <div
                                key={inv.id}
                                className="flex justify-between items-center p-3 border border-slate-100 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                                onClick={() => onNavigate && onNavigate('invoices', inv.id)}
                            >
                                <div>
                                    <div className="font-medium text-slate-800 dark:text-white text-sm">{inv.ref}</div>
                                    <div className="text-xs text-slate-500">{formatDateOnly(inv.date)}</div>
                                </div>
                                <div className="text-right font-bold text-emerald-600 dark:text-emerald-400">
                                    {formatCurrency(inv.total_ttc)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Supplier Invoices */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                    <Receipt size={18} className="text-red-500" />
                    Faturas de Fornecedor ({supplierInvoices.length})
                </h3>
                <div className="space-y-2">
                    {supplierInvoices.length === 0 ? (
                        <p className="text-sm text-slate-400">Nenhuma fatura de fornecedor encontrada.</p>
                    ) : (
                        supplierInvoices.map(inv => (
                            <div
                                key={inv.id}
                                className="flex justify-between items-center p-3 border border-slate-100 dark:border-slate-700 rounded-lg"
                            >
                                <div>
                                    <div className="font-medium text-slate-800 dark:text-white text-sm">{inv.ref}</div>
                                    <div className="text-xs text-slate-500">{inv.label || 'Sem descrição'}</div>
                                </div>
                                <div className="text-right font-bold text-red-600 dark:text-red-400">
                                    -{formatCurrency(inv.total_ttc)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProjectFinancialsTab;
