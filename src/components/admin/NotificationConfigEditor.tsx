import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Save, MessageSquare, Mail, Monitor, AlertTriangle, Phone, ChevronDown, ChevronUp, RefreshCw, Clock, CalendarClock, Hourglass, Info } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { getUiConfig, updateUiConfig, getUsersMissingPhone, TaskNotifEvent, TaskNotifRole, NotifChannel, TaskNotificationsConfig, UserMissingPhone, NotificationPolicyConfig, CobrancaCadenceConfig, QuietHoursChannel, QuietHoursRule } from '../../services/uiConfigService';
import { logger } from '../../utils/logger';

const log = logger.child('NotificationConfigEditor');

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const EVENTS: { key: TaskNotifEvent; label: string }[] = [
    { key: 'assigned', label: 'Atribuída' },
    { key: 'acceptance_pending', label: 'Aceitação pendente' },
    { key: 'acceptance_overdue', label: 'Aceitação vencida' },
    { key: 'deadline_reminder', label: 'Lembrete de prazo' },
    { key: 'overdue', label: 'Atrasada' },
    { key: 'stalled', label: 'Parada / Stalled' },
    { key: 'completed', label: 'Concluída' },
    { key: 'comment', label: 'Comentário' },
];

const ROLES: { key: TaskNotifRole; label: string }[] = [
    { key: 'responsavel', label: 'Responsável' },
    { key: 'interveniente', label: 'Colaborador' },
    { key: 'criador', label: 'Criador' },
];

const CHANNEL_META: { key: NotifChannel; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'in-app', label: 'App', icon: <Monitor size={13} />, color: 'bg-slate-500' },
    { key: 'whatsapp', label: 'WhatsApp', icon: <MessageSquare size={13} />, color: 'bg-emerald-500' },
    { key: 'email', label: 'Email', icon: <Mail size={13} />, color: 'bg-blue-500' },
];

// Quiet-hours: mesma ordem visual da matriz (WhatsApp, E-mail, In-app) — espelha o #1293.
const QH_CHANNELS: { key: QuietHoursChannel; label: string; icon: React.ReactNode }[] = [
    { key: 'whatsapp', label: 'WhatsApp', icon: <MessageSquare size={13} /> },
    { key: 'email', label: 'E-mail', icon: <Mail size={13} /> },
    { key: 'in-app', label: 'In-app', icon: <Monitor size={13} /> },
];

const CADENCE_FIELDS: { key: keyof CobrancaCadenceConfig; label: string; min: number; max: number; tip: string }[] = [
    { key: 'reminderDaysBefore', label: 'Lembrete antes do prazo (dias)', min: 0, max: 90, tip: 'Quantos dias antes do vencimento disparamos o 1º lembrete ao responsável.' },
    { key: 'recobrancaIntervalDays', label: 'Intervalo entre recobranças (dias)', min: 1, max: 90, tip: 'Espaçamento entre cobranças repetidas enquanto não houver progresso na tarefa.' },
    { key: 'escalateAfterCobrancas', label: 'Escalar após N cobranças', min: 1, max: 30, tip: 'Número de cobranças sem avanço antes de escalar a tarefa ao solicitante.' },
    { key: 'prazoDeAceiteDays', label: 'Prazo de aceite (dias)', min: 0, max: 90, tip: 'Prazo para o responsável aceitar a tarefa antes de escalar por falta de aceite.' },
];

// Default visual espelha os defaults do backend (DEFAULT_NOTIFICATION_POLICY).
const DEFAULT_POLICY: NotificationPolicyConfig = {
    cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
    quietHours: {
        whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        email: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
    },
    staleHours: 24,
    invoiceDueHorizonDays: 3,
};

function cloneConfig(c: TaskNotificationsConfig): TaskNotificationsConfig {
    const out = {} as TaskNotificationsConfig;
    for (const ev of EVENTS) {
        out[ev.key] = { ...c[ev.key] };
        for (const r of ROLES) {
            out[ev.key][r.key] = [...(c[ev.key][r.key] || [])];
        }
    }
    return out;
}

