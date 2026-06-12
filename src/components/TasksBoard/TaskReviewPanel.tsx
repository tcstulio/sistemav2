import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { X, FileText, Monitor, Terminal, Eye, Star, ExternalLink, GitMerge, MessageSquare, RotateCcw, XCircle, Play, Square, CheckCircle, Camera } from 'lucide-react';
import { Button } from '../ui';
import { TaskService, Task, TaskEvent } from '../../services/taskService';
import DiffViewer from './DiffViewer';
import { logger } from '../../utils/logger';
import { io, Socket } from 'socket.io-client';

const log = logger.child('TaskReviewPanel');

interface TaskReviewPanelProps {
    task: Task;
    isAdmin: boolean;
    onClose: () => void;
    onAction: (action: string, task: Task, extra?: string) => void;
    onRefresh: () => void;
    themeColor?: string;
}

type Tab = 'diff' | 'preview' | 'visual' | 'console';

interface LogEntry {
    type: 'info' | 'success' | 'warn' | 'error' | 'ai';
    message: string;
    timestamp: string;
}

export const TaskReviewPanel: React.FC<TaskReviewPanelProps> = ({
    task,
    isAdmin,
    onClose,
    onAction,
    onRefresh,
    themeColor = 'indigo',
}) => {
    const [tab, setTab] = useState<Tab>('diff');
    const [diff, setDiff] = useState('');
    const [diffLoading, setDiffLoading] = useState(true);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [feedback, setFeedback] = useState('');
    const [showFeedback, setShowFeedback] = useState(false);
    const [screenshots, setScreenshots] = useState<{ before: string | null; after: string | null }>({ before: null, after: null });
    const consoleRef = useRef<HTMLDivElement>(null);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        setDiffLoading(true);
        TaskService.getDiff(task.issueNumber)
            .then((d: string) => setDiff(d))
            .catch(() => setDiff(''))
            .finally(() => setDiffLoading(false));
    }, [task.issueNumber]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await TaskService.listEvents(task.issueNumber);
                if (cancelled) return;
                const entries: LogEntry[] = (res || []).map((e: TaskEvent) => ({
                    type: mapEventType(e.type),
                    message: e.message,
                    timestamp: e.ts,
                }));
                setLogs(entries);
            } catch { /* best effort */ }
        })();
        return () => { cancelled = true; };
    }, [task.issueNumber]);

    useEffect(() => {
        const cfg = JSON.parse(localStorage.getItem('coolgroove_config') || '{}');
        const token = cfg.apiKey || '';
        const s = io({ auth: { token }, transports: ['websocket'] });
        socketRef.current = s;
        s.on(`task:${task.issueNumber}:log`, (data: any) => {
            setLogs((prev) => [...prev, { type: data.type || 'info', message: data.message, timestamp: data.timestamp || new Date().toISOString() }]);
        });
        s.on(`task:${task.issueNumber}:status`, () => {
            onRefresh();
        });
        return () => { s.disconnect(); socketRef.current = null; };
    }, [task.issueNumber, onRefresh]);

    useEffect(() => {
        if (consoleRef.current) {
            consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        TaskService.getScreenshots(task.issueNumber)
            .then(setScreenshots)
            .catch(() => setScreenshots({ before: null, after: null }));
    }, [task.issueNumber]);

    const handleStartPreview = async () => {
        setPreviewLoading(true);
        try {
            const result = await TaskService.startPreview(task.issueNumber);
            setPreviewUrl(result.frontendUrl);
            toast.success(`Preview rodando em ${result.frontendUrl}`);
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleStopPreview = async () => {
        try {
            await TaskService.stopPreview(task.issueNumber);
            setPreviewUrl(null);
            toast.info('Preview parado');
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        }
    };

    const handleMerge = () => {
        onAction('merge', task);
        onClose();
    };

    const handleReject = () => {
        onAction('reject', task);
        onClose();
    };

    const handleFix = () => {
        if (!feedback.trim()) { toast.error('Descreva a correção.'); return; }
        onAction('fix', task, feedback);
        setShowFeedback(false);
        setFeedback('');
    };

    const handleRedo = () => {
        onAction('redo', task);
        onClose();
    };

    const isReviewable = task.status === 'reviewing' || task.status === 'approved';
    const scoreColor = !task.judgeScore ? 'slate' : task.judgeScore >= 8 ? 'emerald' : task.judgeScore >= 6 ? 'amber' : 'red';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800">
                {/* Header */}
                <div className="flex items-start justify-between p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-slate-400">#{task.issueNumber}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                task.status === 'approved' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                task.status === 'reviewing' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}>
                                {task.status === 'approved' ? 'Aprovado' : task.status === 'reviewing' ? 'Revisão' : task.status}
                            </span>
                            {task.prUrl && (
                                <a href={task.prUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline flex items-center gap-0.5">
                                    PR #{task.prNumber} <ExternalLink size={10} />
                                </a>
                            )}
                        </div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white truncate">{task.title}</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white shrink-0">
                        <X size={20} />
                    </button>
                </div>

                {/* Judge Score Bar */}
                {task.judgeScore != null && (
                    <div className={`px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-4 bg-${scoreColor}-50 dark:bg-${scoreColor}-900/10`}>
                        <div className="flex items-center gap-2">
                            <Star size={18} className={`text-${scoreColor}-500`} />
                            <span className={`text-2xl font-bold text-${scoreColor}-600 dark:text-${scoreColor}-400`}>{task.judgeScore}/10</span>
                        </div>
                        {task.judgeReview && (
                            <p className="text-sm text-slate-600 dark:text-slate-300 flex-1 min-w-0 truncate">{task.judgeReview}</p>
                        )}
                        {task.judgeAttempts != null && task.judgeAttempts > 1 && (
                            <span className="text-xs text-slate-400">{task.judgeAttempts} tentativas</span>
                        )}
                    </div>
                )}

                {task.visualScore != null && (
                    <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-4 bg-purple-50 dark:bg-purple-900/10">
                        <div className="flex items-center gap-2">
                            <Camera size={16} className="text-purple-500" />
                            <span className={`text-lg font-bold ${task.visualScore >= 8 ? 'text-purple-600 dark:text-purple-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                Visual: {task.visualScore}/10
                            </span>
                        </div>
                        {task.visualReview && (
                            <p className="text-xs text-slate-600 dark:text-slate-300 flex-1 min-w-0 truncate">{task.visualReview}</p>
                        )}
                    </div>
                )}

                {/* Tabs */}
                <div className="flex border-b border-slate-200 dark:border-slate-700 shrink-0">
                    <TabBtn active={tab === 'diff'} onClick={() => setTab('diff')} icon={<FileText size={14} />} label="Diff" />
                    <TabBtn active={tab === 'visual'} onClick={() => setTab('visual')} icon={<Camera size={14} />} label="Visual" badge={screenshots.after ? '✓' : undefined} />
                    <TabBtn active={tab === 'preview'} onClick={() => setTab('preview')} icon={<Monitor size={14} />} label="Preview" />
                    <TabBtn active={tab === 'console'} onClick={() => setTab('console')} icon={<Terminal size={14} />} label="Console" badge={logs.length > 0 ? String(logs.length) : undefined} />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden">
                    {tab === 'diff' && (
                        diffLoading ? (
                            <div className="flex items-center justify-center h-full text-sm text-slate-400">
                                <RotateCcw size={16} className="animate-spin mr-2" /> Carregando diff...
                            </div>
                        ) : (
                            <div className="h-full overflow-y-auto">
                                {diff && diff !== 'Sem PR/branch ainda.' && diff !== 'Unable to fetch diff' ? (
                                    <DiffViewer
                                        diff={diff}
                                        judgeScore={task.judgeScore}
                                        judgeReview={task.judgeReview}
                                        prUrl={task.prUrl}
                                        onClose={() => {}}
                                        onMerge={handleMerge}
                                        onFix={() => setShowFeedback(true)}
                                        onReject={handleReject}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                                        <FileText size={48} className="mb-3 opacity-30" />
                                        <p className="text-sm">{diff || 'Nenhum diff disponível'}</p>
                                    </div>
                                )}
                            </div>
                        )
                    )}

                    {tab === 'preview' && (
                        <div className="h-full flex flex-col">
                            <div className="p-3 flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
                                {previewUrl ? (
                                    <>
                                        <span className="text-xs text-emerald-600 flex items-center gap-1">
                                            <CheckCircle size={12} /> Rodando em <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">{previewUrl}</code>
                                        </span>
                                        <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline flex items-center gap-0.5">
                                            Abrir <ExternalLink size={10} />
                                        </a>
                                        <Button variant="ghost" size="sm" icon={<Square size={12} />} onClick={handleStopPreview} className="text-red-500 ml-auto">Parar</Button>
                                    </>
                                ) : (
                                    <Button variant="primary" size="sm" icon={<Play size={12} />} onClick={handleStartPreview} loading={previewLoading} className="bg-teal-600 hover:bg-teal-700">
                                        Iniciar Preview
                                    </Button>
                                )}
                            </div>
                            {previewUrl ? (
                                <iframe
                                    src={previewUrl}
                                    className="flex-1 w-full border-0"
                                    title={`Preview #${task.issueNumber}`}
                                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                                />
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                                    <Monitor size={48} className="mb-3 opacity-30" />
                                    <p className="text-sm">Clique "Iniciar Preview" para ver o app rodando</p>
                                    <p className="text-xs mt-1 text-slate-400">Sobe Vite + Backend na branch da task</p>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'visual' && (
                        <div className="h-full overflow-y-auto p-4">
                            {screenshots.before && screenshots.after ? (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Antes (main)</h4>
                                            <img
                                                src={screenshots.before}
                                                alt="Before"
                                                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm"
                                            />
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Depois (branch)</h4>
                                            <img
                                                src={screenshots.after}
                                                alt="After"
                                                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm"
                                            />
                                        </div>
                                    </div>
                                    {task.visualReview && (
                                        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Camera size={14} className="text-purple-500" />
                                                <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                                    Judge Visual: {task.visualScore}/10
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{task.visualReview}</p>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                                    <Camera size={48} className="mb-3 opacity-30" />
                                    <p className="text-sm">Nenhum screenshot disponível</p>
                                    <p className="text-xs mt-1 text-slate-400">Screenshots são gerados automaticamente quando o Judge Visual detecta mudanças no frontend</p>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'console' && (
                        <div ref={consoleRef} className="h-full overflow-y-auto bg-slate-950 p-4 font-mono text-xs space-y-1">
                            {logs.length === 0 ? (
                                <div className="text-slate-500 text-center py-8">Nenhum log ainda</div>
                            ) : (
                                logs.map((entry, i) => (
                                    <div key={i} className={`flex gap-2 ${
                                        entry.type === 'error' || entry.type === 'warn' ? 'text-red-400' :
                                        entry.type === 'success' ? 'text-emerald-400' :
                                        entry.type === 'ai' ? 'text-indigo-400' :
                                        'text-slate-400'
                                    }`}>
                                        <span className="text-slate-600 shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                                        <span>{entry.message}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                {isAdmin && isReviewable && tab !== 'diff' && (
                    <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0 bg-slate-50 dark:bg-slate-900/50">
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" icon={<MessageSquare size={14} />} onClick={() => setShowFeedback(!showFeedback)}>
                                Corrigir
                            </Button>
                            <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={handleRedo}>
                                Refazer
                            </Button>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" icon={<XCircle size={14} />} onClick={handleReject} className="text-red-500">
                                Rejeitar
                            </Button>
                            <Button variant="primary" size="sm" icon={<GitMerge size={14} />} onClick={handleMerge} className={`bg-emerald-600 hover:bg-emerald-700`}>
                                Merge
                            </Button>
                        </div>
                    </div>
                )}

                {/* Feedback input */}
                {showFeedback && (
                    <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0 bg-slate-50 dark:bg-slate-900/50">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                placeholder="Descreva o que deve ser corrigido..."
                                className="flex-1 text-sm p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                onKeyDown={(e) => { if (e.key === 'Enter') handleFix(); }}
                            />
                            <Button variant="primary" size="sm" onClick={handleFix}>Enviar</Button>
                            <Button variant="ghost" size="sm" onClick={() => { setShowFeedback(false); setFeedback(''); }}>Cancelar</Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: string }> = ({ active, onClick, icon, label, badge }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            active
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
    >
        {icon} {label}
        {badge && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{badge}</span>}
    </button>
);

function mapEventType(type: string): 'info' | 'success' | 'warn' | 'error' | 'ai' {
    if (type.includes('fail') || type.includes('error')) return 'error';
    if (type.includes('kill') || type.includes('reject')) return 'warn';
    if (type.includes('ok') || type.includes('complet') || type.includes('created') || type.includes('pushed') || type.includes('merged')) return 'success';
    if (type.includes('judge') || type.includes('planner') || type.includes('ai')) return 'ai';
    return 'info';
}

export default TaskReviewPanel;
