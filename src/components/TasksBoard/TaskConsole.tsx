import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { X, Terminal, Loader2, Skull, Cpu, Coins, Clock, Zap } from 'lucide-react';
import { Button } from '../ui';
import { TaskService, TaskMetrics } from '../../services/taskService';
import { useDolibarr } from '../../context/DolibarrContext';
import { toast } from 'sonner';

interface LogEntry {
    type: 'info' | 'success' | 'warn' | 'error' | 'ai' | 'output';
    message: string;
    timestamp: string;
}

interface TaskStatus {
    status: string;
    judgeScore?: number;
    judgeReview?: string;
    prNumber?: number;
    prUrl?: string;
    error?: string;
    updatedAt: string;
}

interface TaskEvent {
    ts: string;
    type: string;
    message: string;
    meta?: Record<string, any>;
}

interface TaskConsoleProps {
    issueNumber: number;
    onClose: () => void;
}

const TYPE_COLORS: Record<string, string> = {
    info: 'text-slate-300',
    success: 'text-green-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
    ai: 'text-indigo-300',
    output: 'text-cyan-300',
};

const TYPE_PREFIX: Record<string, string> = {
    info: 'ℹ',
    success: '✓',
    warn: '⚠',
    error: '✗',
    ai: '🤖',
    output: '📋',
};