export interface NotificationConfigEditorProps {
    isAdmin: boolean;
    themeColor?: string;
}

export const NotificationConfigEditor: React.FC<NotificationConfigEditorProps> = ({ isAdmin, themeColor = 'indigo' }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<TaskNotificationsConfig | null>(null);
    const [externalEnabled, setExternalEnabled] = useState(false);
    const [policy, setPolicy] = useState<NotificationPolicyConfig>(DEFAULT_POLICY);

    // Estado do diagnóstico de telefones
    const [diagLoading, setDiagLoading] = useState(false);
    const [diagResult, setDiagResult] = useState<{ total: number; missingCount: number; users: UserMissingPhone[] } | null>(null);
    const [diagOpen, setDiagOpen] = useState(false);

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const cfg = await getUiConfig();
                if (cancelled) return;
                if (cfg?.taskNotifications) setConfig(cfg.taskNotifications);
                setExternalEnabled(cfg?.taskNotificationsExternalEnabled === true);
                if (cfg?.notificationPolicy) setPolicy({ ...DEFAULT_POLICY, ...cfg.notificationPolicy });
            } catch (e) {
                log.error('Falha ao carregar config de notificações', e);
                toast.error('Falha ao carregar notificações.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    const handleLoadDiag = async () => {
        setDiagLoading(true);
        try {
            const result = await getUsersMissingPhone();
            setDiagResult(result);
            setDiagOpen(true);
        } catch (e: any) {
            toast.error(`Falha ao carregar diagnóstico: ${e?.message || 'erro'}`);
        } finally {
            setDiagLoading(false);
        }
    };

    const toggleChannel = (event: TaskNotifEvent, role: TaskNotifRole, channel: NotifChannel) => {
        if (!config) return;
        const next = cloneConfig(config);
        const list = next[event][role];
        const idx = list.indexOf(channel);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(channel);
        setConfig(next);
    };

    // ---- Handlers da política de notificações (#1293) ----
    const setCadence = (key: keyof CobrancaCadenceConfig, raw: number) => {
        const field = CADENCE_FIELDS.find((f) => f.key === key)!;
        const safe = Number.isFinite(raw) ? Math.max(field.min, Math.min(field.max, Math.round(raw))) : DEFAULT_POLICY.cobrancaCadence[key];
        setPolicy((p) => ({ ...p, cobrancaCadence: { ...p.cobrancaCadence, [key]: safe } }));
    };

    const setQuiet = (ch: QuietHoursChannel, patch: Partial<QuietHoursRule>) => {
        setPolicy((p) => ({ ...p, quietHours: { ...p.quietHours, [ch]: { ...p.quietHours[ch], ...patch } } }));
    };

    const setStaleHours = (raw: number) => {
        const safe = Number.isFinite(raw) ? Math.max(1, Math.min(720, Math.round(raw))) : DEFAULT_POLICY.staleHours;
        setPolicy((p) => ({ ...p, staleHours: safe }));
    };

    const setInvoiceHorizon = (raw: number) => {
        const safe = Number.isFinite(raw) ? Math.max(0, Math.min(365, Math.round(raw))) : DEFAULT_POLICY.invoiceDueHorizonDays;
        setPolicy((p) => ({ ...p, invoiceDueHorizonDays: safe }));
    };

    // Validação client-side: impede salvar valores inválidos (negativos, horários malformados).
    const errors = useMemo<string[]>(() => {
        const errs: string[] = [];
        for (const f of CADENCE_FIELDS) {
            const v = policy.cobrancaCadence[f.key];
            if (!Number.isFinite(v) || v < f.min) errs.push(`${f.label} deve ser ≥ ${f.min}.`);
        }
        for (const ch of QH_CHANNELS) {
            const r = policy.quietHours[ch.key];
            if (r.enabled) {
                if (!HHMM_RE.test(r.startHHmm)) errs.push(`Horário de início inválido para ${ch.label}.`);
                if (!HHMM_RE.test(r.endHHmm)) errs.push(`Horário de fim inválido para ${ch.label}.`);
            }
        }
        if (!Number.isFinite(policy.staleHours) || policy.staleHours < 1) errs.push('Ticket stale (horas) deve ser ≥ 1.');
        if (!Number.isFinite(policy.invoiceDueHorizonDays) || policy.invoiceDueHorizonDays < 0) errs.push('Fatura a vencer (dias) deve ser ≥ 0.');
        return errs;
    }, [policy]);

    const handleSave = async () => {
        if (!config) return;
        if (errors.length > 0) {
            toast.error(`Não foi possível salvar: ${errors[0]}`);
            return;
        }
        setSaving(true);
        try {
            const updated = await updateUiConfig({
                taskNotifications: config,
                taskNotificationsExternalEnabled: externalEnabled,
                notificationPolicy: policy,
            } as any);
            setConfig(updated.taskNotifications || config);
            setExternalEnabled(updated.taskNotificationsExternalEnabled === true);
            if (updated.notificationPolicy) setPolicy({ ...DEFAULT_POLICY, ...updated.notificationPolicy });
            toast.success('Notificações salvas com sucesso.');
        } catch (e: any) {
            toast.error(`Falha ao salvar: ${e?.response?.data?.error || e?.message || 'erro'}`);
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) return null;

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><Bell size={16} /> Notificações de Tarefas (Admin)</h3>}>
            <p className="text-sm text-slate-500 mb-4">
                Configure quais canais cada papel recebe para cada evento de tarefa.
                <strong> App</strong> é sempre entregue; <strong>WhatsApp/Email</strong> requer ativação abaixo.
            </p>

            {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
            ) : config ? (
                <>
                    {/* Toggle externo */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 mb-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {externalEnabled ? <Bell size={18} className="text-emerald-500" /> : <BellOff size={18} className="text-slate-400" />}
                                    Notificações externas (WhatsApp / E-mail)
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    {externalEnabled
                                        ? 'Ativo — notificações WhatsApp e Email serão enviadas conforme a matriz abaixo.'
                                        : 'Desativado — somente notificações in-app são entregues, mesmo que estejam marcadas abaixo.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                                <input
                                    type="checkbox"
                                    aria-label="Notificações externas (WhatsApp e E-mail)"
                                    checked={externalEnabled}
                                    onChange={(e) => setExternalEnabled(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                            </label>
                        </div>

                        {/* Aviso explícito ao habilitar */}
                        {externalEnabled && (
                            <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
                                <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-amber-700 dark:text-amber-300">
                                    <strong>Atenção:</strong> Habilitar este toggle fará o sistema enviar mensagens <strong>reais</strong> para o WhatsApp e e-mail de todos os usuários afetados pelas regras abaixo.
                                    Certifique-se de que os telefones estão cadastrados corretamente no Dolibarr antes de ativar.
                                </p>
                            </div>
                        )}

                        {/* Diagnóstico de telefones */}
                        <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                    <Phone size={13} />
                                    Diagnóstico: usuários sem telefone cadastrado
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleLoadDiag}
                                        disabled={diagLoading}
                                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium disabled:opacity-50"
                                    >
                                        <RefreshCw size={11} className={diagLoading ? 'animate-spin' : ''} />
                                        {diagLoading ? 'Carregando...' : 'Verificar'}
                                    </button>
                                    {diagResult && (
                                        <button
                                            type="button"
                                            onClick={() => setDiagOpen(o => !o)}
                                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                        >
                                            {diagOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {diagResult && (
                                <p className="text-xs mt-1 text-slate-500 dark:text-slate-400">
                                    <span className={diagResult.missingCount > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-emerald-600 dark:text-emerald-400 font-medium'}>
                                        {diagResult.missingCount} de {diagResult.total}
                                    </span>{' '}
                                    {diagResult.missingCount === 1 ? 'usuário ativo sem' : 'usuários ativos sem'} <code>phone_mobile</code> — não receberão WhatsApp.
                                </p>
                            )}
                            {diagResult && diagOpen && diagResult.users.length > 0 && (
                                <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-700">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800">
                                                <th className="text-left px-3 py-1.5 text-slate-400 font-medium">Login</th>
                                                <th className="text-left px-3 py-1.5 text-slate-400 font-medium">Nome</th>
                                                <th className="text-left px-3 py-1.5 text-slate-400 font-medium">E-mail</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {diagResult.users.map(u => (
                                                <tr key={u.id} className="border-t border-slate-100 dark:border-slate-800">
                                                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 font-mono">{u.login}</td>
                                                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{u.name || '—'}</td>
                                                    <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{u.email || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Legenda */}
                    <div className="flex gap-3 mb-3 flex-wrap">
                        {CHANNEL_META.map((ch) => (
                            <span key={ch.key} className="flex items-center gap-1 text-xs text-slate-500">
                                <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-white ${ch.color}`}>{ch.icon}</span>
                                {ch.label}
                            </span>
                        ))}
                    </div>

                    {/* Matriz */}
                    <div className="overflow-x-auto -mx-2 px-2">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr>
                                    <th className="text-left py-2 pr-3 text-xs font-bold text-slate-400 uppercase tracking-wider w-40">Evento</th>
                                    {ROLES.map((r) => (
                                        <th key={r.key} className="text-center py-2 px-1 text-xs font-bold text-slate-400 uppercase tracking-wider min-w-[120px]">
                                            {r.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {EVENTS.map((ev) => (
                                    <tr key={ev.key} className="border-t border-slate-100 dark:border-slate-800">
                                        <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-200 font-medium whitespace-nowrap">
                                            {ev.label}
                                        </td>
                                        {ROLES.map((role) => (
                                            <td key={role.key} className="py-2.5 px-1 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    {CHANNEL_META.map((ch) => {
                                                        const active = (config[ev.key][role.key] || []).includes(ch.key);
                                                        const isExternal = ch.key !== 'in-app';
                                                        const disabled = isExternal && !externalEnabled;
                                                        return (
                                                            <button
                                                                key={ch.key}
                                                                type="button"
                                                                title={`${ch.label}${disabled ? ' (canais externos desativados)' : ''}`}
                                                                disabled={disabled}
                                                                onClick={() => toggleChannel(ev.key, role.key, ch.key)}
                                                                className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                                                                    active
                                                                        ? `${ch.color} text-white shadow-sm`
                                                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                                                                } ${disabled && !active ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                            >
                                                                {ch.icon}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex justify-end mt-4">
                        <Button type="button" variant="primary" loading={saving} icon={<Save size={16} />} onClick={handleSave}>
                            Salvar notificações
                        </Button>
                    </div>

                    {/* ---- #1293: Política de notificações (cadência / quiet-hours / alertas) ---- */}
                    <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-700 space-y-4">
                        <h4 className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                            <Clock size={14} /> Política de notificações
                        </h4>

                        {/* 1. Cadência de cobrança */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                                <CalendarClock size={16} /> Cadência de cobrança
                            </div>
                            <p className="text-xs text-slate-500 mb-3">Controla lembretes, recobranças e escalações automáticas de tarefas atribuídas.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {CADENCE_FIELDS.map((f) => (
                                    <label key={f.key} className="text-xs text-slate-500 dark:text-slate-400">
                                        <span className="flex items-center gap-1" title={f.tip}>
                                            {f.label}
                                            <Info size={11} className="text-slate-300 dark:text-slate-600" />
                                        </span>
                                        <input
                                            type="number"
                                            min={f.min}
                                            max={f.max}
                                            aria-label={f.label}
                                            value={policy.cobrancaCadence[f.key]}
                                            onChange={(e) => setCadence(f.key, Number(e.target.value))}
                                            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* 2. Quiet-hours por canal */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                                <BellOff size={16} /> Quiet-hours por canal
                            </div>
                            <p className="text-xs text-slate-500 mb-3">
                                Silencia notificações do canal fora da janela informada. Se o fim for anterior ao início, a janela atravessa a meia-noite (ex.: 22:00 → 07:00).
                            </p>
                            <div className="space-y-3">
                                {QH_CHANNELS.map((ch) => {
                                    const r = policy.quietHours[ch.key];
                                    const crosses = HHMM_RE.test(r.startHHmm) && HHMM_RE.test(r.endHHmm) && r.endHHmm <= r.startHHmm;
                                    return (
                                        <div key={ch.key} className="rounded-lg border border-slate-100 dark:border-slate-700 p-3">
                                            <div className="flex items-center justify-between">
                                                <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded text-white bg-slate-500">{ch.icon}</span>
                                                    {ch.label}
                                                </span>
                                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Habilitar quiet-hours ${ch.label}`}
                                                        checked={r.enabled}
                                                        onChange={(e) => setQuiet(ch.key, { enabled: e.target.checked })}
                                                        className="sr-only peer"
                                                    />
                                                    <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                                                </label>
                                            </div>
                                            {r.enabled && (
                                                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 items-end">
                                                    <label className="text-xs text-slate-500 dark:text-slate-400">
                                                        Início
                                                        <input
                                                            type="time"
                                                            aria-label={`Início quiet-hours ${ch.label}`}
                                                            value={r.startHHmm}
                                                            onChange={(e) => setQuiet(ch.key, { startHHmm: e.target.value })}
                                                            className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100"
                                                        />
                                                    </label>
                                                    <label className="text-xs text-slate-500 dark:text-slate-400">
                                                        Fim
                                                        <input
                                                            type="time"
                                                            aria-label={`Fim quiet-hours ${ch.label}`}
                                                            value={r.endHHmm}
                                                            onChange={(e) => setQuiet(ch.key, { endHHmm: e.target.value })}
                                                            className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100"
                                                        />
                                                    </label>
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                                        <input
                                                            type="checkbox"
                                                            aria-label={`Apenas dias úteis quiet-hours ${ch.label}`}
                                                            checked={r.weekdaysOnly}
                                                            onChange={(e) => setQuiet(ch.key, { weekdaysOnly: e.target.checked })}
                                                            className="rounded border-slate-300"
                                                        />
                                                        Apenas dias úteis
                                                    </label>
                                                    {crosses && (
                                                        <p className="col-span-2 sm:col-span-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                                            <Info size={11} /> <span>Esta janela cruza a meia-noite.</span>
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 3. Alertas automáticos */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                                <AlertTriangle size={16} /> Alertas automáticos
                            </div>
                            <p className="text-xs text-slate-500 mb-3">Limiares dos alertas cron de fundo (tickets parados e faturas a vencer).</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1" title="Dispara alerta para tickets sem resposta após este tempo.">
                                        <Hourglass size={12} /> Ticket stale (horas)
                                        <Info size={11} className="text-slate-300 dark:text-slate-600" />
                                    </span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={720}
                                        aria-label="Ticket stale (horas)"
                                        value={policy.staleHours}
                                        onChange={(e) => setStaleHours(Number(e.target.value))}
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                                    />
                                </label>
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1" title="Horizonte de dias para o alerta de fatura a vencer.">
                                        <CalendarClock size={12} /> Fatura a vencer (dias)
                                        <Info size={11} className="text-slate-300 dark:text-slate-600" />
                                    </span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={365}
                                        aria-label="Fatura a vencer (dias)"
                                        value={policy.invoiceDueHorizonDays}
                                        onChange={(e) => setInvoiceHorizon(Number(e.target.value))}
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-100"
                                    />
                                </label>
                            </div>
                        </div>

                        {errors.length > 0 && (
                            <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2">
                                <AlertTriangle size={15} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                                <ul className="text-xs text-red-700 dark:text-red-300 list-disc list-inside">
                                    {errors.map((er, i) => <li key={i}>{er}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <p className="text-sm text-slate-400">Não foi possível carregar a configuração.</p>
            )}
        </Card>
    );
};

export default NotificationConfigEditor;
