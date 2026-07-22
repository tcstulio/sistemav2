// Resolve um atalho de período ("this_week", "today"...) para um intervalo de datas
// concreto (YYYY-MM-DD), calculado a partir do RELÓGIO DO SERVIDOR. Existe porque pedir
// pro LLM calcular "essa semana" (datas + fuso) é frágil: o agente passa `period` e o
// backend devolve o range exato. Semana = segunda→domingo. Pura (recebe `now`) → testável.

const pad = (n: number): string => String(n).padStart(2, '0');
const fmt = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** Segunda-feira da semana de `d` (00:00 local). */
const startOfWeek = (d: Date): Date => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (x.getDay() + 6) % 7; // 0=segunda ... 6=domingo
    return addDays(x, -dow);
};

export interface EventPeriodRange { dateStart?: string; dateEnd?: string; }

/**
 * period (case-insensitive, aceita PT/EN):
 *   today/hoje, tomorrow/amanha, this_week/semana, next_week, this_month/mes, next_month.
 * Desconhecido → {} (sem filtro).
 */
export function resolveEventPeriod(period: string, now: Date): EventPeriodRange {
    switch (String(period || '').toLowerCase().trim()) {
        case 'today': case 'hoje':
            return { dateStart: fmt(now), dateEnd: fmt(now) };
        case 'tomorrow': case 'amanha': case 'amanhã': {
            const t = addDays(now, 1);
            return { dateStart: fmt(t), dateEnd: fmt(t) };
        }
        case 'this_week': case 'week': case 'semana': case 'esta_semana': case 'essa_semana': {
            const s = startOfWeek(now);
            return { dateStart: fmt(s), dateEnd: fmt(addDays(s, 6)) };
        }
        case 'next_week': case 'proxima_semana': case 'próxima_semana': {
            const s = addDays(startOfWeek(now), 7);
            return { dateStart: fmt(s), dateEnd: fmt(addDays(s, 6)) };
        }
        case 'this_month': case 'month': case 'mes': case 'mês': case 'este_mes': {
            const s = new Date(now.getFullYear(), now.getMonth(), 1);
            const e = new Date(now.getFullYear(), now.getMonth() + 1, 0); // dia 0 do próximo = último deste
            return { dateStart: fmt(s), dateEnd: fmt(e) };
        }
        case 'next_month': case 'proximo_mes': case 'próximo_mês': {
            const s = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            const e = new Date(now.getFullYear(), now.getMonth() + 2, 0);
            return { dateStart: fmt(s), dateEnd: fmt(e) };
        }
        default:
            return {};
    }
}
