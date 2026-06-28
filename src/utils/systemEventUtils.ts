import type { ComponentType } from 'react';
import { Activity, Bot, Bell, CalendarClock, CheckCircle, Cpu, ShieldCheck, Users } from 'lucide-react';
import type { AppView } from '../types';
import { getEntityLink } from './navigationUtils';
import type { SystemEvent, SystemEventSource } from '../services/systemEventsService';

type IconType = ComponentType<{ size?: number; className?: string }>;

export const SOURCE_META: Record<SystemEventSource, { label: string; icon: IconType; dot: string }> = {
    audit: { label: 'Auditoria', icon: ShieldCheck, dot: 'bg-rose-500' },
    agent: { label: 'Agente', icon: Bot, dot: 'bg-purple-500' },
    delegation: { label: 'Delegação', icon: Users, dot: 'bg-blue-500' },
    notification: { label: 'Notificações', icon: Bell, dot: 'bg-amber-500' },
    scheduler: { label: 'Agendador', icon: CalendarClock, dot: 'bg-cyan-500' },
    approval: { label: 'Aprovações', icon: CheckCircle, dot: 'bg-emerald-500' },
    task: { label: 'Tasks', icon: Cpu, dot: 'bg-indigo-500' },
    dolibarr: { label: 'Agenda (Dolibarr)', icon: Activity, dot: 'bg-slate-500' },
};

export const DELEG_TO_ROLE: Record<string, string> = {
    requested: 'Responsável', cobranca: 'Responsável', reminder: 'Responsável',
    escalated: 'Solicitante', completed: 'Solicitante',
};

export function resolveActorName(ev: SystemEvent, userMap: Record<string, string>): string {
    if (userMap[ev.actor.id]) return userMap[ev.actor.id];
    const name = ev.actor.name;
    if (name && name !== 'unknown' && !/^\d+$/.test(name)) return name;
    return userMap[name] || 'Sistema';
}

export function resolveToName(to: string | number, userMap: Record<string, string>): string {
    const key = String(to);
    return userMap[key] || `#${key}`;
}

export function resolveEventTarget(e: SystemEvent): { view: AppView; id: string } | null {
    if (e.linkTo && e.linkTo.includes('/')) {
        const [view, id] = e.linkTo.split('/');
        if (view) return { view: view as AppView, id: id || '' };
    }
    if (e.entityType && e.entityId) {
        return getEntityLink(e.entityType, e.entityId);
    }
    return null;
}
