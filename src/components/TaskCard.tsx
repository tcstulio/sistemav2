import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import type { Task, PrecheckReport, PrecheckVerdict } from '../types';

/**
 * TaskCard — superfície visual do pre-check de tasks (issue #972 / #1017).
 *
 * Expõe subcomponentes focados em apresentação para que possam ser reutilizados
 * tanto na lista de tasks quanto no kanban:
 *  - {@link TaskPrecheckBadge}: badge ao lado do título (veredito != 'ok').
 *  - {@link TaskPrecheckAnalysis}: seção expansível "Análise prévia" com evidence[].
 *  - {@link TaskRejectedBanner}: banner destacado para status `rejected_precheck`.
 */

interface VerdictBadgeConfig {
    label: string;
    icon: string;
    classes: string;
    description: string;
}

/** Configuração visual por veredito (cores/ícones distintos). */
export const VERDICT_CONFIG: Record<Exclude<PrecheckVerdict, 'ok'>, VerdictBadgeConfig> = {
    duplicate: {
        label: 'Duplicado',
        icon: '🔁',
        classes:
            'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
        description: 'Esta task pode ser uma duplicata de outro item já existente.',
    },
    already_resolved: {
        label: 'Já resolvido',
        icon: '✅',
        classes:
            'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
        description: 'O pre-check encontrou commits/PRs que podem ter resolvido esta task.',
    },
    false_report: {
        label: 'Sem evidência',
        icon: '⚠️',
        classes:
            'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
        description: 'Nenhum erro correspondente foi encontrado nos logs analisados.',
    },
    low_evidence: {
        label: 'Baixa evidência',
        icon: '🤔',
        classes:
            'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
        description: 'Há pouca evidência para confirmar ou negar esta task.',
    },
};

/** Indica se a task foi rejeitada automaticamente pelo pre-check. */
export const isRejectedPrecheck = (task: Task): boolean => {
    return String(task.status ?? task.statut ?? '') === 'rejected_precheck';
};

interface TaskPrecheckBadgeProps {
    report?: PrecheckReport | null;
    /** Callback disparado ao clicar em "Ver originais" (veredito duplicate). */
    onOpenOriginal?: (report: PrecheckReport) => void;
}

/**
 * Badge clicável que resume o veredito do pre-check. Ao clicar, abre um
 * popover/tooltip com a explicação, as evidências e os links relevantes.
 *
 * Retorna `null` quando não há relatório ou o veredito é 'ok' (sem regressão).
 */
