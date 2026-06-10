import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Edit, Save, Loader2, X } from 'lucide-react';
import { DolibarrConfig } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';
import { logger } from '../../utils/logger';
import { notifyError } from '../../utils/notifyError';

const log = logger.child('DelegationDocPanel');

interface Props {
    config: DolibarrConfig;
    taskId: string;
}

/**
 * Documentação oficial da delegação (Fase 1.5): objetivo + critério de pronto.
 * Visível a todos que veem a tarefa; um artefato = clareza + checklist + critério + auditoria.
 */
export const DelegationDocPanel: React.FC<Props> = ({ config, taskId }) => {
    const [objetivo, setObjetivo] = useState('');
    const [criterio, setCriterio] = useState('');
    const [editing, setEditing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const r = await DolibarrService.getDelegation(config, taskId);
            setObjetivo(r?.objetivo || '');
            setCriterio(r?.criterio || '');
        } catch (e) {
            log.warn('Falha ao carregar documentação', e);
        } finally {
            setLoading(false);
        }
    }, [config, taskId]);

    useEffect(() => { reload(); }, [reload]);

    const save = async () => {
        setSaving(true);
        try {
            await DolibarrService.setDelegationDoc(config, taskId, { objetivo, criterio });
            setEditing(false);
            await reload();
        } catch (e) {
            notifyError('Salvar documentação', e);
        } finally {
            setSaving(false);
        }
    };

    const empty = !objetivo && !criterio;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <FileText size={18} className="text-indigo-500" /> Documentação oficial
                    {(loading || saving) && <Loader2 size={16} className="animate-spin text-slate-400" />}
                </h2>
                {!editing ? (
                    <button type="button" onClick={() => setEditing(true)}
                        className="flex items-center gap-1 text-sm px-2.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                        <Edit size={14} /> Editar
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={save} disabled={saving}
                            className="flex items-center gap-1 text-sm px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
                            <Save size={14} /> Salvar
                        </button>
                        <button type="button" onClick={() => { setEditing(false); reload(); }}
                            className="flex items-center gap-1 text-sm px-2.5 py-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                            <X size={14} /> Cancelar
                        </button>
                    </div>
                )}
            </div>

            {editing ? (
                <div className="space-y-3">
                    <div>
                        <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Objetivo</label>
                        <textarea value={objetivo} onChange={(e) => setObjetivo(e.target.value)}
                            placeholder="O que é esperado desta delegação?"
                            className="w-full text-sm p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-20" />
                    </div>
                    <div>
                        <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Critério de pronto</label>
                        <textarea value={criterio} onChange={(e) => setCriterio(e.target.value)}
                            placeholder="Como sabemos que terminou?"
                            className="w-full text-sm p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-20" />
                    </div>
                </div>
            ) : empty ? (
                <p className="text-sm text-slate-400 italic">Sem documentação. Clique em Editar para definir o objetivo e o critério de pronto.</p>
            ) : (
                <div className="space-y-3 text-sm">
                    {objetivo && (
                        <div>
                            <p className="text-xs uppercase font-bold text-slate-500 mb-1">Objetivo</p>
                            <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{objetivo}</p>
                        </div>
                    )}
                    {criterio && (
                        <div>
                            <p className="text-xs uppercase font-bold text-slate-500 mb-1">Critério de pronto</p>
                            <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{criterio}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DelegationDocPanel;