const TaskConsole: React.FC<TaskConsoleProps> = ({ issueNumber, onClose }) => {
    const { currentUser } = useDolibarr();
    const isAdmin = currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true;
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [status, setStatus] = useState<TaskStatus | null>(null);
    const [connected, setConnected] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [killing, setKilling] = useState(false);
    const [metrics, setMetrics] = useState<TaskMetrics | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const socketRef = useRef<Socket | null>(null);

    const handleKill = async () => {
        if (!isAdmin) { toast.error('Apenas administradores podem matar tasks.'); return; }
        if (!confirm(`Matar a task #${issueNumber}? O processo do opencode e seus filhos serao encerrados (SIGKILL). Esta acao nao pode ser desfeita.`)) return;
        setKilling(true);
        try {
            await TaskService.kill(issueNumber, 'user kill from TaskConsole');
            toast.success('Task cancelada. O processo foi encerrado.');
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        } finally {
            setKilling(false);
        }
    };

    // Carrega historico persistido (#306) antes de abrir socket.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const eventList = await TaskService.listEvents(issueNumber);
                if (cancelled) return;
                const seen = new Set<string>();
                const entries: LogEntry[] = [];
                for (const e of eventList as TaskEvent[]) {
                    const key = `${e.ts}|${e.message}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const t = e.type;
                    const uiType =
                        t === 'task_failed' || t === 'error' || t === 'judge_error' ||
                        t === 'pr_creation_failed' || t === 'typecheck_failed' ||
                        t === 'attempt_no_changes' || t === 'task_killed' ||
                        t === 'task_watchdog_timeout' ? 'warn'
                        : t === 'typecheck_ok' || t === 'pr_created' || t === 'pr_merged' || t === 'task_completed' ? 'success'
                        : t === 'judge_score' || t === 'judge_started' ? 'ai'
                        : t === 'opencode_output' ? 'output'
                        : 'info';
                    const msg = t === 'opencode_output' && e.meta?.output
                        ? `📋 Output do opencode:\n${String(e.meta.output).substring(0, 3000)}`
                        : e.message;
                    entries.push({ type: uiType, message: msg, timestamp: e.ts });
                }
                setLogs(entries);
            } catch {
                // silencioso: se falhar, vai pegar tudo do socket ao vivo
            } finally {
                if (!cancelled) setHistoryLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [issueNumber]);

    // Métricas (#305): carrega após historyLoaded. Recarrega periodicamente se task ainda
    // rodando (Judge pode estar em andamento). Para tasks finalizadas, fixa após 1 fetch.
    useEffect(() => {
        let cancelled = false;
        const fetchMetrics = async () => {
            try {
                const m = await TaskService.getMetrics(issueNumber);
                if (!cancelled) setMetrics(m);
            } catch { /* silencioso: 404 etc */ }
        };
        fetchMetrics();
        const isActive = status?.status === 'running' || status?.status === 'fixing' || status?.status === 'cancelling' || status?.status === 'reviewing';
        if (isActive) {
            const t = setInterval(fetchMetrics, 10000);
            return () => { cancelled = true; clearInterval(t); };
        }
        return () => { cancelled = true; };
    }, [issueNumber, status?.status]);

    useEffect(() => {
        const token = (() => {
            try {
                const saved = localStorage.getItem('coolgroove_config');
                if (saved) return JSON.parse(saved).apiKey || '';
            } catch { /* ignore */ }
            return '';
        })();

        const socket = io({
            auth: { token },
            transports: ['websocket', 'polling'],
        });

        socketRef.current = socket;

        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));

        socket.on(`task:${issueNumber}:log`, (entry: LogEntry) => {
            setLogs(prev => {
                // Dedup: evento persistido pode ser re-emitido pelo socket
                const dup = prev.some(p => p.timestamp === entry.timestamp && p.message === entry.message);
                return dup ? prev : [...prev, entry];
            });
        });

        socket.on(`task:${issueNumber}:status`, (s: TaskStatus) => {
            setStatus(s);
        });

        return () => {
            socket.disconnect();
        };
    }, [issueNumber]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    const isActive = status?.status === 'running' || status?.status === 'fixing' || status?.status === 'cancelling';

    const formatDuration = (ms: number): string => {
        if (!ms || ms < 0) return '–';
        const s = Math.floor(ms / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        const rs = s % 60;
        if (m < 60) return `${m}m${rs}s`;
        const h = Math.floor(m / 60);
        const rm = m % 60;
        return `${h}h${rm}m`;
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
            <div className="bg-slate-950 rounded-2xl w-full max-w-2xl flex flex-col overflow-hidden shadow-2xl border border-slate-800" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
                    <div className="flex items-center gap-2">
                        <Terminal size={16} className="text-indigo-400" />
                        <span className="text-sm font-mono text-white">{isActive ? 'Console' : 'Histórico'} — Task #{issueNumber}</span>
                        {isActive && <Loader2 size={14} className="animate-spin text-blue-400" />}
                        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} title={connected ? 'Conectado' : 'Desconectado'} />
                        {historyLoaded && <span className="text-[10px] text-slate-500">histórico carregado</span>}
                    </div>
                    <div className="flex items-center gap-1">
                        {isAdmin && isActive && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleKill}
                                disabled={killing}
                                className="text-red-400 hover:text-red-300 hover:bg-red-950/30"
                                title="Matar o processo do opencode (SIGKILL no Unix, taskkill /F /T no Windows)"
                            >
                                <Skull size={14} className="mr-1" /> {killing ? 'Matando...' : 'Matar task'}
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={onClose}><X size={14} /></Button>
                    </div>
                </div>

                {status && (
                    <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800 flex items-center gap-3 text-xs flex-wrap">
                        <span className="text-slate-400">Status: <span className="text-white font-medium">{status.status}</span></span>
                        {status.judgeScore !== undefined && (
                            <span className={`font-medium ${status.judgeScore >= 7 ? 'text-green-400' : 'text-amber-400'}`}>
                                Judge: {status.judgeScore}/10
                            </span>
                        )}
                        {status.prUrl && (
                            <a href={status.prUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
                                PR #{status.prNumber}
                            </a>
                        )}
                    </div>
                )}

                {metrics?.metricsAvailable && (
                    <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-800 flex items-center gap-4 text-[11px] flex-wrap font-mono">
                        <span className="flex items-center gap-1 text-slate-300" title="Wall-clock total (startedAt → completedAt)">
                            <Clock size={12} className="text-cyan-400" />
                            {formatDuration(metrics.wallTimeMs || 0)}
                        </span>
                        {metrics.opencode && (
                            <span className="flex items-center gap-1 text-slate-300" title={`CPU avg/max · RSS avg/max (${metrics.opencode.samples} amostras a cada 2s)`}>
                                <Cpu size={12} className="text-amber-400" />
                                CPU {metrics.opencode.cpuPercentAvg}/{metrics.opencode.cpuPercentMax}% · RAM {metrics.opencode.rssMbAvg}/{metrics.opencode.rssMbMax} MB
                            </span>
                        )}
                        {metrics.judge && (
                            <>
                                <span className="flex items-center gap-1 text-slate-300" title={`${metrics.judge.attempts} chamada(s) do Judge`}>
                                    <Zap size={12} className="text-indigo-400" />
                                    {metrics.judge.totalTokens.toLocaleString('pt-BR')} tokens
                                </span>
                                <span className="flex items-center gap-1 text-slate-300" title={`Custo estimado: ${metrics.judge.models.join(', ') || 'modelo desconhecido'}`}>
                                    <Coins size={12} className="text-yellow-400" />
                                    ${metrics.judge.costUsd.toFixed(4)}
                                </span>
                            </>
                        )}
                    </div>
                )}

                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5 min-h-[200px]" style={{ maxHeight: '60vh' }}>
                    {logs.length === 0 && (
                        <p className="text-slate-500">{isActive ? `Aguardando eventos da task #${issueNumber}...` : `Nenhum evento registrado para a task #${issueNumber}.`}</p>
                    )}
                    {logs.map((log, i) => (
                        <div key={`${log.timestamp}-${i}`} className={`${TYPE_COLORS[log.type] || 'text-slate-300'} flex gap-2`}>
                            <span className="text-slate-600 shrink-0">{new Date(log.timestamp).toLocaleTimeString('pt-BR')}</span>
                            <span className="shrink-0">{TYPE_PREFIX[log.type] || '•'}</span>
                            <span className="whitespace-pre-wrap break-all">{log.message}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default TaskConsole;
