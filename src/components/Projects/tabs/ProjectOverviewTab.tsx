import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Project } from '../../../types/projects';
import { AppView } from '../../../types/common';
import { LinkedObjects } from '../../common/LinkedObjects';
import { formatDateOnly } from '../../../utils/dateUtils';
import { formatCurrency } from '../../../utils/formatUtils';

interface ProjectOverviewTabProps {
    project: Project;
    customerName: string;
    totalInvoiced: number;
    totalSupplierBills: number;
    totalExpenses: number;
    createdByName?: string;
    modifiedByName?: string;
    onNavigate?: (view: AppView, id: string) => void;
}

export const ProjectOverviewTab: React.FC<ProjectOverviewTabProps> = ({
    project,
    customerName,
    totalInvoiced,
    totalSupplierBills,
    totalExpenses,
    createdByName,
    modifiedByName,
    onNavigate
}) => {
    const margin = totalInvoiced - totalSupplierBills - totalExpenses;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Details Card */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="font-bold text-slate-800 dark:text-white mb-4">Detalhes</h3>
                <div className="space-y-3">
                    <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <span className="text-sm text-slate-500">Cliente</span>
                        <span
                            className="text-sm font-medium text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline"
                            onClick={() => onNavigate && onNavigate('customers', project.socid)}
                        >
                            {customerName}
                        </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <span className="text-sm text-slate-500">Progresso</span>
                        <span className="text-sm font-bold text-slate-800 dark:text-white">{project.progress}%</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <span className="text-sm text-slate-500">Início</span>
                        <span className="text-sm text-slate-800 dark:text-white">{formatDateOnly(project.date_start) || '-'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <span className="text-sm text-slate-500">Fim</span>
                        <span className="text-sm text-slate-800 dark:text-white">{formatDateOnly(project.date_end) || '-'}</span>
                    </div>
                    {project.budget_amount != null && project.budget_amount > 0 && (
                        <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-sm text-slate-500">Orçamento</span>
                            <span className="text-sm font-medium text-slate-800 dark:text-white">{formatCurrency(project.budget_amount)}</span>
                        </div>
                    )}
                    {project.description && (
                        <div className="pt-1">
                            <span className="text-xs text-slate-500 block mb-1">Descrição</span>
                            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">{project.description}</p>
                        </div>
                    )}
                    {createdByName && (
                        <div className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-2 mt-2">
                            <span className="text-xs text-slate-500">Criado por</span>
                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{createdByName}</span>
                        </div>
                    )}
                    {modifiedByName && (
                        <div className="flex justify-between">
                            <span className="text-xs text-slate-500">Modificado por</span>
                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{modifiedByName}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Financial Summary Card */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="font-bold text-slate-800 dark:text-white mb-4">Resumo Financeiro</h3>
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                            <ArrowDown size={18} /> <span className="text-sm font-medium">Faturado</span>
                        </div>
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(totalInvoiced)}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-900/30">
                        <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                            <ArrowUp size={18} /> <span className="text-sm font-medium">Custos</span>
                        </div>
                        <span className="font-bold text-red-700 dark:text-red-400">{formatCurrency(totalSupplierBills + totalExpenses)}</span>
                    </div>
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                        <span className="text-sm font-bold text-slate-500">Margem</span>
                        <span className={`text-lg font-bold ${margin >= 0 ? 'text-slate-800 dark:text-white' : 'text-red-500'}`}>
                            {formatCurrency(margin)}
                        </span>
                    </div>
                </div>
            </div>

            {/* Linked Objects */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm md:col-span-2">
                <LinkedObjects
                    id={project.id}
                    type="project"
                    onNavigate={onNavigate}
                />
            </div>
        </div>
    );
};

export default ProjectOverviewTab;
