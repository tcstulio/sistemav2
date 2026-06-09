/**
 * Helpers puros (testáveis) para passos/sub-tarefas de uma delegação.
 * A barra de progresso da delegação-mãe é a média do progresso das filhas
 * (fk_parent === maeId) — agregação feita no frontend (o custom_sync não agrega tarefas).
 */

export interface ProgressChild {
    fk_parent?: string | number | null;
    progress?: number | string | null;
}

/** Sub-tarefas (passos) de uma tarefa-mãe. */
export function childrenOf<T extends { fk_parent?: string | number | null }>(tasks: T[], parentId: string | number): T[] {
    const pid = String(parentId);
    return (tasks || []).filter((t) => t.fk_parent !== undefined && t.fk_parent !== null && String(t.fk_parent) === pid);
}

/** Progresso agregado (média arredondada) das filhas. null quando não há passos. */
export function aggregateProgress(children: ProgressChild[]): number | null {
    if (!children || children.length === 0) return null;
    const sum = children.reduce((s, c) => s + (Number(c.progress) || 0), 0);
    return Math.round(sum / children.length);
}
