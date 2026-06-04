import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { DolibarrUser, ExpenseReport, RecruitmentJobPosition, DolibarrConfig, Task, Project, Ticket, AppView, Candidate, LeaveRequest, UserGroup } from '../types';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { Search, Plus, Filter, ArrowUp, ArrowDown, UserCheck, Plane, BarChart3, Banknote, Briefcase, Scan, Users, ArrowUpDown, Network } from 'lucide-react';
import { TeamTab } from './HR/tabs/TeamTab';
import { GroupsTab } from './HR/tabs/GroupsTab';
import { HierarchyTab } from './HR/tabs/HierarchyTab';
import { ExpensesTab } from './HR/tabs/ExpensesTab';
import { LeavesTab } from './HR/tabs/LeavesTab';
import { RecruitmentJobsList } from './HR/tabs/RecruitmentJobsList';
import { RecruitmentCandidatesList } from './HR/tabs/RecruitmentCandidatesList';
import { WorkloadTab } from './HR/tabs/WorkloadTab';
import { UserDetail } from './HR/UserDetail';
import { GroupDetail } from './HR/GroupDetail';
import { UserModal } from './HR/modals/UserModal';
import { JobModal } from './HR/modals/JobModal';
import { LeaveModal } from './HR/modals/LeaveModal';
import { ExpenseScannerModal } from './HR/modals/ExpenseScannerModal';
import { ExpenseDetailModal } from './HR/modals/ExpenseDetailModal';
import { GroupModal } from './HR/modals/GroupModal';
import { DolibarrService } from '../services/dolibarrService';
import * as HRAdmin from '../services/api/hrAdmin';
import { useDolibarr } from '../context/DolibarrContext';
import { useUsers, useExpenseReports, useLeaveRequests, useJobPositions, useCandidates, useTasks, useTickets, useProjects, useGroups, useExpenseReportLines, useExpenseReportPayments } from '../hooks/dolibarr';
import { logger } from '../utils/logger';

const log = logger.child('HRList');


interface HRListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
    onRefresh?: (options?: { forceFull?: boolean, limit?: number, page?: number, query?: string }) => void;
}

