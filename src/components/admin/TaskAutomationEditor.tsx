import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Play, GitMerge, ShieldCheck, Save, Boxes, RefreshCw } from 'lucide-react';
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
    const [config, setConfig] = useState<TaskAutomationConfig>({ autoPlay: false, autoMerge: false, autoDecompose: false, minMergeScore: 8, minApproveScore: 9, maxJudgeRounds: 3, maxGateFixRounds: 3, maxRoundsPerTask: 20, dailyRoundBudget: 200, judgeModel: '', coderModel: '', coderFallbackModel: '' });

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
                                    <Boxes size={18} className={config.autoDecompose ? 'text-emerald-500' : 'text-slate-400'} />
                                    Auto-decompose
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {config.autoDecompose
                                        ? 'Ativo — o Planner detecta issues grandes na triagem, marca como epica e fatia em sub-tasks (aprovacao automatica sob auto-play).'
                                        : 'Desativado — issues grandes rodam inteiras (ou voce decompoe manualmente).'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input type="checkbox" checked={config.autoDecompose} onChange={(e) => setConfig({ ...config, autoDecompose: e.target.checked })} className="sr-only peer" />
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

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                                <ShieldCheck size={16} /> Nota minima para APROVAR (Judge)
                            </div>
                            <p className="text-xs text-slate-500 mb-2">Abaixo desta nota a task vai para revisao humana em vez de aprovada. O merge tem gate proprio (acima).</p>
                            <div className="flex items-center gap-3">
                                <input
                                    type="range"
                                    min={5}
                                    max={10}
                                    value={config.minApproveScore}
                                    onChange={(e) => setConfig({ ...config, minApproveScore: Number(e.target.value) })}
                                    className="flex-1"
                                />
                                <span className={`text-lg font-bold min-w-[3ch] text-center ${
                                    config.minApproveScore >= 9 ? 'text-emerald-500' : config.minApproveScore >= 7 ? 'text-amber-500' : 'text-red-500'
                                }`}>
                                    {config.minApproveScore}
                                </span>
                                <span className="text-xs text-slate-400">/10</span>
                            </div>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                                <ShieldCheck size={16} /> Modelo do Juiz (quem da a nota)
                            </div>
                            <p className="text-xs text-slate-500 mb-3">
                                Vazio = usa a cadeia do chat (hoje MiniMax). Um modelo Claude aqui faz o juiz rodar no Claude Code PRIMEIRO — familia diferente do coder = gate independente (evita o modelo julgar o proprio codigo) — com fallback pra cadeia do chat se indisponivel. Requer o Claude CLI instalado.
                            </p>
                            <input
                                type="text"
                                placeholder="vazio = cadeia do chat (MiniMax) — ou: sonnet / opus / haiku / ID completo"
                                value={config.judgeModel ?? ''}
                                onChange={(e) => setConfig({ ...config, judgeModel: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                            />
                            <div className="flex flex-wrap gap-2 mt-2">
                                {['', 'sonnet', 'opus', 'haiku'].map((m) => (
                                    <button
                                        key={m || 'chat'}
                                        type="button"
                                        onClick={() => setConfig({ ...config, judgeModel: m })}
                                        className={`text-xs px-2 py-1 rounded border ${(config.judgeModel ?? '') === m ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}
                                    >
                                        {m || 'chat (MiniMax)'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                                <ShieldCheck size={16} /> Modelo do Coder (quem resolve as issues)
                            </div>
                            <p className="text-xs text-slate-500 mb-3">
                                Vazio = usa o default do servidor (env/opencode — hoje MiniMax). Setado = o opencode roda nesse modelo. Troca vale no PROXIMO run, sem reiniciar. So letras/digitos/. _ : / - (nome tipo provider/modelo).
                            </p>
                            <input
                                type="text"
                                placeholder="vazio = default do servidor — ou: zai-coding-plan/glm-5.2 / minimax/MiniMax-M3"
                                value={config.coderModel ?? ''}
                                onChange={(e) => setConfig({ ...config, coderModel: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                            />
                            <div className="flex flex-wrap gap-2 mt-2">
                                {['', 'zai-coding-plan/glm-5.2', 'minimax/MiniMax-M3'].map((m) => (
                                    <button
                                        key={m || 'default'}
                                        type="button"
                                        onClick={() => setConfig({ ...config, coderModel: m })}
                                        className={`text-xs px-2 py-1 rounded border ${(config.coderModel ?? '') === m ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}
                                    >
                                        {m || 'default (servidor)'}
                                    </button>
                                ))}
                            </div>
                            <label className="block text-xs text-slate-500 mt-3 mb-1">Fallback (quando o primario da 429/timeout)</label>
                            <input
                                type="text"
                                placeholder="vazio = default do servidor (MiniMax-M3)"
                                value={config.coderFallbackModel ?? ''}
                                onChange={(e) => setConfig({ ...config, coderFallbackModel: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                            />
                        </div>

                        {config.autoMerge && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                                    <ShieldCheck size={16} /> Score minimo para auto-merge
                                </div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min={5}
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

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                                <RefreshCw size={16} /> Rodadas de correcao antes de escalar para voce
                            </div>
                            <p className="text-xs text-slate-500 mb-3">
                                Quantas vezes o robo tenta se auto-corrigir (realimentado com o motivo da falha) antes de parar e pedir sua revisao. Mais rodadas = mais autonomia, porem mais custo de LLM. Limite 1–10.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Auto-fix do Judge (nota baixa)
                                    <input
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={config.maxJudgeRounds ?? 3}
                                        onChange={(e) => setConfig({ ...config, maxJudgeRounds: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                                    />
                                </label>
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Self-heal de gate (regressao / CI vermelha / veto)
                                    <input
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={config.maxGateFixRounds ?? 3}
                                        onChange={(e) => setConfig({ ...config, maxGateFixRounds: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                                <RefreshCw size={16} /> Teto de custo (rodadas de opencode)
                            </div>
                            <p className="text-xs text-slate-500 mb-3">
                                Limita quanto o robo gasta. <strong>Por task</strong>: ao atingir, escala p/ revisao humana com o motivo. <strong>Por dia</strong>: ao atingir, segura novos inicios ate a virada do dia (a task em execucao segue).
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Rodadas por task (1&ndash;100)
                                    <input
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={config.maxRoundsPerTask ?? 20}
                                        onChange={(e) => setConfig({ ...config, maxRoundsPerTask: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                                    />
                                </label>
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Rodadas por dia (10&ndash;5000)
                                    <input
                                        type="number"
                                        min={10}
                                        max={5000}
                                        value={config.dailyRoundBudget ?? 200}
                                        onChange={(e) => setConfig({ ...config, dailyRoundBudget: Math.max(10, Math.min(5000, Number(e.target.value) || 10)) })}
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                                    />
                                </label>
                            </div>
                        </div>
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
