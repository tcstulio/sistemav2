import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Save, MessageSquare, Mail, Monitor } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { getUiConfig, updateUiConfig, TaskNotifEvent, TaskNotifRole, NotifChannel, TaskNotificationsConfig } from '../../services/uiConfigService';
import { logger } from '../../utils/logger';

const log = logger.child('NotificationConfigEditor');

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
    { key: 'interveniente', label: 'Interveniente' },
    { key: 'criador', label: 'Criador' },
];

const CHANNEL_META: { key: NotifChannel; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'in-app', label: 'App', icon: <Monitor size={13} />, color: 'bg-slate-500' },
    { key: 'whatsapp', label: 'WhatsApp', icon: <MessageSquare size={13} />, color: 'bg-emerald-500' },
    { key: 'email', label: 'Email', icon: <Mail size={13} />, color: 'bg-blue-500' },
];

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
            } catch (e) {
                log.error('Falha ao carregar config de notificações', e);
                toast.error('Falha ao carregar notificações.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin]);

    const toggleChannel = (event: TaskNotifEvent, role: TaskNotifRole, channel: NotifChannel) => {
        if (!config) return;
        const next = cloneConfig(config);
        const list = next[event][role];
        const idx = list.indexOf(channel);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(channel);
        setConfig(next);
    };

    const handleSave = async () => {
        if (!config) return;
        setSaving(true);
        try {
            const updated = await updateUiConfig({
                taskNotifications: config,
                taskNotificationsExternalEnabled: externalEnabled,
            } as any);
            setConfig(updated.taskNotifications || config);
            setExternalEnabled(updated.taskNotificationsExternalEnabled === true);
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
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between mb-4">
                        <div>
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                {externalEnabled ? <Bell size={18} className="text-emerald-500" /> : <BellOff size={18} className="text-slate-400" />}
                                Canais externos (WhatsApp / Email)
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
                                checked={externalEnabled}
                                onChange={(e) => setExternalEnabled(e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${themeColor}-600`}></div>
                        </label>
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
                </>
            ) : (
                <p className="text-sm text-slate-400">Não foi possível carregar a configuração.</p>
            )}
        </Card>
    );
};

export default NotificationConfigEditor;