const HRList: React.FC<HRListProps> = ({
    onNavigate,
    initialItemId,
    onRefresh
}) => {
    const { config, currentUser } = useDolibarr();

    const { data: usersData } = useUsers(config);
    const users = usersData || [];
    const { data: expenseReportsData } = useExpenseReports(config);
    const expenseReports = expenseReportsData || [];
    const { data: leaveRequestsData } = useLeaveRequests(config);
    const leaveRequests = leaveRequestsData || [];
    const { data: jobPositionsData } = useJobPositions(config);
    const jobPositions = jobPositionsData || [];
    const { data: candidatesData } = useCandidates(config);
    const candidates = candidatesData || [];
    const { data: tasksData } = useTasks(config);
    const tasks = tasksData || [];
    const { data: ticketsData } = useTickets(config);
    const tickets = ticketsData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];
    const { data: userGroupsData } = useGroups(config);
    const userGroups = userGroupsData || [];
    const { data: expenseReportLinesData } = useExpenseReportLines(config);
    const expenseReportLines = expenseReportLinesData || [];
    const { data: expenseReportPaymentsData } = useExpenseReportPayments(config);
    const expenseReportPayments = expenseReportPaymentsData || [];


    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [activeTab, setActiveTab] = useState<'team' | 'groups' | 'hierarchy' | 'workload' | 'expenses' | 'leaves' | 'recruitment'>('team');
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'default', direction: 'desc' });
    const [displayLimit, setDisplayLimit] = useState(50);
    const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);

    // Selection State
    const [selectedUser, setSelectedUser] = useState<DolibarrUser | null>(null);
    const [selectedGroup, setSelectedGroup] = useState<UserGroup | null>(null);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]); // Multi-select
    const [viewingCandidates, setViewingCandidates] = useState<string | null>(null);
    const [selectedExpense, setSelectedExpense] = useState<ExpenseReport | null>(null);

    // Modals
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [isJobModalOpen, setIsJobModalOpen] = useState(false);
    const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false); // NEW Group Modal State

    // Edit/Create User State
    const [userToEdit, setUserToEdit] = useState<DolibarrUser | null>(null);
    const [groupToEdit, setGroupToEdit] = useState<UserGroup | null>(null);
    const [prefillUserData, setPrefillUserData] = useState<Partial<DolibarrUser> | null>(null);

    // Deeplink HITL do agente (#57): create_job / create_leave (aplica 1x por token).
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    const [jobPrefill, setJobPrefill] = useState<Record<string, string> | undefined>(undefined);
    const [leavePrefill, setLeavePrefill] = useState<Record<string, string> | undefined>(undefined);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_job') {
            appliedPrefillRef.current = prefill;
            setJobPrefill(prefill.data);
            setIsJobModalOpen(true);
            toast.info('Revise os dados e confirme a criação da vaga.');
        } else if (prefill.kind === 'create_leave') {
            appliedPrefillRef.current = prefill;
            setLeavePrefill(prefill.data);
            setIsLeaveModalOpen(true);
            toast.info('Revise os dados e confirme a solicitação de licença.');
        }
    }, [prefill]);

    // Derived Data for UserDetail
    const userTasks = useMemo(() => selectedUser ? tasks.filter(t => (t.fk_user_assign && String(t.fk_user_assign) === String(selectedUser.id)) || (t.fk_user_creat && String(t.fk_user_creat) === String(selectedUser.id))) : [], [selectedUser, tasks]);
    const userExpenses = useMemo(() => selectedUser ? expenseReports.filter(e => String(e.fk_user_author) === String(selectedUser.id)) : [], [selectedUser, expenseReports]);
    const userLeaves = useMemo(() => selectedUser ? leaveRequests.filter(l => String(l.fk_user) === String(selectedUser.id)) : [], [selectedUser, leaveRequests]);

    // Get all subordinates recursively
    const userSubordinates = useMemo(() => {
        if (!selectedUser) return [];

        const getAllSubordinates = (managerId: string): DolibarrUser[] => {
            const directReports = users.filter(u => String(u.supervisor_id) === String(managerId));
            let allReports = [...directReports];

            directReports.forEach(report => {
                allReports = [...allReports, ...getAllSubordinates(report.id)];
            });

            return allReports;
        };

        return getAllSubordinates(selectedUser.id);
    }, [selectedUser, users]);

    // Handle deep linking or initial item
    useEffect(() => {
        if (initialItemId && users.length > 0 && !selectedUser) {
            const u = users.find(user => user.id === initialItemId);
            if (u) {
                setActiveTab('team');
                setSelectedUser(u);
            }
        }
    }, [initialItemId, users]);

    const handleTabChange = (tab: typeof activeTab) => {
        setActiveTab(tab);
        setSelectedUser(null);
        setSelectedGroup(null);
        setSelectedUserIds([]); // Clear multi-select
        setViewingCandidates(null);
        setSearchTerm('');
        setDisplayLimit(50);
        setSortConfig({ key: 'default', direction: 'desc' });
    };

    const handleSort = (key: string) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
        setIsSortMenuOpen(false);
    };

    const handleToggleUser = (userId: string, isMulti: boolean) => {
        setSelectedUserIds(prev => {
            if (prev.includes(userId)) {
                return prev.filter(id => id !== userId);
            } else {
                return [...prev, userId];
            }
        });
    };

    const handleHireCandidate = (candidate: Candidate) => {
        const suggestedLogin = `${candidate.firstname.toLowerCase()}.${candidate.lastname.toLowerCase()}`.replace(/[^a-z0-9.]/g, '');
        setPrefillUserData({
            login: suggestedLogin,
            firstname: candidate.firstname,
            lastname: candidate.lastname,
            email: candidate.email,
            job: jobPositions.find(p => String(p.id) === String(candidate.fk_job_position))?.label || ''
        });
        setUserToEdit(null);
        setIsUserModalOpen(true);
    };

    const openCreateUserModal = () => {
        setUserToEdit(null);
        setPrefillUserData(null);
        setIsUserModalOpen(true);
    }

    const openEditUserModal = (u: DolibarrUser) => {
        setUserToEdit(u);
        setPrefillUserData(null); // Reset prefill
        setIsUserModalOpen(true);
    };

    const handleDeleteUser = async (id: string) => {
        if (confirm("Tem certeza que deseja excluir este usuário?")) {
            try {
                // Not implemented in Service? Assuming it exists or mocking alert
                // await DolibarrService.deleteUser(config, id); 
                alert("Funcionalidade de exclusão pendente de implementação na API.");
            } catch (e) { log.error("Failed to delete user", e); }
        }
    };

    const getSortOptions = () => {
        switch (activeTab) {
            case 'team': return [{ key: 'name', label: 'Nome' }, { key: 'job', label: 'Cargo' }];
            case 'expenses': return [{ key: 'date', label: 'Data' }, { key: 'amount', label: 'Valor' }, { key: 'status', label: 'Status' }];
            case 'leaves': return [{ key: 'date', label: 'Data Início' }, { key: 'status', label: 'Status' }];
            case 'recruitment': return [{ key: 'label', label: 'Posição' }, { key: 'qty', label: 'Vagas' }];
            default: return [];
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Modals */}
            <UserModal
                isOpen={isUserModalOpen}
                onClose={() => setIsUserModalOpen(false)}
                config={config}
                users={users} // Pass users list
                userToEdit={userToEdit}
                prefillData={prefillUserData}
                onRefresh={onRefresh}
            />
            <JobModal isOpen={isJobModalOpen} onClose={() => { setIsJobModalOpen(false); setJobPrefill(undefined); }} config={config} onRefresh={onRefresh} initialForm={jobPrefill} />
            <LeaveModal isOpen={isLeaveModalOpen} onClose={() => { setIsLeaveModalOpen(false); setLeavePrefill(undefined); }} config={config} users={users} onRefresh={onRefresh} initialForm={leavePrefill} />
            <ExpenseScannerModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} config={config} currentUser={currentUser} users={users} onRefresh={onRefresh} />
            <ExpenseScannerModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} config={config} currentUser={currentUser} users={users} onRefresh={onRefresh} />

            <GroupModal isOpen={isGroupModalOpen} onClose={() => setIsGroupModalOpen(false)} config={config} groupToEdit={groupToEdit} onRefresh={onRefresh} />

            <GroupModal isOpen={isGroupModalOpen} onClose={() => setIsGroupModalOpen(false)} config={config} groupToEdit={groupToEdit} onRefresh={onRefresh} />

            {/* Header */}
            <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${(selectedUser || viewingCandidates) ? 'hidden lg:block' : 'block'}`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">RH e Equipe</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie funcionários, tempo e despesas</p>
                    </div>
                    <div className="relative flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className={`pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-${config.themeColor}-500 focus:border-${config.themeColor}-500 outline-none w-full md:w-64 text-sm transition-all`}
                            />
                        </div>

                        {activeTab !== 'workload' && (
                            <div className="relative">
                                <button
                                    onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
                                    className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                >
                                    <ArrowUpDown size={20} />
                                </button>
                                {isSortMenuOpen && (
                                    <div className="absolute right-0 top-full mt-2 w-40 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden animate-in fade-in zoom-in-95">
                                        <div className="p-2 text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-slate-800/50">Ordenar Por</div>
                                        {getSortOptions().map(option => (
                                            <button
                                                key={option.key}
                                                onClick={() => handleSort(option.key)}
                                                className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 ${sortConfig.key === option.key ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-slate-700 dark:text-slate-300'}`}
                                            >
                                                {option.label}
                                                {sortConfig.key === option.key && (
                                                    sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800">
                    <div className="flex gap-2 overflow-x-auto">
                        <button onClick={() => handleTabChange('team')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === 'team' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}><UserCheck size={16} /> Equipe ({users.length})</button>
                        <button onClick={() => handleTabChange('groups')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === 'groups' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}><Users size={16} /> Grupos</button>
                        <button onClick={() => handleTabChange('hierarchy')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === 'hierarchy' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}><Network size={16} /> Hierarquia</button>
                        <button onClick={() => handleTabChange('leaves')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === 'leaves' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}><Plane size={16} /> Licenças</button>
                        <button onClick={() => handleTabChange('workload')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === 'workload' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}><BarChart3 size={16} /> Relatório de Tempo</button>
                        <button onClick={() => handleTabChange('expenses')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === 'expenses' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}><Banknote size={16} /> Despesas</button>
                        <button onClick={() => handleTabChange('recruitment')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === 'recruitment' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}><Briefcase size={16} /> Recrutamento</button>
                    </div>
                    <div className="flex gap-2 mb-1.5">
                        {activeTab === 'team' && (
                            <button onClick={openCreateUserModal} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white text-xs font-bold shadow-sm transition-all`}><Plus size={14} /> Novo Membro</button>
                        )}
                        {activeTab === 'groups' && (
                            <button onClick={() => {
                                setGroupToEdit(null); // Create mode
                                setIsGroupModalOpen(true);
                            }} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white text-xs font-bold shadow-sm transition-all`}><Plus size={14} /> Novo Grupo</button>
                        )}
                        {activeTab === 'expenses' && (
                            <button onClick={() => setIsScannerOpen(true)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white text-xs font-bold shadow-sm transition-all`}><Scan size={14} /> Escanear Recibo</button>
                        )}
                        {activeTab === 'leaves' && (
                            <button onClick={() => setIsLeaveModalOpen(true)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white text-xs font-bold shadow-sm transition-all`}><Plus size={14} /> Solicitar Licença</button>
                        )}
                        {activeTab === 'recruitment' && (
                            <>
                                <button onClick={() => setViewingCandidates('ALL')} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold shadow-sm transition-all border border-slate-200 dark:border-slate-700"><Users size={14} /> Todos Candidatos</button>
                                <button onClick={() => setIsJobModalOpen(true)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white text-xs font-bold shadow-sm transition-all`}><Plus size={14} /> Nova Posição</button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* List Side */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${(selectedUser || viewingCandidates || selectedGroup || (activeTab === 'expenses' && selectedExpense)) ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {activeTab === 'team' && (
                        <TeamTab
                            users={users}
                            searchTerm={searchTerm}
                            sortConfig={sortConfig}
                            displayLimit={displayLimit}
                            selectedUserIds={selectedUserIds}
                            config={config}
                            onToggleUser={handleToggleUser}
                            onSelectUser={(u) => {
                                setSelectedUser(u);
                            }}
                            setDisplayLimit={setDisplayLimit}
                        />
                    )}
                    {activeTab === 'hierarchy' && (
                        <HierarchyTab
                            users={users}
                            config={config}
                            onSelectUser={setSelectedUser}
                        />
                    )}
                    {activeTab === 'expenses' && (
                        <ExpensesTab
                            expenseReports={expenseReports}
                            users={users}
                            searchTerm={searchTerm}
                            sortConfig={sortConfig}
                            displayLimit={displayLimit}
                            onSelectExpense={setSelectedExpense}
                            onOpenScanner={() => setIsScannerOpen(true)}
                            expenseReportLines={expenseReportLines}
                            expenseReportPayments={expenseReportPayments}
                            projects={projects}
                        />

                    )}
                    {activeTab === 'leaves' && (
                        <LeavesTab
                            leaveRequests={leaveRequests}
                            users={users}
                            searchTerm={searchTerm}
                            sortConfig={sortConfig}
                            onOpenLeaveModal={() => setIsLeaveModalOpen(true)}
                        />
                    )}
                    {activeTab === 'recruitment' && (
                        <RecruitmentJobsList
                            jobPositions={jobPositions}
                            candidates={candidates}
                            searchTerm={searchTerm}
                            sortConfig={sortConfig}
                            displayLimit={displayLimit}
                            viewingCandidatesId={viewingCandidates}
                            config={config}
                            onViewCandidates={setViewingCandidates}
                            onOpenJobModal={() => setIsJobModalOpen(true)}
                            setDisplayLimit={setDisplayLimit}
                        />
                    )}
                    {activeTab === 'workload' && (
                        <WorkloadTab
                            users={users}
                            tasks={tasks}
                        />
                    )}
                    {activeTab === 'groups' && (
                        <GroupsTab
                            groups={userGroups}
                            searchTerm={searchTerm}
                            sortConfig={sortConfig}
                            displayLimit={displayLimit}
                            config={config}
                            onSelectGroup={setSelectedGroup}
                            onEditGroup={(g) => {
                                setGroupToEdit(g);
                                setIsGroupModalOpen(true);
                            }}
                            onDeleteGroup={async (id) => {
                                if (confirm("Excluir Grupo?")) {
                                    await HRAdmin.deleteGroup(config, id);
                                    // Refresh logic ideally handled via onRefresh or query invalidation
                                    onRefresh?.();
                                }
                            }}
                            setDisplayLimit={setDisplayLimit}
                        />
                    )}
                </div>

                {/* Detail View Side */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${(selectedUser || viewingCandidates || selectedGroup || (activeTab === 'expenses' && selectedExpense)) ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {selectedUser ? (
                        <UserDetail
                            user={selectedUser}
                            userTasks={userTasks}
                            userExpenses={userExpenses}
                            userLeaves={userLeaves}
                            subordinates={userSubordinates}
                            projects={projects}
                            config={config}
                            onClose={() => setSelectedUser(null)}
                            onEditUser={() => openEditUserModal(selectedUser)}
                            onDeleteUser={handleDeleteUser}
                            onNavigate={onNavigate}
                            allUsers={users}
                            expenseReportLines={expenseReportLines}
                            expenseReportPayments={expenseReportPayments}
                        />
                    ) : selectedGroup ? (
                        <GroupDetail
                            group={selectedGroup}
                            users={users}
                            currentConfig={config}
                            onClose={() => setSelectedGroup(null)}
                            onRefresh={() => onRefresh?.()}
                        />
                    ) : (activeTab === 'expenses' && selectedExpense) ? (
                        <ExpenseDetailModal
                            expense={selectedExpense}
                            onClose={() => setSelectedExpense(null)}
                            config={config}
                            users={users}
                            expenseReportLines={expenseReportLines}
                            expenseReportPayments={expenseReportPayments}
                            projects={projects}
                            onNavigate={onNavigate}
                            variant="embedded"
                        />
                    ) : viewingCandidates ? (
                        <RecruitmentCandidatesList
                            candidates={candidates}
                            viewingCandidatesId={viewingCandidates}
                            jobPositions={jobPositions}
                            onHireCandidate={handleHireCandidate}
                            onClose={() => setViewingCandidates(null)}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            {/* Empty State when no Detail selected */}
                            {activeTab === 'team' && <><UserCheck size={48} className="mb-4 opacity-50" /><p>Selecione um membro da equipe</p></>}
                            {activeTab === 'groups' && <><Users size={48} className="mb-4 opacity-50" /><p>Selecione um grupo para gerenciar membros</p></>}
                            {activeTab === 'recruitment' && <><Briefcase size={48} className="mb-4 opacity-50" /><p>Selecione uma vaga para ver candidatos</p></>}
                            {activeTab === 'leaves' && <><Plane size={48} className="mb-4 opacity-50" /><p>Selecione uma licença (não implementado detalhe)</p></>}
                            {activeTab === 'expenses' && <><Banknote size={48} className="mb-4 opacity-50" /><p>Selecione uma despesa para ver detalhes</p></>}
                            {activeTab === 'workload' && <><BarChart3 size={48} className="mb-4 opacity-50" /><p>Visualização de Carga de Trabalho</p></>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default HRList;