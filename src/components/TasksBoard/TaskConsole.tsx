import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { X, Terminal, Loader2, Skull } from 'lucide-react';
import { Button } from '../ui';
import { TaskService } from '../../services/taskService';
import { useDolibarr } from '../../context/DolibarrContext';
import { toast } from 'sonner';

interface LogEntry {
    type: 'info' | 'success' | 'warn' | 'error' | 'ai';
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
};

const TYPE_PREFIX: Record<string, string> = {
    info: 'ℹ',
    success: '✓',
    warn: '⚠',
    error: '✗',
    ai: '🤖',
};

const TaskConsole: React.FC<TaskConsoleProps> = ({ issueNumber, onClose }) => {
    const { currentUser } = useDolibarr();
    const isAdmin = currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true;
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [status, setStatus] = useState<TaskStatus | null>(null);
    const [connected, setConnected] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [killing, setKilling] = useState(false);
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
                        : 'info';
                    entries.push({ type: uiType, message: e.message, timestamp: e.ts });
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

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
            <div className="bg-slate-950 rounded-2xl w-full max-w-2xl flex flex-col overflow-hidden shadow-2xl border border-slate-800" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
                    <div className="flex items-center gap-2">
                        <Terminal size={16} className="text-indigo-400" />
                        <span className="text-sm font-mono text-white">Task #{issueNumber}</span>
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

                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5 min-h-[200px]" style={{ maxHeight: '60vh' }}>
                    {logs.length === 0 && (
                        <p className="text-slate-500">Aguardando eventos da task #{issueNumber}...</p>
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
