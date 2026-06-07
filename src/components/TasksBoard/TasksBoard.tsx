import React, { useState, useEffect, useCallback } from 'react';
import { TaskService, Task } from '../../services/taskService';
import { PageLayout, PageHeader, Card, Button, Spinner, Tabs, Tab } from '../ui';
import { Play, CheckCircle, XCircle, RotateCcw, GitMerge, MessageSquare, Loader2, AlertCircle, Clock, Eye, RefreshCw, ExternalLink, ThumbsUp, Star } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
    pending: { color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', icon: <Clock size={14} />, label: 'Pendente' },
    running: { color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Executando' },
    fixing: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Corrigindo' },
    reviewing: { color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', icon: <Eye size={14} />, label: 'Em Revisão' },
    approved: { color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', icon: <ThumbsUp size={14} />, label: 'Aprovado' },
    merged: { color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: <GitMerge size={14} />, label: 'Merged' },
    rejected: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: <XCircle size={14} />, label: 'Rejeitado' },
    failed: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: <AlertCircle size={14} />, label: 'Falhou' },
};

const TaskCard: React.FC<{ task: Task; onAction: (action: string, task: Task) => void; polling: boolean }> = ({ task, onAction, polling }) => {
    const [expanded, setExpanded] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [showFeedback, setShowFeedback] = useState(false);
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
    const isActive = ['running', 'fixing'].includes(task.status);

    return (
        <Card className="relative overflow-hidden">
            {isActive && <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 animate-pulse" />}

            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-slate-400">#{task.issueNumber}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color} ${cfg.bg}`}>
                            {cfg.icon} {cfg.label}
                        </span>
                        {task.judgeScore !== undefined && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${task.judgeScore >= 7 ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50'}`}>
                                <Star size={10} /> {task.judgeScore}/10
                            </span>
                        )}
                    </div>
                    <h3 className="font-semibold text-sm text-slate-800 dark:text-white truncate">{task.title}</h3>
                    {task.branch && <p className="text-[10px] font-mono text-slate-400 mt-1">branch: {task.branch}</p>}
                    {task.prUrl && (
                        <a href={task.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline mt-1">
                            PR #{task.prNumber} <ExternalLink size={8} />
                        </a>
                    )}
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
                {task.status === 'pending' && (
                    <Button variant="primary" size="sm" icon={<Play size={12} />} onClick={() => onAction('start', task)}>Iniciar</Button>
                )}
                {(task.status === 'reviewing' || task.status === 'approved') && (
                    <>
                        <Button variant="primary" size="sm" icon={<CheckCircle size={12} />} onClick={() => onAction('merge', task)}>Merge</Button>
                        <Button variant="ghost" size="sm" icon={<MessageSquare size={12} />} onClick={() => setShowFeedback(!showFeedback)}>Corrigir</Button>
                        <Button variant="ghost" size="sm" icon={<RotateCcw size={12} />} onClick={() => onAction('redo', task)}>Refazer</Button>
                        <Button variant="ghost" size="sm" icon={<XCircle size={12} />} onClick={() => onAction('reject', task)}>Rejeitar</Button>
                    </>
                )}
                {task.status === 'failed' && (
                    <Button variant="primary" size="sm" icon={<RotateCcw size={12} />} onClick={() => onAction('redo', task)}>Tentar Novamente</Button>
                )}
                {task.status === 'merged' && (
                    <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={12} /> Concluído</span>
                )}
                <Button variant="ghost" size="sm" icon={<Eye size={12} />} onClick={() => setExpanded(!expanded)}>
                    {expanded ? 'Fechar' : 'Detalhes'}
                </Button>
            </div>

            {showFeedback && (
                <div className="mt-3 flex gap-2">
                    <input
                        type="text"
                        value={feedback}
                        onChange={e => setFeedback(e.target.value)}
                        placeholder="Instrução adicional..."
                        className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                        onKeyDown={e => {
                            if (e.key === 'Enter' && feedback.trim()) {
                                onAction('fix', task);
                                setFeedback('');
                                setShowFeedback(false);
                            }
                        }}
                    />
                    <Button variant="primary" size="sm" onClick={() => { onAction('fix', task); setFeedback(''); setShowFeedback(false); }} disabled={!feedback.trim()}>
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

const TasksBoard: React.FC = () => {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'active' | 'done' | 'all'>('active');

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

    const handleAction = async (action: string, task: Task) => {
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
                    toast.info('Enviando correção...');
                    break;
            }
            load();
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        }
    };

    const filteredTasks = tasks.filter(t => {
        if (tab === 'active') return !['merged', 'rejected'].includes(t.status);
        if (tab === 'done') return ['merged', 'rejected'].includes(t.status);
        return true;
    });

    const hasActive = tasks.some(t => ['running', 'fixing'].includes(t.status));

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
                        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={load}>Atualizar</Button>
                    </div>
                }
                tabs={
                    <Tabs value={tab} onChange={v => setTab(v as any)}>
                        <Tab value="active">Ativas ({tasks.filter(t => !['merged', 'rejected'].includes(t.status)).length})</Tab>
                        <Tab value="done">Concluídas ({tasks.filter(t => ['merged', 'rejected'].includes(t.status)).length})</Tab>
                        <Tab value="all">Todas ({tasks.length})</Tab>
                    </Tabs>
                }
            />

            <div className="mt-6 space-y-4">
                {filteredTasks.length === 0 && (
                    <Card>
                        <div className="text-center py-8 text-slate-400">
                            <p className="text-sm">Nenhuma task encontrada</p>
                            <p className="text-xs mt-1">Crie issues com label "opencode-task" no GitHub</p>
                        </div>
                    </Card>
                )}
                {filteredTasks.map(task => (
                    <TaskCard key={task.issueNumber} task={task} onAction={handleAction} polling={hasActive} />
                ))}
            </div>
        </PageLayout>
    );
};

export default TasksBoard;
