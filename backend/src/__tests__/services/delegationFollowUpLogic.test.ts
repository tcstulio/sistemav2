import { describe, it, expect } from 'vitest';
import {
    decideFollowUp,
    TaskTracking,
    DEFAULT_CADENCE,
    DAY_MS,
} from '../../services/delegationFollowUpLogic';

// Helpers de tempo: trabalhamos em "índices de dia" (UTC).
const noon = (dayNum: number) => dayNum * DAY_MS + DAY_MS / 2; // todayMs no meio do dia
const dueSec = (dayNum: number) => (dayNum * DAY_MS) / 1000;   // date_end (segundos) à meia-noite do dia

const task = (over: Partial<{ id: string; date_end: number; progress: number; fk_user_creat: string }> = {}) => ({
    id: '50',
    fk_user_creat: '9',
    ...over,
});

describe('decideFollowUp', () => {
    it('1ª observação: cria baseline e NÃO dispara nada', () => {
        const { event, tracking } = decideFollowUp(task({ date_end: dueSec(10), progress: 0 }), undefined, noon(5));
        expect(event).toBeNull();
        expect(tracking).toMatchObject({ cobrancas: 0, escalated: false, reportedDone: false });
    });

    it('1ª observação de tarefa já concluída: baseline reportedDone=true (sem reporte retroativo)', () => {
        const { event, tracking } = decideFollowUp(task({ progress: 100 }), undefined, noon(5));
        expect(event).toBeNull();
        expect(tracking.reportedDone).toBe(true);
    });

    it('lembra 1 dia antes do prazo (uma vez por prazo)', () => {
        const base: TaskTracking = { cobrancas: 0, escalated: false, reportedDone: false, progressAtLastCobranca: 0 };
        const d1 = decideFollowUp(task({ date_end: dueSec(10), progress: 0 }), base, noon(9));
        expect(d1.event).toBe('deadline_reminder');
        expect(d1.tracking.remindedForDay).toBe(10);
        // mesmo prazo, novo tick -> não repete
        const d2 = decideFollowUp(task({ date_end: dueSec(10), progress: 0 }), d1.tracking, noon(9));
        expect(d2.event).toBeNull();
    });

    it('não lembra fora da janela', () => {
        const base: TaskTracking = { cobrancas: 0, escalated: false, reportedDone: false };
        const d = decideFollowUp(task({ date_end: dueSec(20), progress: 0 }), base, noon(9));
        expect(d.event).toBeNull();
    });

    it('cobra no vencimento', () => {
        const base: TaskTracking = { cobrancas: 0, escalated: false, reportedDone: false, progressAtLastCobranca: 0 };
        const d = decideFollowUp(task({ date_end: dueSec(10), progress: 0 }), base, noon(11));
        expect(d.event).toBe('overdue');
        expect(d.tracking.cobrancas).toBe(1);
        expect(d.tracking.lastCobrancaDay).toBe(11);
    });

    it('re-cobra a cada 2 dias (não no dia seguinte)', () => {
        const prev: TaskTracking = { cobrancas: 1, lastCobrancaDay: 11, escalated: false, reportedDone: false, progressAtLastCobranca: 0 };
        const dt = task({ date_end: dueSec(10), progress: 0 });
        expect(decideFollowUp(dt, prev, noon(12)).event).toBeNull();      // 1 dia depois
        const d = decideFollowUp(dt, prev, noon(13));                      // 2 dias depois
        expect(d.event).toBe('overdue');
        expect(d.tracking.cobrancas).toBe(2);
    });

    it('escala ao solicitante após 3 cobranças sem progresso', () => {
        const prev: TaskTracking = { cobrancas: 3, lastCobrancaDay: 15, escalated: false, reportedDone: false, progressAtLastCobranca: 0 };
        const d = decideFollowUp(task({ date_end: dueSec(10), progress: 0 }), prev, noon(16));
        expect(d.event).toBe('stalled');
        expect(d.tracking.escalated).toBe(true);
    });

    it('não re-escala (escalonamento é uma vez por ciclo)', () => {
        const prev: TaskTracking = { cobrancas: 3, lastCobrancaDay: 15, escalated: true, reportedDone: false, progressAtLastCobranca: 0 };
        const d = decideFollowUp(task({ date_end: dueSec(10), progress: 0 }), prev, noon(16));
        expect(d.event).not.toBe('stalled');
    });

    it('avanço de progresso reinicia o ciclo (não escala)', () => {
        const prev: TaskTracking = { cobrancas: 3, lastCobrancaDay: 16, escalated: false, reportedDone: false, progressAtLastCobranca: 20 };
        // progrediu 20 -> 60, e ainda não passaram 2 dias da última cobrança
        const d = decideFollowUp(task({ date_end: dueSec(10), progress: 60 }), prev, noon(16));
        expect(d.event).toBeNull();
        expect(d.tracking.cobrancas).toBe(0);
        expect(d.tracking.escalated).toBe(false);
    });

    it('reporta a conclusão uma única vez ao solicitante', () => {
        const prev: TaskTracking = { cobrancas: 2, escalated: false, reportedDone: false, progressAtLastCobranca: 50 };
        const d = decideFollowUp(task({ progress: 100 }), prev, noon(20));
        expect(d.event).toBe('completed');
        expect(d.tracking.reportedDone).toBe(true);
        // não reporta de novo
        expect(decideFollowUp(task({ progress: 100 }), d.tracking, noon(21)).event).toBeNull();
    });

    it('conclusão é reportada mesmo sem prazo definido', () => {
        const baseline = decideFollowUp(task({ progress: 40 }), undefined, noon(5)).tracking; // sem date_end
        const d = decideFollowUp(task({ progress: 100 }), baseline, noon(6));
        expect(d.event).toBe('completed');
    });

    it('sem prazo e não concluída: nenhuma ação temporal', () => {
        const base: TaskTracking = { cobrancas: 0, escalated: false, reportedDone: false, progressAtLastCobranca: 0 };
        const d = decideFollowUp(task({ progress: 30 }), base, noon(100));
        expect(d.event).toBeNull();
    });

    it('respeita uma cadência customizada', () => {
        const cadence = { reminderDaysBefore: 3, recobrancaIntervalDays: 1, escalateAfterCobrancas: 1 };
        // lembrete com janela de 3 dias
        const base: TaskTracking = { cobrancas: 0, escalated: false, reportedDone: false, progressAtLastCobranca: 0 };
        expect(decideFollowUp(task({ date_end: dueSec(10), progress: 0 }), base, noon(8), cadence).event).toBe('deadline_reminder');
        // escala já após 1 cobrança
        const prev: TaskTracking = { cobrancas: 1, lastCobrancaDay: 11, escalated: false, reportedDone: false, progressAtLastCobranca: 0 };
        expect(decideFollowUp(task({ date_end: dueSec(10), progress: 0 }), prev, noon(12), cadence).event).toBe('stalled');
    });

    it('usa a cadência padrão quando não informada', () => {
        expect(DEFAULT_CADENCE).toEqual({ reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3 });
    });
});
