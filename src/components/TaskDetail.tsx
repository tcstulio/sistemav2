import React, { useEffect, useState } from 'react';
import { DolibarrConfig, AppView, Task } from '../types';
import { dbService } from '../services/dbService';
import { mapTask } from '../hooks/dolibarr/mappers';
import { ChevronLeft, Calendar as CalendarIcon, Clock, User, FolderKanban, FileText, CheckSquare, Settings, Timer, Plus, X, Loader2, Users, Edit, Save, MessageSquare } from 'lucide-react';
import { RichTextEditor } from './common/RichTextEditor';
import { LinkedObjects } from './common/LinkedObjects';
import { useDolibarrLink } from '../hooks/useDolibarrLink';
import { useTaskTimeLogs, useUsers, useTaskContacts, useContacts } from '../hooks/dolibarr';
import { DolibarrService } from '../services/dolibarrService';
import { ChatInterface } from './Chat/ChatInterface';

interface TaskDetailProps {
    config: DolibarrConfig;
    initialItemId?: string;
    onNavigate: (view: AppView, id: string) => void;
    onClose?: () => void;
    isEmbedded?: boolean;
}

const TaskDetail: React.FC<TaskDetailProps> = ({ config, initialItemId, onNavigate, onClose, isEmbedded }) => {
    const { openLink } = useDolibarrLink(config);
    const [task, setTask] = useState<Task | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Time Logs State
    const { data: timeLogs = [] } = useTaskTimeLogs(config);
    const { data: users = [] } = useUsers(config);
    const { data: taskContacts = [] } = useTaskContacts(config);
    const { data: contacts = [] } = useContacts(config);

    const [isTimeModalOpen, setIsTimeModalOpen] = useState(false);
    const [timeForm, setTimeForm] = useState({
        date: new Date().toISOString().split('T')[0],
        duration_h: 0,
        duration_m: 0,
        note: ''
    });
    const [isSubmittingTime, setIsSubmittingTime] = useState(false);

    // Description Edit State
    const [isEditingDesc, setIsEditingDesc] = useState(false);
    const [descriptionContent, setDescriptionContent] = useState('');
    const [isSavingDesc, setIsSavingDesc] = useState(false);

    const [activeTab, setActiveTab] = useState<'overview' | 'time' | 'chat' | 'contacts' | 'documents'>('overview');


    const taskLogs = timeLogs.filter(log => String(log.task_id) === String(initialItemId)).sort((a, b) => b.date - a.date);
    const participants = taskContacts.filter(c => String(c.task_id) === String(initialItemId));

    useEffect(() => {
        const fetchTask = async () => {
            if (!initialItemId) return;
            setLoading(true);
            setError(null);
            try {
                const rawData = await dbService.get<any>('tasks', initialItemId);
                if (rawData) {
                    const mapped = mapTask(rawData);
                    setTask(mapped);
                    setDescriptionContent(mapped.description || '');
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
        return new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
    };

    const formatDateOnly = (timestamp?: number) => {
        if (!timestamp) return '-';
        return new Date(timestamp).toLocaleDateString('pt-BR');
    };

    const resolveUserName = (userId?: string) => {
        if (!userId) return '-';
        const u = users.find(u => String(u.id) === String(userId));
        return u ? (u.firstname + ' ' + (u.lastname || '')).trim() : userId;
    };

    const resolveContactName = (contactId?: string) => {
        if (!contactId) return '-';
        const c = contacts.find(c => String(c.id) === String(contactId));
        return c ? (c.firstname + ' ' + (c.lastname || '')).trim() : contactId;
    };

    const resolveParticipantName = (p: { user_id?: string, contact_id?: string }) => {
        if (p.user_id) return resolveUserName(p.user_id) + ' (Usuário)';
        if (p.contact_id) return resolveContactName(p.contact_id) + ' (Contato)';
        return 'Desconhecido';
    };

    const handleAddTime = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!task) return;
        setIsSubmittingTime(true);
        try {
            const durationSec = (Number(timeForm.duration_h) * 3600) + (Number(timeForm.duration_m) * 60);
            if (durationSec <= 0) throw new Error("A duração deve ser maior que zero.");

            const dateTs = new Date(timeForm.date).getTime() / 1000;

            await DolibarrService.addTaskTimeLog(config, task.id, durationSec, dateTs, timeForm.note, config.currentUser?.id);
            alert("Tempo registrado!");
            setIsTimeModalOpen(false);
            setTimeForm({ date: new Date().toISOString().split('T')[0], duration_h: 0, duration_m: 0, note: '' });
            // Ideally trigger refresh or rely on eventual sync
        } catch (e: any) {
            alert(`Erro: ${e.message}`);
        } finally {
            setIsSubmittingTime(false);
        }
    };

    const handleSaveDescription = async () => {
        if (!task) return;
        setIsSavingDesc(true);
        try {
            await DolibarrService.updateTask(config, task.id, { description: descriptionContent });
            setTask(prev => prev ? { ...prev, description: descriptionContent } : null);
            setIsEditingDesc(false);
        } catch (error) {
            console.error(error);
            alert('Erro ao salvar descrição');
        } finally {
            setIsSavingDesc(false);
        }
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
            <div className={`bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 md:p-6 sticky top-0 z-10 ${isEmbedded ? 'md:p-4' : ''}`}>
                <div className="flex items-center gap-2 mb-4">
                    <button
                        onClick={() => {
                            if (onClose) onClose();
                            else if (task && task.project_id) onNavigate('projects', task.project_id);
                            else window.history.back();
                        }}
                        className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors"
                        aria-label="Voltar"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    {!isEmbedded && (
                        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            {task && task.project_id ? 'Projetos / Tarefa' : 'Tarefa'}
                        </span>
                    )}
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
                        <button onClick={() => openLink('task', task.id)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Abrir no Dolibarr" aria-label="Abrir no Dolibarr">
                            <Settings size={20} />
                        </button>
                    </div>
                </div>

                {/* Tabs for Overview, Time, Chat, etc. */}
                <div className="mt-6 border-b border-slate-200 dark:border-slate-800">
                    <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'overview' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:border-slate-600'}`}
                        >
                            Visão Geral
                        </button>
                        <button
                            onClick={() => setActiveTab('time')}
                            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'time' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:border-slate-600'}`}
                        >
                            Registro de Horas
                        </button>
                        <button
                            onClick={() => setActiveTab('chat')}
                            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'chat' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:border-slate-600'}`}
                        >
                            <MessageSquare size={16} className="inline-block mr-1" /> Chat
                        </button>
                        {/* Add other tabs here if needed */}
                    </nav>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6">
                {activeTab === 'overview' && (
                    <>
                        {/* Description */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                                    <FileText size={18} className="text-indigo-500" /> Descrição
                                </h2>
                                {!isEditingDesc && (
                                    <button
                                        onClick={() => setIsEditingDesc(true)}
                                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                        title="Editar descrição"
                                        aria-label="Editar descrição"
                                    >
                                        <Edit size={16} />
                                    </button>
                                )}
                            </div>

                            {isEditingDesc ? (
                                <div className="space-y-3">
                                    <RichTextEditor
                                        value={descriptionContent}
                                        onChange={setDescriptionContent}
                                        placeholder="Descreva a tarefa..."
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => {
                                                setIsEditingDesc(false);
                                                setDescriptionContent(task.description || '');
                                            }}
                                            className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 rounded text-sm font-medium"
                                            disabled={isSavingDesc}
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={handleSaveDescription}
                                            className="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-sm font-medium flex items-center gap-2"
                                            disabled={isSavingDesc}
                                        >
                                            {isSavingDesc ? <Loader2 className="animate-spin h-4 w-4" /> : <Save className="h-4 w-4" />}
                                            Salvar
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div
                                    className="prose dark:prose-invert max-w-none text-slate-600 dark:text-slate-300"
                                    dangerouslySetInnerHTML={{ __html: task.description || "Sem descrição." }}
                                />
                            )}
                        </div>

                        {/* Debug Info */}
                        <details className="bg-slate-100 dark:bg-slate-900 rounded p-2 text-xs text-slate-500">
                            <summary className="cursor-pointer font-bold mb-2">Debug Data (Temporary)</summary>
                            <pre className="whitespace-pre-wrap">{JSON.stringify(task, null, 2)}</pre>
                        </details>

                        {/* Info Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {/* Creator */}
                            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                                <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-500"><User size={20} /></div>
                                <div>
                                    <p className="text-xs text-slate-500 uppercase font-bold">Criado Por</p>
                                    <p className="text-sm font-medium text-slate-900 dark:text-white">{resolveUserName(task.fk_user_creat)}</p>
                                </div>
                            </div>

                            {/* Responsible */}
                            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                                <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-500"><User size={20} className="text-indigo-600" /></div>
                                <div>
                                    <p className="text-xs text-slate-500 uppercase font-bold">Responsável</p>
                                    <p className="text-sm font-medium text-slate-900 dark:text-white">{task.fk_user_assign ? resolveUserName(task.fk_user_assign) : 'Não atribuído'}</p>
                                </div>
                            </div>

                            {/* Participants Count */}
                            {participants.length > 0 && (
                                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                                    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-500"><Users size={20} /></div>
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase font-bold">Participantes</p>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white">{participants.length} envolvidos</p>
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

                        {/* Participants Detail Section */}
                        {participants.length > 0 && (
                            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                                <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                    <Users size={18} className="text-indigo-500" /> Outros Envolvidos
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {participants.map(p => (
                                        <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                                            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
                                                {(resolveParticipantName(p)[0] || '?').toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-slate-900 dark:text-white">{resolveParticipantName(p)}</p>
                                                <p className="text-xs text-slate-500 capitalize">{p.type_id}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Parent Project */}
                        {task.project_id && (
                            <div onClick={() => onNavigate('projects', task.project_id!)} className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/30 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors flex items-center gap-3 group">
                                <div className="p-2 bg-white dark:bg-slate-900 rounded-lg shadow-sm text-indigo-600 dark:text-indigo-400">
                                    <FolderKanban size={20} />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm text-indigo-600 dark:text-indigo-300 font-medium">{task.project_title || 'Projeto Pai'}</p>
                                    <p className="text-xs text-indigo-400 dark:text-indigo-400">Ref: {task.project_ref || task.project_id}</p>
                                </div>
                                <ChevronLeft size={16} className="transform rotate-180 text-indigo-400" />
                            </div>
                        )}

                        {/* Linked Objects */}
                        <LinkedObjects id={task.id} type="project_task" onNavigate={onNavigate} />
                    </>
                )}

                {activeTab === 'chat' && (
                    <ChatInterface
                        elementId={task.id}
                        elementType="task"
                        title={`Chat da Tarefa ${task.ref}`}
                    />
                )}

                {activeTab === 'time' && (
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                                <Timer size={18} className="text-orange-500" /> Registro de Horas
                            </h2>
                            <button onClick={() => setIsTimeModalOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                                <Plus size={16} /> Lançar Horas
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-medium uppercase text-xs">
                                    <tr>
                                        <th className="px-4 py-3 rounded-l-lg">Data</th>
                                        <th className="px-4 py-3">Usuário</th>
                                        <th className="px-4 py-3">Descrição</th>
                                        <th className="px-4 py-3 text-right rounded-r-lg">Duração</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {taskLogs.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                                                Nenhum registro de tempo encontrado.
                                            </td>
                                        </tr>
                                    ) : (
                                        taskLogs.map(log => (
                                            <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                <td className="px-4 py-3 text-slate-800 dark:text-white font-medium">{formatDateOnly(log.date)}</td>
                                                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{resolveUserName(log.user_id)}</td>
                                                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{log.note || '-'}</td>
                                                <td className="px-4 py-3 text-right text-indigo-600 dark:text-indigo-400 font-bold">{(log.duration / 3600).toFixed(2)}h</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                                {taskLogs.length > 0 && (
                                    <tfoot className="border-t border-slate-200 dark:border-slate-800">
                                        <tr>
                                            <td colSpan={3} className="px-4 py-3 text-right font-bold text-slate-800 dark:text-white">Total Registrado:</td>
                                            <td className="px-4 py-3 text-right font-bold text-indigo-600 dark:text-indigo-400">
                                                {(taskLogs.reduce((acc, l) => acc + l.duration, 0) / 3600).toFixed(2)}h
                                            </td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Time Log Modal */}
            {isTimeModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <Clock size={18} className="text-indigo-600" /> Lançar Horas
                            </h3>
                            <button onClick={() => setIsTimeModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded" aria-label="Fechar"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleAddTime} className="p-6 space-y-4">
                            <div>
                                <label htmlFor="time-date" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                                <input
                                    id="time-date"
                                    type="date"
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={timeForm.date}
                                    onChange={e => setTimeForm(prev => ({ ...prev, date: e.target.value }))}
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="time-hours" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Horas</label>
                                    <input
                                        id="time-hours"
                                        type="number"
                                        min="0"
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={timeForm.duration_h}
                                        onChange={e => setTimeForm(prev => ({ ...prev, duration_h: parseInt(e.target.value) || 0 }))}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="time-minutes" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Minutos</label>
                                    <input
                                        id="time-minutes"
                                        type="number"
                                        min="0"
                                        max="59"
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={timeForm.duration_m}
                                        onChange={e => setTimeForm(prev => ({ ...prev, duration_m: parseInt(e.target.value) || 0 }))}
                                    />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="time-note" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                                <textarea
                                    id="time-note"
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white resize-none h-20"
                                    placeholder="O que foi feito?"
                                    value={timeForm.note}
                                    onChange={e => setTimeForm(prev => ({ ...prev, note: e.target.value }))}
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsTimeModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmittingTime} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmittingTime ? <Loader2 className="animate-spin" size={16} /> : <CheckSquare size={16} />} Registrar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TaskDetail;
