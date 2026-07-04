/**
 * Filtro de período para a página de Issues/Tasks (#983).
 *
 * A página acumulava milhares de issues/tasks já concluídas. O período escopa
 * o que é "concluído" por data — o trabalho ativo (issues abertas / tasks em
 * andamento) continua sempre visível. Padrão do front = "Hoje".
 *
 * O filtro é aplicado server-side para issues: quando um período está ativo,
 * ampliamos o --limit do `gh issue list` para capturar issues fechadas
 * recentemente antes de filtrar por closedAt (evita perder o trabalho do dia
 * caso as primeiras N posições já sejam antigas).
 */

/** Valores canônicos de período aceitos pelo backend. */
export type IssuePeriod = 'today' | '1' | '5' | '7' | '30' | 'all';

const VALID_PERIODS: ReadonlySet<string> = new Set(['today', '1', '5', '7', '30', 'all']);

/**
 * Limite ampliado usado quando um período está ativo.
 * Garante que busquemos issues fechadas recentemente mesmo que existam muitas
 * abertas (ou antigas) ocupando as primeiras posições do `gh issue list`.
 */
export const ISSUE_PERIOD_FETCH_LIMIT = 200;

/**
 * Normaliza o valor cru recebido via query string para um período canônico.
 * Qualquer valor inválido/ausente vira 'all' (sem filtro).
 */
export function normalizePeriod(raw: unknown): IssuePeriod {
    if (typeof raw === 'string' && VALID_PERIODS.has(raw)) {
        return raw as IssuePeriod;
    }
    return 'all';
}

/** Converte um período em número de dias (rolling window). 'today' = 1; 'all' = null. */
function periodToDays(period: IssuePeriod): number | null {
    switch (period) {
        case 'today':
        case '1':
            return 1;
        case '5':
            return 5;
        case '7':
            return 7;
        case '30':
            return 30;
        case 'all':
        default:
            return null;
    }
}

/**
 * Início do dia de calendário atual (meia-noite, horário local) como timestamp.
 * Usado para "Hoje" — reflete "o que foi realizado no dia" (reset à meia-noite).
 */
function startOfToday(now: Date): number {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * Verdadeiro se `dateStr` cai dentro do período selecionado (ou período = "Tudo").
 * - 'today': desde a meia-noite de hoje (dia de calendário).
 * - 'N' dias: janela móvel de N*24h.
 * - 'all': sempre verdadeiro.
 *
 * Retorna `true` quando `dateStr` é ausente/nula apenas para 'all'; nos demais
 * casos sem data o item é considerado fora do período (ex.: issue fechada sem
 * closedAt não deve aparecer num recorte temporal).
 */
export function withinPeriod(dateStr: string | null | undefined, period: IssuePeriod, now: Date = new Date()): boolean {
    if (period === 'all') return true;
    if (!dateStr) return false;

    const ts = new Date(dateStr).getTime();
    if (Number.isNaN(ts)) return false;

    if (period === 'today') {
        return ts >= startOfToday(now);
    }

    const days = periodToDays(period);
    if (days === null) return true;
    const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
    return ts >= cutoff;
}

interface IssueLike {
    state?: string;
    closedAt?: string | null;
}

/**
 * Filtra uma lista de issues pelo período.
 *
 * Issues **abertas** sempre passam (trabalho em andamento é sempre relevante).
 * Apenas as **fechadas** são escopadas pelo período via `closedAt`.
 */
export function filterIssuesByPeriod<T extends IssueLike>(issues: T[], period: IssuePeriod, now: Date = new Date()): T[] {
    if (period === 'all') return issues;
    return issues.filter((i) => {
        const isOpen = i.state ? i.state.toLowerCase() === 'open' : false;
        if (isOpen) return true;
        return withinPeriod(i.closedAt ?? undefined, period, now);
    });
}