export const TaskPrecheckBadge: React.FC<TaskPrecheckBadgeProps> = ({ report, onOpenOriginal }) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handlePointer = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handlePointer);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handlePointer);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [open]);

    if (!report || report.verdict === 'ok') return null;
    const config = VERDICT_CONFIG[report.verdict];
    if (!config) return null;

    const evidence = report.evidence ?? [];
    const badgeText = `${config.icon} ${config.label}`;

    return (
        <div className="relative inline-block shrink-0" ref={containerRef}>
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={badgeText}
                title={config.description}
                className={`inline-flex items-center gap-1 text-[11px] leading-none font-semibold px-2 py-0.5 rounded-full border cursor-pointer transition-colors hover:opacity-90 ${config.classes}`}
            >
                <span aria-hidden="true">{config.icon}</span>
                <span>{config.label}</span>
            </button>

            {open && (
                <div
                    role="tooltip"
                    data-testid="precheck-popover"
                    className="absolute left-0 z-30 mt-1 w-72 max-w-[80vw] p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl text-xs space-y-2"
                >
                    <p className="font-semibold text-slate-900 dark:text-white">
                        <span aria-hidden="true" className="mr-1">{config.icon}</span>
                        {config.label}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">
                        {report.reason || config.description}
                    </p>

                    {evidence.length > 0 && (
                        <ul className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                            {evidence.map((ev, idx) => (
                                <li
                                    key={`${ev.type}-${idx}`}
                                    className="border-l-2 border-slate-200 dark:border-slate-700 pl-2"
                                >
                                    <p className="font-medium text-slate-700 dark:text-slate-200">
                                        {ev.type}
                                        {ev.reference ? <span className="text-slate-400"> · {ev.reference}</span> : null}
                                    </p>
                                    {ev.snippet && (
                                        <blockquote className="mt-0.5 italic text-slate-500 dark:text-slate-400 line-clamp-3">
                                            “{ev.snippet}”
                                        </blockquote>
                                    )}
                                    {ev.url && (
                                        <a
                                            href={ev.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 mt-0.5 text-indigo-600 dark:text-indigo-400 hover:underline"
                                        >
                                            abrir <ExternalLink className="h-3 w-3" />
                                        </a>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {report.verdict === 'duplicate' && (
                        <button
                            type="button"
                            onClick={() => onOpenOriginal?.(report)}
                            className="mt-1 w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors"
                        >
                            Ver originais
                        </button>
                    )}

                    {report.verdict === 'already_resolved' && report.original_url && (
                        <a
                            href={report.original_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline"
                        >
                            Ver resolução <ExternalLink className="h-3 w-3" />
                        </a>
                    )}
                </div>
            )}
        </div>
    );
};

interface TaskPrecheckAnalysisProps {
    report?: PrecheckReport | null;
    /** Controla o estado aberto/fechado externamente (opcional). */
    defaultOpen?: boolean;
}

/**
 * Seção expansível "Análise prévia" listando as evidências (tipo/referência/trecho)
 * que fundamentaram o veredito do pre-check.
 */
export const TaskPrecheckAnalysis: React.FC<TaskPrecheckAnalysisProps> = ({ report, defaultOpen = false }) => {
    const [expanded, setExpanded] = useState(defaultOpen);

    if (!report || report.verdict === 'ok') return null;
    const evidence = report.evidence ?? [];
    if (evidence.length === 0) return null;

    return (
        <div data-testid="precheck-analysis" className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                aria-expanded={expanded}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                Análise prévia ({evidence.length})
            </button>

            {expanded && (
                <ul className="mt-1.5 space-y-1.5">
                    {evidence.map((ev, idx) => (
                        <li
                            key={`${ev.type}-${idx}`}
                            data-testid="precheck-evidence"
                            className="rounded-md bg-slate-50 dark:bg-slate-800/60 p-2 border border-slate-100 dark:border-slate-800"
                        >
                            <p className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                {ev.type}
                                {ev.reference ? (
                                    <span className="text-slate-400"> · {ev.reference}</span>
                                ) : null}
                            </p>
                            {ev.snippet && (
                                <p className="mt-0.5 text-[11px] italic text-slate-500 dark:text-slate-400 line-clamp-3">
                                    {ev.snippet}
                                </p>
                            )}
                            {ev.url && (
                                <a
                                    href={ev.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 mt-0.5 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                    abrir <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

interface TaskRejectedBannerProps {
    task: Task;
    /** Callback para abrir o item original (opcional). */
    onOpenOriginal?: () => void;
}

/**
 * Banner destacado exibido quando a task foi rejeitada automaticamente
 * pelo pre-check (status `rejected_precheck`).
 */
export const TaskRejectedBanner: React.FC<TaskRejectedBannerProps> = ({ task, onOpenOriginal }) => {
    if (!isRejectedPrecheck(task)) return null;

    const report = task.precheck_report;
    const reason =
        report?.verdict === 'duplicate'
            ? 'duplicado'
            : report?.verdict === 'already_resolved'
                ? 'já resolvido'
                : 'rejeitada pelo pre-check';

    return (
        <div
            role="alert"
            data-testid="precheck-rejected-banner"
            className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200"
        >
            <span>
                Esta task foi rejeitada automaticamente pelo pre-check por ser {reason}.
            </span>
            {(report?.original_url || onOpenOriginal) && (
                <a
                    href={report?.original_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={onOpenOriginal}
                    className="font-semibold underline hover:text-amber-900 dark:hover:text-amber-100"
                >
                    Abrir original
                </a>
            )}
        </div>
    );
};

export default TaskPrecheckBadge;
