import { describe, it, expect } from 'vitest';
import {
    isWithinQuietWindow,
    nextQuietEnd,
    parseHHmm,
    partsInTz,
    getQuietHours,
} from '../../../services/notifications/quietHours';
import { DEFAULT_NOTIFICATION_POLICY } from '../../../services/uiConfigService';

// SP = UTC-3 (DST abolido em 2019). Referências SP ↔ UTC usadas nos testes:
//   2025-01-15 (Wed): 03:00Z=00:00SP | 05:00Z=02:00SP | 10:00Z=07:00SP | 12:00Z=09:00SP
//                     15:00Z=12:00SP | 23:00Z=20:00SP
//                     01:00Z(16)=22:00SP(15) | 02:00Z(16)=23:00SP(15)
//   2025-01-16 (Thu): 05:00Z=02:00SP | 09:00Z=06:00SP | 10:00Z=07:00SP
//   2025-01-18 (Sat): 15:00Z=12:00SP
//   2025-01-19 (Sun): 15:00Z=12:00SP
//   2025-01-20 (Mon): 13:00Z=10:00SP

describe('quietHours — isWithinQuietWindow (#1291)', () => {
    const rule = (
        over: Partial<{
            enabled: boolean;
            startHHmm: string;
            endHHmm: string;
            weekdaysOnly: boolean;
            diasUteis: boolean;
        }> = {},
    ) => ({
        enabled: true,
        startHHmm: '22:00',
        endHHmm: '06:00',
        weekdaysOnly: false,
        diasUteis: false,
        ...over,
    });

    it('janela DESABILITADA → nunca bloqueia, qualquer hora', () => {
        const r = rule({ enabled: false });
        expect(isWithinQuietWindow(new Date('2025-01-15T03:00:00Z'), r)).toBe(false); // 00:00 SP
        expect(isWithinQuietWindow(new Date('2025-01-15T12:00:00Z'), r)).toBe(false); // 09:00 SP
        expect(isWithinQuietWindow(new Date('2025-01-18T15:00:00Z'), r)).toBe(false); // 12:00 SP Sat
    });

    it('janela 22:00-06:00 (cruza meia-noite): 00:00, 02:00 e 23:00 SP BLOQUEADOS', () => {
        const r = rule();
        expect(isWithinQuietWindow(new Date('2025-01-15T03:00:00Z'), r)).toBe(true);  // 00:00 SP
        expect(isWithinQuietWindow(new Date('2025-01-16T05:00:00Z'), r)).toBe(true);  // 02:00 SP Jan 16
        expect(isWithinQuietWindow(new Date('2025-01-16T02:00:00Z'), r)).toBe(true);  // 23:00 SP Jan 15
    });

    it('janela 22:00-06:00: 07:00, 09:00 e 20:00 SP NÃO bloqueados', () => {
        const r = rule();
        expect(isWithinQuietWindow(new Date('2025-01-15T10:00:00Z'), r)).toBe(false); // 07:00 SP
        expect(isWithinQuietWindow(new Date('2025-01-15T12:00:00Z'), r)).toBe(false); // 09:00 SP
        expect(isWithinQuietWindow(new Date('2025-01-15T23:00:00Z'), r)).toBe(false); // 20:00 SP
    });

    it('boundaries: 22:00 SP (start inclusivo) bloqueado; 06:00 SP (end exclusivo) liberado', () => {
        const r = rule();
        expect(isWithinQuietWindow(new Date('2025-01-16T01:00:00Z'), r)).toBe(true);  // 22:00 SP Jan 15
        expect(isWithinQuietWindow(new Date('2025-01-16T09:00:00Z'), r)).toBe(false); // 06:00 SP Jan 16
    });

    it('janela diurna 09:00-18:00: 12:00 SP bloqueado, 19:00 SP liberado', () => {
        const r = rule({ startHHmm: '09:00', endHHmm: '18:00' });
        expect(isWithinQuietWindow(new Date('2025-01-15T15:00:00Z'), r)).toBe(true);  // 12:00 SP
        expect(isWithinQuietWindow(new Date('2025-01-15T22:00:00Z'), r)).toBe(false); // 19:00 SP
    });

    it('janela diurna: 09:00 SP (start inclusivo) bloqueado; 18:00 SP (end exclusivo) liberado', () => {
        const r = rule({ startHHmm: '09:00', endHHmm: '18:00' });
        expect(isWithinQuietWindow(new Date('2025-01-15T12:00:00Z'), r)).toBe(true);  // 09:00 SP
        expect(isWithinQuietWindow(new Date('2025-01-15T21:00:00Z'), r)).toBe(false); // 18:00 SP
    });

    it('diasUteis=true: sábado 12:00 SP BLOQUEADO mesmo fora da janela HH:mm', () => {
        const r = rule({ diasUteis: true });
        expect(isWithinQuietWindow(new Date('2025-01-18T15:00:00Z'), r)).toBe(true); // 12:00 SP Sat
    });

    it('diasUteis=true: domingo 12:00 SP BLOQUEADO', () => {
        const r = rule({ diasUteis: true });
        expect(isWithinQuietWindow(new Date('2025-01-19T15:00:00Z'), r)).toBe(true); // 12:00 SP Sun
    });

    it('diasUteis=true: segunda 10:00 SP NÃO bloqueado', () => {
        const r = rule({ diasUteis: true });
        expect(isWithinQuietWindow(new Date('2025-01-20T13:00:00Z'), r)).toBe(false); // 10:00 SP Mon
    });

    it('weekdaysOnly=true (alias) tem o mesmo efeito que diasUteis=true', () => {
        const r1 = rule({ diasUteis: false, weekdaysOnly: true });
        const r2 = rule({ diasUteis: true, weekdaysOnly: false });
        const sat = new Date('2025-01-18T15:00:00Z');
        const mon = new Date('2025-01-20T13:00:00Z');
        expect(isWithinQuietWindow(sat, r1)).toBe(isWithinQuietWindow(sat, r2));
        expect(isWithinQuietWindow(mon, r1)).toBe(isWithinQuietWindow(mon, r2));
    });

    it('diasUteis=false (default): sábado 12:00 SP fora da janela HH:mm → NÃO bloqueado', () => {
        const r = rule(); // 22:00-06:00 + diasUteis=false
        expect(isWithinQuietWindow(new Date('2025-01-18T15:00:00Z'), r)).toBe(false); // 12:00 SP Sat
    });

    it('HH:mm malformado → fail-open (não bloqueia)', () => {
        const r1 = rule({ startHHmm: '25:99' });
        const r2 = rule({ endHHmm: 'abc' });
        expect(isWithinQuietWindow(new Date('2025-01-15T15:00:00Z'), r1)).toBe(false);
        expect(isWithinQuietWindow(new Date('2025-01-15T15:00:00Z'), r2)).toBe(false);
    });

    it('janela vazia (start == end) → nunca bloqueia', () => {
        const r = rule({ startHHmm: '12:00', endHHmm: '12:00' });
        expect(isWithinQuietWindow(new Date('2025-01-15T15:00:00Z'), r)).toBe(false);
    });

    it('window null/undefined → fail-safe (não bloqueia)', () => {
        expect(isWithinQuietWindow(new Date(), null as any)).toBe(false);
        expect(isWithinQuietWindow(new Date(), undefined as any)).toBe(false);
    });

    it('canal in-app é benigno: caller não chama isWithinQuietWindow (a função é por regra)', () => {
        // O service NÃO consulta quietHours p/ in-app (sempre passa). Aqui só validamos
        // que a regra default in-app vem com enabled=false → isWithinQuietWindow=false.
        const inAppRule = DEFAULT_NOTIFICATION_POLICY.quietHours['in-app'];
        expect(inAppRule.enabled).toBe(false);
        expect(isWithinQuietWindow(new Date('2025-01-15T03:00:00Z'), inAppRule)).toBe(false); // 00:00 SP
    });
});

