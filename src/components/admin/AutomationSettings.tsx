import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Clock, Save, CheckCircle2, XCircle, CalendarClock } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { RestrictedAccess } from '../RestrictedAccess';
import {
    AiService,
    FinancialAnalysisAutomationConfig,
    FinancialAnalysisAutomationSchedule,
} from '../../services/aiService';
import { DolibarrConfig } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child('AutomationSettings');

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const DEFAULT_CONFIG: FinancialAnalysisAutomationConfig = {
    enabled: false,
    schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
    lastRunAt: null,
    lastRunStatus: null,
};

interface AutomationSettingsProps {
    config: DolibarrConfig;
}

type BadgeState = 'active' | 'inactive' | 'error';

function deriveBadge(cfg: FinancialAnalysisAutomationConfig): BadgeState {
    if (cfg.lastRunStatus === 'error') return 'error';
    return cfg.enabled ? 'active' : 'inactive';
}

function formatLastRun(iso: string | null): string {
    if (!iso) return 'Nunca executada';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * AutomationSettings — Tela de Automações (admin).
 *
 * Lista as automações disponíveis no sistema (issue #497). Inicialmente apenas
 * "Análise Financeira IA": toggle on/off, agendamento (dia/semana + hora/minuto)
 * e status da última execução. Segue o padrão visual de TaskAutomationEditor.
 */
export const AutomationSettings: React.FC<AutomationSettingsProps> = ({ config }) => {
    const isAdmin =
        config.currentUser?.admin === 1 ||
        config.currentUser?.admin === '1' ||
        config.currentUser?.admin === true;

    const [loading, setLoading] = useState(true);
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [cfg, setCfg] = useState<FinancialAnalysisAutomationConfig>(DEFAULT_CONFIG);
    const [draft, setDraft] = useState<FinancialAnalysisAutomationSchedule>(DEFAULT_CONFIG.schedule);

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const data = await AiService.getFinancialAnalysisAutomationConfig();
                if (cancelled) return;
                // null => falha no carregamento. O service já logou; o componente decide a mensagem (#677).
                // Este useEffect só roda no mount (deps=[isAdmin]); salvamentos não disparam re-fetch,
                // então este toast não aparece após um salvamento bem-sucedido.
                if (!data) {
                    toast.error('Não foi possível carregar as configurações de automação.');
                    return;
                }
                setCfg(data);
                setDraft(data.schedule);
            } catch (e) {
                log.error('Falha ao carregar config de automação', e);
                if (!cancelled) toast.error('Não foi possível carregar as configurações de automação.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    const handleToggle = async () => {
        setToggling(true);
        const next = !cfg.enabled;
        try {
            const updated = await AiService.updateFinancialAnalysisAutomationConfig({ enabled: next });
            if (updated) {
                setCfg(updated);
                toast.success('Automação atualizada!');
            } else {
                // Falha ao persistir: como o toggle é controlado por cfg.enabled (que não mudou),
                // a UI volta visualmente ao estado anterior automaticamente (#677).
                toast.error('Falha ao salvar automação. Tente novamente.');
            }
        } catch (e: any) {
            log.error('Falha ao alternar automação', e);
            toast.error('Falha ao salvar automação. Tente novamente.');
        } finally {
            setToggling(false);
        }
    };

    const handleSaveSchedule = async () => {
        setSavingSchedule(true);
        try {
            const updated = await AiService.updateFinancialAnalysisAutomationConfig({ schedule: draft });
            if (updated) {
                setCfg(updated);
                setDraft(updated.schedule);
                toast.success('Horário salvo com sucesso!');
            } else {
                toast.error('Falha ao salvar horário.');
            }
        } catch (e: any) {
            log.error('Falha ao salvar horário', e);
            toast.error('Falha ao salvar horário.');
        } finally {
            setSavingSchedule(false);
        }
    };

    if (!isAdmin) {
        return <RestrictedAccess view="settings" />;
    }

    const badge = deriveBadge(cfg);
    const badgeStyles: Record<BadgeState, { dot: string; text: string; label: string }> = {
        active: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', label: 'Ativo' },
        inactive: { dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400', label: 'Inativo' },
        error: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', label: 'Erro na última execução' },
    };

    const scheduleDirty =
        draft.dayOfWeek !== cfg.schedule.dayOfWeek ||
        draft.hour !== cfg.schedule.hour ||
        draft.minute !== cfg.schedule.minute;

    return (
        <div className="space-y-4">
            <Card header={
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">
                    <Sparkles size={16} /> Automações
                </h3>
            }>
                <p className="text-sm text-slate-500 mb-4">
                    Gerencie as automações disponíveis no sistema. Alterações são persistidas e refletidas no agendador do backend.
                </p>

                {loading ? (
                    <div className="flex justify-center py-8"><Spinner /></div>
                ) : (
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    <Sparkles size={18} className="text-indigo-500" />
                                    Análise Financeira IA
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    Gera automaticamente a análise financeira da organização no dia/horário agendado.
                                </p>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                                <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${badgeStyles[badge].text}`}>
                                    <span className={`w-2 h-2 rounded-full ${badgeStyles[badge].dot}`} />
                                    {badgeStyles[badge].label}
                                </span>
                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={cfg.enabled}
                                        onChange={handleToggle}
                                        disabled={toggling}
                                        className="sr-only peer"
                                        aria-label="Ativar/desativar Análise Financeira IA"
                                    />
                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                </label>
                            </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 mb-3">
                                <CalendarClock size={14} /> Agendamento
                            </div>
                            <div className="flex flex-wrap items-end gap-3">
                                <div>
                                    <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Dia da semana</label>
                                    <select
                                        value={draft.dayOfWeek}
                                        onChange={(e) => setDraft({ ...draft, dayOfWeek: Number(e.target.value) })}
                                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        {DAYS.map((day, idx) => (
                                            <option key={day} value={idx}>{day}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Hora</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={23}
                                        value={draft.hour}
                                        onChange={(e) => setDraft({ ...draft, hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })}
                                        className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Minuto</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={59}
                                        value={draft.minute}
                                        onChange={(e) => setDraft({ ...draft, minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })}
                                        className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    loading={savingSchedule}
                                    disabled={!scheduleDirty}
                                    icon={<Save size={14} />}
                                    onClick={handleSaveSchedule}
                                >
                                    Salvar horário
                                </Button>
                            </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <Clock size={14} className="text-slate-400" />
                            <span>Última execução:</span>
                            <span className="font-medium text-slate-600 dark:text-slate-300">{formatLastRun(cfg.lastRunAt)}</span>
                            {cfg.lastRunStatus === 'success' && (
                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 size={13} /> Sucesso
                                </span>
                            )}
                            {cfg.lastRunStatus === 'error' && (
                                <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                                    <XCircle size={13} /> Erro
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default AutomationSettings;
