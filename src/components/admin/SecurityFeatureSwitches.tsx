import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ShieldAlert, Send, Banknote, Lock, Save, UserCheck } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { getUiConfig, updateUiConfig, FeatureSwitchesConfig } from '../../services/uiConfigService';
import { logger } from '../../utils/logger';

const log = logger.child('SecurityFeatureSwitches');

// Defaults alinhados ao backend: dryRun/financial/employeeElevation OFF, crmContext ON.
const DEFAULT_SWITCHES: FeatureSwitchesConfig = { dryRunMode: false, financialCommands: false, crmContextInjection: true, whatsappEmployeeElevation: false };

export interface SecurityFeatureSwitchesProps {
    isAdmin: boolean;
    themeColor?: string;
}

export const SecurityFeatureSwitches: React.FC<SecurityFeatureSwitchesProps> = ({ isAdmin, themeColor = 'indigo' }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [switches, setSwitches] = useState<FeatureSwitchesConfig>(DEFAULT_SWITCHES);

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const cfg = await getUiConfig();
                if (cancelled) return;
                if (cfg?.featureSwitches) setSwitches(cfg.featureSwitches);
            } catch (e) {
                log.error('Falha ao carregar kill-switches de segurança', e);
                toast.error('Falha ao carregar kill-switches de segurança.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const updated = await updateUiConfig({ featureSwitches: switches });
            setSwitches(updated.featureSwitches || switches);
            toast.success('Kill-switches de segurança salvos.');
        } catch (e) {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            toast.error(`Falha ao salvar: ${err?.response?.data?.error || err?.message || 'erro'}`);
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) return null;

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><ShieldAlert size={16} /> Integrações / Segurança (Admin)</h3>}>
            <p className="text-sm text-slate-500 mb-4">
                Kill-switches de comportamento sensível. Ligam/desligam em runtime, sem restart — acionáveis num incidente.
            </p>

            {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
                <>
                    <div className="space-y-4">
                        {/* DRY_RUN */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <Send size={18} className={switches.dryRunMode ? 'text-amber-500' : 'text-slate-400'} />
                                    Dry-run (bloquear envio real de mensagens)
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {switches.dryRunMode
                                        ? 'Ativo — nenhuma mensagem real é enviada (anti-spam de incidente). O channelRouter retorna dry-run.'
                                        : 'Inativo — mensagens são enviadas normalmente. Ligar em incidente de spam dispara o kill-switch imediatamente.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input type="checkbox" checked={switches.dryRunMode} onChange={(e) => setSwitches({ ...switches, dryRunMode: e.target.checked })} className="sr-only peer" />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>

                        {/* FINANCIAL_COMMANDS */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <Banknote size={18} className={switches.financialCommands ? 'text-emerald-500' : 'text-slate-400'} />
                                    Comandos financeiros (/pagar, /pix)
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {switches.financialCommands
                                        ? 'Ativo — /pagar e /pix aceitos pelo bot (movimentam dinheiro real). Mudanças são auditadas.'
                                        : 'Pausado — /pagar e /pix recusados pelo bot. Desligar corta comandos de dinheiro em incidente sem redeploy.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input type="checkbox" checked={switches.financialCommands} onChange={(e) => setSwitches({ ...switches, financialCommands: e.target.checked })} className="sr-only peer" />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>

                        {/* CRM_CONTEXT_INJECTION */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <Lock size={18} className={switches.crmContextInjection ? 'text-emerald-500' : 'text-amber-500'} />
                                    Injeção de contexto CRM no LLM (privacidade)
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {switches.crmContextInjection
                                        ? 'Ativo — dados do cliente são injetados nas respostas do LLM.'
                                        : 'Pausado — nenhum dado de cliente vai ao LLM. Desligar em incidente de privacidade.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input type="checkbox" checked={switches.crmContextInjection} onChange={(e) => setSwitches({ ...switches, crmContextInjection: e.target.checked })} className="sr-only peer" />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>

                        {/* WHATSAPP_EMPLOYEE_ELEVATION */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <UserCheck size={18} className={switches.whatsappEmployeeElevation ? 'text-emerald-500' : 'text-slate-400'} />
                                    Permissões de funcionário no bot do WhatsApp
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {switches.whatsappEmployeeElevation
                                        ? 'Ativo — funcionário identificado pelo celular (1:1) usa o próprio perfil de permissões no bot; irreversíveis seguem exigindo confirmação logada no app.'
                                        : 'Inativo — o bot é 100% somente-leitura para todos os remetentes, inclusive funcionários.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input type="checkbox" checked={!!switches.whatsappEmployeeElevation} onChange={(e) => setSwitches({ ...switches, whatsappEmployeeElevation: e.target.checked })} className="sr-only peer" />
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

export default SecurityFeatureSwitches;
