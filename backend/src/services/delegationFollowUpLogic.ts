/**
 * Lógica pura do motor de acompanhamento de delegações (Fase 1d) — SEM I/O.
 *
 * Para cada tarefa em aberto, decide a próxima ação por REGRAS (cadência):
 *   - lembra 1 dia antes do prazo            -> evento 'deadline_reminder' (Responsável)
 *   - cobra no vencimento                    -> evento 'overdue'           (Responsável)
 *   - re-cobra a cada N dias                 -> evento 'overdue'           (Responsável)
 *   - escala ao solicitante após K cobranças -> evento 'stalled'          (Criador)
 *   - reporta a conclusão                    -> evento 'completed'         (Criador)
 *
 * Os eventos mapeiam direto para a matriz [evento × papel × canal] da camada 2
 * (dispatchTaskNotification), então quem-recebe-o-quê continua configurável.
 *
 * Propriedade de rollout seguro: na PRIMEIRA observação de uma tarefa cria-se apenas
 * o baseline (event=null) — nada dispara. Só transições subsequentes geram ação,
 * evitando um flood retroativo no primeiro tick após o deploy.
 */

export type FollowUpEvent = 'deadline_reminder' | 'overdue' | 'stalled' | 'completed';

export interface FollowUpTask {
    id: string | number;
    date_end?: string | number | null; // unix (segundos)
    progress?: string | number | null; // 0..100
    fk_user_creat?: string | number | null;
}

export interface TaskTracking {
    cobrancas: number;               // nº de cobranças enviadas no ciclo atual
    lastCobrancaDay?: number;        // day index da última cobrança
    remindedForDay?: number;         // day index do prazo p/ o qual já lembramos
    escalated: boolean;              // já escalou ao solicitante neste ciclo?
    reportedDone: boolean;           // já reportou a conclusão?
    progressAtLastCobranca?: number; // progresso na última cobrança/baseline (detecta avanço)
}

export interface Cadence {
    reminderDaysBefore: number;     // janela do lembrete antes do prazo
    recobrancaIntervalDays: number; // intervalo entre re-cobranças
    escalateAfterCobrancas: number; // nº de cobranças sem progresso antes de escalar
}

export const DEFAULT_CADENCE: Cadence = {
    reminderDaysBefore: 1,
    recobrancaIntervalDays: 2,
    escalateAfterCobrancas: 3,
};

export const DAY_MS = 86400000;

/** Índice de dia (UTC) de um timestamp em ms. */
export function dayIndex(ms: number): number {
    return Math.floor(ms / DAY_MS);
}

function num(v: unknown): number {
    const n = parseFloat(String(v ?? ''));
    return isNaN(n) ? 0 : n;
}

export interface FollowUpDecision {
    event: FollowUpEvent | null;
    tracking: TaskTracking;
}

/** Estado inicial ao observar a tarefa pela 1ª vez (não dispara nada). */
export function freshTracking(progress: number, done: boolean): TaskTracking {
    return {
        cobrancas: 0,
        escalated: false,
        reportedDone: done, // se já estava concluída, não reporta retroativamente
        progressAtLastCobranca: progress,
    };
}

/**
 * Decide a próxima ação para UMA tarefa, dado seu estado anterior e o "agora".
 * `todayMs` é injetado (função pura/testável).
 */
export function decideFollowUp(
    task: FollowUpTask,
    prev: TaskTracking | undefined,
    todayMs: number,
    cadence: Cadence = DEFAULT_CADENCE,
): FollowUpDecision {
    const progress = num(task.progress);
    const done = progress >= 100;
    const todayDay = dayIndex(todayMs);

    // 1ª observação -> só baseline.
    if (!prev) {
        return { event: null, tracking: freshTracking(progress, done) };
    }

    // Conclusão -> reporta uma única vez ao solicitante.
    if (done) {
        if (!prev.reportedDone) {
            return { event: 'completed', tracking: { ...prev, reportedDone: true } };
        }
        return { event: null, tracking: prev };
    }

    const dueSec = num(task.date_end);
    if (!dueSec) {
        return { event: null, tracking: prev }; // sem prazo -> sem ação temporal
    }
    const dueDay = dayIndex(dueSec * 1000);
    const daysUntil = dueDay - todayDay;

    // Antes (ou no dia) do prazo: lembrete único dentro da janela.
    if (daysUntil >= 0) {
        if (daysUntil <= cadence.reminderDaysBefore && prev.remindedForDay !== dueDay) {
            return { event: 'deadline_reminder', tracking: { ...prev, remindedForDay: dueDay } };
        }
        return { event: null, tracking: prev };
    }

    // Atrasada. Avanço de progresso desde a última cobrança -> reinicia o ciclo de escalonamento.
    let cobrancas = prev.cobrancas;
    let escalated = prev.escalated;
    let progressBaseline = prev.progressAtLastCobranca;
    if (progressBaseline !== undefined && progress > progressBaseline) {
        cobrancas = 0;
        escalated = false;
    }

    // Escalonamento: após K cobranças sem progresso, escala ao solicitante (uma vez por ciclo).
    if (cobrancas >= cadence.escalateAfterCobrancas && !escalated) {
        return { event: 'stalled', tracking: { ...prev, cobrancas, escalated: true, progressAtLastCobranca: progressBaseline } };
    }

    // Cobrança: 1ª no vencimento; re-cobra a cada recobrancaIntervalDays.
    const daysSinceLast = prev.lastCobrancaDay === undefined ? Infinity : todayDay - prev.lastCobrancaDay;
    if (daysSinceLast >= cadence.recobrancaIntervalDays) {
        return {
            event: 'overdue',
            tracking: {
                ...prev,
                cobrancas: cobrancas + 1,
                lastCobrancaDay: todayDay,
                escalated,
                progressAtLastCobranca: progress,
            },
        };
    }

    // Nada a fazer agora; persiste eventual reinício de ciclo.
    return { event: null, tracking: { ...prev, cobrancas, escalated, progressAtLastCobranca: progressBaseline } };
}
