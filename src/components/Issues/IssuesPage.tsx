import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GithubService, GitHubIssue, IssueStats } from '../../services/githubService';
import { TaskService, Task } from '../../services/taskService';
import { PageLayout, PageHeader, Card, Button, Spinner, Tabs, Tab } from '../ui';
import { AlertCircle, Bug, Sparkles, Shield, Wrench, TestTube, GitMerge, Loader2, Eye, CheckCircle, XCircle, RotateCcw, MessageSquare, Trash2, Pencil, Terminal, ExternalLink, Search, Tag, CircleDot, Clock, ThumbsUp, Star, Play, RefreshCw, ShieldOff, Plus, Filter, LayoutGrid, List, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { useDolibarr } from '../../context/DolibarrContext';
import { useConfirm } from '../../hooks/useConfirm';
import DiffViewer from '../TasksBoard/DiffViewer';
import TaskConsole from '../TasksBoard/TaskConsole';
import { DndContext, closestCorners, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/** Formata o timestamp de desfecho de uma task para exibição compacta. */
const formatOutcomeTime = (status: string, task: { completedAt?: string; updatedAt: string }): string | null => {
    const OUTCOME_STATUSES = ['merged', 'rejected', 'cancelled', 'failed'];
    if (!OUTCOME_STATUSES.includes(status)) return null;
    const raw = task.completedAt || task.updatedAt;
    if (!raw) return null;
    const d = new Date(raw);
    const label: Record<string, string> = { merged: 'Merge', rejected: 'Rejeitada', cancelled: 'Cancelada', failed: 'Falhou' };
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${label[status] ?? status} ${time}`;
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
    pending: { color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', icon: <Clock size={14} />, label: 'Pendente' },
    running: { color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Executando' },
    fixing: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Corrigindo' },
    reviewing: { color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', icon: <Eye size={14} />, label: 'Em Revisão' },
    approved: { color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', icon: <ThumbsUp size={14} />, label: 'Aprovado' },
    merged: { color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: <GitMerge size={14} />, label: 'Merged' },
    rejected: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: <XCircle size={14} />, label: 'Rejeitado' },
    failed: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: <AlertCircle size={14} />, label: 'Falhou' },
    cancelling: { color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Cancelando...' },
    cancelled: { color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', icon: <XCircle size={14} />, label: 'Cancelada' },
};

const TERMINAL_STATUSES = ['merged', 'rejected', 'cancelled', 'failed'];

const PIPELINE_COLUMNS = [
    { key: 'queue', label: 'Fila', statuses: ['pending'] },
    { key: 'active', label: 'Em Execução', statuses: ['running', 'fixing', 'cancelling'] },
    { key: 'review', label: 'Revisão', statuses: ['reviewing', 'approved'] },
    { key: 'done', label: 'Concluído', statuses: ['merged', 'rejected'] },
    { key: 'failed', label: 'Falhadas', statuses: ['failed'] },
    { key: 'cancelled', label: 'Canceladas', statuses: ['cancelled'] },
] as const;

const LABEL_COLORS: Record<string, string> = {
    bug: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    enhancement: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    security: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    question: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    testing: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400',
    opencode_task: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400',
    production: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
    infra: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400',
    documentation: 'bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-400',
};

const LABEL_ICONS: Record<string, React.ReactNode> = {
    bug: <Bug size={12} />,
    enhancement: <Sparkles size={12} />,
    security: <Shield size={12} />,
    testing: <TestTube size={12} />,
    opencode_task: <Wrench size={12} />,
};

/** Modal com histórico completo de eventos de uma task do TaskRunner. */
const TaskHistoryModal: React.FC<{
    task: Task;
    onClose: () => void;
}> = ({ task, onClose }) => {
    const [events, setEvents] = useState<import('../../services/taskService').TaskEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                // Prefer events already embedded in task, otherwise fetch
                if (task.events && task.events.length > 0) {
                    if (!cancelled) { setEvents(task.events); setLoading(false); }
                } else {
                    const evts = await TaskService.listEvents(task.issueNumber);
                    if (!cancelled) { setEvents(evts); setLoading(false); }
                }
            } catch {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [task]);

    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
    const outcomeTime = formatOutcomeTime(task.status, task);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={onClose}
            data-testid="task-history-modal"
        >
            <div
                className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-4 border-b border-slate-200 dark:border-slate-700 gap-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-slate-400">#{task.issueNumber}</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color} ${cfg.bg}`}>
                                {cfg.icon} {cfg.label}
                            </span>
                            {outcomeTime && (
                                <span className="text-[10px] text-slate-400">{outcomeTime}</span>
                            )}
                        </div>
                        <h3 className="text-sm font-semibold text-slate-800 dark:text-white line-clamp-2">{task.title}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                        aria-label="Fechar histórico"
                    >
                        <XCircle size={18} />
                    </button>
                </div>

                {/* Timeline */}
                <div className="flex-1 overflow-y-auto p-4">
                    <h4 className="text-[10px] uppercase font-bold text-slate-400 mb-3 flex items-center gap-1.5">
                        <Clock size={11} /> Histórico de eventos
                    </h4>
                    {loading ? (
                        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-indigo-500" /></div>
                    ) : events.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-8">Nenhum evento registrado</p>
                    ) : (
                        <ol className="relative border-l border-slate-200 dark:border-slate-700 space-y-4 ml-2">
                            {events.map((evt, i) => {
                                const d = new Date(evt.ts);
                                const timeStr = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                                const isError = evt.type === 'error' || evt.type === 'failed';
                                return (
                                    <li key={i} className="ml-4">
                                        <span className={`absolute -left-1.5 mt-1 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${isError ? 'bg-red-500' : 'bg-indigo-400'}`} />
                                        <div className="flex items-baseline gap-2 mb-0.5">
                                            <span className="text-[9px] font-mono text-slate-400 shrink-0">{timeStr}</span>
                                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${isError ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{evt.type}</span>
                                        </div>
                                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug whitespace-pre-wrap break-words">{evt.message}</p>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </div>

                {task.error && (
                    <div className="px-4 pb-4">
                        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-xs text-red-600 border border-red-200 dark:border-red-800">
                            <span className="font-bold">Erro: </span>{task.error}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const SortableMiniCard: React.FC<{
    task: Task;
    onAction: (action: string, task: Task, extra?: string) => void;
    onReview: (task: Task) => void;
    onEdit: (task: Task) => void;
    onDelete: (task: Task) => void;
    onConsole: (task: Task) => void;
    onHistory: (task: Task) => void;
    isAdmin: boolean;
    queuePosition?: number;
    isDragOverlay?: boolean;
}> = ({ task, onAction, onReview, onEdit, onDelete, onConsole, onHistory, isAdmin, queuePosition, isDragOverlay }) => {
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedback, setFeedback] = useState('');
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
    const isActive = ['running', 'fixing', 'cancelling'].includes(task.status);
    const canKill = ['running', 'fixing'].includes(task.status);
    const isSortable = task.status === 'pending';

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: `task-${task.issueNumber}`,
        disabled: !isSortable,
    });

    const style = isSortable ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    } : undefined;

    const outcomeTime = formatOutcomeTime(task.status, task);

    return (
        <div
            ref={isSortable ? setNodeRef : undefined}
            style={style}
            {...(isSortable ? attributes : {})}
            {...(isSortable ? listeners : {})}
            onClick={() => onHistory(task)}
            className={`p-3 rounded-lg border cursor-pointer ${isActive ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'} transition-all hover:shadow-sm hover:border-indigo-300 dark:hover:border-indigo-700 ${isDragging ? 'ring-2 ring-indigo-400 shadow-lg' : ''}`}
        >
            <div className="flex items-center gap-2 mb-1 flex-wrap">
                {isSortable && isAdmin && (
                    <span className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400">
                        <GripVertical size={12} />
                    </span>
                )}
                {queuePosition !== undefined && (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold">{queuePosition}</span>
                )}
                <span className="text-[10px] font-mono text-slate-400">#{task.issueNumber}</span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${cfg.color} ${cfg.bg}`}>
                    {cfg.icon} {cfg.label}
                </span>
                {outcomeTime && (
                    <span className="text-[9px] text-slate-400 ml-auto">{outcomeTime}</span>
                )}
                {task.judgeScore !== undefined && (
                    <span className={`text-[9px] font-medium ${task.judgeScore >= 7 ? 'text-green-600' : 'text-amber-600'}`}>
                        <Star size={8} className="inline" /> {task.judgeScore}/10
                    </span>
                )}
            </div>
            <h4 className="text-xs font-medium text-slate-800 dark:text-white leading-tight mb-1 line-clamp-2">{task.title}</h4>
            {task.planReason && (
                <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mb-1 line-clamp-2">{task.planReason}</p>
            )}
            {task.error && (
                <p className="text-[10px] text-red-500 mb-1 truncate">{task.error}</p>
            )}
            {!isDragOverlay && (
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                    {isAdmin && task.status === 'pending' && (
                        <button onClick={(e) => { e.stopPropagation(); onAction('start', task); }} className="text-[10px] px-2 py-0.5 rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
                            <Play size={10} className="inline mr-0.5" /> Iniciar
                        </button>
                    )}
                    {(task.status === 'reviewing' || task.status === 'approved') && (
                        <>
                            <button onClick={(e) => { e.stopPropagation(); onReview(task); }} className="text-[10px] px-2 py-0.5 rounded bg-purple-500 text-white hover:bg-purple-600 transition-colors">
                                <Eye size={10} className="inline mr-0.5" /> Revisar
                            </button>
                            {isAdmin && (
                                <>
                                    <button onClick={(e) => { e.stopPropagation(); onAction('merge', task); }} className="text-[10px] px-2 py-0.5 rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                                        <GitMerge size={10} className="inline mr-0.5" /> Merge
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setShowFeedback(!showFeedback); }} className="text-[10px] px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                                        <MessageSquare size={10} />
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); onAction('reject', task); }} className="text-[10px] px-1.5 py-0.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                                        <XCircle size={10} />
                                    </button>
                                </>
                            )}
                        </>
                    )}
                    {isAdmin && task.status === 'failed' && (
                        <button onClick={(e) => { e.stopPropagation(); onAction('redo', task); }} className="text-[10px] px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                            <RotateCcw size={10} className="inline mr-0.5" /> Retry
                        </button>
                    )}
                    {isActive && (
                        <button onClick={(e) => { e.stopPropagation(); onConsole(task); }} aria-label={`Ver console da task #${task.issueNumber}`} className="text-[10px] px-1.5 py-0.5 rounded text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                            <Terminal size={10} />
                        </button>
                    )}
                    {isAdmin && canKill && (
                        <button onClick={(e) => { e.stopPropagation(); onAction('kill', task); }} aria-label={`Cancelar task #${task.issueNumber}`} className="text-[10px] px-1.5 py-0.5 rounded text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                            <XCircle size={10} />
                        </button>
                    )}
                    {isAdmin && (
                        <>
                            <button onClick={(e) => { e.stopPropagation(); onEdit(task); }} aria-label={`Editar task #${task.issueNumber}`} className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                                <Pencil size={10} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onDelete(task); }} aria-label={`Excluir task #${task.issueNumber}`} className="text-[10px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                                <Trash2 size={10} />
                            </button>
                        </>
                    )}
                    {task.prUrl && (
                        <a href={task.prUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[10px] px-1.5 py-0.5 rounded text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                            PR #{task.prNumber} <ExternalLink size={8} className="inline" />
                        </a>
                    )}
                </div>
            )}
            {isAdmin && showFeedback && !isDragOverlay && (
                <div className="mt-2 flex gap-1">
                    <input
                        type="text" value={feedback} onChange={e => setFeedback(e.target.value)}
                        placeholder="Instrução..."
                        className="flex-1 text-[10px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                        onKeyDown={e => { if (e.key === 'Enter' && feedback.trim()) { onAction('fix', task, feedback.trim()); setFeedback(''); setShowFeedback(false); } }}
                    />
                    <button onClick={() => { if (feedback.trim()) { onAction('fix', task, feedback.trim()); setFeedback(''); setShowFeedback(false); } }} disabled={!feedback.trim()} className="text-[10px] px-2 py-1 rounded bg-indigo-500 text-white disabled:opacity-50">
                        OK
                    </button>
                </div>
            )}
        </div>
    );
};

