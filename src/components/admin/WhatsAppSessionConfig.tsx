import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MessageSquare, AlertTriangle, Save, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { getUiConfig, updateUiConfig, WhatsappFallbackPolicy } from '../../services/uiConfigService';
import { WhatsAppService } from '../../services/whatsappService';
import { WhatsAppAccount } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child('WhatsAppSessionConfig');

export interface WhatsAppSessionConfigProps { isAdmin: boolean; themeColor?: string; }

/**
 * #1440 (épico #1398) — Admin escolhe a SESSÃO de WhatsApp institucional que dispara os envios
 * automáticos (cobranças, notificações de tarefa) + a POLÍTICA de fallback se ela cair. Antes,
 * a sessão era `'default'` hardcoded e, se caísse, o envio desviava SILENCIOSAMENTE p/ a 1ª sessão
 * WORKING — podendo mandar do número errado. O backend (channelRouter/scheduler) já lê estes campos
 * (#1437); esta tela é a UI que faltava. Persiste em `uiConfig.whatsappPrimarySessionId` +
 * `whatsappFallbackPolicy` via o PUT existente.
 */
export const WhatsAppSessionConfig: React.FC<WhatsAppSessionConfigProps> = ({ isAdmin, themeColor = 'indigo' }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [sessions, setSessions] = useState<WhatsAppAccount[]>([]);
    const [primaryId, setPrimaryId] = useState<string>('');
    const [policy, setPolicy] = useState<WhatsappFallbackPolicy>('fail');

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [cfg, accounts] = await Promise.all([getUiConfig(), WhatsAppService.getAccounts()]);
                if (cancelled) return;
                setSessions(accounts || []);
                if (cfg) {
                    setPrimaryId((cfg.whatsappPrimarySessionId || '').trim());
                    setPolicy(cfg.whatsappFallbackPolicy === 'first-working' ? 'first-working' : 'fail');
                }
            } catch (e) {
                log.error('Falha ao carregar sessões/config', e);
                if (!cancelled) toast.error('Falha ao carregar as sessões de WhatsApp.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    // WORKING no backend é mapeado p/ 'connected' pelo getAccounts (whatsappService.ts:82).
    const workingSessions = sessions.filter(s => s.status === 'connected');
    const configuredButDown = primaryId !== '' && !workingSessions.some(s => s.id === primaryId);

    const handleSave = async () => {
        // Critério de aceite: não permite salvar sessão que não está WORKING (vazio = legado 'default' é OK).
        if (primaryId !== '' && !workingSessions.some(s => s.id === primaryId)) {
            toast.error('A sessão escolhida não está WORKING. Selecione uma sessão conectada (ou o padrão legado).');
            return;
        }
        setSaving(true);
        try {
            const updated = await updateUiConfig({ whatsappPrimarySessionId: primaryId, whatsappFallbackPolicy: policy });
            setPrimaryId((updated.whatsappPrimarySessionId || '').trim());
            setPolicy(updated.whatsappFallbackPolicy === 'first-working' ? 'first-working' : 'fail');
            toast.success('Sessão de envio institucional salva.');
        } catch (e: any) {
            toast.error(`Falha ao salvar: ${e?.response?.data?.error || e?.message || 'erro'}`);
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) return null;

    const RadioRow: React.FC<{ value: WhatsappFallbackPolicy; title: string; desc: string; danger?: boolean }> = ({ value, title, desc, danger }) => (
        <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${policy === value ? `border-${themeColor}-400 bg-${themeColor}-50 dark:bg-${themeColor}-900/20` : 'border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'}`}>
            <input type="radio" name="whatsappFallbackPolicy" value={value} checked={policy === value} onChange={() => setPolicy(value)} className="mt-1" />
            <div>
                <div className={`text-sm font-medium flex items-center gap-1.5 ${danger ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                    {danger ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}{title}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
            </div>
        </label>
    );

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><MessageSquare size={16} /> Sessão de WhatsApp institucional (Admin)</h3>}>
            <p className="text-sm text-slate-500 mb-4">
                Qual conta de WhatsApp dispara os <strong>envios automáticos</strong> (cobranças, notificações de tarefa) — e o que fazer se ela cair.
            </p>

            {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
                <>
                    <div className="space-y-4">
                        {/* Sessão primária */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Sessão primária</label>
                            {workingSessions.length === 0 ? (
                                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-xl border border-amber-200 dark:border-amber-800">
                                    <AlertTriangle size={16} />
                                    Nenhuma sessão de WhatsApp está WORKING agora. Conecte uma sessão (Comunicação → WhatsApp) para escolher a conta institucional.
                                </div>
                            ) : (
                                <select
                                    value={primaryId}
                                    onChange={(e) => setPrimaryId(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200"
                                >
                                    <option value="">— Padrão legado (sessão 'default')</option>
                                    {workingSessions.map(s => (
                                        <option key={s.id} value={s.id}>
                                            {s.name} {s.phoneNumber && s.phoneNumber !== '---' ? `(${s.phoneNumber})` : ''} — {s.id}
                                        </option>
                                    ))}
                                </select>
                            )}
                            {configuredButDown && (
                                <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                                    <AlertTriangle size={13} /> A sessão configurada (<code>{primaryId}</code>) NÃO está WORKING agora — os envios seguem a política de fallback abaixo até ela voltar.
                                </p>
                            )}
                        </div>

                        {/* Política de fallback */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Se a primária não estiver WORKING</label>
                            <div className="space-y-2">
                                <RadioRow value="fail" title="Falhar (recomendado)" desc="Não envia e retorna erro — evita mandar a mensagem do número errado." />
                                <RadioRow value="first-working" title="Desviar para a 1ª sessão WORKING" desc="Comportamento legado — RISCO: pode enviar do número errado sem avisar." danger />
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end mt-4">
                        <Button type="button" variant="primary" loading={saving} icon={<Save size={16} />} onClick={handleSave}>
                            Salvar sessão de envio
                        </Button>
                    </div>
                </>
            )}
        </Card>
    );
};

export default WhatsAppSessionConfig;
