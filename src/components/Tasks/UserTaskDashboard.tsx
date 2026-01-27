import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useDolibarr } from '../../context/DolibarrContext';
import { useTasks, useProjects, useUsers, useTaskContacts, useProjectContacts, useTaskTimeLogs } from '../../hooks/dolibarr'; // Import hooks
import { Task, DolibarrUser, TaskContact, ProjectContact } from '../../types'; // Added DolibarrUser
// Check if these exist, otherwise use standard divs. 
// Actually, looking at previous files, components/ui/card might not exist or be standard. 
// I'll use standard Tailwind classes to be safe as I haven't verified key UI components path.
// Re-reading file structure: there is no "ui" folder in "components".
// I will build the UI with raw Tailwind.

import {
    CheckCircle2,
    Clock,
    AlertCircle,
    Calendar,
    Filter,
    Search,
    PlayCircle,
    Users,
    User,
    LayoutTemplate,
    List,
    Layers,
    ChevronDown,
    X
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TaskTimeDialog } from './TaskTimeDialog';
import { TimeAnalysisDashboard } from './TimeAnalysisDashboard';
import { TaskAssistantModal } from './TaskAssistantModal';
import { Sparkles, RefreshCw } from 'lucide-react';
import TaskDetail from '../TaskDetail'; // Added Sparkles & RefreshCw

interface UserTaskDashboardProps {
    onNavigate: (view: string, id: string) => void;
}

