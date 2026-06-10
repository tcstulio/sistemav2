import React, { useState, useMemo } from 'react';
import { DolibarrUser, Task, ExpenseReport, LeaveRequest, Project, DolibarrConfig, AppView, GroupUser as DolibarrGroupUser, ExpenseReportLine, ExpenseReportPayment } from '../../types';
import { UserAvatar } from './UserAvatar';
import { formatDuration, getProjectName, getLeaveIcon, getLeaveStatusBadge, getExpenseStatusBadge } from './utils';
import { UserCheck, Clock, Receipt, Plane, Shield, Edit2, Trash2, X, ArrowLeft, CreditCard, Fingerprint, Mail, Phone, Users, Plus, Calendar } from 'lucide-react';
import { formatDateOnly } from '../../utils/dateUtils';
import { useGroups, useGroupUsers } from '../../hooks/dolibarr';
import * as HRAdmin from '../../services/api/hrAdmin';

import { PermissionManager } from './PermissionManager';
import { ExpenseDetailModal } from './modals/ExpenseDetailModal';
import { logger } from '../../utils/logger';
import { notifyError } from '../../utils/notifyError';
import { toast } from 'sonner';

const log = logger.child('UserDetail');

interface UserDetailProps {
    user: DolibarrUser;
    userTasks: Task[];
    userExpenses: ExpenseReport[];
    userLeaves: LeaveRequest[];
    subordinates: DolibarrUser[];
    projects: Project[];
    config: DolibarrConfig;
    onClose: () => void;
    onEditUser: () => void;
    onDeleteUser: (id: string) => void;
    onNavigate?: (view: AppView, id: string) => void;
    allUsers?: DolibarrUser[];
    expenseReportLines?: ExpenseReportLine[];
    expenseReportPayments?: ExpenseReportPayment[];
}

