import React, { useEffect, useState, useCallback } from 'react';
import { History, Loader2, RefreshCw } from 'lucide-react';
import { DolibarrConfig } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';
import { logger } from '../../utils/logger';

const log = logger.child('DelegationTimelinePanel');

interface TimelineEvent {
    type: string;
    at: string;     // ISO
    by?: string;    // userId de quem agiu
    to?: string;    // userId do destinatário (para quem)
    note?: string;
}

interface SimpleUser { id: string; firstname?: string; lastname?: string; login?: string; }

interface Props {
    config: DolibarrConfig;
    taskId: string;
    users?: SimpleUser[];
}

const LABELS: Record<string, string> = {
    requested: 'Aceite solicitado',
    accepted: 'Aceita',
    declined: 'Recusada',
    doc_updated: 'Documentação atualizada',
    template_set: 'Template definido',
    cobranca: 'Cobrança enviada',
    escalated: 'Escalada ao solicitante',
    completed: 'Concluída / reportada',
    reminder: 'Lembrete de prazo',
};

const fmt = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/**
 * Linha do tempo da delegação (Fase 1.6): mostra cada etapa, quando e por quem.
 * Lê o log de eventos (fonte única); os mesmos eventos são espelhados como actioncomm no Dolibarr.
 */
export const DelegationTimelinePanel: React.FC<Props> = ({ config, taskId, users = [] }) => {
    const [events, setEvents] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const userName = (by?: string) => {
        if (!by) return 'Sistema';
        const u = users.find((x) => String(x.id) === String(by));
        return u ? `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login || `ID ${by}` : `ID ${by}`;
    };

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const r = await DolibarrService.getDelegationEvents(config, taskId);
            setEvents(Array.isArray(r) ? r : []);
        } catch (e) {
            log.warn('Falha ao carregar a linha do tempo', e);
            setEvents([]);
        } finally {
            setLoading(false);
        }
    }, [config, taskId]);

    useEffect(() => { reload(); }, [reload]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <History size={18} className="text-indigo-500" /> Histórico
                    {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
                </h2>
                <button type="button" onClick={reload} aria-label="Atualizar histórico"
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    <RefreshCw size={15} />
                </button>
            </div>

            {events.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Sem eventos ainda.</p>
            ) : (
                <ol className="relative border-l border-slate-200 dark:border-slate-700 ml-2 space-y-4">
                    {events.map((e, i) => (
                        <li key={i} className="ml-4">
                            <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white dark:border-slate-900" />
                            <p className="text-sm font-medium text-slate-900 dark:text-white">{LABELS[e.type] || e.type}</p>
                            <p className="text-xs text-slate-500">{fmt(e.at)} · {userName(e.by)}{e.to ? ` → ${userName(e.to)}` : ''}</p>
                            {e.note && <p className="text-xs text-slate-400 mt-0.5">{e.note}</p>}
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
};

export default DelegationTimelinePanel;
