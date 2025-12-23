import React, { useMemo } from 'react';
import { ExpenseReport, DolibarrUser } from '../../../types';
import { getExpenseStatusBadge, getUserName } from '../utils';
import { Receipt, Plus, Calendar, User } from 'lucide-react';

interface ExpensesTabProps {
    expenseReports: ExpenseReport[];
    users: DolibarrUser[];
    searchTerm: string;
    sortConfig: { key: string, direction: 'asc' | 'desc' };
    displayLimit: number;
    onSelectExpense: (e: ExpenseReport) => void;
    onOpenScanner: () => void;
}

export const ExpensesTab: React.FC<ExpensesTabProps> = ({
    expenseReports,
    users,
    searchTerm,
    sortConfig,
    displayLimit,
    onSelectExpense,
    onOpenScanner
}) => {

    const filteredExpenses = useMemo(() => {
        let result = expenseReports.filter(e => {
            const userName = getUserName(e.fk_user_author, users).toLowerCase();
            return e.ref.toLowerCase().includes(searchTerm.toLowerCase()) || userName.includes(searchTerm.toLowerCase());
        });

        if (sortConfig.key !== 'default') {
            result.sort((a, b) => {
                let valA: any = 0, valB: any = 0;
                if (sortConfig.key === 'date') {
                    valA = a.date_debut;
                    valB = b.date_debut;
                } else if (sortConfig.key === 'amount') {
                    valA = a.total_ttc;
                    valB = b.total_ttc;
                } else if (sortConfig.key === 'status') {
                    valA = a.statut;
                    valB = b.statut;
                }

                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        } else {
            result.sort((a, b) => b.date_debut - a.date_debut);
        }
        return result;
    }, [expenseReports, users, searchTerm, sortConfig]);

    const displayedExpenses = filteredExpenses.slice(0, displayLimit);

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg text-slate-800 dark:text-white">Relatórios de Despesas</h3>
                <button
                    onClick={onOpenScanner}
                    className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                    <Plus size={16} /> Nova Despesa
                </button>
            </div>

            {displayedExpenses.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <Receipt size={48} className="mx-auto mb-4 opacity-50" />
                    <p>Nenhuma despesa encontrada.</p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {displayedExpenses.map(expense => (
                        <div key={expense.id} onClick={() => onSelectExpense(expense)} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg">
                                    <Receipt size={24} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-slate-900 dark:text-white">{expense.ref}</h4>
                                        {getExpenseStatusBadge(expense.statut)}
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-1">{expense.note_public || "Sem descrição"}</p>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                                        <span className="flex items-center gap-1"><User size={12} /> {getUserName(expense.fk_user_author, users)}</span>
                                        <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(expense.date_debut < 100000000000 ? expense.date_debut * 1000 : expense.date_debut).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <span className="block text-xl font-bold text-slate-900 dark:text-white">${expense.total_ttc.toFixed(2)}</span>
                                <span className="text-xs text-slate-500">Total TTC</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
