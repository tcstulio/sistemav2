import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Lock, Crown, Hash, MessageCircle, Plus, X, Save } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { getUiConfig, updateUiConfig, ActionGovernanceConfig } from '../../services/uiConfigService';
import { logger } from '../../utils/logger';

const log = logger.child('ActionGovernanceEditor');

const DEFAULT_ACTION_GOVERNANCE: ActionGovernanceConfig = {
    irreversibleRequiresApproval: false,
    adminBypassIrreversible: true,
    approvalValueThreshold: null,
    whatsappDestinationAllowlist: [],
};

const ALLOWLIST_MIN = 8;
const ALLOWLIST_MAX = 15;

export interface ActionGovernanceEditorProps {
    isAdmin: boolean;
    themeColor?: string;
}

export const ActionGovernanceEditor: React.FC<ActionGovernanceEditorProps> = ({ isAdmin, themeColor = 'indigo' }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<ActionGovernanceConfig>(DEFAULT_ACTION_GOVERNANCE);
    const [allowlistInput, setAllowlistInput] = useState('');

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const cfg = await getUiConfig();
                if (cancelled) return;
                if (cfg?.actionGovernance) setConfig({ ...DEFAULT_ACTION_GOVERNANCE, ...cfg.actionGovernance });
            } catch (e) {
                log.error('Falha ao carregar config de governanca', e);
                toast.error('Falha ao carregar governanca de acao.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    const normalizedAllowlistInput = allowlistInput.replace(/\D/g, '');
    const canAddAllowlist = normalizedAllowlistInput.length >= ALLOWLIST_MIN && normalizedAllowlistInput.length <= ALLOWLIST_MAX;

    const handleAddAllowlist = () => {
        if (!canAddAllowlist) return;
        if (config.whatsappDestinationAllowlist.includes(normalizedAllowlistInput)) {
            setAllowlistInput('');
            return;
        }
        setConfig({ ...config, whatsappDestinationAllowlist: [...config.whatsappDestinationAllowlist, normalizedAllowlistInput] });
        setAllowlistInput('');
    };

    const handleRemoveAllowlist = (item: string) => {
        setConfig({ ...config, whatsappDestinationAllowlist: config.whatsappDestinationAllowlist.filter((n) => n !== item) });
    };

    const handleThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (raw === '') {
            setConfig({ ...config, approvalValueThreshold: null });
            return;
        }
        const num = Number(raw);
        if (Number.isNaN(num) || num < 0) return;
        setConfig({ ...config, approvalValueThreshold: num });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const updated = await updateUiConfig({ actionGovernance: config });
            setConfig(updated.actionGovernance || config);
            toast.success('Governanca de acao salva.');
        } catch (e: any) {
            toast.error(`Falha ao salvar: ${e?.response?.data?.error || e?.message || 'erro'}`);
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) return null;

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><ShieldCheck size={16} /> Governança de Ação do Agente (Admin)</h3>}>
            <p className="text-sm text-slate-500 mb-4">
                Define guardrails para ações do agente (irreversíveis, com valor monetário ou envio de mensagens).
                <span className="block mt-1 text-xs text-amber-600 dark:text-amber-400">
                    O enforcement (Fase B2) ainda não está ativo — esta é uma configuração dormente que passará a ser respeitada quando o runtime de governança for ligado.
                </span>
            </p>

            {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
                <>
                    <div className="space-y-4">
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <Lock size={18} className={config.irreversibleRequiresApproval ? 'text-emerald-500' : 'text-slate-400'} />
                                    Ações irreversíveis exigem aprovação
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {config.irreversibleRequiresApproval
                                        ? 'Ativo — ações marcadas como irreversíveis aguardam aprovação humana antes de executar.'
                                        : 'Desativado — ações irreversíveis executam sem aprovação prévia.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input
                                    type="checkbox"
                                    role="switch"
                                    aria-label="Ações irreversíveis exigem aprovação"
                                    data-testid="gov-irreversible-toggle"
                                    checked={config.irreversibleRequiresApproval}
                                    onChange={(e) => setConfig({ ...config, irreversibleRequiresApproval: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <Crown size={18} className={config.adminBypassIrreversible ? 'text-emerald-500' : 'text-slate-400'} />
                                    Admin ignora o gate de ações irreversíveis
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {config.adminBypassIrreversible
                                        ? 'Ativo — admins executam ações irreversíveis sem necessidade de aprovação.'
                                        : 'Desativado — admins também passam pelo gate de aprovação.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input
                                    type="checkbox"
                                    role="switch"
                                    aria-label="Admin ignora o gate de ações irreversíveis"
                                    data-testid="gov-admin-bypass-toggle"
                                    checked={config.adminBypassIrreversible}
                                    onChange={(e) => setConfig({ ...config, adminBypassIrreversible: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                                <Hash size={16} /> Valor mínimo que exige aprovação
                            </div>
                            <p className="text-xs text-slate-500 mb-2">
                                Ações com valor igual ou superior a este exigem aprovação. Deixe vazio para desativar o teto (salva como nulo).
                            </p>
                            <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                aria-label="Valor mínimo que exige aprovação"
                                data-testid="gov-approval-threshold"
                                value={config.approvalValueThreshold === null ? '' : config.approvalValueThreshold}
                                onChange={handleThresholdChange}
                                placeholder="Ex.: 1000 (vazio = sem teto)"
                                className="w-full sm:w-64 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                            />
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                                <MessageCircle size={16} /> Allowlist de destinos WhatsApp
                            </div>
                            <p className="text-xs text-slate-500 mb-3">
                                Apenas números com {ALLOWLIST_MIN}–{ALLOWLIST_MAX} dígitos são aceitos. Caracteres não numéricos são removidos automaticamente.
                            </p>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    aria-label="Novo destino WhatsApp"
                                    data-testid="gov-allowlist-input"
                                    value={allowlistInput}
                                    onChange={(e) => setAllowlistInput(e.target.value.replace(/\D/g, ''))}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAllowlist(); } }}
                                    placeholder="Ex.: 5511999900000"
                                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                                />
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="md"
                                    icon={<Plus size={16} />}
                                    disabled={!canAddAllowlist}
                                    data-testid="gov-allowlist-add"
                                    onClick={handleAddAllowlist}
                                >
                                    Adicionar
                                </Button>
                            </div>
                            {!canAddAllowlist && normalizedAllowlistInput.length > 0 && (
                                <p className="text-xs text-red-500 mt-2" data-testid="gov-allowlist-error">
                                    O número deve ter entre {ALLOWLIST_MIN} e {ALLOWLIST_MAX} dígitos.
                                </p>
                            )}
                            {config.whatsappDestinationAllowlist.length > 0 && (
                                <ul className="flex flex-wrap gap-2 mt-3" data-testid="gov-allowlist-list">
                                    {config.whatsappDestinationAllowlist.map((item) => (
                                        <li
                                            key={item}
                                            data-testid={`gov-allowlist-item-${item}`}
                                            className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full bg-slate-200 dark:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                                        >
                                            {item}
                                            <button
                                                type="button"
                                                aria-label={`Remover ${item}`}
                                                data-testid={`gov-allowlist-remove-${item}`}
                                                onClick={() => handleRemoveAllowlist(item)}
                                                className="inline-flex items-center justify-center w-5 h-5 rounded-full hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300"
                                            >
                                                <X size={12} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end mt-4">
                        <Button type="button" variant="primary" loading={saving} icon={<Save size={16} />} data-testid="gov-save" onClick={handleSave}>
                            Salvar governança
                        </Button>
                    </div>
                </>
            )}
        </Card>
    );
};

export default ActionGovernanceEditor;
