import React, { useEffect, useState } from 'react';
import { Bot, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { Modal } from '../ui/Modal';

const log = logger.child('AgentActivityFeed');
const API = config.API_BASE_URL;

interface Activity {
    id: string;
    tool: string;
    action: string;
    entityType?: string;
    entityId?: string;
    description: string;
    result: 'success' | 'error';
    userName: string;
    durationMs: number;
    createdAt: number;
}

/** Normaliza nome de autor: vazio, 'unknown' e IDs numéricos crus → fallback seguro. */
function displayName(name?: string, fallback = 'Agente'): string {
    if (!name || name === 'unknown' || /^\d+$/.test(name)) return fallback;
    return name;
}

/** Formata createdAt (ms) como "dd/MM HH:mm" para exibição no feed. */
function formatFeedDate(ms: number): string {
    const d = new Date(ms);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month} ${hour}:${min}`;
}

/** Formata createdAt (ms) como "dd/MM/yyyy HH:mm:ss" para o detalhe do modal. */
function formatDetailDate(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const ActivityDetailModal: React.FC<{ activity: Activity | null; onClose: () => void }> = ({ activity, onClose }) => {
    if (!activity) return null;
    const rows: Array<{ label: string; value: React.ReactNode }> = [
        { label: 'Descrição', value: activity.description || '—' },
        { label: 'Ação', value: activity.action || '—' },
        {
            label: 'Alvo',
            value: activity.entityType && activity.entityType !== 'unknown'
                ? `${activity.entityType}${activity.entityId ? ` #${activity.entityId}` : ''}`
                : '—',
        },
        {
            label: 'Resultado',
            value: (
                <span className={`inline-flex items-center gap-1 font-medium ${activity.result === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                    {activity.result === 'success' ? <CheckCircle size={13} /> : <XCircle size={13} />}
                    {activity.result === 'success' ? 'Sucesso' : 'Erro'}
                </span>
            ),
        },
        { label: 'Autor', value: displayName(activity.userName) },
        { label: 'Data/Hora', value: formatDetailDate(activity.createdAt) },
        { label: 'Duração', value: activity.durationMs > 0 ? `${(activity.durationMs / 1000).toFixed(2)}s` : '—' },
    ];

    return (
        <Modal isOpen onClose={onClose} title="Detalhe da Atividade" size="md">
            <dl className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map(row => (
                    <div key={row.label} className="flex gap-3 py-2.5">
                        <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">{row.label}</dt>
                        <dd className="flex-1 text-sm text-slate-800 dark:text-slate-200 break-words">{row.value}</dd>
                    </div>
                ))}
            </dl>
        </Modal>
    );
};

export const AgentActivityFeed: React.FC = () => {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Activity | null>(null);

    useEffect(() => {
        const fetchActivities = async () => {
            try {
                const res = await fetch(`${API}/api/ai/agent/activity?limit=10`);
                if (res.ok) {
                    const data = await res.json();
                    setActivities(data.activities || []);
                }
            } catch (e) {
                log.error('Failed to fetch agent activity', e);
            } finally {
                setLoading(false);
            }
        };

        fetchActivities();
        const interval = setInterval(fetchActivities, 60000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Bot size={16} className="text-purple-500" />
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Atividade do Marciano</h3>
                </div>
                <div className="flex items-center justify-center py-4">
                    <Loader2 size={20} className="animate-spin text-slate-400" />
                </div>
            </div>
        );
    }

    if (activities.length === 0) return null;

    return (
        <>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Bot size={16} className="text-purple-500" />
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Atividade do Marciano</h3>
                    <span className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 px-1.5 py-0.5 rounded-full">
                        {activities.length}
                    </span>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    {activities.map(a => (
                        <button
                            key={a.id}
                            role="button"
                            onClick={() => setSelected(a)}
                            className="w-full text-left flex items-start gap-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/40 rounded-lg px-1 py-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
                        >
                            <div className="mt-0.5 shrink-0">
                                {a.result === 'success' ? (
                                    <CheckCircle size={12} className="text-green-500" />
                                ) : (
                                    <XCircle size={12} className="text-red-500" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-slate-700 dark:text-slate-300 line-clamp-2">{a.description}</p>
                                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                    <Clock size={8} />
                                    {/* Show date + time so items from different days are distinguishable (#542) */}
                                    <span>{formatFeedDate(a.createdAt)}</span>
                                    <span>por {displayName(a.userName)}</span>
                                    {a.durationMs > 0 && <span>{(a.durationMs / 1000).toFixed(1)}s</span>}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            <ActivityDetailModal activity={selected} onClose={() => setSelected(null)} />
        </>
    );
};
