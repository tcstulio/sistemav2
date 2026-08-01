import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical, Pencil, Plus, Sparkles } from 'lucide-react';
import type { Task } from '../../../types/projects';
import { AppView } from '../../../types/common';
import { ConfirmDeleteButton } from '../../ui';

export type ProjectTaskStatus = 'todo' | 'in_progress' | 'done';

const taskStatusColumns: Array<{
    id: ProjectTaskStatus;
    label: string;
    className: string;
}> = [
    { id: 'todo', label: 'To Do', className: 'border-slate-200 bg-slate-100/70 dark:border-slate-700 dark:bg-slate-800/50' },
    { id: 'in_progress', label: 'In Progress', className: 'border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-900/20' },
    { id: 'done', label: 'Done', className: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-900/20' },
];

const getTaskStatus = (task: Task): ProjectTaskStatus => {
    const progress = Number(task.progress || 0);
    const status = Number(task.status || 0);
    if (progress >= 100 || status >= 2) return 'done';
    if (progress > 0) return 'in_progress';
    return 'todo';
};

interface ProjectTasksTabProps {
    tasks: Task[];
    onNavigate?: (view: AppView, id: string) => void;
    onCreateTask: () => void;
    onEditTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => Promise<void>;
    onMoveTask?: (task: Task, status: ProjectTaskStatus) => Promise<void>;
    onOpenWizard: () => void;
    refreshData?: () => void;
}

export const ProjectTasksTab: React.FC<ProjectTasksTabProps> = ({
    tasks,
    onNavigate,
    onCreateTask,
    onEditTask,
    onDeleteTask,
    onMoveTask,
    onOpenWizard,
    refreshData
}) => {
    const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null);
    const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
    const menuContainerRef = useRef<HTMLDivElement | null>(null);

    // Outside-click: fecha o menu ao clicar fora — sem isso o dropdown fica preso sobre
    // outros elementos (UX ruim e pode mascarar erros). 'mousedown' é disparado ANTES do
    // bubbling dos botões internos, evitando race com handlers que fechariam o menu por
    // acidente. Também fecha em Esc (acessibilidade).
    useEffect(() => {
        if (!openMenuTaskId) return;
        const handleMouseDown = (event: MouseEvent) => {
            if (menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
                setOpenMenuTaskId(null);
            }
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpenMenuTaskId(null);
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKey);
        };
    }, [openMenuTaskId]);

    const moveTask = async (task: Task, status: ProjectTaskStatus) => {
        if (!onMoveTask || getTaskStatus(task) === status) return;
        setMovingTaskId(task.id);
        try {
            await onMoveTask(task, status);
            setOpenMenuTaskId(null);
        } finally {
            setMovingTaskId(null);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                <h3 className="font-bold text-slate-800 dark:text-white">Tarefas do Projeto</h3>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button
                        onClick={onOpenWizard}
                        className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-medium hover:bg-indigo-200 transition-colors"
                    >
                        <Sparkles size={16} /> Wizard
                    </button>
                    <button
                        data-testid="add-task-button"
                        onClick={onCreateTask}
                        className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
                    >
                        <Plus size={16} /> Nova Tarefa
                    </button>
                </div>
            </div>

            <div data-testid="task-list">
                {tasks.length === 0 ? (
                    <p className="text-center text-slate-400 py-10">Nenhuma tarefa encontrada.</p>
                ) : (
                    <div className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-3 sm:overflow-x-auto">
                        {taskStatusColumns.map(column => {
                            const columnTasks = tasks.filter(task => getTaskStatus(task) === column.id);

                            return (
                                <section
                                    key={column.id}
                                    data-testid="task-column"
                                    data-task-status={column.id}
                                    className={`min-h-48 rounded-xl border p-3 ${column.className}`}
                                >
                                    <div className="mb-3 flex items-center justify-between">
                                        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{column.label}</h4>
                                        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-slate-500 dark:bg-black/20 dark:text-slate-300">{columnTasks.length}</span>
                                    </div>
                                    <div className="space-y-3">
                                        {columnTasks.map(task => (
                                            <div
                                                key={task.id}
                                                ref={openMenuTaskId === task.id ? menuContainerRef : undefined}
                                                data-testid="task-item"
                                                data-task-title={task.label}
                                                data-task-status={column.id}
                                                onClick={() => onNavigate && onNavigate('tasks', task.id)}
                                                className="group relative cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
                                            >
                                                <div className="mb-3 flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <h5 className="truncate text-sm font-bold text-slate-800 dark:text-white">{task.label}</h5>
                                                        <div className="mt-1 text-xs text-slate-500">{task.ref} • {task.progress}% Concluído</div>
                                                    </div>
                                                    <span
                                                        data-testid="task-status"
                                                        className="shrink-0 rounded-full border border-current px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                                                    >
                                                        {column.label}
                                                    </span>
                                                </div>
                                                <div className="flex items-end justify-between gap-2">
                                                    <div className="text-xs">
                                                        <div className="text-slate-500">Planejado: {(task.planned_workload || 0) / 3600}h</div>
                                                        <div className="font-medium text-indigo-600 dark:text-indigo-400">Gasto: {(task.duration_effective || 0) / 3600}h</div>
                                                    </div>
                                                    <div className="flex gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                                                        {onMoveTask && (
                                                            <button
                                                                type="button"
                                                                data-testid="task-actions-menu"
                                                                aria-label={`Ações da tarefa ${task.label}`}
                                                                aria-haspopup="menu"
                                                                aria-expanded={openMenuTaskId === task.id}
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    setOpenMenuTaskId(current => current === task.id ? null : task.id);
                                                                }}
                                                                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"
                                                            >
                                                                <MoreVertical size={16} />
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            aria-label={`Editar ${task.label}`}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                onEditTask(task);
                                                            }}
                                                            className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
                                                        >
                                                            <Pencil size={16} />
                                                        </button>
                                                        <ConfirmDeleteButton
                                                            onDelete={() => onDeleteTask(task.id)}
                                                            onDeleted={refreshData}
                                                            itemLabel={task.ref || task.label}
                                                        />
                                                    </div>
                                                </div>

                                                {openMenuTaskId === task.id && (
                                                    <div
                                                        role="menu"
                                                        className="absolute right-2 top-12 z-20 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                                                        onClick={event => event.stopPropagation()}
                                                    >
                                                        <button
                                                            type="button"
                                                            role="menuitem"
                                                            onClick={() => {
                                                                setOpenMenuTaskId(null);
                                                                onEditTask(task);
                                                            }}
                                                            className="w-full rounded px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                                                        >
                                                            Editar
                                                        </button>
                                                        {taskStatusColumns.map(status => (
                                                            <button
                                                                key={status.id}
                                                                type="button"
                                                                role="menuitem"
                                                                data-task-status-target={status.id}
                                                                disabled={movingTaskId === task.id || getTaskStatus(task) === status.id}
                                                                onClick={() => moveTask(task, status.id)}
                                                                className="w-full rounded px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-default disabled:font-semibold disabled:text-indigo-600 dark:text-slate-200 dark:hover:bg-slate-800 dark:disabled:text-indigo-400"
                                                            >
                                                                {status.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProjectTasksTab;
