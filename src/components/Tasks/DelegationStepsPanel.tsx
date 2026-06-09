import React, { useState } from 'react';
import { ListChecks, Plus, Check, Loader2 } from 'lucide-react';
import { DolibarrConfig } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';
import { logger } from '../../utils/logger';
import { childrenOf, aggregateProgress } from './taskProgress';

const log = logger.child('DelegationStepsPanel');

interface Props {
    config: DolibarrConfig;
    taskId: string;
    projectId: string;
    tasks: any[];            // todas as tarefas sincronizadas (useTasks)
    onChanged?: () => void;  // refetch das tarefas após criar/concluir
}

/**
 * Passos da delegação como sub-tarefas (fk_task_parent) + barra de progresso agregada (Fase 1.5).
 */
export const DelegationStepsPanel: React.FC<Props> = ({ config, taskId, projectId, tasks, onChanged }) => {
    const [newLabel, setNewLabel] = useState('');
    const [saving, setSaving] = useState(false);

    const steps = childrenOf(tasks, taskId);
    const agg = aggregateProgress(steps);

    const run = async (fn: () => Promise<any>) => {
        setSaving(true);
        try { await fn(); onChanged?.(); }
        catch (e) { log.warn('Ação de passo falhou', e); }
        finally { setSaving(false); }
    };

    const addStep = () => {
        if (!newLabel.trim()) return;
        run(async () => {
            await DolibarrService.createTask(config, { label: newLabel.trim(), project_id: projectId, fk_task_parent: taskId });
            setNewLabel('');
        });
    };

    const completeStep = (childId: string) =>
        run(() => DolibarrService.updateTask(config, childId, { progress: 100 }));

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <ListChecks size={18} className="text-indigo-500" /> Passos da delegação
                {saving && <Loader2 size={16} className="animate-spin text-slate-400" />}
            </h2>

            {/* Barra de progresso agregada */}
            {agg !== null && (
                <div className="mb-4">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Progresso</span>
                        <span className="font-medium">{agg}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${agg}%` }} />
                    </div>
                </div>
            )}

            {/* Lista de passos */}
            {steps.length === 0 ? (
                <p className="text-sm text-slate-400 italic mb-3">Nenhum passo ainda. Decomponha a delegação abaixo.</p>
            ) : (
                <ul className="space-y-2 mb-3">
                    {steps.map((s) => {
                        const done = Number(s.progress) >= 100;
                        return (
                            <li key={s.id} className="flex items-center gap-3 p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                                <span className={`flex-1 text-sm ${done ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>{s.label}</span>
                                <span className="text-xs text-slate-500">{Number(s.progress) || 0}%</span>
                                {!done && (
                                    <button type="button" onClick={() => completeStep(s.id)} disabled={saving}
                                        aria-label={`Concluir ${s.label}`}
                                        className="flex items-center gap-1 text-xs px-2 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50">
                                        <Check size={12} /> Concluir
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* Adicionar passo */}
            <div className="flex items-center gap-2">
                <input
                    type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addStep(); }}
                    placeholder="Novo passo…"
                    className="flex-1 text-sm p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                />
                <button type="button" onClick={addStep} disabled={saving || !newLabel.trim()}
                    className="flex items-center gap-1 text-sm px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
                    <Plus size={14} /> Adicionar
                </button>
            </div>
        </div>
    );
};

export default DelegationStepsPanel;
