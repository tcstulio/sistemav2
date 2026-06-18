import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Save, ListTodo, CalendarDays, DollarSign } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import {
    getAgentBootstrapConfig,
    updateAgentBootstrapConfig,
    AgentBootstrapConfig,
} from '../../services/agentBootstrapService';
import { logger } from '../../utils/logger';

const log = logger.child('AgentBootstrapEditor');

const SOURCES: { key: keyof Pick<AgentBootstrapConfig, 'includeTasks' | 'includeAgenda' | 'includeFinancial'>; label: string; desc: string; icon: React.ReactNode }[] = [
    { key: 'includeTasks', label: 'Tarefas pendentes', desc: 'Lista as tarefas atribuídas ao usuário', icon: <ListTodo size={16} /> },
    { key: 'includeAgenda', label: 'Agenda / compromissos', desc: 'Próximos eventos da agenda', icon: <CalendarDays size={16} /> },
    { key: 'includeFinancial', label: 'Resumo financeiro', desc: 'Visão rápida do financeiro do dia', icon: <DollarSign size={16} /> },
];

export interface AgentBootstrapEditorProps {
    isAdmin: boolean;
    themeColor?: string;
}

export const AgentBootstrapEditor: React.FC<AgentBootstrapEditorProps> = ({ isAdmin, themeColor = 'indigo' }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<AgentBootstrapConfig | null>(null);

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            const cfg = await getAgentBootstrapConfig();
            if (cancelled) return;
            if (cfg) setConfig(cfg);
            else toast.error('Falha ao carregar a configuração do agente.');
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    if (!isAdmin) return null;

    const handleSave = async () => {
        if (!config) return;
        setSaving(true);
        try {
            const saved = await updateAgentBootstrapConfig(config);
            setConfig(saved);
            toast.success('Sessão automática do agente salva.');
        } catch (e) {
            log.error('Falha ao salvar bootstrap-config', e);
            toast.error('Falha ao salvar (requer admin).');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="mt-6">
            <div className="flex items-center gap-2 mb-1">
                <Sparkles size={18} className={`text-${themeColor}-600 dark:text-${themeColor}-400`} />
                <h3 className="font-bold text-slate-800 dark:text-white">Sessão automática do agente</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Controla o resumo proativo que o assistente gera ao abrir uma conversa nova.
            </p>

            {loading || !config ? (
                <div className="flex items-center gap-2 text-slate-500 py-4"><Spinner /> Carregando…</div>
            ) : (
                <div className="space-y-4">
                    <label className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-sm font-semibold text-slate-800 dark:text-white">Ativar resumo proativo</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Se desligado, o agente abre sem resumo automático.</p>
                        </div>
                        <input
                            type="checkbox"
                            className="h-5 w-5 accent-current cursor-pointer"
                            checked={config.enabled}
                            onChange={e => setConfig({ ...config, enabled: e.target.checked })}
                        />
                    </label>

                    <div className={`space-y-2 ${config.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">O QUE O AGENTE REÚNE</p>
                        {SOURCES.map(s => (
                            <label key={s.key} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                                    {s.icon}
                                    <span>
                                        <span className="font-medium">{s.label}</span>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400">{s.desc}</span>
                                    </span>
                                </span>
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-current cursor-pointer"
                                    checked={config[s.key]}
                                    onChange={e => setConfig({ ...config, [s.key]: e.target.checked })}
                                />
                            </label>
                        ))}

                        <div>
                            <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-1 mt-3">INSTRUÇÃO EXTRA (OPCIONAL)</label>
                            <textarea
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-white"
                                rows={2}
                                maxLength={2000}
                                placeholder="Ex.: priorize prazos de hoje e destaque pendências de aprovação."
                                value={config.extraInstruction}
                                onChange={e => setConfig({ ...config, extraInstruction: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <Button variant="primary" loading={saving} icon={<Save size={16} />} onClick={handleSave}>
                            Salvar
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    );
};
