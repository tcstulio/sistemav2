/**
 * Helpers puros de AGRUPAMENTO épica→subtasks (#1178).
 *
 * Extraídos de IssuesPage.tsx para serem testáveis isoladamente (mesmo padrão de
 * taskBadge.tsx). Três responsabilidades:
 *
 *  1. Dizer se uma task é uma épica (kind === 'epic').
 *  2. Resolver as subtasks de uma épica — priorizando `task.subTasks` (lista canônica
 *     gerada pelo decompose no backend) e, se ausente, derivando do back-reference
 *     `parentEpic` (defesa em profundidade).
 *  3. Calcular o progresso AGREGADO de uma épica contando APENAS as suas subtasks
 *     (merged/total + breakdown por fase), mais uma barra de progresso reaproveitável.
 *
 * INVARIANTE de contagem: o progresso de uma épica conta estritamente as suas subtasks
 * (jamais tasks de outra épica ou órfãs). Isso é o critério de aceite #1178.
 */
import React from 'react';
import type { Task } from '../../services/taskService';

/** Verdadeiro quando a task é a ponta (container) de uma épica. */
export function isEpic(task: Task): boolean {
    return task.kind === 'epic';
}

/** Status ativos da esteira (não-pending, não-terminais). */
const ACTIVE_STATUSES = new Set(['running', 'fixing', 'reviewing', 'approved', 'cancelling']);
/** Status terminais que NÃO são merged — contam como insucesso no agregado. */
const FAILED_STATUSES = new Set(['rejected', 'rejected_precheck', 'failed', 'cancelled']);

export interface EpicProgress {
    total: number;
    merged: number;
    inProgress: number;
    failed: number;
    pending: number;
    /** 0..100 — fração de subtasks merged. 0 quando a épica não tem subtasks. */
    percent: number;
}

/** Conta o progresso a partir de uma lista já resolvida de subtasks. */
export function progressFromSubtasks(subs: Task[]): EpicProgress {
    let merged = 0;
    let inProgress = 0;
    let failed = 0;
    let pending = 0;
    for (const s of subs) {
        if (s.status === 'merged') merged++;
        else if (ACTIVE_STATUSES.has(s.status)) inProgress++;
        else if (FAILED_STATUSES.has(s.status)) failed++;
        else pending++; // 'pending' (e qualquer status novo/desconhecido cai aqui)
    }
    const total = subs.length;
    return {
        total,
        merged,
        inProgress,
        failed,
        pending,
        percent: total ? Math.round((merged / total) * 100) : 0,
    };
}

/**
 * Resolve as subtasks de uma épica.
 *
 * Prioriza `epic.subTasks` (lista canônica do backend, saída do decompose). Se a épica
 * não traz essa lista, deriva do back-reference `parentEpic` — robustez para registros
 * antigos ou criados fora do fluxo de decomposição.
 *
 * Preserva a ORDEM de `epic.subTasks` (a ordem planejada); no fallback, ordena por
 * issueNumber p/ saída estável.
 */
export function getEpicSubtasks(epic: Task, allTasks: Task[]): Task[] {
    const ids = epic.subTasks && epic.subTasks.length > 0 ? epic.subTasks : null;
    if (ids) {
        const byNum = new Map<number, Task>();
        for (const t of allTasks) byNum.set(t.issueNumber, t);
        const out: Task[] = [];
        for (const id of ids) {
            const t = byNum.get(id);
            if (t) out.push(t);
        }
        return out;
    }
    return allTasks
        .filter(t => t.parentEpic === epic.issueNumber)
        .sort((a, b) => a.issueNumber - b.issueNumber);
}

/** Atalho: resolve as subtasks e já calcula o progresso agregado. */
export function computeEpicProgress(epic: Task, allTasks: Task[]): EpicProgress {
    return progressFromSubtasks(getEpicSubtasks(epic, allTasks));
}

/**
 * Barra de progresso agregada reaproveitável entre o list-card (cheia) e o mini-card
 * (compacta) da épica. Cor reflete o andamento: completa=verde, parcial=índigo, vazia=cinza.
 */
export const EpicProgressBar: React.FC<{ progress: EpicProgress; compact?: boolean }> = ({ progress, compact }) => {
    const { percent, merged, total } = progress;
    const tone = percent >= 100
        ? 'bg-emerald-500'
        : percent > 0
            ? 'bg-indigo-500'
            : 'bg-slate-300 dark:bg-slate-600';
    return (
        <div className="w-full" data-testid="epic-progress-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso da épica: ${merged} de ${total} subtasks merged`}>
            <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
                <div className={`flex-1 ${compact ? 'h-1.5' : 'h-2'} rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden`}>
                    <div className={`${tone} h-full rounded-full transition-all`} style={{ width: `${percent}%` }} />
                </div>
                <span className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-mono text-slate-500 dark:text-slate-400 shrink-0`}>
                    {merged}/{total}
                </span>
            </div>
        </div>
    );
};
