import React, { useState, useEffect, useCallback } from 'react';
import { GithubService, GitHubIssue, IssueStats } from '../../services/githubService';
import { TaskService, Task } from '../../services/taskService';
import { PageLayout, PageHeader, Card, Button, Spinner, Tabs, Tab } from '../ui';
import { AlertCircle, Bug, Sparkles, Shield, Wrench, TestTube, GitMerge, Loader2, Eye, CheckCircle, XCircle, RotateCcw, MessageSquare, Trash2, Pencil, Terminal, ExternalLink, Search, Tag } from 'lucide-react';
import { toast } from 'sonner';
import DiffViewer from '../TasksBoard/DiffViewer';
import TaskConsole from '../TasksBoard/TaskConsole';

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
    pending: { color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', icon: <AlertCircle size={14} />, label: 'Pendente' },
    running: { color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Executando' },
    fixing: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Corrigindo' },
    reviewing: { color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', icon: <Eye size={14} />, label: 'Em Revisão' },
    approved: { color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', icon: <CheckCircle size={14} />, label: 'Aprovado' },
    merged: { color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: <GitMerge size={14} />, label: 'Merged' },
    rejected: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: <XCircle size={14} />, label: 'Rejeitado' },
    failed: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: <AlertCircle size={14} />, label: 'Falhou' },
};

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

const IssuesPage: React.FC = () => {
    const [tab, setTab] = useState<'issues' | 'tasks' | 'stats'>('issues');
    const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'closed'>('all');
    const [labelFilter, setLabelFilter] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [issues, setIssues] = useState<GitHubIssue[]>([]);
    const [stats, setStats] = useState<IssueStats | null>(null);
    const [issuesLoading, setIssuesLoading] = useState(true);

    const [tasks, setTasks] = useState<Task[]>([]);
    const [tasksLoading, setTasksLoading] = useState(true);
    const [taskTab, setTaskTab] = useState<'active' | 'done' | 'all'>('active');

    const [reviewTask, setReviewTask] = useState<Task | null>(null);
    const [diffText, setDiffText] = useState('');
    const [diffLoading, setDiffLoading] = useState(false);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editBody, setEditBody] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<Task | null>(null);
    const [consoleTask, setConsoleTask] = useState<Task | null>(null);
    const [labelingIssue, setLabelingIssue] = useState<number | null>(null);

    const loadIssues = useCallback(async () => {
        setIssuesLoading(true);
        const [i, s] = await Promise.all([
            GithubService.getIssues({ state: issueFilter, label: labelFilter || undefined, limit: 50 }),
            GithubService.getStats(),
        ]);
        setIssues(i);
        if (s) setStats(s);
        setIssuesLoading(false);
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

    const filteredTasks = tasks.filter(t => {
        if (taskTab === 'active') return !['merged', 'rejected'].includes(t.status);
        if (taskTab === 'done') return ['merged', 'rejected'].includes(t.status);
        return true;
    });

    const hasActiveTask = tasks.some(t => ['running', 'fixing'].includes(t.status));

    const openReview = async (task: Task) => {
        setReviewTask(task); setDiffLoading(true);
        try { setDiffText(await TaskService.getDiff(task.issueNumber)); } catch { setDiffText(''); }
        setDiffLoading(false);
    };

    const handleTaskAction = async (action: string, task: Task) => {
        try {
            switch (action) {
                case 'start': await TaskService.start(task.issueNumber); toast.info(`Iniciando #${task.issueNumber}...`); break;
                case 'merge': await TaskService.merge(task.issueNumber); toast.success('PR merged!'); break;
                case 'reject': await TaskService.reject(task.issueNumber); toast.info('Rejeitada'); break;
                case 'redo': await TaskService.redo(task.issueNumber); toast.info('Refazendo...'); break;
                case 'kill': await TaskService.kill(task.issueNumber); toast.info('Cancelando...'); break;
            }
            loadTasks();
        } catch (e: any) { toast.error(e.response?.data?.error || e.message); }
    };

    const saveEdit = async () => {
        if (!editTask) return;
        try { await TaskService.update(editTask.issueNumber, { title: editTitle, body: editBody }); toast.success('Atualizada'); setEditTask(null); loadTasks(); }
        catch (e: any) { toast.error(e.response?.data?.error || e.message); }
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        try { await TaskService.delete(deleteConfirm.issueNumber); toast.success('Deletada'); setDeleteConfirm(null); loadTasks(); }
        catch (e: any) { toast.error(e.response?.data?.error || e.message); }
    };

    // #315: "Virar Task" — adiciona a label opencode-task à issue (não dispara execução; o admin inicia).
    const virarTask = async (e: React.MouseEvent, issue: GitHubIssue) => {
        e.preventDefault(); e.stopPropagation();
        setLabelingIssue(issue.number);
        const r = await GithubService.addLabel(issue.number, 'opencode-task');
        if (r.ok) { toast.success(`#${issue.number} virou task (opencode-task)`); await loadIssues(); }
        else toast.error(r.error || 'Falha ao virar task');
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
                        <Tab value="tasks">Tasks ({tasks.filter(t => !['merged','rejected'].includes(t.status)).length})</Tab>
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
                                        <p className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate">
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
                    <div className="flex items-center gap-2">
                        {hasActiveTask && <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full"><Loader2 size={12} className="animate-spin" /> Executando</span>}
                        <div className="flex gap-1 text-xs">
                            <button onClick={() => setTaskTab('active')} className={`px-3 py-1.5 rounded-full ${taskTab === 'active' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                Ativas ({tasks.filter(t => !['merged','rejected'].includes(t.status)).length})
                            </button>
                            <button onClick={() => setTaskTab('done')} className={`px-3 py-1.5 rounded-full ${taskTab === 'done' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                Concluídas ({tasks.filter(t => ['merged','rejected'].includes(t.status)).length})
                            </button>
                        </div>
                    </div>

                    {tasksLoading ? <div className="flex justify-center py-12"><Spinner /></div> : (
                        <div className="space-y-3">
                            {filteredTasks.length === 0 && (
                                <Card><div className="text-center py-8 text-slate-400 text-sm">Nenhuma task. Crie issues com label "opencode-task" no GitHub.</div></Card>
                            )}
                            {filteredTasks.map(task => <TaskCard key={task.issueNumber} task={task} onAction={handleTaskAction} onReview={openReview} onEdit={t => { setEditTask(t); setEditTitle(t.title); setEditBody(t.body); }} onDelete={setDeleteConfirm} onConsole={setConsoleTask} />)}
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
                                                <span className="truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{i.title}</span>
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
            {reviewTask && (diffLoading ? (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 flex flex-col items-center gap-3"><Loader2 size={24} className="animate-spin text-indigo-500" /><p className="text-sm text-slate-500">Carregando diff...</p></div>
                </div>
            ) : (
                <DiffViewer diff={diffText} judgeScore={reviewTask.judgeScore} judgeReview={reviewTask.judgeReview} prUrl={reviewTask.prUrl} onClose={() => setReviewTask(null)}
                    onMerge={async () => { await TaskService.merge(reviewTask.issueNumber); setReviewTask(null); toast.success('Merged!'); loadTasks(); }}
                    onFix={() => setReviewTask(null)}
                    onReject={async () => { await TaskService.reject(reviewTask.issueNumber); setReviewTask(null); toast.info('Rejeitada'); loadTasks(); }}
                />
            ))}

            {editTask && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditTask(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Editar Task #{editTask.issueNumber}</h2>
                        <div><label className="text-xs font-medium text-slate-500">Título</label><input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" /></div>
                        <div><label className="text-xs font-medium text-slate-500">Descrição</label><textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={6} className="w-full mt-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 resize-none" /></div>
                        <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditTask(null)}>Cancelar</Button><Button variant="primary" size="sm" onClick={saveEdit}>Salvar</Button></div>
                    </div>
                </div>
            )}

            {deleteConfirm && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Deletar #{deleteConfirm.issueNumber}?</h2>
                        <p className="text-sm text-slate-500">O issue no GitHub será mantido.</p>
                        <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>Cancelar</Button><Button variant="primary" size="sm" onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Deletar</Button></div>
                    </div>
                </div>
            )}

            {consoleTask && <TaskConsole issueNumber={consoleTask.issueNumber} onClose={() => setConsoleTask(null)} />}
        </PageLayout>
    );
};

const TaskCard: React.FC<{ task: Task; onAction: (a: string, t: Task) => void; onReview: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void; onConsole: (t: Task) => void }> = ({ task, onAction, onReview, onEdit, onDelete, onConsole }) => {
    const [expanded, setExpanded] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedback, setFeedback] = useState('');
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
    const isActive = ['running', 'fixing'].includes(task.status);

    return (
        <Card className="relative overflow-hidden">
            {isActive && <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 animate-pulse" />}
            <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-mono text-slate-400">#{task.issueNumber}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color} ${cfg.bg}`}>{cfg.icon} {cfg.label}</span>
                        {task.judgeScore !== undefined && <span className={`px-2 py-0.5 rounded-full text-[10px] ${task.judgeScore >= 7 ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50'}`}>{task.judgeScore}/10</span>}
                    </div>
                    <h3 className="font-semibold text-sm text-slate-800 dark:text-white truncate">{task.title}</h3>
                    {task.prUrl && <a href={task.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline mt-1">PR #{task.prNumber} <ExternalLink size={8} /></a>}
                </div>
            </div>
            {task.error && <div className="mt-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-xs text-red-600">{task.error}</div>}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
                {task.status === 'pending' && <Button variant="primary" size="sm" icon={<Eye size={12} />} onClick={() => onAction('start', task)}>Iniciar</Button>}
                {(task.status === 'reviewing' || task.status === 'approved') && (
                    <>
                        <Button variant="primary" size="sm" icon={<Eye size={12} />} onClick={() => onReview(task)}>Revisar</Button>
                        <Button variant="primary" size="sm" icon={<CheckCircle size={12} />} onClick={() => onAction('merge', task)}>Merge</Button>
                        <Button variant="ghost" size="sm" icon={<MessageSquare size={12} />} onClick={() => setShowFeedback(!showFeedback)}>Corrigir</Button>
                        <Button variant="ghost" size="sm" icon={<RotateCcw size={12} />} onClick={() => onAction('redo', task)}>Refazer</Button>
                    </>
                )}
                {task.status === 'failed' && <Button variant="primary" size="sm" icon={<RotateCcw size={12} />} onClick={() => onAction('redo', task)}>Tentar Novamente</Button>}
                {isActive && <Button variant="ghost" size="sm" icon={<Terminal size={12} />} onClick={() => onConsole(task)} className="text-indigo-500">Console</Button>}
                {isActive && <Button variant="ghost" size="sm" icon={<XCircle size={12} />} onClick={() => onAction('kill', task)} className="text-amber-600 hover:text-amber-700">Cancelar</Button>}
                <Button variant="ghost" size="sm" icon={<Eye size={12} />} onClick={() => setExpanded(!expanded)}>{expanded ? 'Fechar' : 'Detalhes'}</Button>
                <Button variant="ghost" size="sm" icon={<Pencil size={12} />} onClick={() => onEdit(task)}>Editar</Button>
                <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => onDelete(task)} className="text-red-500 hover:text-red-700" title="Deletar (mata o processo se estiver rodando)" />
            </div>
            {showFeedback && (
                <div className="mt-3 flex gap-2">
                    <input type="text" value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Instrução..." className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        onKeyDown={e => { if (e.key === 'Enter' && feedback.trim()) { onAction('redo', task); setFeedback(''); setShowFeedback(false); } }} />
                    <Button variant="primary" size="sm" onClick={() => { onAction('redo', task); setFeedback(''); setShowFeedback(false); }} disabled={!feedback.trim()}>Enviar</Button>
                </div>
            )}
            {expanded && (
                <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-2">
                    <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-32 overflow-auto">{task.body || 'Sem descrição'}</p>
                    {task.feedbackHistory.length > 0 && (
                        <div><h4 className="text-[10px] uppercase font-bold text-slate-400 mb-1">Feedback</h4>
                            <ul className="space-y-1">{task.feedbackHistory.map((fb, i) => <li key={i} className="text-xs text-amber-600 dark:text-amber-400">• {fb}</li>)}</ul>
                        </div>
                    )}
                    <div className="text-[10px] text-slate-400">Atualizado: {new Date(task.updatedAt).toLocaleString('pt-BR')}</div>
                </div>
            )}
        </Card>
    );
};

export default IssuesPage;
