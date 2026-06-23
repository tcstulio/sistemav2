import React, { useState, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, ReferenceLine
} from 'recharts';
import { TaskTimeLog, Project, Task, DolibarrUser } from '../../types';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertCircle, Clock, Calendar, MoveLeft, Download, Search, Check, ChevronDown, Sparkles } from 'lucide-react';
import { TaskAssistantModal } from './TaskAssistantModal';

interface TimeAnalysisDashboardProps {
    logs: TaskTimeLog[];
    projects: Project[];
    tasks: Task[];
    users: DolibarrUser[];
    currentUser?: DolibarrUser; // Added currentUser for AI
    onClose?: () => void; // Made optional
}

export const TimeAnalysisDashboard: React.FC<TimeAnalysisDashboardProps> = ({
    logs, projects, tasks, users, currentUser, onClose
}) => {
    // State for filters
    const [selectedUserId, setSelectedUserId] = useState<string>('all');
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [showAiAssistant, setShowAiAssistant] = useState(false);

    const [dateRange, setDateRange] = useState<{ start: string, end: string }>({
        start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
        end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
    });

    // Helper: Find User Name
    const getUserName = (id: string) => {
        const u = users.find(user => user.id === id);
        return u ? (u.firstname || u.login) : 'Desconhecido';
    };

    // Filter Logs
    const filteredLogs = useMemo(() => {
        const start = new Date(dateRange.start);
        const end = new Date(dateRange.end);
        // Set end to end of day
        end.setHours(23, 59, 59, 999);

        return logs.filter(log => {
            const logDate = new Date(log.date);
            const matchesDate = logDate >= start && logDate <= end;
            const matchesUser = selectedUserId === 'all' || log.user_id === selectedUserId;
            return matchesDate && matchesUser;
        });
    }, [logs, dateRange, selectedUserId]);

    // Aggregate Data for Daily Chart
    const dailyData = useMemo(() => {
        const start = new Date(dateRange.start);
        const end = new Date(dateRange.end);
        const days = eachDayOfInterval({ start, end });

        return days.map(day => {
            // Find logs for this day
            const dayLogs = filteredLogs.filter(log => isSameDay(new Date(log.date), day));

            // Sum hours per user (if 'all' selected) or total
            const totalSeconds = dayLogs.reduce((sum, log) => sum + log.duration, 0);
            const totalHours = totalSeconds / 3600;

            // Check for overload (if filtering by single user or generally)
            // If 'all' users, overload threshold might not make sense per bar, unless we stack.
            // For simplicity: Show total hours.

            return {
                date: format(day, 'dd/MM'),
                fullDate: format(day, "dd 'de' MMMM", { locale: ptBR }),
                hours: Number(totalHours.toFixed(2)),
                isOverload: totalHours > 8
            };
        });
    }, [filteredLogs, dateRange]);

    // Aggregate Data for Project Pie Chart
    const projectData = useMemo(() => {
        const projMap = new Map<string, { seconds: number; fullName: string }>();

        filteredLogs.forEach(log => {
            const task = tasks.find(t => t.id === log.task_id);
            const projectId = task?.project_id || 'unknown';
            const fullName = projects.find(p => p.id === projectId)?.title || 'Sem Projeto';

            const current = projMap.get(fullName) || { seconds: 0, fullName };
            projMap.set(fullName, { seconds: current.seconds + log.duration, fullName });
        });

        return Array.from(projMap.values()).map(({ fullName, seconds }) => ({
            name: fullName.length > 28 ? fullName.slice(0, 26) + '…' : fullName,
            fullName,
            value: Number((seconds / 3600).toFixed(2))
        })).sort((a, b) => b.value - a.value);
    }, [filteredLogs, tasks, projects]);

    // Summary Metrics
    const totalHours = filteredLogs.reduce((sum, l) => sum + l.duration, 0) / 3600;
    const activeDays = new Set(filteredLogs.map(l => format(new Date(l.date), 'yyyy-MM-dd'))).size;
    const avgHoursPerDay = activeDays ? (totalHours / activeDays) : 0;

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

    // Define filtered tasks for AI context (tasks related to the time logs)
    const contextTasks = useMemo(() => {
        const taskIds = new Set(filteredLogs.map(l => l.task_id));
        return tasks.filter(t => taskIds.has(t.id));
    }, [filteredLogs, tasks]);

    return (
        <div className="flex flex-col min-h-full bg-slate-50 dark:bg-slate-950 p-3 sm:p-6 rounded-xl w-full">
            {/* Header */}
            <div className="flex flex-col gap-4 mb-6 sm:mb-8">
                <div className="flex flex-wrap justify-between items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Clock className="w-5 h-5 sm:w-7 sm:h-7 text-indigo-600" />
                                Análise de Tempo
                            </h1>
                            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">Distribuição de carga horária da equipe.</p>
                        </div>
                    </div>
                    {/* AI Button */}
                    <button
                        onClick={() => setShowAiAssistant(true)}
                        className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 sm:py-2 rounded-xl sm:rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-colors shadow-md shadow-indigo-500/20 active:scale-[0.98]"
                    >
                        <Sparkles className="w-4 h-4" />
                        Assistente IA
                    </button>
                </div>

                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 bg-white dark:bg-slate-900 p-2 sm:p-3 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
                    {/* User Filter (Searchable) */}
                    <div className="relative w-full md:w-auto">
                        <button
                            onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                            className="w-full md:min-w-[200px] p-3 sm:p-2 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-md text-sm bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none flex justify-between items-center text-left transition-all shadow-sm min-h-[44px] sm:min-h-0"
                        >
                            <span className="truncate pr-2">
                                {selectedUserId === 'all'
                                    ? 'Todas as Pessoas'
                                    : (users.find(u => u.id === selectedUserId)?.firstname || users.find(u => u.id === selectedUserId)?.login || 'Desconhecido')
                                }
                            </span>
                            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        </button>

                        {isUserDropdownOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setIsUserDropdownOpen(false)}
                                />
                                <div className="absolute top-full left-0 md:right-0 md:left-auto mt-2 w-[calc(100vw-2rem)] sm:w-[280px] max-w-[280px] bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-gray-100 dark:border-slate-800 z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                    <div className="p-2 border-b border-gray-50 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50">
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
                                            <input
                                                type="text"
                                                placeholder="Buscar pessoa..."
                                                className="w-full pl-9 pr-3 py-1.5 text-sm border-none rounded-lg bg-white dark:bg-slate-800 shadow-sm ring-1 ring-gray-200 dark:ring-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                                                value={userSearchQuery}
                                                onChange={(e) => setUserSearchQuery(e.target.value)}
                                                autoFocus
                                            />
                                        </div>
                                    </div>
                                    <div className="max-h-[250px] overflow-y-auto p-1 custom-scrollbar">
                                        <button
                                            onClick={() => {
                                                setSelectedUserId('all');
                                                setIsUserDropdownOpen(false);
                                            }}
                                            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-between ${selectedUserId === 'all'
                                                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium'
                                                : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                                                }`}
                                        >
                                            <span>Todas as Pessoas</span>
                                            {selectedUserId === 'all' && <Check className="w-4 h-4" />}
                                        </button>

                                        {users
                                            .filter(u => {
                                                if (!userSearchQuery) return true;
                                                const search = userSearchQuery.toLowerCase();
                                                return (u.firstname || '').toLowerCase().includes(search) ||
                                                    (u.login || '').toLowerCase().includes(search);
                                            })
                                            .map(u => (
                                                <button
                                                    key={u.id}
                                                    onClick={() => {
                                                        setSelectedUserId(u.id);
                                                        setIsUserDropdownOpen(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-between ${selectedUserId === u.id
                                                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium'
                                                        : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-2 truncate">
                                                        <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-[10px] text-gray-600 dark:text-slate-300 font-bold shrink-0">
                                                            {(u.firstname?.[0] || u.login?.[0] || '?').toUpperCase()}
                                                        </div>
                                                        <span className="truncate">{u.firstname || u.login}</span>
                                                    </div>
                                                    {selectedUserId === u.id && <Check className="w-4 h-4 shrink-0" />}
                                                </button>
                                            ))}

                                        {users.filter(u => (u.firstname || '').toLowerCase().includes(userSearchQuery.toLowerCase()) || (u.login || '').toLowerCase().includes(userSearchQuery.toLowerCase())).length === 0 && (
                                            <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-slate-500">
                                                Ninguém encontrado
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Date Range */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
                        <div className="flex items-center gap-2 flex-1">
                            <span className="text-[10px] text-slate-500 uppercase font-bold w-6">De</span>
                            <input
                                type="date"
                                className="flex-1 p-3 sm:p-2 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-md text-sm bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none min-h-[44px] sm:min-h-0"
                                value={dateRange.start}
                                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                            />
                        </div>
                        <div className="flex items-center gap-2 flex-1">
                            <span className="text-[10px] text-slate-500 uppercase font-bold w-6">Até</span>
                            <input
                                type="date"
                                className="flex-1 p-3 sm:p-2 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-md text-sm bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none min-h-[44px] sm:min-h-0"
                                value={dateRange.end}
                                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-6 mb-6 sm:mb-8">
                <div className="bg-white dark:bg-slate-900 p-3 sm:p-5 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">Horas</p>
                        <h3 className="text-xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-1">{totalHours.toFixed(1)}h</h3>
                    </div>
                    <div className="hidden sm:block bg-indigo-50 dark:bg-indigo-900/30 p-3 rounded-full">
                        <Clock className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-3 sm:p-5 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">Dias</p>
                        <h3 className="text-xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-1">{activeDays}</h3>
                    </div>
                    <div className="hidden sm:block bg-blue-50 dark:bg-blue-900/30 p-3 rounded-full">
                        <Calendar className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                </div>

                <div className="col-span-2 md:col-span-1 bg-white dark:bg-slate-900 p-3 sm:p-5 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">Média</p>
                        <h3 className={`text-xl sm:text-3xl font-extrabold mt-1 ${avgHoursPerDay > 8 ? 'text-red-500' : 'text-emerald-600'}`}>
                            {avgHoursPerDay.toFixed(1)}h
                        </h3>
                    </div>
                    <div className={`p-3 rounded-full ${avgHoursPerDay > 8 ? 'bg-red-50 dark:bg-red-900/30' : 'bg-emerald-50 dark:bg-emerald-900/30'}`}>
                        {avgHoursPerDay > 8 ? (
                            <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
                        ) : (
                            <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 dark:text-emerald-400" />
                        )}
                    </div>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8 lg:flex-1 min-h-[400px]">
                {/* Bar Chart: Daily Workload */}
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col">
                    <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white mb-6 px-2 border-l-4 border-indigo-500">Carga Diária</h3>
                    <div className="flex-1 w-full min-h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dailyData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                <XAxis dataKey="date" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    cursor={{ fill: '#F3F4F6' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                    labelClassName="font-bold text-gray-800 mb-2"
                                />
                                <ReferenceLine y={8} stroke="red" strokeDasharray="3 3" label={{ position: 'top', value: 'Limite 8h', fill: 'red', fontSize: 10 }} />
                                <Bar dataKey="hours" name="Horas" radius={[4, 4, 0, 0]}>
                                    {dailyData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.hours > 8 ? '#EF4444' : '#6366F1'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Pie Chart: Project Distribution */}
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col">
                    <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white mb-4 px-2 border-l-4 border-purple-500">Por Projeto</h3>
                    {projectData.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
                            Nenhum dado no período
                        </div>
                    ) : (
                        <div className="flex flex-col flex-1 gap-3 min-h-0">
                            {/* Rosca — altura fixa para o gráfico não competir com a legenda */}
                            <div className="w-full h-[220px] shrink-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={projectData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={55}
                                            outerRadius={85}
                                            paddingAngle={4}
                                            dataKey="value"
                                        >
                                            {projectData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', backgroundColor: 'rgba(255, 255, 255, 0.96)' }}
                                            formatter={(value: number, _name: string, props: any) => [
                                                `${value}h`,
                                                props.payload?.fullName || props.payload?.name
                                            ]}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            {/* Legenda externa — scroll controlado, sem sobreposição */}
                            <ul
                                className="overflow-y-auto max-h-[160px] pr-1 space-y-1 custom-scrollbar"
                                data-testid="project-legend"
                            >
                                {projectData.map((entry, index) => (
                                    <li
                                        key={entry.fullName}
                                        className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300"
                                    >
                                        <span
                                            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                            aria-hidden="true"
                                        />
                                        <span
                                            className="truncate"
                                            title={entry.fullName}
                                        >
                                            {entry.name}
                                        </span>
                                        <span className="ml-auto shrink-0 font-medium tabular-nums">
                                            {entry.value}h
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>

            {/* Detailed Table */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 lg:mt-auto">
                <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white mb-4 px-2 border-l-4 border-emerald-500">Apontamentos</h3>
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                    <table className="w-full text-sm text-left text-slate-600 dark:text-slate-400">
                        <thead className="text-[10px] sm:text-xs text-slate-700 dark:text-slate-300 uppercase bg-slate-50 dark:bg-slate-800">
                            <tr>
                                <th className="px-6 py-3">Data</th>
                                <th className="px-6 py-3">Início*</th>
                                <th className="px-6 py-3">Usuário</th>
                                <th className="px-6 py-3">Tarefa</th>
                                <th className="px-6 py-3">Projeto</th>
                                <th className="px-6 py-3 text-right">Duração</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLogs.slice(0, 50).map((log) => { // Limit to 50 for performance
                                const date = new Date(log.date);
                                const startTime = log.date_start ? new Date(log.date_start) : null;
                                const task = tasks.find(t => t.id === log.task_id);
                                const project = projects.find(p => p.id === task?.project_id);
                                const user = users.find(u => u.id === log.user_id);

                                return (
                                    <tr key={log.id} className="bg-white border-b hover:bg-gray-50 dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-slate-800">
                                        <td className="px-6 py-4">{format(date, 'dd/MM/yyyy')}</td>
                                        <td className="px-6 py-4 font-mono text-xs">
                                            {startTime
                                                ? format(startTime, 'HH:mm')
                                                : (log.date_start ? '00:00' : '-')}
                                        </td>
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">{user?.firstname || log.user_id}</td>
                                        <td className="px-6 py-4 truncate max-w-[200px]" title={task?.label}>{task?.label || log.task_id}</td>
                                        <td className="px-6 py-4 truncate max-w-[150px]">{project?.title || '-'}</td>
                                        <td className="px-6 py-4 text-right font-medium">{(log.duration / 3600).toFixed(2)}h</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="text-xs text-center text-slate-400 mt-4">Mostrando os últimos 50 registros do período.</p>
                </div>
            </div>

            {/* AI Assistant Modal */}
            {showAiAssistant && (
                <TaskAssistantModal
                    tasks={tasks}
                    projects={projects}
                    users={users}
                    timeLogs={logs} // Pass ALL logs to the wizard
                    currentUser={currentUser || null}
                    onClose={() => setShowAiAssistant(false)}
                />
            )}
        </div>
    );
};
