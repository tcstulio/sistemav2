// #1179: helpers de UI compartilhados entre IssuesPage e TaskHistoryModal (extraído para
// permitir testar o modal de forma ISOLADA, sem montar a página inteira). Pura UI estática:
// o mapeamento de status -> cor/ícone/label e o formato do timestamp de desfecho.
import React from 'react';
import { AlertCircle, Clock, Eye, GitMerge, Loader2, ShieldOff, ThumbsUp, XCircle } from 'lucide-react';

/** Formata o timestamp de desfecho de uma task para exibição compacta. */
export const formatOutcomeTime = (
    status: string,
    task: { completedAt?: string; updatedAt: string }
): string | null => {
    const OUTCOME_STATUSES = ['merged', 'rejected', 'rejected_precheck', 'cancelled', 'failed'];
    if (!OUTCOME_STATUSES.includes(status)) return null;
    const raw = task.completedAt || task.updatedAt;
    if (!raw) return null;
    const d = new Date(raw);
    const label: Record<string, string> = {
        merged: 'Merge',
        rejected: 'Rejeitada',
        rejected_precheck: 'Rejeitada',
        cancelled: 'Cancelada',
        failed: 'Falhou',
    };
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${label[status] ?? status} ${time}`;
};

export const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
    pending: { color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', icon: <Clock size={14} />, label: 'Pendente' },
    running: { color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Executando' },
    fixing: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Corrigindo' },
    reviewing: { color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', icon: <Eye size={14} />, label: 'Em Revisão' },
    approved: { color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', icon: <ThumbsUp size={14} />, label: 'Aprovado' },
    merged: { color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: <GitMerge size={14} />, label: 'Merged' },
    rejected: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: <XCircle size={14} />, label: 'Rejeitado' },
    rejected_precheck: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: <ShieldOff size={14} />, label: 'Rejeitado (pre-check)' },
    failed: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: <AlertCircle size={14} />, label: 'Falhou' },
    cancelling: { color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', icon: <Loader2 size={14} className="animate-spin" />, label: 'Cancelando...' },
    cancelled: { color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', icon: <XCircle size={14} />, label: 'Cancelada' },
};


