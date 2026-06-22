import React, { useEffect, useState } from 'react';
import { Bot, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { config } from '../../config';
import { logger } from '../../utils/logger';

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

export const AgentActivityFeed: React.FC = () => {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);

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
                    <div key={a.id} className="flex items-start gap-2 text-xs">
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
                                <span>{new Date(a.createdAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                <span>por {displayName(a.userName)}</span>
                                {a.durationMs > 0 && <span>{(a.durationMs / 1000).toFixed(1)}s</span>}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
