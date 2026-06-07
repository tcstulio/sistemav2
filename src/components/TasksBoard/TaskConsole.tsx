import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { X, Terminal, Loader2 } from 'lucide-react';
import { Button } from '../ui';

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
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [status, setStatus] = useState<TaskStatus | null>(null);
    const [connected, setConnected] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const socketRef = useRef<Socket | null>(null);

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
            setLogs(prev => [...prev, entry]);
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

    const isActive = status?.status === 'running' || status?.status === 'fixing';

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
            <div className="bg-slate-950 rounded-2xl w-full max-w-2xl flex flex-col overflow-hidden shadow-2xl border border-slate-800" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
                    <div className="flex items-center gap-2">
                        <Terminal size={16} className="text-indigo-400" />
                        <span className="text-sm font-mono text-white">Task #{issueNumber}</span>
                        {isActive && <Loader2 size={14} className="animate-spin text-blue-400" />}
                        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} title={connected ? 'Conectado' : 'Desconectado'} />
                    </div>
                    <Button variant="ghost" size="sm" onClick={onClose}><X size={14} /></Button>
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
                        <div key={i} className={`${TYPE_COLORS[log.type] || 'text-slate-300'} flex gap-2`}>
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
