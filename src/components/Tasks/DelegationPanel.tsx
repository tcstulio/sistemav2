import React, { useEffect, useState, useCallback } from 'react';
import { ClipboardCheck, Check, X, Loader2, Clock, Send } from 'lucide-react';
import { DolibarrConfig } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';
import { logger } from '../../utils/logger';
import { notifyError } from '../../utils/notifyError';

const log = logger.child('DelegationPanel');
const DAY_MS = 86400000;

interface Aceite {
    status: 'pending' | 'accepted' | 'declined';
    deadlineDay?: number;
    by?: string;
    at?: string;
    reason?: string;
}
interface DelegationRecord {
    taskId: string;
    objetivo?: string;
    criterio?: string;
    aceite?: Aceite;
}

interface Props {
    config: DolibarrConfig;
    taskId: string;
    task: any;                 // tarefa carregada (usada p/ resolver solicitante/responsável na notificação)
    currentUserId?: string;    // quem aceita/recusa
}

const fmtDay = (day?: number) => (day === undefined ? '' : new Date(day * DAY_MS).toLocaleDateString('pt-BR'));

/**
 * Painel do ciclo de vida da delegação (Fase 1.5): solicita aceite, e permite Aceitar/Recusar.
 * Recusa escala imediatamente ao solicitante (lado backend).
 */
export const DelegationPanel: React.FC<Props> = ({ config, taskId, task, currentUserId }) => {
    const [rec, setRec] = useState<DelegationRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showDecline, setShowDecline] = useState(false);
    const [reason, setReason] = useState('');

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const r = await DolibarrService.getDelegation(config, taskId);
            setRec(r || null);
        } catch (e) {
            log.warn('Falha ao carregar delegação', e);
            setRec(null);
        } finally {
            setLoading(false);
        }
    }, [config, taskId]);

    useEffect(() => { reload(); }, [reload]);

    const run = async (fn: () => Promise<any>) => {
        setSaving(true);
        try { await fn(); await reload(); }
        catch (e) { notifyError('Ação de delegação', e); }
        finally { setSaving(false); }
    };

    const requestAcceptance = () => run(() => DolibarrService.requestDelegationAcceptance(config, taskId, task, undefined, currentUserId));
    const accept = () => run(() => DolibarrService.acceptDelegation(config, taskId, currentUserId || ''));
    const decline = () => run(async () => {
        await DolibarrService.declineDelegation(config, taskId, currentUserId || '', reason, task);
        setShowDecline(false); setReason('');
    });

    const aceite = rec?.aceite;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <ClipboardCheck size={18} className="text-indigo-500" /> Delegação
                {(loading || saving) && <Loader2 size={16} className="animate-spin text-slate-400" />}
            </h2>

            {!aceite && (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm text-slate-500">Esta tarefa ainda não é uma delegação rastreada.</p>
                    <button
                        type="button" onClick={requestAcceptance} disabled={saving}
                        className="flex items-center gap-1 text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                        <Send size={14} /> Solicitar aceite
                    </button>
                </div>
            )}

            {aceite?.status === 'pending' && (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                        <Clock size={15} className="text-amber-500" />
                        <span className="font-medium text-amber-700 dark:text-amber-400">Aguardando aceite</span>
                        {aceite.deadlineDay !== undefined && <span className="text-slate-500">· prazo {fmtDay(aceite.deadlineDay)}</span>}
                    </div>
                    {!showDecline ? (
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={accept} disabled={saving || !currentUserId}
                                className="flex items-center gap-1 text-sm px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
                                <Check size={14} /> Aceitar
                            </button>
                            <button type="button" onClick={() => setShowDecline(true)} disabled={saving}
                                className="flex items-center gap-1 text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
                                <X size={14} /> Recusar
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <input
                                type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                                placeholder="Motivo da recusa (opcional)"
                                className="w-full text-sm p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            />
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={decline} disabled={saving || !currentUserId}
                                    className="text-sm px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50">
                                    Confirmar recusa
                                </button>
                                <button type="button" onClick={() => { setShowDecline(false); setReason(''); }}
                                    className="text-sm px-3 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                                    Cancelar
                                </button>
                            </div>
                            <p className="text-xs text-slate-400">Recusar escala a delegação ao solicitante.</p>
                        </div>
                    )}
                </div>
            )}

            {aceite?.status === 'accepted' && (
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                    <Check size={15} /> <span className="font-medium">Aceita</span>
                    {aceite.at && <span className="text-slate-500">· em {new Date(aceite.at).toLocaleDateString('pt-BR')}</span>}
                </div>
            )}

            {aceite?.status === 'declined' && (
                <div className="text-sm">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                        <X size={15} /> <span className="font-medium">Recusada</span>
                        <span className="text-slate-500">· escalada ao solicitante</span>
                    </div>
                    {aceite.reason && <p className="text-slate-500 mt-1">Motivo: {aceite.reason}</p>}
                </div>
            )}
        </div>
    );
};

export default DelegationPanel;
