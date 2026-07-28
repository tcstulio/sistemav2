/**
 * Quiet Hours — lógica pura (camada 2).
 *
 * Determina se um instante cai dentro da janela de silêncio configurada para um
 * canal (WhatsApp/email/in-app), respeitando o fuso America/Sao_Paulo e a flag
 * `weekdaysOnly` (sábado/domingo = sempre bloqueado quando ligada; `diasUteis` é
 * aceito como alias p/ casar com a nomenclatura do produto).
 *
 * Puro (sem I/O) — testável sem mockar logger/notificationService.
 *
 * #1291 — gate de quiet-hours por canal no dispatch do taskNotificationService.
 */

import type { QuietHoursChannel, QuietHoursConfig, QuietHoursRule } from '../uiConfigService';

const SAO_PAULO_TZ = 'America/Sao_Paulo';

/** Janela de silêncio (regra do canal). Aceita `diasUteis` como alias de `weekdaysOnly`. */
export interface QuietWindow {
    enabled: boolean;
    /** "HH:mm" 24h. */
    startHHmm: string;
    /** "HH:mm" 24h. endHHmm < startHHmm = janela que cruza meia-noite. */
    endHHmm: string;
    /** true => sábado/domingo tratados como fora da janela de despacho. */
    weekdaysOnly?: boolean;
    /** Alias semântico de `weekdaysOnly` (consolidação #1397). */
    diasUteis?: boolean;
}

interface DayParts {
    y: number;
    m: number;
    d: number;
    /** 0=Sun, 1=Mon, ..., 6=Sat (convenção JS). */
    dow: number;
    h: number;
    mi: number;
}

const WEEKDAY_MAP: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parseia "HH:mm" -> { h, m }. Devolve null p/ string inválida (fail-open no caller). */
export function parseHHmm(s: unknown): { h: number; m: number } | null {
    const str = String(s ?? '');
    const m = HHMM_RE.exec(str);
    if (!m) return null;
    return { h: Number(m[1]), m: Number(m[2]) };
}

/** Partes (ano/mês/dia/dia-da-semana/hora/minuto) de `date` no fuso `timeZone`. */
export function partsInTz(date: Date, timeZone: string = SAO_PAULO_TZ): DayParts {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const tokens = fmt.formatToParts(date);
    const get = (t: string) => tokens.find((p) => p.type === t)?.value;
    // Algumas engines (Node < 18) devolvem "24" p/ meia-noite com hour12:false; normaliza.
    const hourRaw = get('hour');
    const hour = hourRaw === '24' ? '0' : (hourRaw ?? '0');
    return {
        y: Number(get('year')),
        m: Number(get('month')),
        d: Number(get('day')),
        dow: WEEKDAY_MAP[get('weekday') ?? 'Sun'] ?? 0,
        h: Number(hour),
        mi: Number(get('minute') ?? '0'),
    };
}

function toMin(h: number, m: number): number { return h * 60 + m; }
function isWeekendDow(dow: number): boolean { return dow === 0 || dow === 6; }
function isDiasUteis(w: QuietWindow): boolean { return !!(w.weekdaysOnly || w.diasUteis); }

/** True se `now` cai DENTRO da janela de silêncio configurada (i.e., devemos bloquear). */
export function isWithinQuietWindow(now: Date, window: QuietWindow): boolean {
    if (!window?.enabled) return false;
    const start = parseHHmm(window.startHHmm);
    const end = parseHHmm(window.endHHmm);
    if (!start || !end) return false;
    const parts = partsInTz(now, SAO_PAULO_TZ);
    // diasUteis/weedaysOnly => sábado e domingo sempre bloqueados (independente de HH:mm).
    if (isDiasUteis(window) && isWeekendDow(parts.dow)) return true;
    const nowMin = toMin(parts.h, parts.mi);
    const startMin = toMin(start.h, start.m);
    const endMin = toMin(end.h, end.m);
    if (startMin === endMin) return false; // janela vazia => nunca bloqueia
    if (startMin < endMin) {
        return nowMin >= startMin && nowMin < endMin;
    }
    // startMin > endMin => cruza meia-noite: [start, 24h) ∪ [0, end)
    return nowMin >= startMin || nowMin < endMin;
}

/**
 * Próximo instante (>= now) em que o canal SAI da janela de silêncio
 * (= janela de despacho abre). Considera `weekdaysOnly` (pula fim de semana).
 * Retorna `now` se a janela está desabilitada ou é vazia.
 */
export function nextQuietEnd(now: Date, window: QuietWindow): Date {
    if (!window?.enabled) return now;
    const start = parseHHmm(window.startHHmm);
    const end = parseHHmm(window.endHHmm);
    if (!start || !end) return now;
    if (toMin(start.h, start.m) === toMin(end.h, end.m)) return now; // janela vazia

    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
        const cand = buildDateAtTz(now, dayOffset, end.h, end.m, SAO_PAULO_TZ);
        if (cand.getTime() <= now.getTime()) continue;
        const candParts = partsInTz(cand, SAO_PAULO_TZ);
        if (isDiasUteis(window) && isWeekendDow(candParts.dow)) continue;
        return cand;
    }
    return now;
}

/** Constrói um Date cujo instante em `timeZone` é HH:MM do dia `now + dayOffset` (local). */
function buildDateAtTz(now: Date, dayOffset: number, h: number, mi: number, timeZone: string): Date {
    const parts = partsInTz(now, timeZone);
    // Date.UTC faz rollover de mês/ano automaticamente.
    const naiveUtc = Date.UTC(parts.y, parts.m - 1, parts.d + dayOffset, h, mi, 0, 0);
    const offsetMin = getTzOffsetMinutes(new Date(naiveUtc), timeZone);
    // O instante "wall-clock HH:MM em tz" = naiveUtc - offset (porque tz == UTC + offset).
    return new Date(naiveUtc - offsetMin * 60_000);
}

/** Offset (em minutos) de `timeZone` relativo a UTC no instante `at` (positivo = tz à frente). */
function getTzOffsetMinutes(at: Date, timeZone: string): number {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    const tokens = fmt.formatToParts(at);
    const get = (t: string) => tokens.find((p) => p.type === t)?.value;
    const hourRaw = get('hour');
    const hour = hourRaw === '24' ? '0' : (hourRaw ?? '0');
    const asUtc = Date.UTC(
        Number(get('year')),
        Number(get('month')) - 1,
        Number(get('day')),
        Number(hour),
        Number(get('minute') ?? '0'),
        Number(get('second') ?? '0'),
    );
    return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Atalho tipado: dado o bloco `notificationPolicy.quietHours`, devolve a regra do canal. */
export function getQuietHours(cfg: QuietHoursConfig, canal: QuietHoursChannel): QuietHoursRule {
    return cfg[canal];
}