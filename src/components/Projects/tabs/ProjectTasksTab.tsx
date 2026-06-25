import React from 'react';
import { Plus, Pencil, Sparkles } from 'lucide-react';
import { Task } from '../../../types/projects';
import { AppView } from '../../../types/common';
import { ConfirmDeleteButton } from '../../ui';

interface ProjectTasksTabProps {
    tasks: Task[];
    onNavigate?: (view: AppView, id: string) => void;
    onCreateTask: () => void;
    onEditTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => Promise<void>;
    onOpenWizard: () => void;
    refreshData?: () => void;
}

export const ProjectTasksTab: React.FC<ProjectTasksTabProps> = ({
    tasks,
    onNavigate,
    onCreateTask,
    onEditTask,
    onDeleteTask,
    onOpenWizard,
    refreshData
}) => {
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
                        onClick={onCreateTask}
                        className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
                    >
                        <Plus size={16} /> Nova Tarefa
                    </button>
                </div>
            </div>

            {tasks.length === 0 ? (
                <p className="text-center text-slate-400 py-10">Nenhuma tarefa encontrada.</p>
            ) : (
                tasks.map(t => (
                    <div
                        key={t.id}
                        onClick={() => onNavigate && onNavigate('tasks', t.id)}
                        className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:shadow-sm transition-shadow group cursor-pointer hover:border-indigo-300"
                    >
                        <div>
                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">{t.label}</h4>
                            <div className="text-xs text-slate-500 mt-1">{t.ref} • {t.progress}% Concluído</div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="text-right text-xs">
                                <div className="text-slate-500">Planejado: {(t.planned_workload || 0) / 3600}h</div>
                                <div className="text-indigo-600 dark:text-indigo-400 font-medium">Gasto: {(t.duration_effective || 0) / 3600}h</div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={(e) => { e.stopPropagation(); onEditTask(t); }}
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                >
                                    <Pencil size={16} />
                                </button>
                                <ConfirmDeleteButton
                                    onDelete={() => onDeleteTask(t.id)}
                                    onDeleted={refreshData}
                                    itemLabel={t.ref || t.label}
                                />
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );
};

export default ProjectTasksTab;