describe('quietHours — parseHHmm', () => {
    it('parseia HH:mm válido', () => {
        expect(parseHHmm('00:00')).toEqual({ h: 0, m: 0 });
        expect(parseHHmm('09:30')).toEqual({ h: 9, m: 30 });
        expect(parseHHmm('23:59')).toEqual({ h: 23, m: 59 });
    });
    it('devolve null p/ entrada inválida', () => {
        expect(parseHHmm('24:00')).toBeNull();
        expect(parseHHmm('9:00')).toBeNull();
        expect(parseHHmm('12:60')).toBeNull();
        expect(parseHHmm('')).toBeNull();
        expect(parseHHmm(null as any)).toBeNull();
        expect(parseHHmm(undefined as any)).toBeNull();
        expect(parseHHmm(123 as any)).toBeNull();
    });
});

describe('quietHours — partsInTz (helper America/Sao_Paulo)', () => {
    it('extrai partes no fuso America/Sao_Paulo (UTC-3 sem DST)', () => {
        const parts = partsInTz(new Date('2025-01-15T12:00:00Z'), 'America/Sao_Paulo');
        expect(parts).toMatchObject({ y: 2025, m: 1, d: 15, dow: 3, h: 9, mi: 0 }); // Wed 09:00 SP
    });
    it('cruza meia-noite corretamente', () => {
        const parts = partsInTz(new Date('2025-01-16T02:00:00Z'), 'America/Sao_Paulo');
        expect(parts).toMatchObject({ y: 2025, m: 1, d: 15, dow: 3, h: 23, mi: 0 }); // Wed 23:00 SP
    });
    it('identifica fim de semana (Sat=6, Sun=0)', () => {
        expect(partsInTz(new Date('2025-01-18T12:00:00Z'), 'America/Sao_Paulo').dow).toBe(6); // Sat
        expect(partsInTz(new Date('2025-01-19T12:00:00Z'), 'America/Sao_Paulo').dow).toBe(0); // Sun
    });
});

