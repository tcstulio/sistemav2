import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { DolibarrUser, ExpenseReport, RecruitmentJobPosition, DolibarrConfig, Task, Project, Ticket, AppView, Candidate, LeaveRequest, UserGroup } from '../types';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { ListControls } from '../hooks/useListControls';
import { ListToolbar } from './ui';
import { MasterDetailLayout } from './ui/MasterDetailLayout';
import { Plus, UserCheck, Plane, BarChart3, Banknote, Briefcase, Scan, Users, Network } from 'lucide-react';
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
import { CandidateModal } from './HR/modals/CandidateModal';
import { ExpenseModal } from './HR/modals/ExpenseModal';
import { ExpenseScannerModal } from './HR/modals/ExpenseScannerModal';
import { ExpenseDetailModal } from './HR/modals/ExpenseDetailModal';
import { GroupModal } from './HR/modals/GroupModal';
import * as HRAdmin from '../services/api/hrAdmin';
import { deleteUser } from '../services/api/core';
import { useDolibarr } from '../context/DolibarrContext';
import { useUsers, useExpenseReports, useLeaveRequests, useJobPositions, useCandidates, useTasks, useTickets, useProjects, useGroups, useExpenseReportLines, useExpenseReportPayments } from '../hooks/dolibarr';
import { useConfirm } from '../hooks/useConfirm';
import { notifyError } from '../utils/notifyError';
import { getTabClasses, getThemeClass } from '../utils/theme';


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
    const { config, currentUser, canDo } = useDolibarr();

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

    const confirm = useConfirm();

    const [activeTab, setActiveTab] = useState<'team' | 'groups' | 'hierarchy' | 'workload' | 'expenses' | 'leaves' | 'recruitment'>('team');
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'default', direction: 'desc' });
    const [displayLimit, setDisplayLimit] = useState(50);

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
    const [isCandidateModalOpen, setIsCandidateModalOpen] = useState(false);
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [expensePrefill, setExpensePrefill] = useState<Record<string, string> | undefined>(undefined);
    const [expenseEditId, setExpenseEditId] = useState<string | undefined>(undefined);

    const openCreateExpense = () => { setExpensePrefill(undefined); setExpenseEditId(undefined); setIsExpenseModalOpen(true); };
    const openEditExpense = (ex: ExpenseReport) => {
        const toDate = (ts?: number) => (ts ? new Date(ts < 1e11 ? ts * 1000 : ts).toISOString().split('T')[0] : '');
        setExpensePrefill({
            fk_user_author: String(ex.fk_user_author),
            date_debut: toDate(ex.date_debut),
            date_fin: toDate(ex.date_fin),
            total_ttc: ex.total_ttc != null ? String(ex.total_ttc) : '',
            note_public: ex.note_public || '',
        });
        setExpenseEditId(String(ex.id));
        setIsExpenseModalOpen(true);
    };
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false); // NEW Group Modal State

    // Edit/Create User State
    const [userToEdit, setUserToEdit] = useState<DolibarrUser | null>(null);
    const [groupToEdit, setGroupToEdit] = useState<UserGroup | null>(null);
    const [prefillUserData, setPrefillUserData] = useState<Partial<DolibarrUser> | null>(null);

    // Deeplink HITL do agente (#57): create/edit de vaga e licença (aplica 1x por token).
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    const [jobPrefill, setJobPrefill] = useState<Record<string, string> | undefined>(undefined);
    const [leavePrefill, setLeavePrefill] = useState<Record<string, string> | undefined>(undefined);
    const [candidatePrefill, setCandidatePrefill] = useState<Record<string, string> | undefined>(undefined);
    const [groupPrefill, setGroupPrefill] = useState<Record<string, string> | undefined>(undefined);
    const [jobEditId, setJobEditId] = useState<string | undefined>(undefined);
    const [leaveEditId, setLeaveEditId] = useState<string | undefined>(undefined);
    const [candidateEditId, setCandidateEditId] = useState<string | undefined>(undefined);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_job') {
            appliedPrefillRef.current = prefill;
            setJobPrefill(prefill.data);
            setJobEditId(undefined);
            setActiveTab('recruitment');
            setIsJobModalOpen(true);
            toast.info('Revise os dados e confirme a criação da vaga.');
        } else if (prefill.kind === 'edit_job') {
            if (jobPositions.length === 0) return; // aguarda os dados p/ carregar o registro atual
            appliedPrefillRef.current = prefill;
            const current = jobPositions.find(j => String(j.id) === String(prefill.data.id));
            setJobPrefill({
                label: prefill.data.label ?? current?.label ?? '',
                qty: prefill.data.qty ?? (current?.qty != null ? String(current.qty) : ''),
                description: prefill.data.description ?? current?.description ?? '',
            });
            setJobEditId(String(prefill.data.id));
            setActiveTab('recruitment');
            setIsJobModalOpen(true);
            toast.info('Revise as mudanças e salve a vaga.');
        } else if (prefill.kind === 'create_leave') {
            appliedPrefillRef.current = prefill;
            setLeavePrefill(prefill.data);
            setLeaveEditId(undefined);
            setActiveTab('leaves');
            setIsLeaveModalOpen(true);
            toast.info('Revise os dados e confirme a solicitação de licença.');
        } else if (prefill.kind === 'edit_leave') {
            if (leaveRequests.length === 0) return; // aguarda os dados p/ carregar o registro atual
            appliedPrefillRef.current = prefill;
            const current = leaveRequests.find(l => String(l.id) === String(prefill.data.id));
            const toDate = (ts?: number) => (ts ? new Date(ts * 1000).toISOString().split('T')[0] : '');
            setLeavePrefill({
                fk_user: current?.fk_user ?? '',
                date_debut: prefill.data.date_debut ?? toDate(current?.date_debut),
                date_fin: prefill.data.date_fin ?? toDate(current?.date_fin),
                type: prefill.data.type ?? current?.type ?? 'Paid Vacation',
                description: prefill.data.description ?? current?.description ?? '',
            });
            setLeaveEditId(String(prefill.data.id));
            setActiveTab('leaves');
            setIsLeaveModalOpen(true);
            toast.info('Revise as mudanças e salve a licença.');
        } else if (prefill.kind === 'create_candidate') {
            appliedPrefillRef.current = prefill;
            setCandidatePrefill(prefill.data);
            setCandidateEditId(undefined);
            setActiveTab('recruitment');
            setIsCandidateModalOpen(true);
            toast.info('Revise os dados e confirme a criação do candidato.');
        } else if (prefill.kind === 'edit_candidate') {
            if (candidates.length === 0) return; // aguarda os dados p/ carregar o registro atual
            appliedPrefillRef.current = prefill;
            const current = candidates.find(c => String(c.id) === String(prefill.data.id));
            setCandidatePrefill({
                firstname: prefill.data.firstname ?? current?.firstname ?? '',
                lastname: prefill.data.lastname ?? current?.lastname ?? '',
                email: prefill.data.email ?? current?.email ?? '',
                phone: prefill.data.phone ?? current?.phone ?? '',
                fk_job_position: prefill.data.fk_job_position ?? current?.fk_job_position ?? '',
                note_public: prefill.data.note_public ?? current?.note_public ?? current?.cv_text ?? '',
            });
            setCandidateEditId(String(prefill.data.id));
            setActiveTab('recruitment');
            setIsCandidateModalOpen(true);
            toast.info('Revise as mudanças e salve o candidato.');
        } else if (prefill.kind === 'create_user') {
            appliedPrefillRef.current = prefill;
            setUserToEdit(null);
            setPrefillUserData(prefill.data as Partial<DolibarrUser>);
            setActiveTab('team');
            setIsUserModalOpen(true);
            toast.info('Revise os dados e confirme a criação do usuário.');
        } else if (prefill.kind === 'edit_user') {
            if (users.length === 0) return; // aguarda os dados
            const current = users.find(u => String(u.id) === String(prefill.data.id));
            if (!current) return;
            appliedPrefillRef.current = prefill;
            setUserToEdit(current);
            setPrefillUserData(prefill.data as Partial<DolibarrUser>); // sobrepõe as mudanças sugeridas
            setActiveTab('team');
            setIsUserModalOpen(true);
            toast.info('Revise as mudanças e salve o usuário.');
        } else if (prefill.kind === 'create_group') {
            appliedPrefillRef.current = prefill;
            setGroupToEdit(null);
            setGroupPrefill(prefill.data);
            setActiveTab('groups');
            setIsGroupModalOpen(true);
            toast.info('Revise os dados e confirme a criação do grupo.');
        } else if (prefill.kind === 'edit_group') {
            if (userGroups.length === 0) return; // aguarda os dados
            const current = userGroups.find(g => String(g.id) === String(prefill.data.id));
            if (!current) return;
            appliedPrefillRef.current = prefill;
            setGroupToEdit(current);
            setGroupPrefill(prefill.data);
            setActiveTab('groups');
            setIsGroupModalOpen(true);
            toast.info('Revise as mudanças e salve o grupo.');
        } else if (prefill.kind === 'create_expense') {
            appliedPrefillRef.current = prefill;
            setExpensePrefill(prefill.data);
            setExpenseEditId(undefined);
            setActiveTab('expenses');
            setIsExpenseModalOpen(true);
            toast.info('Revise os dados e confirme a criação da despesa.');
        } else if (prefill.kind === 'edit_expense') {
            if (expenseReports.length === 0) return; // aguarda os dados
            const current = expenseReports.find(e => String(e.id) === String(prefill.data.id));
            if (!current) return;
            appliedPrefillRef.current = prefill;
            const toDate = (ts?: number) => (ts ? new Date(ts < 1e11 ? ts * 1000 : ts).toISOString().split('T')[0] : '');
            setExpensePrefill({
                fk_user_author: String(current.fk_user_author),
                date_debut: prefill.data.date_debut ?? toDate(current.date_debut),
                date_fin: prefill.data.date_fin ?? toDate(current.date_fin),
                total_ttc: prefill.data.total_ttc ?? (current.total_ttc != null ? String(current.total_ttc) : ''),
                note_public: prefill.data.note_public ?? current.note_public ?? '',
            });
            setExpenseEditId(String(prefill.data.id));
            setActiveTab('expenses');
            setIsExpenseModalOpen(true);
            toast.info('Revise as mudanças e salve a despesa.');
        }
    }, [prefill, jobPositions, leaveRequests, candidates, users, userGroups, expenseReports]);

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

    // Handle deep linking or initial item.
    // Ignora quando há prefill: rotas como /hr/jobs/:id/edit reaproveitam o initialItemId,
    // mas a edição é dirigida pelo prefill (não deve selecionar um usuário homônimo).
    useEffect(() => {
        if (initialItemId && users.length > 0 && !selectedUser && !prefill) {
            const u = users.find(user => user.id === initialItemId);
            if (u) {
                setActiveTab('team');
                setSelectedUser(u);
            }
        }
    }, [initialItemId, users, prefill]);

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

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

    const openCreateCandidate = () => {
        setCandidatePrefill(undefined);
        setCandidateEditId(undefined);
        setIsCandidateModalOpen(true);
    };

    const openEditCandidate = (c: Candidate) => {
        setCandidatePrefill({
            firstname: c.firstname || '',
            lastname: c.lastname || '',
            email: c.email || '',
            phone: c.phone || '',
            fk_job_position: c.fk_job_position || '',
            note_public: c.note_public || c.cv_text || '',
        });
        setCandidateEditId(String(c.id));
        setIsCandidateModalOpen(true);
    };

    const openEditUserModal = (u: DolibarrUser) => {
        setUserToEdit(u);
        setPrefillUserData(null); // Reset prefill
        setIsUserModalOpen(true);
    };

    const handleDeleteUser = async (id: string) => {
        // #1416 — gate de escrita igual ao resto da casa: sem canDo('delete','users')
        // NÃO chama a API (que deleteria de verdade no Dolibarr). A UI também esconde
        // o botão no UserDetail, mas a defesa fica aqui — fonte única.
        if (!canDo('delete', 'users')) {
            toast.error('Você não tem permissão para excluir usuários.');
            return;
        }
        if (!(await confirm({ message: 'Tem certeza que deseja excluir este usuário? Esta ação não pode ser desfeita.', danger: true }))) return;
        try {
            await deleteUser(config, id);
            toast.success('Usuário excluído com sucesso.');
            setSelectedUser(null);
            onRefresh?.();
        } catch (e) { notifyError('Excluir usuário', e); }
    };

    const getSortOptions = () => {
        switch (activeTab) {
            case 'team': return [{ key: 'name', label: 'Nome' }, { key: 'job', label: 'Cargo' }];
            case 'expenses': return [{ key: 'date', label: 'Data' }, { key: 'amount', label: 'Valor' }, { key: 'status', label: 'Status' }];
            case 'leaves': return [{ key: 'date', label: 'Data Início' }, { key: 'status', label: 'Status' }];
            case 'recruitment': return [{ key: 'label', label: 'Posição' }, { key: 'qty', label: 'Vagas' }];
            case 'groups': return [{ key: 'name', label: 'Nome' }, { key: 'date', label: 'Data' }];
            default: return [];
        }
    };

    // Toolbar padronizada (#121) — adapta os controles de busca/ordenação existentes ao
    // <ListToolbar>. As abas de RH (TeamTab, ExpensesTab, etc.) continuam recebendo
    // searchTerm/sortConfig e fazendo a filtragem/ordenação internamente, sem mudança de contrato.
    const sortOptions = getSortOptions();
    const hrToolbarControls: ListControls<unknown> = {
        search: searchTerm,
        setSearch: setSearchTerm,
        sortKey: sortConfig.key === 'default' ? (sortOptions[0]?.key ?? '') : sortConfig.key,
        setSortKey: (k) => setSortConfig(prev => ({ key: k, direction: prev.direction })),
        sortDir: sortConfig.direction,
        toggleSortDir: () => setSortConfig(prev => ({
            key: prev.key === 'default' ? (sortOptions[0]?.key ?? 'default') : prev.key,
            direction: prev.direction === 'asc' ? 'desc' : 'asc',
        })),
        filterValues: {},
        setFilter: () => { },
        clear: () => { setSearchTerm(''); setSortConfig({ key: 'default', direction: 'desc' }); },
        result: [],
        config: {
            searchText: () => '',
            sorts: sortOptions.map(o => ({ key: o.key, label: o.label, get: () => '' })),
        },
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
            <JobModal isOpen={isJobModalOpen} onClose={() => { setIsJobModalOpen(false); setJobPrefill(undefined); setJobEditId(undefined); }} config={config} onRefresh={onRefresh} initialForm={jobPrefill} editId={jobEditId} />
            <LeaveModal isOpen={isLeaveModalOpen} onClose={() => { setIsLeaveModalOpen(false); setLeavePrefill(undefined); setLeaveEditId(undefined); }} config={config} users={users} onRefresh={onRefresh} initialForm={leavePrefill} editId={leaveEditId} />
            <CandidateModal isOpen={isCandidateModalOpen} onClose={() => { setIsCandidateModalOpen(false); setCandidatePrefill(undefined); setCandidateEditId(undefined); }} config={config} jobPositions={jobPositions} onRefresh={onRefresh} initialForm={candidatePrefill} editId={candidateEditId} />
            <ExpenseModal isOpen={isExpenseModalOpen} onClose={() => { setIsExpenseModalOpen(false); setExpensePrefill(undefined); setExpenseEditId(undefined); }} config={config} users={users} onRefresh={onRefresh} initialForm={expensePrefill} editId={expenseEditId} />
            <ExpenseScannerModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} config={config} currentUser={currentUser} users={users} onRefresh={onRefresh} />

            <GroupModal isOpen={isGroupModalOpen} onClose={() => { setIsGroupModalOpen(false); setGroupPrefill(undefined); setGroupToEdit(null); }} config={config} groupToEdit={groupToEdit} onRefresh={onRefresh} initialForm={groupPrefill} />

            {/* Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">RH e Equipe</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie funcionários, tempo e despesas</p>
                    </div>
                    <div className="relative flex items-center gap-2">
                        {activeTab !== 'workload' && (
                            <ListToolbar controls={hrToolbarControls} searchPlaceholder="Buscar..." />
                        )}
                    </div>
                </div>

                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800">
                    <div className="flex gap-2 overflow-x-auto">
                        <button onClick={() => handleTabChange('team')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${getTabClasses(config.themeColor, activeTab === 'team')}`}><UserCheck size={16} /> Equipe ({users.length})</button>
                        <button onClick={() => handleTabChange('groups')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${getTabClasses(config.themeColor, activeTab === 'groups')}`}><Users size={16} /> Grupos</button>
                        <button onClick={() => handleTabChange('hierarchy')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${getTabClasses(config.themeColor, activeTab === 'hierarchy')}`}><Network size={16} /> Hierarquia</button>
                        <button onClick={() => handleTabChange('leaves')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${getTabClasses(config.themeColor, activeTab === 'leaves')}`}><Plane size={16} /> Licenças</button>
                        <button onClick={() => handleTabChange('workload')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${getTabClasses(config.themeColor, activeTab === 'workload')}`}><BarChart3 size={16} /> Relatório de Tempo</button>
                        <button onClick={() => handleTabChange('expenses')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${getTabClasses(config.themeColor, activeTab === 'expenses')}`}><Banknote size={16} /> Despesas</button>
                        <button onClick={() => handleTabChange('recruitment')} className={`flex items-center gap-2 pb-2 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${getTabClasses(config.themeColor, activeTab === 'recruitment')}`}><Briefcase size={16} /> Recrutamento</button>
                    </div>
                    <div className="flex gap-2 mb-1.5">
                        {activeTab === 'team' && (
                            <button onClick={openCreateUserModal} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${getThemeClass(config.themeColor, 'primaryButton')} text-xs font-bold shadow-sm transition-all`}><Plus size={14} /> Novo Membro</button>
                        )}
                        {activeTab === 'groups' && (
                            <button onClick={() => {
                                setGroupToEdit(null); // Create mode
                                setIsGroupModalOpen(true);
                            }} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${getThemeClass(config.themeColor, 'primaryButton')} text-xs font-bold shadow-sm transition-all`}><Plus size={14} /> Novo Grupo</button>
                        )}
                        {activeTab === 'expenses' && (
                            <>
                                <button onClick={openCreateExpense} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all"><Plus size={14} /> Nova Despesa</button>
                                <button onClick={() => setIsScannerOpen(true)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${getThemeClass(config.themeColor, 'primaryButton')} text-xs font-bold shadow-sm transition-all`}><Scan size={14} /> Escanear Recibo</button>
                            </>
                        )}
                        {activeTab === 'leaves' && (
                            <button onClick={() => setIsLeaveModalOpen(true)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${getThemeClass(config.themeColor, 'primaryButton')} text-xs font-bold shadow-sm transition-all`}><Plus size={14} /> Solicitar Licença</button>
                        )}
                        {activeTab === 'recruitment' && (
                            <>
                                <button onClick={() => setViewingCandidates('ALL')} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold shadow-sm transition-all border border-slate-200 dark:border-slate-700"><Users size={14} /> Todos Candidatos</button>
                                <button onClick={openCreateCandidate} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all"><Plus size={14} /> Novo Candidato</button>
                                <button onClick={() => setIsJobModalOpen(true)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${getThemeClass(config.themeColor, 'primaryButton')} text-xs font-bold shadow-sm transition-all`}><Plus size={14} /> Nova Posição</button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <MasterDetailLayout
                showDetail={!!(selectedUser || viewingCandidates || selectedGroup || (activeTab === 'expenses' && selectedExpense))}
                onCloseDetail={() => {
                    setSelectedUser(null);
                    setSelectedGroup(null);
                    setViewingCandidates(null);
                    setSelectedExpense(null);
                }}
                listWidth="1/3"
                list={
                    <div className="p-4 md:p-6">
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
                                onRefresh={onRefresh}
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
                                    if (!(await confirm({ message: 'Excluir Grupo?', danger: true }))) return;
                                    try {
                                        await HRAdmin.deleteGroup(config, id);
                                        onRefresh?.();
                                    } catch (e) {
                                        notifyError('Excluir grupo', e);
                                    }
                                }}
                                setDisplayLimit={setDisplayLimit}
                            />
                        )}
                    </div>
                }
                detail={
                    selectedUser ? (
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
                            onEditCandidate={openEditCandidate}
                            onClose={() => setViewingCandidates(null)}
                        />
                    ) : undefined
                }
            />
        </div>
    );
};

export default HRList;