const TaskListCard: React.FC<{
    task: Task;
    onAction: (action: string, task: Task, extra?: string) => void;
    onReview: (task: Task) => void;
    onEdit: (task: Task) => void;
    onDelete: (task: Task) => void;
    onConsole: (task: Task) => void;
    onHistory: (task: Task) => void;
    isAdmin: boolean;
    queuePosition?: number;
}> = ({ task, onAction, onReview, onEdit, onDelete, onConsole, onHistory, isAdmin, queuePosition }) => {
    const [expanded, setExpanded] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [showFeedback, setShowFeedback] = useState(false);
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
    const isActive = ['running', 'fixing', 'cancelling'].includes(task.status);
    const canKill = ['running', 'fixing'].includes(task.status);
    const outcomeTime = formatOutcomeTime(task.status, task);

    return (
        <Card className="relative overflow-hidden cursor-pointer hover:border-indigo-200 dark:hover:border-indigo-700 transition-colors" onClick={() => onHistory(task)}>
            {isActive && <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 animate-pulse" />}
            <div className="flex items-start gap-2">
                {queuePosition !== undefined && (
                    <div className="flex items-center justify-center w-6 h-6 mt-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-xs font-bold shrink-0">
                        {queuePosition}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-mono text-slate-400">#{task.issueNumber}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color} ${cfg.bg}`}>
                            {cfg.icon} {cfg.label}
                        </span>
                        {outcomeTime && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800" data-testid="outcome-time">
                                <Clock size={10} /> {outcomeTime}
                            </span>
                        )}
                        {task.judgeScore !== undefined && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${task.judgeScore >= 7 ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50'}`}>
                                <Star size={10} /> {task.judgeScore}/10
                            </span>
                        )}
                        {task.labels.filter(l => l !== 'opencode-task').map(l => (
                            <span key={l} className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{l}</span>
                        ))}
                    </div>
                    <h3 className="font-semibold text-sm text-slate-800 dark:text-white truncate">{task.title}</h3>
                    {task.planReason && (
                        <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-0.5 line-clamp-1">{task.planReason}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {task.branch && <p className="text-[10px] font-mono text-slate-400">branch: {task.branch}</p>}
                        {task.prUrl && (
                            <a href={task.prUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline">
                                PR #{task.prNumber} <ExternalLink size={8} />
                            </a>
                        )}
                        <span className="text-[10px] text-slate-400">{new Date(task.updatedAt).toLocaleString('pt-BR')}</span>
                    </div>
                </div>
            </div>

            {task.judgeReview && (
                <div className="mt-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-600 dark:text-slate-300">
                    {task.judgeReview}
                </div>
            )}
            {task.error && (
                <div className="mt-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-xs text-red-600">
                    {task.error}
                </div>
            )}

            <div className="flex items-center gap-2 mt-3 flex-wrap" onClick={e => e.stopPropagation()}>
                {isAdmin && task.status === 'pending' && (
                    <Button variant="primary" size="sm" icon={<Play size={12} />} onClick={() => onAction('start', task)}>Iniciar</Button>
                )}
                {(task.status === 'reviewing' || task.status === 'approved') && (
                    <>
                        <Button variant="primary" size="sm" icon={<Eye size={12} />} onClick={() => onReview(task)}>Revisar</Button>
                        {isAdmin && (
                            <>
                                <Button variant="primary" size="sm" icon={<CheckCircle size={12} />} onClick={() => onAction('merge', task)}>Merge</Button>
                                <Button variant="ghost" size="sm" icon={<MessageSquare size={12} />} onClick={() => setShowFeedback(!showFeedback)}>Corrigir</Button>
                                <Button variant="ghost" size="sm" icon={<RotateCcw size={12} />} onClick={() => onAction('redo', task)}>Refazer</Button>
                                <Button variant="ghost" size="sm" icon={<XCircle size={12} />} onClick={() => onAction('reject', task)}>Rejeitar</Button>
                            </>
                        )}
                    </>
                )}
                {isAdmin && task.status === 'failed' && (
                    <Button variant="primary" size="sm" icon={<RotateCcw size={12} />} onClick={() => onAction('redo', task)}>Tentar Novamente</Button>
                )}
                {task.status === 'merged' && (
                    <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={12} /> Concluído</span>
                )}
                <Button variant="ghost" size="sm" icon={<Eye size={12} />} onClick={() => setExpanded(!expanded)}>
                    {expanded ? 'Fechar' : 'Detalhes'}
                </Button>
                {isAdmin && <Button variant="ghost" size="sm" icon={<Pencil size={12} />} onClick={() => onEdit(task)}>Editar</Button>}
                {isActive && <Button variant="ghost" size="sm" icon={<Terminal size={12} />} onClick={() => onConsole(task)} className="text-indigo-500">Console</Button>}
                {isAdmin && canKill && <Button variant="ghost" size="sm" icon={<XCircle size={12} />} onClick={() => onAction('kill', task)} className="text-amber-600">Cancelar</Button>}
                {isAdmin && <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => onDelete(task)} className="text-red-500" />}
            </div>

            {isAdmin && showFeedback && (
                <div className="mt-3 flex gap-2">
                    <input type="text" value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Instrução adicional..."
                        className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        onKeyDown={e => { if (e.key === 'Enter' && feedback.trim()) { onAction('fix', task, feedback.trim()); setFeedback(''); setShowFeedback(false); } }} />
                    <Button variant="primary" size="sm" onClick={() => { if (feedback.trim()) { onAction('fix', task, feedback.trim()); setFeedback(''); setShowFeedback(false); } }} disabled={!feedback.trim()}>Enviar</Button>
                </div>
            )}

            {expanded && (
                <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-2">
                    <div>
                        <h4 className="text-[10px] uppercase font-bold text-slate-400 mb-1">Descrição</h4>
                        <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-32 overflow-auto">{task.body || 'Sem descrição'}</p>
                    </div>
                    {task.feedbackHistory.length > 0 && (
                        <div>
                            <h4 className="text-[10px] uppercase font-bold text-slate-400 mb-1">Feedback</h4>
                            <ul className="space-y-1">
                                {task.feedbackHistory.map((fb, i) => <li key={i} className="text-xs text-amber-600 dark:text-amber-400">• {fb}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
};

const CreateTaskModal: React.FC<{
    onClose: () => void;
    onCreated: () => void;
}> = ({ onClose, onCreated }) => {
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [labels, setLabels] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!title.trim()) { toast.error('Título é obrigatório'); return; }
        setSubmitting(true);
        try {
            const extraLabels = labels.split(',').map(l => l.trim()).filter(Boolean);
            await TaskService.create(title.trim(), body.trim(), extraLabels.length ? extraLabels : undefined);
            toast.success('Task criada com sucesso!');
            onCreated();
            onClose();
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Nova Task</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Cria uma issue no GitHub com label <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">opencode-task</span> automaticamente.
                </p>
                <div>
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Título *</label>
                    <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="feat: descrição curta da task"
                        className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        autoFocus onKeyDown={e => { if (e.key === 'Enter' && title.trim()) handleSubmit(); }} />
                </div>
                <div>
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Descrição</label>
                    <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Descreva o que deve ser implementado..."
                        rows={6} className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
                </div>
                <div>
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Labels extras (separadas por vírgula)</label>
                    <input type="text" value={labels} onChange={e => setLabels(e.target.value)} placeholder="enhancement, bug, frontend"
                        className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
                    <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting || !title.trim()}>
                        {submitting ? <><Loader2 size={14} className="animate-spin mr-1" /> Criando...</> : 'Criar Task'}
                    </Button>
                </div>
            </div>
        </div>
    );
};

const IssuesPage: React.FC = () => {
    const { currentUser } = useDolibarr();
    const confirm = useConfirm();
    const isAdmin = currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true;
    const [tab, setTab] = useState<'issues' | 'tasks' | 'stats'>('issues');
    const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'closed'>('all');
    const [labelFilter, setLabelFilter] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [issues, setIssues] = useState<GitHubIssue[]>([]);
    const [stats, setStats] = useState<IssueStats | null>(null);
    const [issuesLoading, setIssuesLoading] = useState(true);

    const [tasks, setTasks] = useState<Task[]>([]);
    const [tasksLoading, setTasksLoading] = useState(true);
    const [taskViewMode, setTaskViewMode] = useState<'pipeline' | 'list'>('pipeline');
    const [taskTab, setTaskTab] = useState<'active' | 'done' | 'all'>('active');
    const [taskSearch, setTaskSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [showCreate, setShowCreate] = useState(false);
    const [planning, setPlanning] = useState(false);

    const [reviewTask, setReviewTask] = useState<Task | null>(null);
    const [diffText, setDiffText] = useState('');
    const [diffLoading, setDiffLoading] = useState(false);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editBody, setEditBody] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<Task | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [consoleTask, setConsoleTask] = useState<Task | null>(null);
    const [historyTask, setHistoryTask] = useState<Task | null>(null);
    const [labelingIssue, setLabelingIssue] = useState<number | null>(null);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    const loadIssues = useCallback(async () => {
        setIssuesLoading(true);
        try {
            const [i, s] = await Promise.all([
                GithubService.getIssues({ state: issueFilter, label: labelFilter || undefined, limit: 50 }),
                GithubService.getStats(),
            ]);
            setIssues(i);
            if (s) setStats(s);
        } catch (e) {
            // API GitHub é intermitente (endpoint Azure-BR). Sem este catch, o await rejeitado
            // deixava issuesLoading=true para sempre → spinner eterno. Zera para o empty-state aparecer.
            setIssues([]);
            toast.error('Erro ao carregar issues do GitHub');
        } finally {
            setIssuesLoading(false);
        }
    }, [issueFilter, labelFilter]);

    const loadTasks = useCallback(async () => {
        try {
            const data = await TaskService.list();
            setTasks(data);
        } catch { toast.error('Erro ao carregar tasks'); }
        setTasksLoading(false);
    }, []);

    useEffect(() => { loadIssues(); }, [loadIssues]);
    useEffect(() => { loadTasks(); const iv = setInterval(loadTasks, 10000); return () => clearInterval(iv); }, [loadTasks]);

    const filteredIssues = searchQuery
        ? issues.filter(i => i.title.toLowerCase().includes(searchQuery.toLowerCase()) || String(i.number).includes(searchQuery))
        : issues;

    const queueOrder = useMemo(() => {
        return tasks
            .filter(t => t.status === 'pending')
            .sort((a, b) => (a.queuePriority ?? 999) - (b.queuePriority ?? 999));
    }, [tasks]);

    const getQueuePosition = (task: Task): number | undefined => {
        if (task.status !== 'pending') return undefined;
        const idx = queueOrder.findIndex(t => t.issueNumber === task.issueNumber);
        return idx >= 0 ? idx + 1 : undefined;
    };

    const filteredTasks = useMemo(() => {
        let result = tasks;
        if (taskTab === 'active') result = result.filter(t => !TERMINAL_STATUSES.includes(t.status));
        else if (taskTab === 'done') result = result.filter(t => TERMINAL_STATUSES.includes(t.status));
        if (statusFilter !== 'all') result = result.filter(t => t.status === statusFilter);
        if (taskSearch.trim()) {
            const q = taskSearch.toLowerCase().trim();
            result = result.filter(t => t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || String(t.issueNumber).includes(q));
        }
        return result;
    }, [tasks, taskTab, statusFilter, taskSearch]);

    const statusCounts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const t of tasks) c[t.status] = (c[t.status] || 0) + 1;
        return c;
    }, [tasks]);

    const hasActiveTask = tasks.some(t => ['running', 'fixing', 'cancelling'].includes(t.status));

    const metrics = useMemo(() => {
        const completed = tasks.filter(t => t.status === 'merged' && t.startedAt && t.completedAt);
        const totalMs = completed.reduce((s, t) => s + (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()), 0);
        const avgMin = completed.length ? Math.round(totalMs / completed.length / 60000) : 0;
        const totalRan = tasks.filter(t => TERMINAL_STATUSES.includes(t.status)).length;
        const successRate = totalRan ? Math.round((completed.length / totalRan) * 100) : 0;
        return { total: tasks.length, avgMin, successRate, pending: tasks.filter(t => t.status === 'pending').length, active: tasks.filter(t => ['running', 'fixing'].includes(t.status)).length };
    }, [tasks]);

    const openReview = async (task: Task) => {
        setReviewTask(task); setDiffLoading(true);
        try { setDiffText(await TaskService.getDiff(task.issueNumber)); } catch { setDiffText(''); }
        setDiffLoading(false);
    };

    const handleTaskAction = async (action: string, task: Task, extra?: string) => {
        if (!isAdmin) { toast.error('Apenas administradores.'); return; }
        try {
            switch (action) {
                case 'start': toast.info(`Iniciando #${task.issueNumber}...`); await TaskService.start(task.issueNumber); break;
                case 'merge': await TaskService.merge(task.issueNumber); toast.success('PR merged!'); break;
                case 'reject': await TaskService.reject(task.issueNumber); toast.info('Rejeitada'); break;
                case 'redo': await TaskService.redo(task.issueNumber); toast.info('Refazendo...'); break;
                case 'fix':
                    if (!extra) { toast.error('Informe a correção.'); return; }
                    toast.info('Enviando correção...');
                    await TaskService.fix(task.issueNumber, extra);
                    break;
                case 'kill':
                    if (!(await confirm({ title: `Cancelar a task #${task.issueNumber}?`, message: 'O trabalho em andamento será perdido.', confirmText: 'Sim, cancelar', cancelText: 'Manter executando', danger: true }))) return;
                    await TaskService.kill(task.issueNumber); toast.info('Cancelando...'); break;
            }
            loadTasks();
        } catch (e: any) { toast.error(e.response?.data?.error || e.message); }
    };

    const handlePlan = async () => {
        setPlanning(true);
        try {
            const result = await TaskService.plan();
            toast.success(`Plano gerado! Ordem: ${result.order.map(n => `#${n}`).join(' → ')}`);
            loadTasks();
        } catch (e: any) { toast.error(e.response?.data?.error || e.message); }
        finally { setPlanning(false); }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const activeId = String(active.id).replace('task-', '');
        const overId = String(over.id).replace('task-', '');

        const oldIndex = queueOrder.findIndex(t => String(t.issueNumber) === activeId);
        const newIndex = queueOrder.findIndex(t => String(t.issueNumber) === overId);
        if (oldIndex === -1 || newIndex === -1) return;

        const newOrder = arrayMove(queueOrder, oldIndex, newIndex).map(t => t.issueNumber);
        try {
            await TaskService.reorder(newOrder);
            loadTasks();
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        }
    };

    const openEdit = (task: Task) => { setEditTask(task); setEditTitle(task.title); setEditBody(task.body); };
    const saveEdit = async () => {
        if (!editTask) return;
        try { await TaskService.update(editTask.issueNumber, { title: editTitle, body: editBody }); toast.success('Atualizada'); setEditTask(null); loadTasks(); }
        catch (e: any) { toast.error(e.response?.data?.error || e.message); }
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        setIsDeleting(true);
        try {
            await TaskService.delete(deleteConfirm.issueNumber);
            toast.success('Deletada');
            loadTasks();
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        } finally {
            setDeleteConfirm(null);
            setIsDeleting(false);
        }
    };

    const virarTask = async (e: React.MouseEvent, issue: GitHubIssue) => {
        e.preventDefault(); e.stopPropagation();
        setLabelingIssue(issue.number);
        const r = await GithubService.addLabel(issue.number, 'opencode-task');
        if (r.ok) { toast.success(`#${issue.number} virou task (opencode-task)`); await loadIssues(); }
        else toast.error(r.error || 'Falha ao virar task');
        setLabelingIssue(null);
    };

    const changeIssueState = async (e: React.MouseEvent, issue: GitHubIssue, state: 'open' | 'closed') => {
        e.preventDefault(); e.stopPropagation();
        const label = state === 'closed' ? 'fechar' : 'reabrir';
        if (!(await confirm({ title: `${label.charAt(0).toUpperCase() + label.slice(1)} issue #${issue.number}?`, message: `Tem certeza que dese ${label} "${issue.title}"?`, confirmText: label.charAt(0).toUpperCase() + label.slice(1), danger: state === 'closed' }))) return;
        setLabelingIssue(issue.number);
        const r = await GithubService.setIssueState(issue.number, state, state === 'closed' ? 'not planned' : undefined);
        if (r.ok) { toast.success(`#${issue.number} ${state === 'closed' ? 'fechada' : 'reaberta'}`); await loadIssues(); }
        else toast.error(r.error || 'Falha ao alterar a issue');
        setLabelingIssue(null);
    };

    const hasOpencodeLabel = (issue: GitHubIssue) => (issue.labels || []).some((l: any) => l.name === 'opencode-task');
    const sortedIssues = [...filteredIssues].sort((a, b) => (a.state === 'OPEN' ? 0 : 1) - (b.state === 'OPEN' ? 0 : 1));
    const openCount = filteredIssues.filter(i => i.state === 'OPEN').length;
    const closedCount = filteredIssues.length - openCount;

    return (
        <PageLayout title="Issues & Tasks">
            <PageHeader
                title="Issues & Tasks"
                subtitle="GitHub issues, tasks automáticas e estatísticas do projeto"
                tabs={
                    <Tabs value={tab} onChange={v => setTab(v as any)}>
                        <Tab value="issues">Issues ({issues.length})</Tab>
                        <Tab value="tasks">Tasks ({tasks.filter(t => !TERMINAL_STATUSES.includes(t.status)).length})</Tab>
                        <Tab value="stats">Estatísticas</Tab>
                    </Tabs>
                }
            />

            {/* ISSUES TAB */}
            {tab === 'issues' && (
                <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex-1 min-w-[200px] relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar issue..." className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
                        </div>
                        <select value={issueFilter} onChange={e => setIssueFilter(e.target.value as any)} className="text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                            <option value="all">Todas</option>
                            <option value="open">Abertas</option>
                            <option value="closed">Fechadas</option>
                        </select>
                        <select value={labelFilter} onChange={e => setLabelFilter(e.target.value)} className="text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                            <option value="">Todos os labels</option>
                            <option value="bug">Bug</option>
                            <option value="enhancement">Enhancement</option>
                            <option value="security">Security</option>
                            <option value="testing">Testing</option>
                            <option value="opencode-task">opencode-task</option>
                            <option value="production">Production</option>
                            <option value="infra">Infra</option>
                        </select>
                    </div>

                    {issuesLoading ? <div className="flex justify-center py-12"><Spinner /></div> : (
                        <div className="space-y-1">
                            {filteredIssues.length === 0 && (
                                <Card><div className="text-center py-8 text-slate-400 text-sm">Nenhuma issue encontrada</div></Card>
                            )}
                            {filteredIssues.length > 0 && (
                                <div className="flex items-center gap-2 px-1 pb-1 text-xs text-slate-500">
                                    <span className="font-medium text-green-600 dark:text-green-400">{openCount} abertas</span>
                                    <span>·</span>
                                    <span>{closedCount} fechadas</span>
                                </div>
                            )}
                            {sortedIssues.map(issue => (
                                <a key={issue.number} href={issue.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                    <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${issue.state === 'OPEN' ? 'bg-green-500' : 'bg-slate-400'}`} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 line-clamp-3 sm:line-clamp-2">
                                            <span className="text-slate-400 mr-1">#{issue.number}</span>{issue.title}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            {(issue.labels || []).map((l: any) => (
                                                <span key={l.name} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${LABEL_COLORS[l.name] || 'bg-slate-100 text-slate-500'}`}>
                                                    {LABEL_ICONS[l.name]}{l.name}
                                                </span>
                                            ))}
                                            <span className="text-[10px] text-slate-400">{new Date(issue.createdAt).toLocaleDateString('pt-BR')}</span>
                                        </div>
                                    </div>
                                    {issue.state === 'OPEN' && (
                                        hasOpencodeLabel(issue) ? (
                                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 mt-0.5"><Terminal size={11} /> Task</span>
                                        ) : (
                                            <button type="button" onClick={(e) => virarTask(e, issue)} disabled={labelingIssue === issue.number}
                                                className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 mt-0.5">
                                                {labelingIssue === issue.number ? <Loader2 size={11} className="animate-spin" /> : <Tag size={11} />} Virar Task
                                            </button>
                                        )
                                    )}
                                    {isAdmin && (
                                        issue.state === 'OPEN' ? (
                                            <button type="button" onClick={(e) => changeIssueState(e, issue, 'closed')} disabled={labelingIssue === issue.number}
                                                className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 mt-0.5">
                                                <XCircle size={11} /> Fechar
                                            </button>
                                        ) : (
                                            <button type="button" onClick={(e) => changeIssueState(e, issue, 'open')} disabled={labelingIssue === issue.number}
                                                className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg text-slate-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 mt-0.5">
                                                <CircleDot size={11} /> Reabrir
                                            </button>
                                        )
                                    )}
                                    <ExternalLink size={14} className="text-slate-300 group-hover:text-indigo-400 shrink-0 mt-1" />
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* TASKS TAB */}
            {tab === 'tasks' && (
                <div className="mt-6 space-y-4">
                    <div className="flex items-center gap-2 flex-wrap">
                        {hasActiveTask && <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full"><Loader2 size={12} className="animate-spin" /> Executando</span>}
                        {isAdmin && metrics.pending > 1 && (
                            <Button variant="ghost" size="sm" icon={<Sparkles size={14} />} onClick={handlePlan} disabled={planning} className="text-indigo-500">
                                {planning ? <><Loader2 size={14} className="animate-spin mr-1" /> Planejando...</> : 'Planejar com IA'}
                            </Button>
                        )}
                        {isAdmin && <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>Nova Task</Button>}
                        <div className="flex gap-1 text-xs">
                            <button onClick={() => setTaskTab('active')} className={`px-3 py-1.5 rounded-full ${taskTab === 'active' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                Ativas ({tasks.filter(t => !TERMINAL_STATUSES.includes(t.status)).length})
                            </button>
                            <button onClick={() => setTaskTab('done')} className={`px-3 py-1.5 rounded-full ${taskTab === 'done' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                Concluídas ({tasks.filter(t => TERMINAL_STATUSES.includes(t.status)).length})
                            </button>
                            <button onClick={() => setTaskTab('all')} className={`px-3 py-1.5 rounded-full ${taskTab === 'all' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                Todas ({tasks.length})
                            </button>
                        </div>
                        <div className="flex border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden ml-auto">
                            <button onClick={() => setTaskViewMode('pipeline')} className={`px-2 py-1.5 ${taskViewMode === 'pipeline' ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`} title="Pipeline"><LayoutGrid size={14} /></button>
                            <button onClick={() => setTaskViewMode('list')} className={`px-2 py-1.5 ${taskViewMode === 'list' ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`} title="Lista"><List size={14} /></button>
                        </div>
                        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={loadTasks} />
                    </div>

                    {!isAdmin && (
                        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
                            <ShieldOff size={14} />
                            <span>Modo somente leitura. Apenas administradores podem gerenciar tasks.</span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                            <div className="text-[10px] text-slate-400 uppercase font-bold">Fila</div>
                            <div className="text-lg font-bold text-slate-800 dark:text-white">{metrics.pending}</div>
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
                            <div className="text-[10px] text-blue-400 uppercase font-bold">Ativas</div>
                            <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{metrics.active}</div>
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800">
                            <div className="text-[10px] text-emerald-400 uppercase font-bold">Sucesso</div>
                            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{metrics.successRate}%</div>
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800">
                            <div className="text-[10px] text-purple-400 uppercase font-bold">Tempo Médio</div>
                            <div className="text-lg font-bold text-purple-600 dark:text-purple-400">{metrics.avgMin}min</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative flex-1 min-w-[200px] max-w-md">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type="text" value={taskSearch} onChange={e => setTaskSearch(e.target.value)} placeholder="Buscar por título, descrição ou #issue..."
                                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Filter size={14} className="text-slate-400" />
                            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                                className="text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none">
                                <option value="all">Todos os status</option>
                                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                                    <option key={key} value={key}>{cfg.label} ({statusCounts[key] || 0})</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {tasksLoading ? <div className="flex justify-center py-12"><Spinner /></div> : taskViewMode === 'pipeline' ? (
                        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {PIPELINE_COLUMNS.map(col => {
                                    const colStatuses = col.statuses as readonly string[];
                                    const colTasks = filteredTasks.filter(t => colStatuses.includes(t.status));
                                    const isQueue = col.key === 'queue';
                                    const sortableIds = colTasks.map(t => `task-${t.issueNumber}`);
                                    return (
                                        <div key={col.key} className="flex flex-col">
                                            <div className="flex items-center gap-2 mb-2 px-1">
                                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">{col.label}</span>
                                                <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full">{colTasks.length}</span>
                                                {isQueue && colTasks.length > 1 && isAdmin && (
                                                    <span className="text-[9px] text-slate-400">arraste para reordenar</span>
                                                )}
                                            </div>
                                            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                                                <div className="flex flex-col gap-2 min-h-[100px]">
                                                    {colTasks.length === 0 && (
                                                        <div className="text-[10px] text-slate-400 text-center py-4 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">Vazio</div>
                                                    )}
                                                    {colTasks.map(task => (
                                                        <SortableMiniCard
                                                            key={task.issueNumber}
                                                            task={task}
                                                            onAction={handleTaskAction}
                                                            onReview={openReview}
                                                            onEdit={openEdit}
                                                            onDelete={setDeleteConfirm}
                                                            onConsole={setConsoleTask}
                                                            onHistory={setHistoryTask}
                                                            isAdmin={isAdmin}
                                                            queuePosition={getQueuePosition(task)}
                                                        />
                                                    ))}
                                                </div>
                                            </SortableContext>
                                        </div>
                                    );
                                })}
                            </div>
                        </DndContext>
                    ) : (
                        <div className="space-y-3">
                            {filteredTasks.length === 0 && (
                                <Card>
                                    <div className="text-center py-8 text-slate-400">
                                        <p className="text-sm">Nenhuma task encontrada</p>
                                        <p className="text-xs mt-1">
                                            {taskSearch || statusFilter !== 'all' ? 'Tente ajustar os filtros' : isAdmin ? <button onClick={() => setShowCreate(true)} className="text-indigo-500 hover:underline">Criar uma nova task</button> : 'Aguardando issues com label "opencode-task"'}
                                        </p>
                                    </div>
                                </Card>
                            )}
                            {filteredTasks.map(task => (
                                <TaskListCard key={task.issueNumber} task={task} onAction={handleTaskAction} onReview={openReview} onEdit={openEdit} onDelete={setDeleteConfirm} onConsole={setConsoleTask} onHistory={setHistoryTask} isAdmin={isAdmin} queuePosition={getQueuePosition(task)} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* STATS TAB */}
            {tab === 'stats' && (
                <div className="mt-6 space-y-6">
                    {stats ? (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <Card><div className="text-center"><p className="text-2xl font-bold text-green-600">{stats.totalClosed}</p><p className="text-xs text-slate-500">Fechadas</p></div></Card>
                                <Card><div className="text-center"><p className="text-2xl font-bold text-amber-600">{stats.totalOpen}</p><p className="text-xs text-slate-500">Abertas</p></div></Card>
                                <Card><div className="text-center"><p className="text-2xl font-bold text-indigo-600">{stats.totalOpen + stats.totalClosed}</p><p className="text-xs text-slate-500">Total</p></div></Card>
                                <Card><div className="text-center"><p className="text-2xl font-bold text-violet-600">{stats.totalClosed > 0 ? Math.round(stats.totalClosed / (stats.totalOpen + stats.totalClosed) * 100) : 0}%</p><p className="text-xs text-slate-500">Resolução</p></div></Card>
                            </div>

                            {Object.keys(stats.byLabel).length > 0 && (
                                <Card>
                                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2"><Tag size={14} /> Por Categoria</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {Object.entries(stats.byLabel).sort((a, b) => (b[1].open + b[1].closed) - (a[1].open + a[1].closed)).map(([label, counts]) => (
                                            <button key={label} onClick={() => { setLabelFilter(label); setTab('issues'); }} className="text-left p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors">
                                                <div className="flex items-center gap-1.5 mb-1">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${LABEL_COLORS[label] || 'bg-slate-100 text-slate-500'}`}>{label}</span>
                                                </div>
                                                <div className="flex gap-3 text-[11px] text-slate-500">
                                                    <span className="text-green-600">{counts.closed} ✓</span>
                                                    {counts.open > 0 && <span className="text-amber-600">{counts.open} ⏳</span>}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </Card>
                            )}

                            {stats.recentClosed.length > 0 && (
                                <Card>
                                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Fechadas Recentemente</h3>
                                    <div className="space-y-1">
                                        {stats.recentClosed.slice(0, 10).map(i => (
                                            <a key={i.number} href={i.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 text-sm text-slate-600 dark:text-slate-400 group">
                                                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                                                <span className="text-slate-400">#{i.number}</span>
                                                <span className="line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{i.title}</span>
                                            </a>
                                        ))}
                                    </div>
                                </Card>
                            )}
                        </>
                    ) : <div className="flex justify-center py-12"><Spinner /></div>}
                </div>
            )}

            {/* MODALS */}
            {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} onCreated={loadTasks} />}

            {historyTask && <TaskHistoryModal task={historyTask} onClose={() => setHistoryTask(null)} />}

            {reviewTask && (diffLoading ? (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 flex flex-col items-center gap-3"><Loader2 size={24} className="animate-spin text-indigo-500" /><p className="text-sm text-slate-500">Carregando diff...</p></div>
                </div>
            ) : (
                <DiffViewer diff={diffText} issueNumber={reviewTask.issueNumber} judgeScore={reviewTask.judgeScore} judgeReview={reviewTask.judgeReview} visualScore={reviewTask.visualScore} visualReview={reviewTask.visualReview} prUrl={reviewTask.prUrl}
                    onClose={() => setReviewTask(null)}
                    onMerge={async () => { if (!isAdmin) { toast.error('Apenas administradores.'); return; } await TaskService.merge(reviewTask.issueNumber); setReviewTask(null); toast.success('PR merged!'); loadTasks(); }}
                    onFix={() => setReviewTask(null)}
                    onReject={async () => { if (!isAdmin) { toast.error('Apenas administradores.'); return; } await TaskService.reject(reviewTask.issueNumber); setReviewTask(null); toast.info('Rejeitada'); loadTasks(); }}
                />
            ))}

            {editTask && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditTask(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Editar Task #{editTask.issueNumber}</h2>
                        <div>
                            <label className="text-xs font-medium text-slate-500">Título</label>
                            <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-500">Descrição</label>
                            <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={8} className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setEditTask(null)}>Cancelar</Button>
                            <Button variant="primary" size="sm" onClick={saveEdit}>Salvar</Button>
                        </div>
                    </div>
                </div>
            )}

            {deleteConfirm && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Deletar Task #{deleteConfirm.issueNumber}?</h2>
                        <p className="text-sm text-slate-500">A task sai do board e o label <span className="font-mono text-xs">opencode-task</span> é removido da issue.</p>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)} disabled={isDeleting}>Cancelar</Button>
                            <Button variant="primary" size="sm" onClick={confirmDelete} disabled={isDeleting} className="bg-red-600 hover:bg-red-700">
                                {isDeleting ? <><Loader2 size={14} className="animate-spin mr-1" /> Deletando...</> : 'Deletar'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {consoleTask && <TaskConsole issueNumber={consoleTask.issueNumber} onClose={() => setConsoleTask(null)} />}
        </PageLayout>
    );
};

export default IssuesPage;
