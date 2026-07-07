// #1179: projeção ENXUTA de Task para o GET /api/tasks.
//
// Modulo ISOLADO e puro (sem side-effects / sem instanciar o singleton taskRunnerService):
// usa `import type` (apagado em runtime) p/ o tipo Task. Assim pode ser unit-testado e
// importado pelas rotas SEM disparar o load do store / timers / sweep de processos.
import type { Task } from './taskRunnerService';

// Limites de truncamento p/ a listagem. O array `events` é devolvido on-demand via
// GET /api/tasks/:issueNumber/events; `body`/`judgeReview` sao truncados p/ evitar campos
// gigantes no payload do board (~400 tasks a cada ~10s de polling).
export const LIST_BODY_MAX_CHARS = 500;
export const LIST_JUDGE_REVIEW_MAX_CHARS = 300;

function truncateForList(value: string | undefined, max: number): string | undefined {
    if (value === undefined) return undefined;
    if (value.length <= max) return value;
    return value.slice(0, max) + '…';
}

/** Forma ENXUTA de uma task devolvida pelo GET /api/tasks (sem o array `events`). */
export type TaskListItem = Omit<
    Task,
    'events' | 'cpuMemSamples' | 'baselineErrors' | 'baselineGlobals'
> & {
    eventsCount: number;
};

/**
 * Projeta uma Task na forma ENXUTA da listagem (#1179): omite o array `events` (pesado —
 * devolvido on-demand via /events) e campos internos volumosos (`cpuMemSamples`, baseline de
 * tsc — so usados pelo backend), truncando `body` (~500) e `judgeReview` (~300). Inclui
 * `eventsCount` p/ a UI saber que ha uma timeline disponivel.
 */
export function toTaskListItem(task: Task): TaskListItem {
    const eventsCount = (task.events && task.events.length) || 0;
    const { events, cpuMemSamples, baselineErrors, baselineGlobals, ...rest } = task;
    return {
        ...rest,
        body: truncateForList(task.body, LIST_BODY_MAX_CHARS) ?? '',
        judgeReview: truncateForList(task.judgeReview, LIST_JUDGE_REVIEW_MAX_CHARS),
        eventsCount,
    };
}
