import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Play, GitMerge, ShieldCheck, Save } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { getUiConfig, updateUiConfig, TaskAutomationConfig } from '../../services/uiConfigService';
import { logger } from '../../utils/logger';

const log = logger.child('TaskAutomationEditor');

export interface TaskAutomationEditorProps {
    isAdmin: boolean;
    themeColor?: string;
}

export const TaskAutomationEditor: React.FC<TaskAutomationEditorProps> = ({ isAdmin, themeColor = 'indigo' }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<TaskAutomationConfig>({ autoPlay: false, autoMerge: false, minMergeScore: 8 });

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const cfg = await getUiConfig();
                if (cancelled) return;
                if (cfg?.taskAutomation) setConfig(cfg.taskAutomation);
            } catch (e) {
                log.error('Falha ao carregar config de automacao', e);
                toast.error('Falha ao carregar automacoes.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const updated = await updateUiConfig({ taskAutomation: config } as any);
            setConfig(updated.taskAutomation || config);
            toast.success('Automacoes salvas.');
        } catch (e: any) {
            toast.error(`Falha ao salvar: ${e?.response?.data?.error || e?.message || 'erro'}`);
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) return null;

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><Play size={16} /> Automacoes do TaskRunner (Admin)</h3>}>
            <p className="text-sm text-slate-500 mb-4">
                Configure o ciclo autonomo: issues viram tasks, o agente executa, e o merge acontece automaticamente se os gates passarem.
            </p>

            {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
                <>
                    <div className="space-y-4">
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <Play size={18} className={config.autoPlay ? 'text-emerald-500' : 'text-slate-400'} />
                                    Auto-play
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {config.autoPlay
                                        ? 'Ativo — tasks pendentes iniciam automaticamente em sequencia.'
                                        : 'Desativado — admin precisa clicar "Iniciar" em cada task.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input type="checkbox" checked={config.autoPlay} onChange={(e) => setConfig({ ...config, autoPlay: e.target.checked })} className="sr-only peer" />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <GitMerge size={18} className={config.autoMerge ? 'text-emerald-500' : 'text-slate-400'} />
                                    Auto-merge
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {config.autoMerge
                                        ? `Ativo — score Judge ≥ ${config.minMergeScore} + typecheck + rebase = merge automatico.`
                                        : 'Desativado — admin precisa clicar "Merge" manualmente.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input type="checkbox" checked={config.autoMerge} onChange={(e) => setConfig({ ...config, autoMerge: e.target.checked })} className="sr-only peer" />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>

                        {config.autoMerge && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                                    <ShieldCheck size={16} /> Score minimo para auto-merge
                                </div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min={1}
                                        max={10}
                                        value={config.minMergeScore}
                                        onChange={(e) => setConfig({ ...config, minMergeScore: Number(e.target.value) })}
                                        className="flex-1"
                                    />
                                    <span className={`text-lg font-bold min-w-[3ch] text-center ${
                                        config.minMergeScore >= 8 ? 'text-emerald-500' : config.minMergeScore >= 6 ? 'text-amber-500' : 'text-red-500'
                                    }`}>
                                        {config.minMergeScore}
                                    </span>
                                    <span className="text-xs text-slate-400">/10</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end mt-4">
                        <Button type="button" variant="primary" loading={saving} icon={<Save size={16} />} onClick={handleSave}>
                            Salvar automacoes
                        </Button>
                    </div>
                </>
            )}
        </Card>
    );
};

export default TaskAutomationEditor;
