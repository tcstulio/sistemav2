// #1179: Modal de histórico (timeline) de uma task do TaskRunner, extraído de IssuesPage.tsx
// para permitir teste ISOLADO (critério de aceite #4: "componente do modal com fetch mockado").
//
// A listagem (GET /api/tasks) vem ENXUTA (sem o array `events`); a timeline completa é buscada
// ON-DEMAND ao abrir o modal via TaskService.listEvents (→ GET /api/tasks/:issueNumber/events).
// Enquanto carrega, mostramos o spinner e — se houver — o `eventsCount` que veio da listagem.
import React, { useEffect, useState } from 'react';
import { Clock, Loader2, XCircle } from 'lucide-react';
import { Task, TaskEvent, TaskService } from '../../services/taskService';
import { STATUS_CONFIG, formatOutcomeTime } from './taskStatusUi';

/** Modal com histórico completo de eventos de uma task do TaskRunner. */
const TaskHistoryModal: React.FC<{
    task: Task;
    onClose: () => void;
}> = ({ task, onClose }) => {
    const [events, setEvents] = useState<TaskEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                // #1179: a listagem (GET /api/tasks) vem SEM o array `events` (payload enxuto).
                // A timeline completa é buscada ON-DEMAND ao abrir o modal — evita os ~47MB de
                // events embutidos no board a cada polling.
                const evts = await TaskService.listEvents(task.issueNumber);
                if (!cancelled) { setEvents(evts); setLoading(false); }
            } catch {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [task]);

    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
    const outcomeTime = formatOutcomeTime(task.status, task);
    // #1179: enquanto carrega, exibimos o `eventsCount` que veio da listagem enxuta; depois do
    // fetch, a contagem real da timeline on-demand. Um único ternário legível.
    const eventCount = loading ? (task.eventsCount ?? 0) : events.length;

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
                        {/* #1179: eventsCount vem da listagem enxuta (timeline é buscada on-demand). */}
                        {eventCount > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 normal-case font-medium">
                                {eventCount}
                            </span>
                        )}
                    </h4>
                    {loading ? (
                        <div data-testid="history-loading" className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-indigo-500" /></div>
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

export default TaskHistoryModal;
