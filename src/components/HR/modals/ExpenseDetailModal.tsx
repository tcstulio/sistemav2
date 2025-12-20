import React from 'react';
import { DolibarrConfig, ExpenseReport, DolibarrUser } from '../../../types';
import { DolibarrService } from '../../../services/dolibarrService';
import { Receipt, X, Calendar, User, FileText, Download, Send, CheckCircle, Banknote, FileEdit } from 'lucide-react';

interface ExpenseDetailModalProps {
    expense: ExpenseReport | null;
    onClose: () => void;
    config: DolibarrConfig;
    users: DolibarrUser[];
}

export const ExpenseDetailModal: React.FC<ExpenseDetailModalProps> = ({ expense, onClose, config, users }) => {
    if (!expense) return null;

    const getUserName = (id: string) => {
        const user = users.find(u => String(u.id) === String(id));
        return user ? `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login : 'Usuário Desconhecido';
    };

    const getExpenseStatusBadge = (status: string) => {
        switch (status) {
            case '0': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold border border-slate-200"><FileEdit size={10} /> Rascunho</span>;
            case '1': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold border border-blue-200"><Send size={10} /> Submetido</span>;
            case '2': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-bold border border-indigo-200"><CheckCircle size={10} /> Aprovado</span>;
            case '4': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-bold border border-indigo-200"><CheckCircle size={10} /> Aprovado</span>;
            case '5': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold border border-emerald-200"><Banknote size={10} /> Pago</span>;
            case '6': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold border border-emerald-200"><Banknote size={10} /> Pago</span>;
            case '9': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold border border-red-200"><X size={10} /> Recusado</span>;
            default: return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold border border-red-200"><X size={10} /> Recusado</span>;
        }
    };

    const handleDownloadPdf = (ref: string) => {
        DolibarrService.downloadDocument(config, 'expensereport', ref);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                    <div className="flex items-center gap-2">
                        <Receipt size={18} className="text-indigo-600 dark:text-indigo-400" />
                        <h3 className="font-bold text-lg dark:text-white">{expense.ref}</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                </div>
                <div className="p-6 overflow-y-auto">
                    <div className="flex justify-between items-center mb-6 bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                        <div>
                            <p className="text-xs text-slate-500 uppercase font-bold mb-1">Valor Total</p>
                            <p className="text-3xl font-bold text-slate-900 dark:text-white">${expense.total_ttc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-slate-500 uppercase font-bold mb-1">Status</p>
                            {getExpenseStatusBadge(expense.statut)}
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-slate-500 uppercase font-bold">Data</label>
                                <p className="text-slate-800 dark:text-white flex items-center gap-2 mt-1">
                                    <Calendar size={14} className="text-slate-400" />
                                    {new Date(expense.date_debut * 1000).toLocaleDateString()}
                                </p>
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 uppercase font-bold">Autor</label>
                                <p className="text-slate-800 dark:text-white flex items-center gap-2 mt-1">
                                    <User size={14} className="text-slate-400" />
                                    {getUserName(expense.fk_user_author)}
                                </p>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-bold mb-2 block flex items-center gap-1">
                                <FileText size={12} /> Descrição / Justificativa
                            </label>
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-100 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                {expense.note_public || "Nenhuma descrição fornecida."}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                    <button onClick={() => handleDownloadPdf(expense.ref)} className="px-4 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-600 flex items-center gap-2">
                        <Download size={16} /> Comprovante
                    </button>
                </div>
            </div>
        </div>
    );
};
