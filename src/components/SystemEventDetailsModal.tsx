import React, { ComponentType } from 'react';
import { AlertCircle, AlertTriangle, Clock, ExternalLink, Info, Tag } from 'lucide-react';
import { Modal, Button } from './ui';
import type { SystemEvent } from '../services/systemEventsService';
import type { AppView } from '../types';
import { formatDateTime, formatRelativeTime } from '../utils/dateUtils';
import { DELEG_TO_ROLE, SOURCE_META, resolveActorName, resolveEventTarget, resolveToName } from '../utils/systemEventUtils';

type IconType = ComponentType<{ size?: number; className?: string }>;

interface SystemEventDetailsModalProps {
    event: SystemEvent | null;
    userMap: Record<string, string>;
    onClose: () => void;
    onNavigate?: (view: AppView, id: string) => void;
}

const SEVERITY_META: Record<SystemEvent['severity'], { label: string; icon: IconType; cls: string }> = {
    error: { label: 'Erro', icon: AlertCircle, cls: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400' },
    warn: { label: 'Atenção', icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400' },
    info: { label: 'Informação', icon: Info, cls: 'text-slate-600 bg-slate-50 dark:bg-slate-800 dark:text-slate-400' },
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex gap-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
        <dt className="w-28 shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500 pt-0.5">{label}</dt>
        <dd className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-200 break-words">{children}</dd>
    </div>
);

const SystemEventDetailsModal: React.FC<SystemEventDetailsModalProps> = ({ event, userMap, onClose, onNavigate }) => {
    if (!event) return null;

    const meta = SOURCE_META[event.source];
    const SourceIcon = meta.icon;
    const sev = SEVERITY_META[event.severity];
    const SevIcon = sev.icon;
    const target = resolveEventTarget(event);
    const ts = Date.parse(event.timestamp);

    const handleNavigate = () => {
        if (target && onNavigate) {
            onNavigate(target.view, target.id);
            onClose();
        }
    };

    const extraMeta = Object.entries(event.metadata || {}).filter(([k]) => k !== 'to' && k !== 'objetivo');

    return (
        <Modal
            isOpen={!!event}
            onClose={onClose}
            size="lg"
            title={
                <span className="flex items-center gap-2">
                    <span className={`p-1.5 rounded-lg ${meta.dot} text-white`}><SourceIcon size={16} /></span>
                    {meta.label}
                </span>
            }
            footer={
                <>
                    {target && onNavigate && (
                        <Button variant="primary" icon={<ExternalLink size={16} />} onClick={handleNavigate}>
                            Abrir registro
                        </Button>
                    )}
                    <Button variant="secondary" onClick={onClose}>Fechar</Button>
                </>
            }
        >
            <div>
                <p className="text-base text-slate-800 dark:text-white font-medium leading-relaxed mb-3 break-words">
                    {event.description}
                </p>

                <div className="flex flex-wrap gap-2 mb-4">
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${sev.cls}`}><SevIcon size={11} /> {sev.label}</span>
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full text-white ${meta.dot}`}>{meta.label}</span>
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 font-mono">
                        <Tag size={10} /> {event.type}
                    </span>
                    {event.status && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">{event.status}</span>
                    )}
                </div>

                <dl>
                    <Field label="Ator">{resolveActorName(event, userMap)}</Field>
                    <Field label="Quando">
                        <span className="inline-flex items-center gap-1.5">
                            <Clock size={13} className="text-slate-400" />
                            <span>{formatDateTime(ts)}</span>
                            <span className="text-xs text-slate-400">· {formatRelativeTime(ts)}</span>
                        </span>
                    </Field>
                    {(event.entityType || event.entityId) && (
                        <Field label="Entidade">
                            {event.entityType ? event.entityType : ''}
                            {event.entityId ? ` #${event.entityId}` : ''}
                        </Field>
                    )}
                    {event.linkTo && <Field label="Link">{event.linkTo}</Field>}
                    {event.metadata?.to && (
                        <Field label="Destinatário">
                            {resolveToName(event.metadata.to, userMap)}{DELEG_TO_ROLE[event.type] ? ` (${DELEG_TO_ROLE[event.type]})` : ''}
                        </Field>
                    )}
                    {event.metadata?.objetivo && <Field label="Objetivo">{event.metadata.objetivo}</Field>}
                    {extraMeta.length > 0 && (
                        <Field label="Detalhes">
                            <pre className="text-xs bg-slate-50 dark:bg-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(Object.fromEntries(extraMeta), null, 2)}</pre>
                        </Field>
                    )}
                </dl>
            </div>
        </Modal>
    );
};

export default SystemEventDetailsModal;
