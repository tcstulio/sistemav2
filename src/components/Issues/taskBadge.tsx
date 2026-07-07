/**
 * Helpers puros de BADGE da kanban de tasks (#1175).
 *
 * Extraídos de IssuesPage.tsx para serem testáveis isoladamente e reutilizados entre
 * o mini-card (pipeline) e o list-card. Três responsabilidades:
 *
 *  1. Cor do score do Judge contra o piso REAL (minMergeScore/minApproveScore da config),
 *     não hardcoded — com fallback sensato se a config não carregar.
 *  2. Sufixo de FASE no chip das tasks ativas (exploração/síntese/julgando).
 *  3. Display de status que separa "Aguardando você" (approved retido) de reviewing e do
 *     approved transitório (mergeando...).
 */
import React from 'react';
import { Clock, Loader2 } from 'lucide-react';
import type { Task, TaskPhase } from '../../services/taskService';

/** Defaults defensivos quando a ui-config não carrega (null/erro de rede). */
export const DEFAULT_MIN_MERGE_SCORE = 8;
export const DEFAULT_MIN_APPROVE_SCORE = 9;

/** Backend fixa 3 explorações e 3 sínteses por task no modo 'synthesis' (MAX_EXPLORE/MAX_SYNTH). */
export const MAX_EXPLORE = 3;
export const MAX_SYNTH = 3;

export interface ScoreThresholds {
    minMergeScore: number;
    minApproveScore: number;
}

/**
 * Resolve os pisos a partir de um pedaço qualquer de config. Aceita o `taskAutomation`
 * inteiro, um Partial, ou null — nunca lança; cai nos defaults se um campo não for número.
 */
export function resolveScoreThresholds(
    cfg?: { minMergeScore?: number; minApproveScore?: number } | null,
): ScoreThresholds {
    return {
        minMergeScore: typeof cfg?.minMergeScore === 'number' ? cfg.minMergeScore : DEFAULT_MIN_MERGE_SCORE,
        minApproveScore: typeof cfg?.minApproveScore === 'number' ? cfg.minApproveScore : DEFAULT_MIN_APPROVE_SCORE,
    };
}

export type ScoreTone = 'green' | 'amber' | 'red';

/**
 * Classifica o score contra o piso REAL:
 *  - verde  : score >= minMergeScore  (passa no gate de merge)
 *  - âmbar  : score >= minApproveScore - 1  (quase lá; abaixo do piso de merge)
 *  - vermelho: abaixo
 *
 * Verde tem prioridade sobre âmbar quando os intervalos se sobrepõem (regra do issue #1175).
 */
export function scoreTone(score: number, t: ScoreThresholds): ScoreTone {
    if (score >= t.minMergeScore) return 'green';
    if (score >= t.minApproveScore - 1) return 'amber';
    return 'red';
}

/** Classes Tailwind (texto solto) por tom — usado no mini-card (score sem pílula). */
export function scoreTextClasses(tone: ScoreTone): string {
    switch (tone) {
        case 'green': return 'text-green-600 dark:text-green-400';
        case 'amber': return 'text-amber-600 dark:text-amber-400';
        case 'red': return 'text-red-600 dark:text-red-400';
    }
}

/** Classes Tailwind (pílula com bg) por tom — usado no list-card. */
export function scoreBadgeClasses(tone: ScoreTone): string {
    switch (tone) {
        case 'green': return 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400';
        case 'amber': return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400';
        case 'red': return 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400';
    }
}

/** Tooltip nativo (title) do score: "8/10 — piso de merge: 9". */
export function scoreTooltip(score: number, t: ScoreThresholds): string {
    return `${score}/10 — piso de merge: ${t.minMergeScore}`;
}

/**
 * Sufixo de FASE para o chip das tasks running/fixing (#1175).
 * Devolve "exploração 2/3" | "síntese" (ou "síntese 2/3") | "julgando", ou null quando
 * não há fase aplicável (task não-ativa ou fase 'done'/ausente).
 *
 * - exploring: contagem = explorações já concluídas em task.attempts + 1 (a corrente), topo MAX_EXPLORE.
 * - synthesizing: usa task.synthesisAttempt quando disponível, topo MAX_SYNTH.
 */
export function phaseSuffix(task: Task): string | null {
    if (task.status !== 'running' && task.status !== 'fixing') return null;
    const phase: TaskPhase | undefined = task.phase;
    if (!phase || phase === 'done') return null;
    if (phase === 'judging') return 'julgando';
    if (phase === 'synthesizing') {
        const sa = typeof task.synthesisAttempt === 'number' ? task.synthesisAttempt : undefined;
        return sa ? `síntese ${Math.min(sa, MAX_SYNTH)}/${MAX_SYNTH}` : 'síntese';
    }
    // exploring
    const done = (task.attempts || []).filter(a => a.phase === 'exploring').length;
    const cur = Math.min(done + 1, MAX_EXPLORE);
    return `exploração ${cur}/${MAX_EXPLORE}`;
}

export interface CardStatusDisplay {
    color: string;
    bg: string;
    icon: React.ReactNode;
    label: string;
}

/**
 * Display de status do CARD que separa os três "pedidos ao humano" (#1175):
 *  - reviewing              → "Em Revisão" (Judge escalou p/ revisão humana do código)
 *  - approved + hold        → "Aguardando você" (aprovado mas RETIDO pelo piso/autoMergeOff)
 *  - approved (sem hold)    → "mergeando..." (transitório, auto-merge em curso)
 *
 * `baseConfig` é o mapa STATUS_CONFIG do IssuesPage (passado p/ evitar import circular e
 * redefinir labels/cores p/ os demais status).
 */
export function resolveCardStatusDisplay(
    task: Task,
    baseConfig: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }>,
): CardStatusDisplay {
    if (task.status === 'approved') {
        if (task.mergeHoldReason) {
            return {
                color: 'text-amber-700 dark:text-amber-300',
                bg: 'bg-amber-100 dark:bg-amber-900/30',
                icon: <Clock size={14} />,
                label: 'Aguardando você',
            };
        }
        return {
            color: 'text-emerald-600 dark:text-emerald-400',
            bg: 'bg-emerald-50 dark:bg-emerald-900/20',
            icon: <Loader2 size={14} className="animate-spin" />,
            label: 'mergeando...',
        };
    }
    const base = baseConfig[task.status] || baseConfig.pending;
    return {
        color: base.color,
        bg: base.bg,
        icon: base.icon,
        label: base.label,
    };
}

/** Label legível do motivo do hold p/ exibir sob o título (truncado pelo CSS no card). */
export function holdReasonLabel(task: Task): string | null {
    if (task.status !== 'approved' || !task.mergeHoldReason) return null;
    return task.mergeHoldReason;
}
