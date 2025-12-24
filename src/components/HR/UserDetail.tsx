import React, { useState } from 'react';
import { DolibarrUser, Task, ExpenseReport, LeaveRequest, Project, DolibarrConfig, AppView } from '../../types';
import { UserAvatar } from './UserAvatar';
import { formatDuration, getProjectName, getLeaveIcon, getLeaveStatusBadge, getExpenseStatusBadge } from './utils';
import { UserCheck, Clock, Receipt, Plane, Shield, Edit2, Trash2, X, ArrowLeft, CreditCard, Fingerprint, Mail, Phone } from 'lucide-react';
import { formatDateOnly } from '../../utils/dateUtils';

interface UserDetailProps {
    user: DolibarrUser;
    userTasks: Task[];
    userExpenses: ExpenseReport[];
    userLeaves: LeaveRequest[];
    projects: Project[];
    config: DolibarrConfig;
    onClose: () => void;
    onEditUser: () => void;
    onDeleteUser: (id: string) => void;
    onNavigate?: (view: AppView, id: string) => void;
}

export const UserDetail: React.FC<UserDetailProps> = ({
    user,
    userTasks,
    userExpenses,
    userLeaves,
    projects,
    config,
    onClose,
    onEditUser,
    onDeleteUser,
    onNavigate
}) => {
    const [detailTab, setDetailTab] = useState<'overview' | 'time' | 'expenses' | 'leaves' | 'permissions'>('overview');

    // Mock Permissions (from original code)
    const [mockPermissions, setMockPermissions] = useState({
        manufacturing: true,
        crm: true,
        accounting: false,
        hr: true,
        inventory: true
    });

    const togglePermission = (key: string) => {
        setMockPermissions(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
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
                    { id: 'time', label: 'Logs de Tempo', icon: Clock },
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
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><CreditCard size={18} className="text-indigo-500" /> Informações Bancárias</h4>
                                <div className="space-y-3">
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center"><span className="text-sm text-slate-600 dark:text-slate-400">Salário</span><span className="font-bold text-slate-800 dark:text-white">$---</span></div>
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center"><span className="text-sm text-slate-600 dark:text-slate-400">IBAN</span><span className="font-mono text-xs text-slate-800 dark:text-white">XXXX-XXXX-XXXX</span></div>
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
                                        {task.fk_user_creat && (
                                            <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                                Criado por: {task.fk_user_creat === user.id ? 'Mim' : `User ${task.fk_user_creat}`}
                                            </span>
                                        )}
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
                            <div key={exp.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-md transition-all flex justify-between items-center">
                                <div><div className="font-bold text-slate-800 dark:text-white text-sm">{exp.ref}</div><div className="text-xs text-slate-500">{formatDateOnly(exp.date_debut)}</div></div>
                                <div className="text-right"><div className="font-bold text-slate-800 dark:text-white">${exp.total_ttc.toLocaleString()}</div>{getExpenseStatusBadge(exp.statut)}</div>
                            </div>
                        ))}
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
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><Shield size={18} className="text-red-500" /> Controle de Acesso</h4>
                        <div className="space-y-2">
                            {Object.entries(mockPermissions).map(([key, val]) => (
                                <div key={key} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 capitalize">{key} Access</span>
                                    <button
                                        onClick={() => togglePermission(key)}
                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${val ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                                    >
                                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${val ? 'translate-x-5' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
