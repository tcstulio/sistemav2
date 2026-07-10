import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Power, Zap, Save } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { getUiConfig, updateUiConfig, AutomationSwitchesConfig } from '../../services/uiConfigService';
import { logger } from '../../utils/logger';

const log = logger.child('BackgroundAutomationSwitches');

const DEFAULT_SWITCHES: AutomationSwitchesConfig = { schedulerEnabled: true, alertCronEnabled: true };

export interface BackgroundAutomationSwitchesProps {
    isAdmin: boolean;
    themeColor?: string;
}

export const BackgroundAutomationSwitches: React.FC<BackgroundAutomationSwitchesProps> = ({ isAdmin, themeColor = 'indigo' }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [switches, setSwitches] = useState<AutomationSwitchesConfig>(DEFAULT_SWITCHES);

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const cfg = await getUiConfig();
                if (cancelled) return;
                if (cfg?.automationSwitches) setSwitches(cfg.automationSwitches);
            } catch (e) {
                log.error('Falha ao carregar switches de automação', e);
                toast.error('Falha ao carregar automações de fundo.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const updated = await updateUiConfig({ automationSwitches: switches } as any);
            setSwitches(updated.automationSwitches || switches);
            toast.success('Automações de fundo salvas.');
        } catch (e: any) {
            toast.error(`Falha ao salvar: ${e?.response?.data?.error || e?.message || 'erro'}`);
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) return null;

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><Power size={16} /> Automações de fundo (Admin)</h3>}>
            <p className="text-sm text-slate-500 mb-4">
                Pause automações globais sem derrubar o backend. O efeito vale no próximo ciclo e religar retoma sem restart.
            </p>

            {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
                <>
                    <div className="space-y-4">
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <Zap size={18} className={switches.schedulerEnabled ? 'text-emerald-500' : 'text-slate-400'} />
                                    Mensagens agendadas (WhatsApp/E-mail)
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {switches.schedulerEnabled
                                        ? 'Ativo — mensagens agendadas saem a cada 30s (tick do schedulerService).'
                                        : 'Pausado — nenhuma mensagem agendada sai até religar (sem restart do backend).'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input type="checkbox" checked={switches.schedulerEnabled} onChange={(e) => setSwitches({ ...switches, schedulerEnabled: e.target.checked })} className="sr-only peer" />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <Power size={18} className={switches.alertCronEnabled ? 'text-emerald-500' : 'text-slate-400'} />
                                    Alertas de fundo (faturas/estoque/tickets)
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {switches.alertCronEnabled
                                        ? 'Ativo — alertas de faturas vencidas, estoque baixo e tickets parados rodam nos ciclos do alertCronService.'
                                        : 'Pausado — nenhum alerta é gerado até religar (faturas 24h, estoque 6h, tickets 4h).'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input type="checkbox" checked={switches.alertCronEnabled} onChange={(e) => setSwitches({ ...switches, alertCronEnabled: e.target.checked })} className="sr-only peer" />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>
                    </div>

                    <div className="flex justify-end mt-4">
                        <Button type="button" variant="primary" loading={saving} icon={<Save size={16} />} onClick={handleSave}>
                            Salvar
                        </Button>
                    </div>
                </>
            )}
        </Card>
    );
};

export default BackgroundAutomationSwitches;
