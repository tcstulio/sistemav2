import React, { useMemo } from 'react';
import { LeaveRequest, DolibarrUser } from '../../../types';
import { Plane, Thermometer, Sun, Calendar, User, Plus } from 'lucide-react';

interface LeavesTabProps {
    leaveRequests: LeaveRequest[];
    users: DolibarrUser[];
    searchTerm: string;
    sortConfig: { key: string, direction: 'asc' | 'desc' };
    onOpenLeaveModal: () => void;
}

export const LeavesTab: React.FC<LeavesTabProps> = ({
    leaveRequests,
    users,
    searchTerm,
    sortConfig,
    onOpenLeaveModal
}) => {

    const getUserName = (id: string) => {
        const user = users.find(u => String(u.id) === String(id));
        return user ? `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login : 'Usuário Desconhecido';
    };

    const getLeaveStatusBadge = (status: string) => {
        switch (status) {
            case '1': return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600 border border-slate-200">Rascunho</span>;
            case '2': return <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-700 border border-orange-200">Aguardando</span>;
            case '3': return <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 border border-emerald-200">Aprovado</span>;
            case '4': return <span className="px-2 py-0.5 rounded text-xs bg-red-50 text-red-600 border border-red-100">Cancelado</span>;
            case '5': return <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 border border-red-200">Recusado</span>;
            default: return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500">Desconhecido</span>;
        }
    };

    const getLeaveIcon = (type: string) => {
        const t = (type || '').toLowerCase();
        if (t.includes('sick')) return <Thermometer size={16} className="text-red-500" />;
        if (t.includes('vacation') || t.includes('holiday')) return <Sun size={16} className="text-orange-500" />;
        return <Plane size={16} className="text-blue-500" />;
    };

    const filteredLeaves = useMemo(() => {
        let result = leaveRequests.filter(l => {
            const userName = getUserName(l.fk_user).toLowerCase();
            return userName.includes(searchTerm.toLowerCase()) || (l.description || '').toLowerCase().includes(searchTerm.toLowerCase());
        });

        if (sortConfig.key !== 'default') {
            result.sort((a, b) => {
                let valA: any = 0, valB: any = 0;
                if (sortConfig.key === 'date') {
                    valA = a.date_debut;
                    valB = b.date_debut;
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
    }, [leaveRequests, users, searchTerm, sortConfig]);

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg text-slate-800 dark:text-white">Solicitações de Licença</h3>
                <button
                    onClick={onOpenLeaveModal}
                    className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                    <Plus size={16} /> Nova Solicitação
                </button>
            </div>

            {filteredLeaves.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <Plane size={48} className="mx-auto mb-4 opacity-50" />
                    <p>Nenhuma licença encontrada.</p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {filteredLeaves.map(leave => (
                        <div key={leave.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                    {getLeaveIcon(leave.type)}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-slate-900 dark:text-white">{leave.type}</h4>
                                        {getLeaveStatusBadge(leave.statut)}
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-1">{leave.description || "Sem descrição"}</p>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                                        <span className="flex items-center gap-1"><User size={12} /> {getUserName(leave.fk_user)}</span>
                                        <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(leave.date_debut < 100000000000 ? leave.date_debut * 1000 : leave.date_debut).toLocaleDateString()} - {new Date(leave.date_fin < 100000000000 ? leave.date_fin * 1000 : leave.date_fin).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