describe('quietHours — nextQuietEnd', () => {
    const rule = (
        over: Partial<{
            enabled: boolean;
            startHHmm: string;
            endHHmm: string;
            weekdaysOnly: boolean;
            diasUteis: boolean;
        }> = {},
    ) => ({
        enabled: true,
        startHHmm: '22:00',
        endHHmm: '06:00',
        weekdaysOnly: false,
        diasUteis: false,
        ...over,
    });

    it('janela desabilitada → devolve now', () => {
        const r = rule({ enabled: false });
        const now = new Date('2025-01-15T03:00:00Z');
        expect(nextQuietEnd(now, r).getTime()).toBe(now.getTime());
    });

    it('em quiet às 02:00 SP Jan 16 → scheduledFor = 06:00 SP Jan 16', () => {
        const r = rule();
        const now = new Date('2025-01-16T05:00:00Z'); // 02:00 SP Jan 16
        expect(nextQuietEnd(now, r).toISOString()).toBe('2025-01-16T09:00:00.000Z'); // 06:00 SP Jan 16
    });

    it('em quiet às 23:00 SP Jan 15 → scheduledFor = 06:00 SP Jan 16 (dia seguinte)', () => {
        const r = rule();
        const now = new Date('2025-01-16T02:00:00Z'); // 23:00 SP Jan 15
        expect(nextQuietEnd(now, r).toISOString()).toBe('2025-01-16T09:00:00.000Z'); // 06:00 SP Jan 16
    });

    it('janela 09:00-18:00, agora 12:00 SP → scheduledFor = 18:00 SP mesmo dia', () => {
        const r = rule({ startHHmm: '09:00', endHHmm: '18:00' });
        const now = new Date('2025-01-15T15:00:00Z'); // 12:00 SP
        expect(nextQuietEnd(now, r).toISOString()).toBe('2025-01-15T21:00:00.000Z'); // 18:00 SP
    });

    it('weekdaysOnly + agora sexta 23:00 SP → pula sáb/dom → segunda 06:00 SP', () => {
        const r = rule({ weekdaysOnly: true });
        // 2025-01-17 = Friday. 23:00 SP = 2025-01-18T02:00:00Z
        const now = new Date('2025-01-18T02:00:00Z'); // 23:00 SP Fri
        // Próximo 06:00 SP em dia útil = segunda 2025-01-20 06:00 SP = 2025-01-20T09:00:00Z
        expect(nextQuietEnd(now, r).toISOString()).toBe('2025-01-20T09:00:00.000Z');
    });

    it('weekdaysOnly + agora sábado 23:00 SP → segunda 06:00 SP', () => {
        const r = rule({ weekdaysOnly: true });
        // 2025-01-18 = Saturday. 23:00 SP = 2025-01-19T02:00:00Z
        const now = new Date('2025-01-19T02:00:00Z'); // 23:00 SP Sat
        expect(nextQuietEnd(now, r).toISOString()).toBe('2025-01-20T09:00:00.000Z'); // Mon 06:00 SP
    });
});

describe('quietHours — getQuietHours (helper tipado)', () => {
    it('retorna a regra do canal no QuietHoursConfig', () => {
        const cfg = DEFAULT_NOTIFICATION_POLICY.quietHours;
        expect(getQuietHours(cfg, 'whatsapp').enabled).toBe(cfg.whatsapp.enabled);
        expect(getQuietHours(cfg, 'whatsapp').startHHmm).toBe(cfg.whatsapp.startHHmm);
        expect(getQuietHours(cfg, 'email').endHHmm).toBe(cfg.email.endHHmm);
        expect(getQuietHours(cfg, 'in-app').weekdaysOnly).toBe(cfg['in-app'].weekdaysOnly);
    });
});