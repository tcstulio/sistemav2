
import React, { useEffect, useState } from 'react';
import { DolibarrConfig, AppView, Task } from '../types';
import { dbService } from '../services/dbService';
import { mapTask } from '../hooks/dolibarr/mappers';
import { ChevronLeft, Calendar as CalendarIcon, Clock, User, FolderKanban, FileText, CheckSquare, Settings } from 'lucide-react';
import { LinkedObjects } from './common/LinkedObjects';
import { useDolibarrLink } from '../hooks/useDolibarrLink';

interface TaskDetailProps {
    config: DolibarrConfig;
    initialItemId?: string;
    onNavigate: (view: AppView, id: string) => void;
}

const TaskDetail: React.FC<TaskDetailProps> = ({ config, initialItemId, onNavigate }) => {
    const { openLink } = useDolibarrLink(config);
    const [task, setTask] = useState<Task | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchTask = async () => {
            if (!initialItemId) return;
            setLoading(true);
            setError(null);
            try {
                const rawData = await dbService.get<any>('tasks', initialItemId);
                if (rawData) {
                    setTask(mapTask(rawData));
                } else {
                    setError("Tarefa não encontrada. Aguarde a sincronização.");
                }
            } catch (err) {
                console.error("Error fetching task:", err);
                setError("Erro ao carregar a tarefa.");
            } finally {
                setLoading(false);
            }
        };
        fetchTask();
    }, [initialItemId]);

    const formatDate = (timestamp?: number) => {
        if (!timestamp) return '-';
        return new Date(timestamp * 1000).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400">
                <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <p>Carregando tarefa...</p>
                </div>
            </div>
        );
    }

    if (error || !task) {
        return (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                <p>{error || "Tarefa não encontrada."}</p>
                <button onClick={() => onNavigate('projects', '')} className="mt-4 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    Voltar para Projetos
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 md:p-6 sticky top-0 z-10">
                <div className="flex items-center gap-2 mb-4">
                    <button onClick={() => task.project_id ? onNavigate('projects', task.project_id) : window.history.back()} className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                        <ChevronLeft size={20} />
                    </button>
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                        {task.project_id ? 'Projetos / Tarefa' : 'Tarefa'}
                    </span>
                </div>

                <div className="flex flex-wrap justify-between items-start gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{task.label || task.ref}</h1>
                            <span className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-500">{task.ref}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                            {task.date_start && (
                                <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">
                                    <CalendarIcon size={14} /> Início: {formatDate(task.date_start)}
                                </span>
                            )}
                            {task.date_end && (
                                <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">
                                    <Clock size={14} /> Fim: {formatDate(task.date_end)}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className={`px-3 py-1.5 rounded-full text-sm font-medium border ${task.progress === 100 ? 'bg-green-100 text-green-700 border-green-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                            {task.progress}% Concluído
                        </div>
                        <button onClick={() => openLink('task', task.id)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Abrir no Dolibarr">
                            <Settings size={20} />
                        </button>
                    </div>
                </div>
            </div>

            <div className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6">

                {/* Description */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                        <FileText size={18} className="text-indigo-500" /> Descrição
                    </h2>
                    <div className="prose dark:prose-invert max-w-none text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                        {task.description || "Sem descrição."}
                    </div>
                </div>

                {/* Debug Info */}
                <details className="bg-slate-100 dark:bg-slate-900 rounded p-2 text-xs text-slate-500">
                    <summary className="cursor-pointer font-bold mb-2">Debug Data (Temporary)</summary>
                    <pre className="whitespace-pre-wrap">{JSON.stringify(task, null, 2)}</pre>
                </details>

                {/* Info Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {task.fk_user_assign && (
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-500"><User size={20} /></div>
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold">Responsável</p>
                                <p className="text-sm font-medium text-slate-900 dark:text-white">ID: {task.fk_user_assign}</p>
                            </div>
                        </div>
                    )}
                    {task.planned_workload !== undefined && task.planned_workload > 0 && (
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-500"><Clock size={20} /></div>
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold">Tempo Planejado</p>
                                <p className="text-sm font-medium text-slate-900 dark:text-white">{(task.planned_workload / 3600).toFixed(1)}h</p>
                            </div>
                        </div>
                    )}
                    {task.duration_effective !== undefined && task.duration_effective > 0 && (
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-500"><CheckSquare size={20} /></div>
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold">Tempo Gasto</p>
                                <p className="text-sm font-medium text-slate-900 dark:text-white">{(task.duration_effective / 3600).toFixed(1)}h</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Parent Project */}
                {task.project_id && (
                    <div onClick={() => onNavigate('projects', task.project_id)} className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/30 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors flex items-center gap-3 group">
                        <div className="p-2 bg-white dark:bg-slate-900 rounded-lg shadow-sm text-indigo-600 dark:text-indigo-400">
                            <FolderKanban size={20} />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm text-indigo-600 dark:text-indigo-300 font-medium">Projeto Pai</p>
                            <p className="text-xs text-indigo-400 dark:text-indigo-400">ID: {task.project_id}</p>
                        </div>
                        <ChevronLeft size={16} className="transform rotate-180 text-indigo-400" />
                    </div>
                )}

                {/* Linked Objects */}
                <LinkedObjects id={task.id} type="project_task" onNavigate={onNavigate} />
            </div>
        </div>
    );
};

export default TaskDetail;