export const UserDetail: React.FC<UserDetailProps> = ({
    user,
    userTasks,
    userExpenses,
    userLeaves,
    subordinates,
    projects,
    config,
    onClose,
    onEditUser,
    onDeleteUser,
    onNavigate,
    allUsers = [],
    expenseReportLines = [],
    expenseReportPayments = []
}) => {
    const [detailTab, setDetailTab] = useState<'overview' | 'time' | 'expenses' | 'leaves' | 'team' | 'groups' | 'permissions'>('overview');

    // Hooks for Groups Management
    const { data: allGroups } = useGroups(config);
    const { data: allGroupLinks, refetch: refetchGroupLinks } = useGroupUsers(config);

    // Derived Groups Data,
    const userGroupIds = useMemo(() => {
        if (!allGroupLinks) return [];
        return (allGroupLinks as unknown as DolibarrGroupUser[])
            .filter(link => String(link.fk_user) === String(user.id))
            .map(link => String(link.fk_usergroup));
    }, [allGroupLinks, user.id]);

    const userGroups = useMemo(() => {
        if (!allGroups) return [];
        return allGroups.filter(g => userGroupIds.includes(String(g.id)));
    }, [allGroups, userGroupIds]);

    const availableGroups = useMemo(() => {
        if (!allGroups) return [];
        return allGroups.filter(g => !userGroupIds.includes(String(g.id)));
    }, [allGroups, userGroupIds]);

    const [isAddingGroup, setIsAddingGroup] = useState(false);
    const [selectedGroupToAdd, setSelectedGroupToAdd] = useState('');
    const [selectedExpenseReport, setSelectedExpenseReport] = useState<ExpenseReport | null>(null);

    const handleAddToGroup = async () => {
        if (!selectedGroupToAdd) return;
        try {
            await HRAdmin.addUserToGroup(config, selectedGroupToAdd, user.id);
            await refetchGroupLinks?.();
            toast.success('Usuário adicionado ao grupo.');
            setIsAddingGroup(false);
            setSelectedGroupToAdd('');
        } catch (e) {
            notifyError('Adicionar ao grupo', e);
        }
    };

    const handleRemoveFromGroup = async (groupId: string) => {
        if (!confirm('Remover usuário deste grupo?')) return;
        try {
            await HRAdmin.removeUserFromGroup(config, groupId, user.id);
            await refetchGroupLinks?.();
            toast.success('Usuário removido do grupo.');
        } catch (e) {
            notifyError('Remover do grupo', e);
        }
    };

    const totalTaskTime = userTasks.reduce((acc, t) => acc + (t.duration_effective || 0), 0);

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">{user.firstname} {user.lastname}</h2>
                        <span className="text-xs text-slate-400">{user.job || 'Membro da Equipe'}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={onEditUser} className="p-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors" title="Editar Usuário"><Edit2 size={18} /></button>
                    <button onClick={() => onDeleteUser(user.id)} className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors" title="Excluir Usuário"><Trash2 size={18} /></button>
                    <button onClick={onClose} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none">
                {[
                    { id: 'overview', label: 'Visão Geral', icon: UserCheck },
                    { id: 'team', label: `Equipe (${subordinates.length})`, icon: Users },
                    { id: 'groups', label: `Grupos (${userGroups.length})`, icon: Users },
                    { id: 'time', label: 'Logs', icon: Clock },
                    { id: 'expenses', label: 'Despesas', icon: Receipt },
                    { id: 'leaves', label: 'Licenças', icon: Plane },
                    { id: 'permissions', label: 'Permissões', icon: Shield }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setDetailTab(tab.id as any)}
                        className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${detailTab === tab.id ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        <tab.icon size={16} /> {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                {detailTab === 'overview' && (
                    <>
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 mb-6 text-center shadow-sm">
                            <div className="flex justify-center mb-3">
                                <UserAvatar user={user} config={config} size="lg" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 dark:text-white">{user.firstname} {user.lastname}</h3>
                            <p className="text-slate-500 dark:text-slate-400 mb-4">{user.email}</p>
                            <div className="flex justify-center gap-4 text-sm">
                                <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2 rounded-lg border border-slate-100 dark:border-slate-700">
                                    <span className="block font-bold text-slate-800 dark:text-white">{userTasks.length}</span>
                                    <span className="text-xs text-slate-500">Tarefas</span>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2 rounded-lg border border-slate-100 dark:border-slate-700">
                                    <span className="block font-bold text-slate-800 dark:text-white">{formatDuration(totalTaskTime)}</span>
                                    <span className="text-xs text-slate-500">Tempo Total</span>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2 rounded-lg border border-slate-100 dark:border-slate-700">
                                    <span className="block font-bold text-slate-800 dark:text-white">{userLeaves.length}</span>
                                    <span className="text-xs text-slate-500">Licenças</span>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2 rounded-lg border border-slate-100 dark:border-slate-700">
                                    <span className="block font-bold text-slate-800 dark:text-white">{subordinates.length}</span>
                                    <span className="text-xs text-slate-500">Equipe</span>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><CreditCard size={18} className="text-indigo-500" /> Informações Bancárias</h4>
                                <div className="space-y-3">
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center"><span className="text-sm text-slate-600 dark:text-slate-400">Salário</span><span className="font-bold text-slate-800 dark:text-white">{(user as any).salary ? `R$ ${Number((user as any).salary).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'Não informado'}</span></div>
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center"><span className="text-sm text-slate-600 dark:text-slate-400">IBAN</span><span className="font-mono text-xs text-slate-800 dark:text-white">{(user as any).iban || (user as any).bank || 'Não informado'}</span></div>
                                </div>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><Fingerprint size={18} className="text-emerald-500" /> Segurança</h4>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center"><span className="text-sm text-slate-600 dark:text-slate-400">Status</span><span className={`px-2 py-1 rounded text-xs ${user.statut === '1' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{user.statut === '1' ? 'Ativo' : 'Inativo'}</span></div>
                                    <div className="flex justify-between items-center"><span className="text-sm text-slate-600 dark:text-slate-400">Login</span><span className="font-mono text-xs text-slate-800 dark:text-white">{user.login}</span></div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {detailTab === 'team' && (
                    <div className="space-y-3">
                        {subordinates.length === 0 ? <p className="text-center text-slate-400 py-10">Este usuário não supervisiona ninguém.</p> : subordinates.map(sub => (
                            <div key={sub.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-md transition-all flex items-center gap-4">
                                <UserAvatar user={sub} config={config} />
                                <div className="flex-1">
                                    <div className="font-bold text-slate-800 dark:text-white text-sm">{sub.firstname} {sub.lastname}</div>
                                    <div className="text-xs text-slate-500">{sub.job || 'Membro da Equipe'}</div>
                                </div>
                                <div className="text-right">
                                    <span className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                        ID: {sub.id}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {detailTab === 'groups' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h4 className="font-bold text-slate-800 dark:text-white">Grupos Associados</h4>
                            {!isAddingGroup && (
                                <button onClick={() => setIsAddingGroup(true)} className="text-sm text-blue-600 flex items-center gap-1"><Plus size={14} /> Adicionar ao Grupo</button>
                            )}
                        </div>

                        {isAddingGroup && (
                            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg flex gap-2">
                                <select
                                    className="flex-1 p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                                    value={selectedGroupToAdd}
                                    onChange={(e) => setSelectedGroupToAdd(e.target.value)}
                                >
                                    <option value="">Selecione um grupo...</option>
                                    {availableGroups.map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                </select>
                                <button onClick={handleAddToGroup} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-bold">Salvar</button>
                                <button onClick={() => setIsAddingGroup(false)} className="px-3 py-2 bg-slate-200 text-slate-600 rounded hover:bg-slate-300 text-sm">Cancelar</button>
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-3">
                            {userGroups.length === 0 ? (
                                <p className="text-slate-400 italic text-center py-4">Usuário não pertence a nenhum grupo.</p>
                            ) : (
                                userGroups.map(group => (
                                    <div key={group.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
                                                <Users size={16} />
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-800 dark:text-white text-sm">{group.name}</div>
                                                <div className="text-xs text-slate-500">{group.note || 'Sem descrição'}</div>
                                            </div>
                                        </div>
                                        <button onClick={() => handleRemoveFromGroup(group.id)} className="text-slate-400 hover:text-red-500 p-2"><Trash2 size={16} /></button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {detailTab === 'time' && (
                    <div className="space-y-4">
                        {userTasks.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhuma tarefa atribuída.</p> : userTasks.map(task => (
                            <div
                                key={task.id}
                                className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-md transition-all flex justify-between items-center cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600"
                                onClick={() => task.project_id && onNavigate && onNavigate('projects', task.project_id)}
                            >
                                <div>
                                    <div className="font-bold text-slate-800 dark:text-white text-sm">{task.label}</div>
                                    <div className="text-xs text-slate-500">
                                        {task.ref} •
                                        <span className={task.project_id ? 'text-indigo-600 dark:text-indigo-400 hover:underline' : ''}>
                                            {task.project_id ? getProjectName(task.project_id, projects) : 'Sem Projeto'}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-indigo-600 dark:text-indigo-400">{formatDuration(task.duration_effective || 0)}</div>
                                    <div className="text-xs text-slate-400">de {formatDuration(task.planned_workload || 0)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {detailTab === 'expenses' && (
                    <div className="space-y-3">
                        {userExpenses.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhuma despesa registrada.</p> : userExpenses.map(exp => (
                            <div
                                key={exp.id}
                                className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600"
                                onClick={() => setSelectedExpenseReport(exp)}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg">
                                        <Receipt size={24} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-bold text-slate-900 dark:text-white">{exp.ref}</h4>
                                            {getExpenseStatusBadge(exp.statut)}
                                        </div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-1">{exp.note_public || "Sem descrição"}</p>
                                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                                            <span className="flex items-center gap-1"><Calendar size={12} /> {formatDateOnly(exp.date_debut)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="block text-xl font-bold text-slate-900 dark:text-white">${exp.total_ttc.toFixed(2)}</span>
                                    <span className="text-xs text-slate-500">Total TTC</span>
                                </div>
                            </div>
                        ))}

                        {selectedExpenseReport && (
                            <ExpenseDetailModal
                                expense={selectedExpenseReport}
                                config={config}
                                onClose={() => setSelectedExpenseReport(null)}
                                users={allUsers.length > 0 ? allUsers : [user]} // Pass all users for robust name resolution
                                onNavigate={onNavigate}
                                expenseReportLines={expenseReportLines}
                                expenseReportPayments={expenseReportPayments}
                                projects={projects}
                                variant="side"
                            />
                        )}
                    </div>
                )}

                {detailTab === 'leaves' && (
                    <div className="space-y-3">
                        {userLeaves.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhuma licença registrada.</p> : userLeaves.map(l => (
                            <div key={l.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded text-slate-500">{getLeaveIcon(l.type || '')}</div>
                                    <div><div className="font-bold text-slate-800 dark:text-white text-sm">{l.type}</div><div className="text-xs text-slate-500">{formatDateOnly(l.date_debut)} - {formatDateOnly(l.date_fin)}</div></div>
                                </div>
                                {getLeaveStatusBadge(l.statut)}
                            </div>
                        ))}
                    </div>
                )}

                {detailTab === 'permissions' && (
                    <PermissionManager targetId={user.id} targetType="user" config={config} />
                )}
            </div>
        </div>
    );
};