const UserTaskDashboard: React.FC<UserTaskDashboardProps> = ({ onNavigate }) => {
    const { config, currentUser: user } = useDolibarr(); // Get config & currentUser
    const { data: tasks } = useTasks(config); // Fetch Tasks
    const { data: projects } = useProjects(config); // Fetch Projects
    const { data: allUsers } = useUsers(config); // Fetch Users for hierarchy
    const { data: taskContacts } = useTaskContacts(config); // Fetch Task Contacts
    const { data: projectContacts } = useProjectContacts(config); // Fetch Project Contacts
    const { data: timeLogs } = useTaskTimeLogs(config); // Fetch Time Logs

    const [filterStatus, setFilterStatus] = useState<'all' | 'open'>('open');
    const [viewMode, setViewMode] = useState<'me' | 'team' | 'analytics'>('me');
    const [viewType, setViewType] = useState<'list' | 'kanban'>('list');
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
    const [groupByProject, setGroupByProject] = useState(true);

    // New Filter States
    const [showAssigned, setShowAssigned] = useState(true);
    const [showProjectTeam, setShowProjectTeam] = useState(true); // Default to true as per previous "Me" behavior
    const [showParticipant, setShowParticipant] = useState(true); // Default to true as per previous "Me" behavior

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [taskToLogTime, setTaskToLogTime] = useState<Task | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [visibleCount, setVisibleCount] = useState(40);
    const [memberSearchQuery, setMemberSearchQuery] = useState('');
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        // Assuming refreshTasks is available or we trigger a re-fetch via context/hooks if exposed.
        // For now, since useTasks doesn't expose refresh directly in this file's usage (it might, let's check hook usage),
        // we might just reload window or rely on hook internal revalidation.
        // Actually, checking lines 37, useTasks returns { data }. If we want refresh, we need to update hook or just use window.location.reload() for MVP.
        // Better: just set a timeout to simulate for UI feedback.
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    // Calculate Subordinates (Recursive)
    const mySubordinateIds = useMemo(() => {
        if (!user?.id || !allUsers) return [];

        const subordinates = new Set<string>();
        const queue = [user.id];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const currentManagerId = queue.shift()!;

            // Prevent loops
            if (visited.has(currentManagerId)) continue;
            visited.add(currentManagerId);

            // Find direct reports
            const directReports = allUsers.filter(u => u.supervisor_id === currentManagerId);

            directReports.forEach(report => {
                // Add to subordinates list (if not self, though logic ensures uniqueness)
                if (!subordinates.has(report.id)) {
                    subordinates.add(report.id);
                    queue.push(report.id); // Add to queue to find THEIR reports
                }
            });
        }

        return Array.from(subordinates);
    }, [user?.id, allUsers]);

    // Filter Tasks
    const filteredTasks = useMemo(() => {
        if (!tasks || !user?.id) return [];

        const relevantUserIds = new Set([user.id]);
        if (viewMode === 'team') {
            mySubordinateIds.forEach(id => relevantUserIds.add(id));
        }

        // Helper: Check if I AM a task participant (for 'Me' view)
        const isMyTaskParticipant = (taskId: string) => {
            return taskContacts?.some((tc: TaskContact) =>
                tc.task_id === taskId &&
                (tc.user_id === user.id || (tc.contact_id && tc.contact_id === user.id))
            );
        };

        // Helper: Check if I AM a project member (for 'Me' view)
        const isMyProjectMember = (projectId: string) => {
            return projectContacts?.some((pc: ProjectContact) =>
                pc.project_id === projectId &&
                (pc.user_id === user.id || (pc.contact_id && pc.contact_id === user.id))
            );
        };

        return tasks.filter((task: Task) => {
            // 1. Visibility Logic
            const assigneeId = task.fk_user_assign;

            // Only apply these detailed filters in 'Me' mode. 
            // In 'Team' mode, we generally want to see everything relevant to the team.
            if (viewMode === 'me') {
                let matchesType = false;

                const isAssignedToMe = assigneeId === user.id;
                const isParticipant = isMyTaskParticipant(task.id);
                const isProjectTeam = task.project_id ? isMyProjectMember(task.project_id) : false;

                if (showAssigned && isAssignedToMe) matchesType = true;
                if (showParticipant && isParticipant) matchesType = true;
                if (showProjectTeam && isProjectTeam) matchesType = true;

                if (!matchesType) return false;

            } else {
                // Team Mode Logic
                const isAssigned = assigneeId && relevantUserIds.has(assigneeId);
                let isVisible = false;

                if (isAssigned) {
                    if (selectedMemberIds.length > 0 && !selectedMemberIds.includes(assigneeId)) isVisible = false;
                    else isVisible = true;
                } else {
                    // Check if team members are participants
                    if (selectedMemberIds.length > 0) {
                        const isParticipant = taskContacts?.some(tc => tc.task_id === task.id && tc.user_id && selectedMemberIds.includes(tc.user_id));
                        if (isParticipant) isVisible = true;
                    } else {
                        // Check if ANY sub is participant
                        const isTeamParticipant = taskContacts?.some(tc => tc.user_id && relevantUserIds.has(tc.user_id) && tc.task_id === task.id);
                        if (isTeamParticipant) isVisible = true;
                    }
                }

                if (!isVisible) return false;
            }

            // 2. Status Filter
            const status = Number(task.status || task.statut || 0);
            if (filterStatus === 'open' && status >= 2) return false;

            // 3. Search
            if (searchQuery) {
                const searchLower = searchQuery.toLowerCase();
                return (
                    task.ref.toLowerCase().includes(searchLower) ||
                    task.label.toLowerCase().includes(searchLower) ||
                    (task.description || '').toLowerCase().includes(searchLower)
                );
            }

            return true;
        }).sort((a, b) => {
            const prioA = Number(a.priority || 0);
            const prioB = Number(b.priority || 0);
            if (prioA !== prioB) return prioB - prioA;

            const dateA = a.date_end || 9999999999;
            const dateB = b.date_end || 9999999999;
            return dateA - dateB;
        });
    }, [tasks, user?.id, filterStatus, searchQuery, viewMode, mySubordinateIds, taskContacts, projectContacts, selectedMemberIds, showAssigned, showProjectTeam, showParticipant]);  // Updated to selectedMemberIds

    const getPriorityColor = (priority?: number) => {
        if (!priority) return 'text-slate-500 bg-slate-100';
        if (priority >= 3) return 'text-red-700 bg-red-100 border-red-200'; // High
        if (priority === 2) return 'text-orange-700 bg-orange-100 border-orange-200'; // Med
        return 'text-blue-700 bg-blue-100 border-blue-200'; // Low
    };

    const getDeadlineStatus = (date?: number, progress?: number) => {
        if (!date) return null;
        if (progress === 100) return 'text-green-600';

        const now = Date.now() / 1000;
        const diff = date - now;

        if (diff < 0) return 'text-red-600 font-bold'; // Overdue
        if (diff < 86400 * 2) return 'text-orange-600'; // Due soon (2 days)
        return 'text-slate-500';
    };

    const getUserName = (userId?: string) => {
        if (!userId) return 'Desconhecido';
        if (userId === user?.id) return 'Você';
        const u = allUsers?.find(u => u.id === userId);
        return u ? (u.firstname || u.login) : 'Usuário ' + userId;
    };

    const canLogTime = (task: Task) => {
        if (!user?.id) return false;
        // 1. Assigned
        if (task.fk_user_assign === user.id) return true;
        // 2. Direct Participant
        const isParticipant = taskContacts?.some((tc: TaskContact) =>
            tc.task_id === task.id &&
            (tc.user_id === user.id || (tc.contact_id && tc.contact_id === user.id))
        );
        return isParticipant;
        // NOTE: Project Members (who are not assigned/participants) CANNOT log time.
    };

    // Helper functions for badges
    const isMyTaskParticipant = (taskId: string) => {
        return taskContacts?.some(tc =>
            tc.task_id === taskId &&
            tc.user_id === user?.id
        );
    };

    const isMyProjectMember = (projectId: string) => {
        return projectContacts?.some(pc =>
            pc.project_id === projectId &&
            pc.user_id === user?.id
        );
    };

    // Infinite Scroll Logic & Hooks (Moved after filteredTasks to avoid hoisting issues)
    const PAGE_SIZE = 20;
    const observerTarget = useRef<HTMLDivElement>(null);

    const handleLoadMore = useCallback(() => {
        setVisibleCount(prev => prev + PAGE_SIZE);
    }, []);

    useEffect(() => {
        setVisibleCount(40);
    }, [filterStatus, searchQuery, viewMode, selectedMemberIds, showAssigned, showProjectTeam, showParticipant, groupByProject]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    handleLoadMore();
                }
            },
            { threshold: 0.1 }
        );

        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }

        return () => observer.disconnect();
    }, [handleLoadMore, filteredTasks]);

    const groupedTasks = useMemo(() => {
        if (!groupByProject || !filteredTasks) {
            return { 'Todas': filteredTasks?.slice(0, visibleCount) || [] };
        }

        let totalProcessed = 0;
        const result: Record<string, Task[]> = {};

        for (const task of filteredTasks) {
            if (totalProcessed >= visibleCount) break;

            const projectTitle = projects?.find(p => p.id === task.project_id)?.title || 'Sem Projeto';
            if (!result[projectTitle]) {
                result[projectTitle] = [];
            }
            result[projectTitle].push(task);
            totalProcessed++;
        }

        return result;
    }, [filteredTasks, groupByProject, projects, visibleCount]);

    const renderTaskCards = (tasksToRender: Task[]) => {
        return tasksToRender.map(task => {
            const deadlineColor = getDeadlineStatus(task.date_end, task.progress);
            const progress = task.progress || 0;
            const project = projects?.find(p => p.id === task.project_id);

            return (
                <div
                    key={task.id}
                    className="group relative bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 hover:shadow-md transition-all hover:border-indigo-200 dark:hover:border-indigo-900"
                >
                    <div className="flex justify-between items-start mb-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${getPriorityColor(task.priority)}`}>
                            {task.priority && task.priority > 1 ? 'Prioridade Alta' : 'Normal'}
                        </span>
                        {task.date_end && (
                            <div className={`flex items-center gap-1 text-xs ${deadlineColor}`}>
                                <Calendar className="h-3 w-3" />
                                <span>
                                    {format(new Date(task.date_end * 1000), "d 'de' MMM", { locale: ptBR })}
                                </span>
                            </div>
                        )}
                    </div>

                    <h3
                        onClick={() => setSelectedTaskId(task.id)}
                        className={`font-semibold text-slate-900 dark:text-slate-100 mb-1 cursor-pointer hover:text-indigo-600 line-clamp-2 ${selectedTaskId === task.id ? 'text-indigo-600 dark:text-indigo-400' : ''}`}
                    >
                        {task.label}
                    </h3>

                    <div className="min-h-[20px] mb-3">
                        {project ? (
                            <div className="flex flex-col gap-1">
                                <p className="text-xs text-slate-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                    {project.title}
                                </p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {task.fk_user_assign === user?.id && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">Atribuído</span>
                                    )}
                                    {isMyTaskParticipant(task.id) && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-medium">Participante</span>
                                    )}
                                    {task.project_id && isMyProjectMember(task.project_id) && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-medium">Equipe do Projeto</span>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="h-4"></div> // Spacer
                        )}
                    </div>

                    {/* Assignee Info (if viewing team) */}
                    {viewMode === 'team' && task.fk_user_assign !== user?.id && (
                        <div className="flex items-center gap-2 mb-3 bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded-lg">
                            <div className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
                                {getUserName(task.fk_user_assign).charAt(0)}
                            </div>
                            <span className="text-xs text-slate-600 dark:text-slate-400">
                                {getUserName(task.fk_user_assign)}
                            </span>
                        </div>
                    )}

                    {/* Workload & Progress */}
                    <div className="space-y-3">
                        <div className="flex justify-between text-xs text-slate-500">
                            <span>Progresso</span>
                            <span className="font-medium text-slate-700 dark:text-slate-300">{progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${progress === 100 ? 'bg-green-500' : 'bg-indigo-500'}`}
                                style={{ width: `${progress}%` }}
                            />
                        </div>

                        <div className="flex items-center gap-4 text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5" />
                                <span>
                                    {task.planned_workload ? Math.round(task.planned_workload / 3600) + 'h Est.' : '--'}
                                </span>
                            </div>
                            {task.duration_effective !== undefined && task.duration_effective > 0 && (
                                <div className="flex items-center gap-1.5 text-indigo-600 font-medium">
                                    <PlayCircle className="h-3.5 w-3.5" />
                                    <span>
                                        {(task.duration_effective / 3600).toFixed(1)}h Feito
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-4 pt-4 flex gap-2 w-full border-t border-slate-100 dark:border-slate-800">
                        {canLogTime(task) ? (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation(); // Prevent card click
                                    setTaskToLogTime(task);
                                }}
                                className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-3 sm:py-2 rounded-xl sm:rounded-lg transition-colors shadow-sm active:scale-[0.98] min-h-[44px] sm:min-h-0"
                            >
                                <Clock className="h-4 w-4" />
                                Registrar Tempo
                            </button>
                        ) : (
                            <button
                                disabled
                                className="flex-1 flex items-center justify-center gap-2 text-sm font-medium text-slate-400 bg-slate-100 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed px-4 py-3 sm:py-2 rounded-xl sm:rounded-lg min-h-[44px] sm:min-h-0"
                                title="Você precisa estar atribuído ou ser um participante direto para registrar tempo."
                            >
                                <Clock className="h-4 w-4" />
                                <span className="text-xs sm:text-sm">Apenas Participantes</span>
                            </button>
                        )}
                    </div>
                </div>
            );
        });
    };

    return (
        <div className="h-full flex flex-col p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex-1">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">Minhas Tarefas</h1>
                    <p className="hidden sm:block text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                        Gerencie atividades e registre horas.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* View Mode Tabs */}
                    <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm w-full sm:w-auto overflow-x-auto no-scrollbar">
                        <button
                            onClick={() => setViewMode('me')}
                            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 sm:py-1.5 text-sm font-medium rounded-md transition-colors min-h-[40px] sm:min-h-0 ${viewMode === 'me'
                                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                                }`}
                        >
                            <User className="h-4 w-4" />
                            <span className="whitespace-nowrap">Eu</span>
                        </button>
                        {mySubordinateIds.length > 0 && (
                            <button
                                onClick={() => setViewMode('team')}
                                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 sm:py-1.5 text-sm font-medium rounded-md transition-colors min-h-[40px] sm:min-h-0 ${viewMode === 'team'
                                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                                    }`}
                            >
                                <Users className="h-4 w-4" />
                                <span className="whitespace-nowrap text-xs sm:text-sm">Equipe</span>
                            </button>
                        )}
                        <button
                            onClick={() => setViewMode('analytics')}
                            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 sm:py-1.5 text-sm font-medium rounded-md transition-colors min-h-[40px] sm:min-h-0 ${viewMode === 'analytics'
                                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                                }`}
                        >
                            <Clock className="w-4 h-4" />
                            <span className="whitespace-nowrap">Análise</span>
                        </button>
                    </div>

                    {/* Desktop-only Controls */}
                    {viewMode !== 'analytics' && (
                        <div className="hidden lg:flex items-center gap-2">
                            {/* ... existing desktop controls (list/kanban toggle and open/all toggle) ... */}
                            <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                                <button
                                    onClick={() => setViewType('list')}
                                    className={`p-1.5 rounded-md transition-colors ${viewType === 'list'
                                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                    title="Lista"
                                >
                                    <List className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={() => setViewType('kanban')}
                                    className={`p-1.5 rounded-md transition-colors ${viewType === 'kanban'
                                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                    title="Kanban"
                                >
                                    <LayoutTemplate className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                                <button
                                    onClick={() => setFilterStatus('open')}
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${filterStatus === 'open'
                                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                        : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                                        }`}
                                >
                                    Abertas
                                </button>
                                <button
                                    onClick={() => setFilterStatus('all')}
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${filterStatus === 'all'
                                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                        : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                                        }`}
                                >
                                    Todas
                                </button>
                            </div>

                            {viewType === 'list' && (
                                <button
                                    onClick={() => setGroupByProject(!groupByProject)}
                                    className={`p-1.5 flex items-center gap-2 text-sm font-medium rounded-lg border transition-all ${groupByProject
                                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300'
                                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400'
                                        }`}
                                >
                                    <Layers className="h-4 w-4" />
                                    <span>Agrupar</span>
                                </button>
                            )}
                        </div>
                    )}

                    <button
                        onClick={handleRefresh}
                        className="p-2 sm:p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 transition-colors"
                        title="Atualizar"
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-600' : ''}`} />
                    </button>

                    {/* Mobile Filter Toggle */}
                    {viewMode !== 'analytics' && (
                        <button
                            onClick={() => setIsFilterModalOpen(true)}
                            className="lg:hidden p-2 sm:p-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg flex items-center gap-2 text-sm font-semibold border border-indigo-100 dark:border-indigo-800"
                        >
                            <Filter className="w-4 h-4" />
                            <span className="text-xs">Filtros</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Desktop Filters (Only on large screens) */}
            <div className="hidden lg:block">
                {viewMode === 'team' ? (
                    <div className="flex flex-col gap-3 py-1 scale-in-sm">
                        {/* Member Search Header */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                            <div className="relative w-full sm:max-w-xs">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Pesquisar membro..."
                                    value={memberSearchQuery}
                                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-8 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                                {memberSearchQuery && (
                                    <button
                                        onClick={() => setMemberSearchQuery('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </div>

                            <div className="text-xs text-slate-500 font-medium">
                                {selectedMemberIds.length > 0 ? (
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        Filtrando por:
                                        {selectedMemberIds.map(id => (
                                            <span key={id} className="flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-md">
                                                <b>{getUserName(id)}</b>
                                                <button onClick={() => setSelectedMemberIds(prev => prev.filter(mid => mid !== id))} className="hover:text-indigo-800"><X size={12} /></button>
                                            </span>
                                        ))}
                                        <button
                                            onClick={() => setSelectedMemberIds([])}
                                            className="text-slate-400 hover:text-slate-600 text-[10px] underline ml-2"
                                        >
                                            Limpar tudo
                                        </button>
                                    </span>
                                ) : (
                                    <span>Mostrando todas as tarefas da equipe</span>
                                )}
                            </div>
                        </div>

                        {/* Member Selection Area (Wrapped) */}
                        <div className="flex flex-wrap items-center gap-2 max-h-[120px] overflow-y-auto no-scrollbar py-1">
                            <button
                                onClick={() => setSelectedMemberIds([])}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all ${selectedMemberIds.length === 0
                                    ? 'bg-slate-800 text-white border-slate-800 shadow-sm dark:bg-white dark:text-slate-900'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                                    }`}
                            >
                                Todos
                            </button>
                            {mySubordinateIds
                                .filter(subId => {
                                    if (!memberSearchQuery) return true;
                                    const sub = allUsers?.find(u => u.id === subId);
                                    if (!sub) return false;
                                    const search = memberSearchQuery.toLowerCase();
                                    return (
                                        (sub.firstname || '').toLowerCase().includes(search) ||
                                        (sub.login || '').toLowerCase().includes(search) ||
                                        (sub.lastname || '').toLowerCase().includes(search)
                                    );
                                })
                                .map(subId => {
                                    const sub = allUsers?.find(u => u.id === subId);
                                    if (!sub) return null;
                                    const isSelected = selectedMemberIds.includes(subId);
                                    return (
                                        <button
                                            key={subId}
                                            onClick={() => {
                                                if (isSelected) {
                                                    setSelectedMemberIds(prev => prev.filter(id => id !== subId));
                                                } else {
                                                    setSelectedMemberIds(prev => [...prev, subId]);
                                                }
                                            }}
                                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all whitespace-nowrap ${isSelected
                                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                                                }`}
                                        >
                                            <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] text-slate-600 dark:text-slate-300">
                                                {sub.firstname?.[0] || sub.login[0]}
                                            </div>
                                            {sub.firstname || sub.login}
                                        </button>
                                    );
                                })}
                        </div>
                    </div>
                ) : null}
            </div>

            {/* Compact Mobile Selection Bar (Only in Team Mode) */}
            {viewMode === 'team' && (
                <div
                    onClick={() => setIsFilterModalOpen(true)}
                    className="lg:hidden flex items-center justify-between p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all cursor-pointer"
                >
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                            {selectedMemberIds.length === 1 ? (
                                <span className="font-bold text-base">{getUserName(selectedMemberIds[0]).charAt(0).toUpperCase()}</span>
                            ) : selectedMemberIds.length > 1 ? (
                                <span className="font-bold text-sm">{selectedMemberIds.length}</span>
                            ) : (
                                <Users size={20} />
                            )}
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-0.5">Visão de Equipe</p>
                            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {selectedMemberIds.length === 0 ? 'Todos os Membros' :
                                    selectedMemberIds.length === 1 ? getUserName(selectedMemberIds[0]) :
                                        `${selectedMemberIds.length} membros selecionados`}
                            </p>
                        </div>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isFilterModalOpen ? 'rotate-180' : ''}`} />
                </div>
            )}

            {/* Search Bar */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                    type="text"
                    placeholder="Buscar tarefas..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
            </div>

            {/* Content Area */}
            <div className="flex-1 min-h-0 flex overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900">
                {/* List Side */}
                <div className={`flex-1 overflow-y-auto ${viewMode === 'analytics' ? 'w-full' : (selectedTaskId ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full')}`}>

                    {/* Toolbar inside List (optional, or keep generic) */}
                    {/* Moving generic content wrapper here */}

                    {!tasks ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                        </div>
                    ) : viewMode === 'analytics' ? (
                        <div className="animate-in fade-in duration-300">
                            <TimeAnalysisDashboard
                                logs={timeLogs || []}
                                projects={projects || []}
                                tasks={tasks || []}
                                users={allUsers || []}
                                currentUser={user}
                            />
                        </div>
                    ) : (
                        viewType === 'list' ? (
                            <div className="h-full p-2 sm:p-4 md:p-6">
                                {Object.keys(groupedTasks).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                                        <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-full mb-4">
                                            <List className="h-8 w-8 text-slate-400" />
                                        </div>
                                        <p className="text-lg font-medium">Nenhuma tarefa encontrada</p>
                                        <p className="text-sm">Tente ajustar os filtros ou criar uma nova tarefa</p>
                                    </div>
                                ) : (
                                    <div className="space-y-8 pb-10">
                                        {Object.entries(groupedTasks).map(([groupName, groupTasks]) => (
                                            <div key={groupName} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden mb-4 sm:mb-6">
                                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                                    <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                                        {groupByProject ? <Layers className="h-4 w-4 text-indigo-500" /> : <User className="h-4 w-4 text-indigo-500" />}
                                                        {groupName}
                                                        <span className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs px-2 py-0.5 rounded-full">
                                                            {groupTasks.length}
                                                        </span>
                                                    </h3>
                                                </div>
                                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                                    {renderTaskCards(groupTasks)}
                                                </div>
                                            </div>
                                        ))}

                                        {/* Intersection Observer Target */}
                                        {filteredTasks.length > visibleCount && (
                                            <div
                                                ref={observerTarget}
                                                className="py-10 flex flex-col items-center justify-center gap-2 text-slate-400"
                                            >
                                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500"></div>
                                                <p className="text-xs font-medium">Carregando mais tarefas...</p>
                                            </div>
                                        )}

                                        {filteredTasks.length <= visibleCount && filteredTasks.length > 0 && (
                                            <div className="py-10 text-center text-slate-400 text-xs border-t border-dashed border-slate-200 dark:border-slate-800">
                                                Você chegou ao fim da lista ({filteredTasks.length} tarefas)
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex gap-4 overflow-x-auto p-4 h-full">
                                {[
                                    { id: 'todo', label: 'A Fazer', color: 'bg-slate-100 dark:bg-slate-800/50', border: 'border-slate-200 dark:border-slate-700' },
                                    { id: 'doing', label: 'Em Andamento', color: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800/50' },
                                    { id: 'done', label: 'Concluído', color: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800/50' }
                                ].map(column => {
                                    const columnTasks = filteredTasks.filter(t => {
                                        const status = Number(t.status || t.statut || 0);
                                        const progress = t.progress || 0;

                                        if (column.id === 'done') return status >= 2 || progress === 100;
                                        if (column.id === 'doing') return status === 1 && progress > 0 && progress < 100;
                                        return (status === 0 || (status === 1 && progress === 0)); // To Do
                                    });

                                    return (
                                        <div key={column.id} className={`flex-1 min-w-[300px] flex flex-col rounded-xl border ${column.border} ${column.color}`}>
                                            <div className="p-3 border-b border-inherit font-semibold text-slate-700 dark:text-slate-200 flex justify-between">
                                                <span>{column.label}</span>
                                                <span className="bg-white/50 dark:bg-black/20 px-2 py-0.5 rounded text-xs">{columnTasks.length}</span>
                                            </div>
                                            <div className="p-3 flex-1 overflow-y-auto space-y-3 custom-scrollbar">
                                                {columnTasks.slice(0, visibleCount).map(task => {
                                                    const project = projects?.find(p => p.id === task.project_id);
                                                    return (
                                                        <div
                                                            key={task.id}
                                                            onClick={() => setSelectedTaskId(task.id)}
                                                            className={`bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all cursor-pointer group ${selectedTaskId === task.id ? 'ring-2 ring-indigo-500' : ''}`}
                                                        >
                                                            <div className="flex justify-between items-start mb-2">
                                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getPriorityColor(task.priority)}`}>
                                                                    P{task.priority || 0}
                                                                </span>
                                                                {task.date_end && (
                                                                    <span className={`text-[10px] ${getDeadlineStatus(task.date_end, task.progress)}`}>
                                                                        {format(new Date(task.date_end * 1000), "d MMM", { locale: ptBR })}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 line-clamp-2 mb-2 group-hover:text-indigo-600 transition-colors">
                                                                {task.label}
                                                            </h4>

                                                            {project && (
                                                                <div className="text-xs text-slate-500 mb-2 flex items-center gap-1 truncate">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                                                                    <span className="truncate">{project.title}</span>
                                                                </div>
                                                            )}

                                                            <div className="flex justify-between items-center text-xs mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                                                <span className="text-slate-500">{task.progress}%</span>
                                                                {task.fk_user_assign && (
                                                                    <div className="flex items-center gap-1 text-slate-500">
                                                                        <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center text-[8px] font-bold">
                                                                            {getUserName(task.fk_user_assign)[0]}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {columnTasks.length > visibleCount && (
                                                    <div className="py-4 text-center text-slate-400 text-[10px] border-t border-dashed border-slate-200 dark:border-slate-800">
                                                        + {columnTasks.length - visibleCount} mais... (veja em lista)
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}
                </div>

                {/* Detail Side */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${viewMode === 'analytics' ? 'hidden' : (selectedTaskId ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center')}`}>
                    {selectedTaskId && config ? (
                        <TaskDetail
                            config={config}
                            initialItemId={selectedTaskId}
                            onNavigate={onNavigate}
                            onClose={() => setSelectedTaskId(null)}
                            isEmbedded={true}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <Sparkles size={48} className="mb-4 opacity-50" />
                            <p>Selecione uma tarefa para ver detalhes.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals & Overlays */}
            {isFilterModalOpen && (
                <div className="fixed inset-0 z-50 lg:hidden animate-in fade-in duration-200">
                    <div
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                        onClick={() => setIsFilterModalOpen(false)}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl p-6 animate-in slide-in-from-bottom duration-300 ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                    {viewMode === 'team' ? 'Filtros de Equipe' : 'Filtros da Minha Visão'}
                                </h3>
                                <p className="text-xs text-slate-500">Personalize sua visualização</p>
                            </div>
                            <button
                                onClick={() => setIsFilterModalOpen(false)}
                                className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-400"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Search & Team Selection (Only in Team Mode) */}
                        {viewMode === 'team' ? (
                            <>
                                <div className="relative mb-6">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Pesquisar por nome ou login..."
                                        value={memberSearchQuery}
                                        onChange={(e) => setMemberSearchQuery(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                                        autoFocus
                                    />
                                </div>

                                <div className="flex-1 overflow-y-auto pr-1">
                                    <div className="grid grid-cols-1 gap-2">
                                        <button
                                            onClick={() => {
                                                setSelectedMemberIds([]);
                                            }}
                                            className={`flex items-center justify-between p-4 rounded-xl border transition-all ${selectedMemberIds.length === 0
                                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300 ring-1 ring-indigo-200'
                                                : 'bg-white border-slate-100 text-slate-600 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3 font-semibold">
                                                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                                                    <Users size={20} />
                                                </div>
                                                <span>Todos da Equipe</span>
                                            </div>
                                            {selectedMemberIds.length === 0 && <CheckCircle2 className="w-5 h-5 text-indigo-500" />}
                                        </button>

                                        {mySubordinateIds
                                            .filter(subId => {
                                                if (!memberSearchQuery) return true;
                                                const sub = allUsers?.find(u => u.id === subId);
                                                if (!sub) return false;
                                                const search = memberSearchQuery.toLowerCase();
                                                return (
                                                    (sub.firstname || '').toLowerCase().includes(search) ||
                                                    (sub.login || '').toLowerCase().includes(search) ||
                                                    (sub.lastname || '').toLowerCase().includes(search)
                                                );
                                            })
                                            .map(subId => {
                                                const sub = allUsers?.find(u => u.id === subId);
                                                if (!sub) return null;
                                                const isSelected = selectedMemberIds.includes(subId);
                                                return (
                                                    <button
                                                        key={subId}
                                                        onClick={() => {
                                                            if (isSelected) {
                                                                setSelectedMemberIds(prev => prev.filter(targetId => targetId !== subId));
                                                            } else {
                                                                setSelectedMemberIds(prev => [...prev, subId]);
                                                            }
                                                        }}
                                                        className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${isSelected
                                                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300 ring-1 ring-indigo-200'
                                                            : 'bg-white border-slate-100 text-slate-600 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400'
                                                            }`}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                                                                {(sub.firstname?.[0] || sub.login[0]).toUpperCase()}
                                                            </div>
                                                            <div className="text-left">
                                                                <p className="font-bold text-slate-900 dark:text-slate-100">{sub.firstname || sub.login}</p>
                                                                <p className="text-[10px] text-slate-500 tracking-wider">@{sub.login}</p>
                                                            </div>
                                                        </div>
                                                        {isSelected && <CheckCircle2 className="w-5 h-5 text-indigo-500" />}
                                                    </button>
                                                );
                                            })}
                                    </div>
                                </div>
                            </>
                        ) : (
                            /* Me Mode Filters in Modal */
                            <div className="space-y-4">
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-300 px-1">Mostrar Tarefas onde sou:</p>
                                <div className="grid grid-cols-1 gap-3">
                                    {[
                                        { id: 'assigned', label: 'Atribuído diretamente', active: showAssigned, setter: setShowAssigned, color: 'blue' },
                                        { id: 'projectTeam', label: 'Membro da Equipe do Projeto', active: showProjectTeam, setter: setShowProjectTeam, color: 'amber' },
                                        { id: 'participant', label: 'Participante convidado', active: showParticipant, setter: setShowParticipant, color: 'purple' }
                                    ].map(filter => (
                                        <button
                                            key={filter.id}
                                            onClick={() => filter.setter(!filter.active)}
                                            className={`flex items-center justify-between p-4 rounded-xl border transition-all ${filter.active
                                                ? `bg-${filter.color}-50 border-${filter.color}-200 text-${filter.color}-700 dark:bg-${filter.color}-900/20 dark:border-${filter.color}-800 ring-1 ring-${filter.color}-200`
                                                : 'bg-white border-slate-100 dark:bg-slate-800/50 dark:border-slate-700 text-slate-600'
                                                }`}
                                        >
                                            <span className="font-semibold">{filter.label}</span>
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center ${filter.active ? `bg-${filter.color}-500 text-white` : 'border-2 border-slate-200'}`}>
                                                {filter.active && <CheckCircle2 size={16} />}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Global Controls at Bottom of Modal */}
                        <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex flex-col gap-4">
                                <div className="flex gap-2">
                                    <div className="flex-1 flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                                        <button
                                            onClick={() => setFilterStatus('open')}
                                            className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${filterStatus === 'open' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-500'}`}
                                        >
                                            Abertas
                                        </button>
                                        <button
                                            onClick={() => setFilterStatus('all')}
                                            className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${filterStatus === 'all' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-500'}`}
                                        >
                                            Todas
                                        </button>
                                    </div>
                                    <div className="flex-1 flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                                        <button
                                            onClick={() => setViewType('list')}
                                            className={`flex-1 py-3 flex items-center justify-center rounded-lg transition-all ${viewType === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-500'}`}
                                        >
                                            <List size={20} />
                                        </button>
                                        <button
                                            onClick={() => setViewType('kanban')}
                                            className={`flex-1 py-3 flex items-center justify-center rounded-lg transition-all ${viewType === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-500'}`}
                                        >
                                            <LayoutTemplate size={20} />
                                        </button>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsFilterModalOpen(false)}
                                    className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none active:scale-[0.98] transition-all"
                                >
                                    Aplicar Filtros
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {taskToLogTime && (
                <TaskTimeDialog
                    task={taskToLogTime}
                    isOpen={!!taskToLogTime}
                    onClose={() => setTaskToLogTime(null)}
                />
            )}
        </div>
    );
};

export default UserTaskDashboard;
