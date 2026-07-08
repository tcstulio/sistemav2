import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ShieldAlert, ShieldCheck, Save } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { getUiConfig, updateUiConfig } from '../../services/uiConfigService';
import { logger } from '../../utils/logger';

const log = logger.child('GovernanceEditor');

interface ActionGovernance {
    irreversibleRequiresApproval: boolean;
    adminBypassIrreversible: boolean;
    approvalValueThreshold: number | null;
    whatsappDestinationAllowlist: string[];
}
const DEFAULTS: ActionGovernance = { irreversibleRequiresApproval: false, adminBypassIrreversible: true, approvalValueThreshold: null, whatsappDestinationAllowlist: [] };

export interface GovernanceEditorProps { isAdmin: boolean; themeColor?: string; }

/**
 * Editor da governança de AÇÃO do agente (robô-de-negócio). Controla o HITL das ações
 * irreversíveis (validar fatura/pedido/proposta): ligar exige que o agente devolva um link de
 * confirmação em vez de executar direto; a ação roda com a permissão de quem confirmar (RBAC).
 * `adminBypassIrreversible` isenta os admins — o HITL vale só para não-admins até você desligá-lo.
 */
export const GovernanceEditor: React.FC<GovernanceEditorProps> = ({ isAdmin, themeColor = 'indigo' }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<ActionGovernance>(DEFAULTS);

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const cfg = await getUiConfig();
                const gov = (cfg as any)?.actionGovernance;
                if (!cancelled && gov) setConfig({ ...DEFAULTS, ...gov });
            } catch (e) {
                log.error('Falha ao carregar governanca', e);
                toast.error('Falha ao carregar a governança de ações.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const updated = await updateUiConfig({ actionGovernance: config } as any);
            const gov = (updated as any)?.actionGovernance;
            if (gov) setConfig({ ...DEFAULTS, ...gov });
            toast.success('Governança de ações salva.');
        } catch (e: any) {
            toast.error(`Falha ao salvar: ${e?.response?.data?.error || e?.message || 'erro'}`);
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) return null;

    const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
        <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
            <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
        </label>
    );

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><ShieldAlert size={16} /> Governança de ações do agente (Admin)</h3>}>
            <p className="text-sm text-slate-500 mb-4">
                Confirmação humana (HITL) das ações <strong>irreversíveis</strong> que o agente executa (ex.: validar fatura, pedido ou proposta).
            </p>

            {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
                <>
                    <div className="space-y-4">
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <ShieldCheck size={18} className={config.irreversibleRequiresApproval ? 'text-emerald-500' : 'text-slate-400'} />
                                    Exigir confirmação para ações irreversíveis
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {config.irreversibleRequiresApproval
                                        ? 'Ativo — o agente NÃO executa direto; devolve um link de confirmação (a ação roda com a permissão de quem confirmar).'
                                        : 'Desativado — ações irreversíveis (validar fatura, etc.) executam direto quando o agente as chama.'}
                                </p>
                            </div>
                            <Toggle checked={config.irreversibleRequiresApproval} onChange={(v) => setConfig({ ...config, irreversibleRequiresApproval: v })} />
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <ShieldCheck size={18} className={config.adminBypassIrreversible ? 'text-amber-500' : 'text-slate-400'} />
                                    Admin dispensa a confirmação
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {config.adminBypassIrreversible
                                        ? 'Ativo — administradores executam direto (sem confirmar). O HITL vale só para NÃO-admins — ligue o de cima sem se preocupar com atrito no seu fluxo.'
                                        : 'Desativado — TODOS (inclusive admin) passam pela confirmação em ação irreversível.'}
                                </p>
                            </div>
                            <Toggle checked={config.adminBypassIrreversible} onChange={(v) => setConfig({ ...config, adminBypassIrreversible: v })} />
                        </div>
                    </div>

                    <div className="flex justify-end mt-4">
                        <Button type="button" variant="primary" loading={saving} icon={<Save size={16} />} onClick={handleSave}>
                            Salvar governança
                        </Button>
                    </div>
                </>
            )}
        </Card>
    );
};

export default GovernanceEditor;
