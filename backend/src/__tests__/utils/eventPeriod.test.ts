import { describe, it, expect } from 'vitest';
import { resolveEventPeriod } from '../../utils/eventPeriod';

// Âncora: quarta-feira 22/07/2026, 15:00 local. Semana (seg→dom) = 20/07 a 26/07.
const NOW = new Date(2026, 6, 22, 15, 0, 0);

describe('resolveEventPeriod — atalhos de período → intervalo YYYY-MM-DD', () => {
    it('today / hoje', () => {
        expect(resolveEventPeriod('today', NOW)).toEqual({ dateStart: '2026-07-22', dateEnd: '2026-07-22' });
        expect(resolveEventPeriod('hoje', NOW)).toEqual({ dateStart: '2026-07-22', dateEnd: '2026-07-22' });
    });

    it('tomorrow / amanhã', () => {
        expect(resolveEventPeriod('tomorrow', NOW)).toEqual({ dateStart: '2026-07-23', dateEnd: '2026-07-23' });
        expect(resolveEventPeriod('amanhã', NOW)).toEqual({ dateStart: '2026-07-23', dateEnd: '2026-07-23' });
    });

    it('this_week (seg→dom da semana corrente)', () => {
        expect(resolveEventPeriod('this_week', NOW)).toEqual({ dateStart: '2026-07-20', dateEnd: '2026-07-26' });
        expect(resolveEventPeriod('semana', NOW)).toEqual({ dateStart: '2026-07-20', dateEnd: '2026-07-26' });
    });

    it('next_week (próxima semana completa)', () => {
        expect(resolveEventPeriod('next_week', NOW)).toEqual({ dateStart: '2026-07-27', dateEnd: '2026-08-02' });
    });

    it('this_month (1º ao último dia do mês)', () => {
        expect(resolveEventPeriod('this_month', NOW)).toEqual({ dateStart: '2026-07-01', dateEnd: '2026-07-31' });
    });

    it('next_month (agosto inteiro)', () => {
        expect(resolveEventPeriod('next_month', NOW)).toEqual({ dateStart: '2026-08-01', dateEnd: '2026-08-31' });
    });

    it('case-insensitive e com espaços', () => {
        expect(resolveEventPeriod('  THIS_WEEK  ', NOW)).toEqual({ dateStart: '2026-07-20', dateEnd: '2026-07-26' });
    });

    it('período desconhecido/vazio → {} (sem filtro)', () => {
        expect(resolveEventPeriod('semana_que_vem_ou_algo', NOW)).toEqual({});
        expect(resolveEventPeriod('', NOW)).toEqual({});
        expect(resolveEventPeriod(undefined as any, NOW)).toEqual({});
    });

    it('vira do ano: dezembro → next_month = janeiro do ano seguinte', () => {
        const dez = new Date(2026, 11, 15, 10, 0, 0); // 15/12/2026
        expect(resolveEventPeriod('next_month', dez)).toEqual({ dateStart: '2027-01-01', dateEnd: '2027-01-31' });
    });
});
