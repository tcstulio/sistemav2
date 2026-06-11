import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TaskService, Task } from '../../services/taskService';
import { PageLayout, PageHeader, Card, Button, Spinner, Tabs, Tab } from '../ui';
import { Play, CheckCircle, XCircle, RotateCcw, GitMerge, MessageSquare, Loader2, AlertCircle, Clock, Eye, RefreshCw, ExternalLink, ThumbsUp, Star, Trash2, Pencil, Terminal, ShieldOff, Plus, Search, Filter } from 'lucide-react';
import { toast } from 'sonner';
import DiffViewer from './DiffViewer';
import TaskConsole from './TaskConsole';
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

const TaskCard: React.FC<{
    task: Task;
    onAction: (action: string, task: Task, extra?: string) => void;
    onReview: (task: Task) => void;
    onEdit: (task: Task) => void;
    onDelete: (task: Task) => void;
    onConsole: (task: Task) => void;
    isAdmin: boolean;
}> = ({ task, onAction, onReview, onEdit, onDelete, onConsole, isAdmin }) => {
    const [expanded, setExpanded] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [showFeedback, setShowFeedback] = useState(false);
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
    const isActive = ['running', 'fixing', 'cancelling'].includes(task.status);

    const handleFeedbackKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && feedback.trim()) {
            onAction('fix', task, feedback.trim());
            setFeedback('');
            setShowFeedback(false);
        }
    };

    const handleFeedbackSend = () => {
        if (feedback.trim()) {
            onAction('fix', task, feedback.trim());
            setFeedback('');
            setShowFeedback(false);
        }
    };

    return (
        <Card className="relative overflow-hidden">
            {isActive && <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 animate-pulse" />}

            <div className="flex items-start justify-between gap-3">
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
                        {task.labels.filter(l => l !== 'opencode-task').map(l => (
                            <span key={l} className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{l}</span>
                        ))}
                    </div>
                    <h3 className="font-semibold text-sm text-slate-800 dark:text-white truncate">{task.title}</h3>
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
                {isAdmin && (
                    <Button variant="ghost" size="sm" icon={<Pencil size={12} />} onClick={() => onEdit(task)}>Editar</Button>
                )}
                {isActive && (
                    <Button variant="ghost" size="sm" icon={<Terminal size={12} />} onClick={() => onConsole(task)} className="text-indigo-500 hover:text-indigo-700">Console</Button>
                )}
                {isAdmin && isActive && (
                    <Button variant="ghost" size="sm" icon={<XCircle size={12} />} onClick={() => onAction('kill', task)} className="text-amber-600 hover:text-amber-700">Cancelar</Button>
                )}
                {isAdmin && (
                    <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => onDelete(task)} className="text-red-500 hover:text-red-700" title="Deletar (mata o processo se estiver rodando)" />
                )}
            </div>

            {isAdmin && showFeedback && (
                <div className="mt-3 flex gap-2">
                    <input
                        type="text"
                        value={feedback}
                        onChange={e => setFeedback(e.target.value)}
                        placeholder="Instrução adicional..."
                        className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                        onKeyDown={handleFeedbackKey}
                    />
                    <Button variant="primary" size="sm" onClick={handleFeedbackSend} disabled={!feedback.trim()}>
                        Enviar
                    </Button>
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
                                {task.feedbackHistory.map((fb, i) => (
                                    <li key={i} className="text-xs text-amber-600 dark:text-amber-400">• {fb}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <div className="text-[10px] text-slate-400">
                        Atualizado: {new Date(task.updatedAt).toLocaleString('pt-BR')}
                    </div>
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
        if (!title.trim()) {
            toast.error('Título é obrigatório');
            return;
        }
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
                    <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="feat: descrição curta da task"
                        className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter' && title.trim()) handleSubmit(); }}
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Descrição</label>
                    <textarea
                        value={body}
                        onChange={e => setBody(e.target.value)}
                        placeholder="Descreva o que deve ser implementado, contexto, arquivos a modificar..."
                        rows={6}
                        className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Labels extras (separadas por vírgula)</label>
                    <input
                        type="text"
                        value={labels}
                        onChange={e => setLabels(e.target.value)}
                        placeholder="enhancement, bug, frontend"
                        className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
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

const TasksBoard: React.FC = () => {
    const { currentUser } = useDolibarr();
    const isAdmin = currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true;
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'active' | 'done' | 'all'>('active');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [showCreate, setShowCreate] = useState(false);

    const [reviewTask, setReviewTask] = useState<Task | null>(null);
    const [diffText, setDiffText] = useState('');
    const [diffLoading, setDiffLoading] = useState(false);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editBody, setEditBody] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<Task | null>(null);
    const [consoleTask, setConsoleTask] = useState<Task | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await TaskService.list();
            setTasks(data);
        } catch {
            toast.error('Erro ao carregar tasks');
        }
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
        try {
            const diff = await TaskService.getDiff(task.issueNumber);
            setDiffText(diff);
        } catch {
            setDiffText('');
        }
        setDiffLoading(false);
    };

    const handleAction = async (action: string, task: Task, extra?: string) => {
        if (!isAdmin) {
            toast.error('Apenas administradores podem executar ações em tasks.');
            return;
        }
        try {
            switch (action) {
                case 'start':
                    toast.info(`Iniciando task #${task.issueNumber}...`);
                    await TaskService.start(task.issueNumber);
                    break;
                case 'merge':
                    await TaskService.merge(task.issueNumber);
                    toast.success('PR merged!');
                    break;
                case 'reject':
                    await TaskService.reject(task.issueNumber);
                    toast.info('Task rejeitada');
                    break;
                case 'redo':
                    await TaskService.redo(task.issueNumber);
                    toast.info('Refazendo task...');
                    break;
                case 'fix':
                    if (!extra) {
                        toast.error('Informe a instrução de correção.');
                        return;
                    }
                    toast.info('Enviando correção...');
                    await TaskService.fix(task.issueNumber, extra);
                    break;
                case 'kill':
                    await TaskService.kill(task.issueNumber);
                    toast.info('Cancelando task...');
                    break;
            }
            load();
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        }
    };

    const openEdit = (task: Task) => {
        setEditTask(task);
        setEditTitle(task.title);
        setEditBody(task.body);
    };

    const saveEdit = async () => {
        if (!editTask) return;
        try {
            await TaskService.update(editTask.issueNumber, { title: editTitle, body: editBody });
            toast.success('Task atualizada');
            setEditTask(null);
            load();
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        }
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        try {
            await TaskService.delete(deleteConfirm.issueNumber);
            toast.success('Task deletada');
            setDeleteConfirm(null);
            load();
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        }
    };

    const filteredTasks = useMemo(() => {
        let result = tasks;

        if (tab === 'active') result = result.filter(t => !TERMINAL_STATUSES.includes(t.status));
        else if (tab === 'done') result = result.filter(t => TERMINAL_STATUSES.includes(t.status));

        if (statusFilter !== 'all') {
            result = result.filter(t => t.status === statusFilter);
        }

        if (search.trim()) {
            const q = search.toLowerCase().trim();
            result = result.filter(t =>
                t.title.toLowerCase().includes(q) ||
                t.body.toLowerCase().includes(q) ||
                String(t.issueNumber).includes(q)
            );
        }

        return result;
    }, [tasks, tab, statusFilter, search]);

    const hasActive = tasks.some(t => ['running', 'fixing', 'cancelling'].includes(t.status));

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const t of tasks) {
            counts[t.status] = (counts[t.status] || 0) + 1;
        }
        return counts;
    }, [tasks]);

    if (loading) {
        return (
            <PageLayout title="Tasks">
                <div className="flex items-center justify-center h-64"><Spinner /></div>
            </PageLayout>
        );
    }

    return (
        <PageLayout title="Tasks">
            <PageHeader
                title="Tasks"
                subtitle="Issues → opencode automático"
                actions={
                    <div className="flex items-center gap-2">
                        {hasActive && <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full"><Loader2 size={12} className="animate-spin" /> Executando</span>}
                        {isAdmin && (
                            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>Nova Task</Button>
                        )}
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
                    <span>Modo somente leitura. Apenas administradores podem iniciar, corrigir, mesclar ou deletar tasks.</span>
                </div>
            )}

            <div className="mt-4 flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por título, descrição ou #issue..."
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                </div>
                <div className="flex items-center gap-1.5">
                    <Filter size={14} className="text-slate-400" />
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                        <option value="all">Todos os status</option>
                        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                            <option key={key} value={key}>
                                {cfg.label} ({statusCounts[key] || 0})
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="mt-4 space-y-3">
                {filteredTasks.length === 0 && (
                    <Card>
                        <div className="text-center py-8 text-slate-400">
                            <p className="text-sm">Nenhuma task encontrada</p>
                            {search || statusFilter !== 'all' ? (
                                <p className="text-xs mt-1">Tente ajustar os filtros ou a busca</p>
                            ) : (
                                <p className="text-xs mt-1">
                                    {isAdmin ? (
                                        <button onClick={() => setShowCreate(true)} className="text-indigo-500 hover:underline">Criar uma nova task</button>
                                    ) : (
                                        'Aguardando issues com label "opencode-task"'
                                    )}
                                </p>
                            )}
                        </div>
                    </Card>
                )}
                {filteredTasks.map(task => (
                    <TaskCard
                        key={task.issueNumber}
                        task={task}
                        onAction={handleAction}
                        onReview={openReview}
                        onEdit={openEdit}
                        onDelete={setDeleteConfirm}
                        onConsole={setConsoleTask}
                        isAdmin={isAdmin}
                    />
                ))}
            </div>

            {showCreate && (
                <CreateTaskModal
                    onClose={() => setShowCreate(false)}
                    onCreated={load}
                />
            )}

            {reviewTask && (
                diffLoading ? (
                    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 flex flex-col items-center gap-3">
                            <Loader2 size={24} className="animate-spin text-indigo-500" />
                            <p className="text-sm text-slate-500">Carregando diff...</p>
                        </div>
                    </div>
                ) : (
                    <DiffViewer
                        diff={diffText}
                        judgeScore={reviewTask.judgeScore}
                        judgeReview={reviewTask.judgeReview}
                        prUrl={reviewTask.prUrl}
                        onClose={() => setReviewTask(null)}
                        onMerge={async () => { if (!isAdmin) { toast.error('Apenas administradores.'); return; } await TaskService.merge(reviewTask.issueNumber); setReviewTask(null); toast.success('PR merged!'); load(); }}
                        onFix={() => setReviewTask(null)}
                        onReject={async () => { if (!isAdmin) { toast.error('Apenas administradores.'); return; } await TaskService.reject(reviewTask.issueNumber); setReviewTask(null); toast.info('Task rejeitada'); load(); }}
                    />
                )
            )}

            {editTask && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditTask(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Editar Task #{editTask.issueNumber}</h2>
                        <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Título</label>
                            <input
                                type="text"
                                value={editTitle}
                                onChange={e => setEditTitle(e.target.value)}
                                className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Descrição</label>
                            <textarea
                                value={editBody}
                                onChange={e => setEditBody(e.target.value)}
                                rows={8}
                                className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                            />
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
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            A task sai do board e o label <span className="font-mono text-xs">opencode-task</span> é removido da issue.
                            A issue em si é mantida no GitHub.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
                            <Button variant="primary" size="sm" onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Deletar</Button>
                        </div>
                    </div>
                </div>
            )}

            {consoleTask && (
                <TaskConsole issueNumber={consoleTask.issueNumber} onClose={() => setConsoleTask(null)} />
            )}
        </PageLayout>
    );
};

export default TasksBoard;
