import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TaskService, Task } from '../../services/taskService';
import { getUiConfig } from '../../services/uiConfigService';
import { PageLayout, PageHeader, Card, Button, Spinner, Tabs, Tab } from '../ui';
import { Play, CheckCircle, XCircle, RotateCcw, GitMerge, MessageSquare, Loader2, AlertCircle, Clock, Eye, RefreshCw, ExternalLink, ThumbsUp, Star, Trash2, Pencil, Terminal, ShieldOff, Plus, Search, Filter, LayoutGrid, List, Sparkles, GripVertical, Monitor, ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { toast } from 'sonner';
import DiffViewer from './DiffViewer';
import TaskConsole from './TaskConsole';
import { TaskReviewPanel } from './TaskReviewPanel';
import { useDolibarr } from '../../context/DolibarrContext';

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

const PLANNER_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
    go: { color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', icon: <ShieldCheck size={9} />, label: 'GO' },
    skip: { color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', icon: <ShieldAlert size={9} />, label: 'SKIP' },
    wait: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: <Clock size={9} />, label: 'WAIT' },
    reorder: { color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: <Shield size={9} />, label: 'PLAN' },
};

const PIPELINE_COLUMNS = [
    { key: 'queue', label: 'Fila', statuses: ['pending'] },
    { key: 'active', label: 'Em Execução', statuses: ['running', 'fixing', 'cancelling'] },
    { key: 'review', label: 'Revisão', statuses: ['reviewing', 'approved'] },
    { key: 'done', label: 'Concluído', statuses: ['merged', 'rejected', 'cancelled', 'failed'] },
] as const;

type PipelinePhase = 'exploring' | 'synthesizing' | 'judging' | 'done';

const PIPELINE_STEPS: { key: PipelinePhase; label: string; icon: string }[] = [
    { key: 'exploring', label: 'Explorar', icon: '🔍' },
    { key: 'synthesizing', label: 'Síntese', icon: '🧪' },
    { key: 'judging', label: 'Judge', icon: '⚖️' },
];

const PipelineBar: React.FC<{
    phase: PipelinePhase;
    attempts?: any[];
    synthesisAttempt?: number;
    judgeAttempts?: number;
}> = ({ phase, attempts, synthesisAttempt, judgeAttempts }) => {
    const phaseIdx = PIPELINE_STEPS.findIndex(s => s.key === phase);
    const exploreDone = attempts?.filter((a: any) => a.phase === 'exploring').length || 0;

    return (
        <div className="flex items-center gap-0.5 mb-1">
            {PIPELINE_STEPS.map((step, i) => {
                const isDone = i < phaseIdx;
                const isCurrent = i === phaseIdx;
                const isPending = i > phaseIdx;
                let detail = '';
                if (step.key === 'exploring') detail = `${exploreDone}/3`;
                if (step.key === 'synthesizing') detail = `${synthesisAttempt || 0}/3`;
                if (step.key === 'judging') detail = judgeAttempts ? `${judgeAttempts}/3` : '';

                return (
                    <React.Fragment key={step.key}>
                        {i > 0 && <div className={`w-2 h-[2px] ${isDone ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`} />}
                        <div className={`flex items-center gap-0.5 px-1 py-0 rounded text-[7px] font-medium ${
                            isCurrent ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' :
                            isDone ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' :
                            'bg-slate-50 dark:bg-slate-800 text-slate-400'
                        }`}>
                            <span>{step.icon}</span>
                            {detail && <span>{detail}</span>}
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
};

const MiniCard: React.FC<{
    task: Task;
    onAction: (action: string, task: Task, extra?: string) => void;
    onReview: (task: Task) => void;
    onEdit: (task: Task) => void;
    onDelete: (task: Task) => void;
    onConsole: (task: Task) => void;
    onPreview: (task: Task) => void;
    onStopPreview: (issueNumber: number) => void;
    previewUrl?: string;
    isAdmin: boolean;
    queuePosition?: number;
}> = ({ task, onAction, onReview, onEdit, onDelete, onConsole, onPreview, onStopPreview, previewUrl, isAdmin, queuePosition }) => {
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedback, setFeedback] = useState('');
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
    const isMiniActive = ['running', 'fixing', 'cancelling'].includes(task.status);

    const plannerAction = task.events?.filter(e => e.type === 'planner_decision').pop()?.meta?.action;
    const plannerCfg = plannerAction ? PLANNER_CONFIG[plannerAction] : null;

    return (
        <div className={`p-3 rounded-lg border ${isMiniActive ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'} transition-all hover:shadow-sm`}>
            <div className="flex items-center gap-2 mb-1">
                {queuePosition !== undefined && (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold">{queuePosition}</span>
                )}
                <span className="text-[10px] font-mono text-slate-400">#{task.issueNumber}</span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${cfg.color} ${cfg.bg}`}>
                    {cfg.icon} {cfg.label}
                </span>
                {task.judgeScore !== undefined && (
                    <span className={`text-[9px] font-medium ${task.judgeScore >= 7 ? 'text-green-600' : 'text-amber-600'}`}>
                        <Star size={8} className="inline" /> {task.judgeScore}/10
                    </span>
                )}
                {plannerCfg && (
                    <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold ${plannerCfg.color} ${plannerCfg.bg}`} title={task.planReason}>
                        {plannerCfg.icon} {plannerCfg.label}
                    </span>
                )}
            </div>
            <h4 className="text-xs font-medium text-slate-800 dark:text-white leading-tight mb-1 line-clamp-2">{task.title}</h4>
            {task.phase && task.phase !== 'done' && (
                <PipelineBar phase={task.phase} attempts={task.attempts} synthesisAttempt={task.synthesisAttempt} judgeAttempts={task.judgeAttempts} />
            )}
            {task.phase === 'done' && task.judgeScore !== undefined && (
                <div className="flex items-center gap-1 mb-1">
                    <div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className={`h-full rounded-full ${task.judgeScore >= 8 ? 'bg-emerald-500' : task.judgeScore >= 6 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${task.judgeScore * 10}%` }} />
                    </div>
                    <span className="text-[8px] text-slate-400">{task.judgeScore}/10</span>
                </div>
            )}
            {task.planReason && (
                <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mb-1 line-clamp-2">{task.planReason}</p>
            )}
            {task.error && (
                <p className="text-[10px] text-red-500 mb-1 truncate">{task.error}</p>
            )}
            <div className="flex items-center gap-1 mt-2 flex-wrap">
                {isAdmin && task.status === 'pending' && (
                    <button onClick={() => onAction('start', task)} className="text-[10px] px-2 py-0.5 rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
                        <Play size={10} className="inline mr-0.5" /> Iniciar
                    </button>
                )}
                {(task.status === 'reviewing' || task.status === 'approved' || task.status === 'failed' || task.status === 'rejected') && (
                    <>
                        <button onClick={() => onReview(task)} className="text-[10px] px-2 py-0.5 rounded bg-purple-500 text-white hover:bg-purple-600 transition-colors">
                            <Eye size={10} className="inline mr-0.5" /> Revisar
                        </button>
                        {task.branch && (
                            previewUrl ? (
                                <button onClick={() => onStopPreview(task.issueNumber)} className="text-[10px] px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors">
                                    <Monitor size={10} className="inline mr-0.5" /> Parar
                                </button>
                            ) : (
                                <button onClick={() => onPreview(task)} className="text-[10px] px-2 py-0.5 rounded bg-teal-500 text-white hover:bg-teal-600 transition-colors">
                                    <Monitor size={10} className="inline mr-0.5" /> Testar
                                </button>
                            )
                        )}
                        {isAdmin && (task.status === 'reviewing' || task.status === 'approved') && (
                            <>
                                <button onClick={() => onAction('merge', task)} className="text-[10px] px-2 py-0.5 rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                                    <GitMerge size={10} className="inline mr-0.5" /> Merge
                                </button>
                                <button onClick={() => setShowFeedback(!showFeedback)} className="text-[10px] px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                                    <MessageSquare size={10} />
                                </button>
                                <button onClick={() => onAction('reject', task)} className="text-[10px] px-1.5 py-0.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                                    <XCircle size={10} />
                                </button>
                            </>
                        )}
                    </>
                )}
                {isAdmin && task.status === 'failed' && (
                    <button onClick={() => onAction('redo', task)} className="text-[10px] px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                        <RotateCcw size={10} className="inline mr-0.5" /> Retry
                    </button>
                )}
                {isMiniActive && (
                    <button onClick={() => onConsole(task)} className="text-[10px] px-1.5 py-0.5 rounded text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                        <Terminal size={10} className="inline mr-0.5" /> Console
                    </button>
                )}
                {!isMiniActive && (task.events?.length || 0) > 0 && (
                    <button onClick={() => onConsole(task)} className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <Terminal size={10} className="inline mr-0.5" /> Histórico
                    </button>
                )}
                {isAdmin && isMiniActive && (
                    <button onClick={() => onAction('kill', task)} className="text-[10px] px-1.5 py-0.5 rounded text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                        <XCircle size={10} />
                    </button>
                )}
                {isAdmin && (
                    <>
                        <button onClick={() => onEdit(task)} className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                            <Pencil size={10} />
                        </button>
                        <button onClick={() => onDelete(task)} className="text-[10px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                            <Trash2 size={10} />
                        </button>
                    </>
                )}
                {task.prUrl && (
                    <a href={task.prUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] px-1.5 py-0.5 rounded text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                        PR #{task.prNumber} <ExternalLink size={8} className="inline" />
                    </a>
                )}
            </div>
            {isAdmin && showFeedback && (
                <div className="mt-2 flex gap-1">
                    <input
                        type="text"
                        value={feedback}
                        onChange={e => setFeedback(e.target.value)}
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

const TaskCard: React.FC<{
    task: Task;
    onAction: (action: string, task: Task, extra?: string) => void;
    onReview: (task: Task) => void;
    onEdit: (task: Task) => void;
    onDelete: (task: Task) => void;
    onConsole: (task: Task) => void;
    onPreview: (task: Task) => void;
    onStopPreview: (issueNumber: number) => void;
    previewUrl?: string;
    isAdmin: boolean;
    queuePosition?: number;
}> = ({ task, onAction, onReview, onEdit, onDelete, onConsole, onPreview, onStopPreview, previewUrl, isAdmin, queuePosition }) => {
    const [expanded, setExpanded] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [showFeedback, setShowFeedback] = useState(false);
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
    const isActive = ['running', 'fixing', 'cancelling'].includes(task.status);

    const plannerAction = task.events?.filter(e => e.type === 'planner_decision').pop()?.meta?.action;
    const plannerCfg = plannerAction ? PLANNER_CONFIG[plannerAction] : null;

    return (
        <Card className="relative overflow-hidden">
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
                        {task.judgeScore !== undefined && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${task.judgeScore >= 7 ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50'}`}>
                                <Star size={10} /> {task.judgeScore}/10
                            </span>
                        )}
                        {plannerCfg && (
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${plannerCfg.color} ${plannerCfg.bg}`} title={task.planReason}>
                                {plannerCfg.icon} {plannerCfg.label}
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
                            <a href={task.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline">
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

            <div className="flex items-center gap-2 mt-3 flex-wrap">
                {isAdmin && task.status === 'pending' && (
                    <Button variant="primary" size="sm" icon={<Play size={12} />} onClick={() => onAction('start', task)}>Iniciar</Button>
                )}
                {(task.status === 'reviewing' || task.status === 'approved') && (
                    <>
                        <Button variant="primary" size="sm" icon={<Eye size={12} />} onClick={() => onReview(task)}>Revisar</Button>
                        {task.branch && (
                            previewUrl ? (
                                <Button variant="ghost" size="sm" icon={<Monitor size={12} />} onClick={() => onStopPreview(task.issueNumber)} className="text-red-500">Parar Preview</Button>
                            ) : (
                                <Button variant="primary" size="sm" icon={<Monitor size={12} />} onClick={() => onPreview(task)} className="bg-teal-600 hover:bg-teal-700">Testar</Button>
                            )
                        )}
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
                {(task.status === 'failed' || task.status === 'rejected') && (
                    <>
                        <Button variant="ghost" size="sm" icon={<Eye size={12} />} onClick={() => onReview(task)} className="text-purple-500">Revisar</Button>
                        {task.branch && (
                            previewUrl ? (
                                <Button variant="ghost" size="sm" icon={<Monitor size={12} />} onClick={() => onStopPreview(task.issueNumber)} className="text-red-500">Parar</Button>
                            ) : (
                                <Button variant="ghost" size="sm" icon={<Monitor size={12} />} onClick={() => onPreview(task)} className="text-teal-600">Testar</Button>
                            )
                        )}
                        {isAdmin && <Button variant="primary" size="sm" icon={<RotateCcw size={12} />} onClick={() => onAction('redo', task)}>Tentar Novamente</Button>}
                    </>
                )}
                {task.status === 'merged' && (
                    <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={12} /> Concluído</span>
                )}
                <Button variant="ghost" size="sm" icon={<Eye size={12} />} onClick={() => setExpanded(!expanded)}>
                    {expanded ? 'Fechar' : 'Detalhes'}
                </Button>
                {isAdmin && <Button variant="ghost" size="sm" icon={<Pencil size={12} />} onClick={() => onEdit(task)}>Editar</Button>}
                {isActive && <Button variant="ghost" size="sm" icon={<Terminal size={12} />} onClick={() => onConsole(task)} className="text-indigo-500">Console</Button>}
                {!isActive && (task.events?.length || 0) > 0 && <Button variant="ghost" size="sm" icon={<Terminal size={12} />} onClick={() => onConsole(task)} className="text-slate-400">Histórico</Button>}
                {isAdmin && isActive && <Button variant="ghost" size="sm" icon={<XCircle size={12} />} onClick={() => onAction('kill', task)} className="text-amber-600">Cancelar</Button>}
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

const TasksBoard: React.FC = () => {
    const { currentUser } = useDolibarr();
    const isAdmin = currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true;
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'active' | 'done' | 'all'>('active');
    const [viewMode, setViewMode] = useState<'list' | 'pipeline'>('pipeline');
    const [search, setSearch] = useState('');
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
    const [autoPlay, setAutoPlay] = useState(false);
    const [consoleTask, setConsoleTask] = useState<Task | null>(null);
    const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});

    const load = useCallback(async () => {
        try {
            const data = await TaskService.list();
            setTasks(data);
            try {
                const cfg = await getUiConfig();
                setAutoPlay(cfg?.taskAutomation?.autoPlay === true);
            } catch {}
        } catch { toast.error('Erro ao carregar tasks'); }
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const interval = setInterval(load, 10000);
        return () => clearInterval(interval);
    }, [load]);

    const openReview = async (task: Task) => {
        setReviewTask(task);
        setDiffLoading(true);
        try { setDiffText(await TaskService.getDiff(task.issueNumber)); } catch { setDiffText(''); }
        setDiffLoading(false);
    };

    const handleAction = async (action: string, task: Task, extra?: string) => {
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
                case 'kill': await TaskService.kill(task.issueNumber); toast.info('Cancelando...'); break;
            }
            load();
        } catch (e: any) { toast.error(e.response?.data?.error || e.message); }
    };

    const handlePlan = async () => {
        setPlanning(true);
        try {
            const result = await TaskService.plan();
            toast.success(`Plano gerado! Ordem: ${result.order.map(n => `#${n}`).join(' → ')}`);
            load();
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        } finally {
            setPlanning(false);
        }
    };

    const openEdit = (task: Task) => { setEditTask(task); setEditTitle(task.title); setEditBody(task.body); };
    const saveEdit = async () => {
        if (!editTask) return;
        try { await TaskService.update(editTask.issueNumber, { title: editTitle, body: editBody }); toast.success('Atualizada'); setEditTask(null); load(); }
        catch (e: any) { toast.error(e.response?.data?.error || e.message); }
    };
    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        try { await TaskService.delete(deleteConfirm.issueNumber); toast.success('Deletada'); setDeleteConfirm(null); load(); }
        catch (e: any) { toast.error(e.response?.data?.error || e.message); }
    };

    const handlePreview = async (task: Task) => {
        try {
            const result = await TaskService.startPreview(task.issueNumber);
            setPreviewUrls(prev => ({ ...prev, [task.issueNumber]: result.frontendUrl }));
            toast.success(`Preview rodando em ${result.frontendUrl}`);
            window.open(result.frontendUrl, '_blank');
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        }
    };

    const handleStopPreview = async (issueNumber: number) => {
        try {
            await TaskService.stopPreview(issueNumber);
            setPreviewUrls(prev => { const next = { ...prev }; delete next[issueNumber]; return next; });
            toast.info('Preview parado');
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        }
    };

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
        if (tab === 'active') result = result.filter(t => !TERMINAL_STATUSES.includes(t.status));
        else if (tab === 'done') result = result.filter(t => TERMINAL_STATUSES.includes(t.status));
        if (statusFilter !== 'all') result = result.filter(t => t.status === statusFilter);
        if (search.trim()) {
            const q = search.toLowerCase().trim();
            result = result.filter(t => t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || String(t.issueNumber).includes(q));
        }
        return result;
    }, [tasks, tab, statusFilter, search]);

    const hasActive = tasks.some(t => ['running', 'fixing', 'cancelling'].includes(t.status));
    const statusCounts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const t of tasks) c[t.status] = (c[t.status] || 0) + 1;
        return c;
    }, [tasks]);

    const metrics = useMemo(() => {
        const completed = tasks.filter(t => t.status === 'merged' && t.startedAt && t.completedAt);
        const totalMs = completed.reduce((s, t) => s + (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()), 0);
        const avgMin = completed.length ? Math.round(totalMs / completed.length / 60000) : 0;
        const totalRan = tasks.filter(t => TERMINAL_STATUSES.includes(t.status)).length;
        const successRate = totalRan ? Math.round((completed.length / totalRan) * 100) : 0;
        return { total: tasks.length, avgMin, successRate, pending: tasks.filter(t => t.status === 'pending').length, active: tasks.filter(t => ['running', 'fixing'].includes(t.status)).length };
    }, [tasks]);

    if (loading) {
        return <PageLayout title="Tasks"><div className="flex items-center justify-center h-64"><Spinner /></div></PageLayout>;
    }

    return (
        <PageLayout title="Tasks">
            <PageHeader
                title="Tasks"
                subtitle="Issues → opencode automático"
                actions={
                    <div className="flex items-center gap-2">
                        {autoPlay && <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full" title="Auto-play ativo — tasks pendentes iniciam automaticamente"><Play size={10} /> Auto</span>}
                        {hasActive && <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full"><Loader2 size={12} className="animate-spin" /> Executando</span>}
                        {isAdmin && metrics.pending > 1 && (
                            <Button variant="ghost" size="sm" icon={<Sparkles size={14} />} onClick={handlePlan} disabled={planning} className="text-indigo-500">
                                {planning ? <><Loader2 size={14} className="animate-spin mr-1" /> Planejando...</> : 'Planejar com IA'}
                            </Button>
                        )}
                        {isAdmin && <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>Nova Task</Button>}
                        <div className="flex border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                            <button onClick={() => setViewMode('pipeline')} className={`px-2 py-1.5 ${viewMode === 'pipeline' ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`} title="Pipeline"><LayoutGrid size={14} /></button>
                            <button onClick={() => setViewMode('list')} className={`px-2 py-1.5 ${viewMode === 'list' ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`} title="Lista"><List size={14} /></button>
                        </div>
                        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={load}>Atualizar</Button>
                    </div>
                }
                tabs={
                    <Tabs value={tab} onChange={v => setTab(v as any)}>
                        <Tab value="active">Ativas ({tasks.filter(t => !TERMINAL_STATUSES.includes(t.status)).length})</Tab>
                        <Tab value="done">Concluídas ({tasks.filter(t => TERMINAL_STATUSES.includes(t.status)).length})</Tab>
                        <Tab value="all">Todas ({tasks.length})</Tab>
                    </Tabs>
                }
            />

            {!isAdmin && (
                <div className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
                    <ShieldOff size={14} />
                    <span>Modo somente leitura. Apenas administradores podem gerenciar tasks.</span>
                </div>
            )}

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
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

            <div className="mt-4 flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por título, descrição ou #issue..."
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

            {viewMode === 'pipeline' ? (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {PIPELINE_COLUMNS.map(col => {
                        const colStatuses = col.statuses as readonly string[];
                        const colTasks = filteredTasks.filter(t => colStatuses.includes(t.status));
                        return (
                            <div key={col.key} className="flex flex-col">
                                <div className="flex items-center gap-2 mb-2 px-1">
                                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">{col.label}</span>
                                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full">{colTasks.length}</span>
                                </div>
                                <div className="flex flex-col gap-2 min-h-[100px]">
                                    {colTasks.length === 0 && (
                                        <div className="text-[10px] text-slate-400 text-center py-4 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">Vazio</div>
                                    )}
                                    {colTasks.map(task => (
                                        <MiniCard
                                            key={task.issueNumber}
                                            task={task}
                                            onAction={handleAction}
                                            onReview={openReview}
                                            onEdit={openEdit}
                                            onDelete={setDeleteConfirm}
                                            onConsole={setConsoleTask}
                                            onPreview={handlePreview}
                                            onStopPreview={handleStopPreview}
                                            previewUrl={previewUrls[task.issueNumber]}
                                            isAdmin={isAdmin}
                                            queuePosition={getQueuePosition(task)}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="mt-4 space-y-3">
                    {filteredTasks.length === 0 && (
                        <Card>
                            <div className="text-center py-8 text-slate-400">
                                <p className="text-sm">Nenhuma task encontrada</p>
                                <p className="text-xs mt-1">
                                    {search || statusFilter !== 'all' ? 'Tente ajustar os filtros' : isAdmin ? <button onClick={() => setShowCreate(true)} className="text-indigo-500 hover:underline">Criar uma nova task</button> : 'Aguardando issues com label "opencode-task"'}
                                </p>
                            </div>
                        </Card>
                    )}
                    {filteredTasks.map(task => (
                        <TaskCard key={task.issueNumber} task={task} onAction={handleAction} onReview={openReview} onEdit={openEdit} onDelete={setDeleteConfirm} onConsole={setConsoleTask} onPreview={handlePreview} onStopPreview={handleStopPreview} previewUrl={previewUrls[task.issueNumber]} isAdmin={isAdmin} queuePosition={getQueuePosition(task)} />
                    ))}
                </div>
            )}

            {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} onCreated={load} />}

            {reviewTask && (
                <TaskReviewPanel
                    task={reviewTask}
                    isAdmin={isAdmin}
                    onClose={() => setReviewTask(null)}
                    onAction={handleAction}
                    onRefresh={load}
                    themeColor="indigo"
                />
            )}

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
                            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
                            <Button variant="primary" size="sm" onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Deletar</Button>
                        </div>
                    </div>
                </div>
            )}

            {consoleTask && <TaskConsole issueNumber={consoleTask.issueNumber} onClose={() => setConsoleTask(null)} />}
        </PageLayout>
    );
};

export default TasksBoard;
