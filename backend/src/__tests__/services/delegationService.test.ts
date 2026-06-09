import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { DAY_MS } from '../../services/delegationFollowUpLogic';

vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { DelegationService } from '../../services/delegationService';

const noon = (d: number) => d * DAY_MS + DAY_MS / 2;
const STORE = path.join(__dirname, '__delegation_store_unit_test__.json');
const newSvc = () => new DelegationService(STORE);

describe('DelegationService', () => {
    beforeEach(() => vi.clearAllMocks());

    it('get retorna undefined para tarefa desconhecida; getAceite idem', () => {
        const svc = newSvc();
        expect(svc.get('999')).toBeUndefined();
        expect(svc.getAceite('999')).toBeUndefined();
    });

    it('requestAcceptance marca pending com deadlineDay = hoje + prazo', () => {
        const svc = newSvc();
        const rec = svc.requestAcceptance('50', { nowMs: noon(10), prazoDeAceiteDays: 1, by: '9' });
        expect(rec.aceite?.status).toBe('pending');
        expect(rec.aceite?.deadlineDay).toBe(11);
        expect(svc.getAceite('50')).toEqual({ status: 'pending', deadlineDay: 11 });
    });

    it('accept marca accepted com quem aceitou', () => {
        const svc = newSvc();
        svc.requestAcceptance('50', { nowMs: noon(10) });
        const rec = svc.accept('50', '16', noon(10));
        expect(rec.aceite?.status).toBe('accepted');
        expect(rec.aceite?.by).toBe('16');
        expect(svc.getAceite('50')?.status).toBe('accepted');
    });

    it('decline marca declined com motivo', () => {
        const svc = newSvc();
        svc.requestAcceptance('50', { nowMs: noon(10) });
        const rec = svc.decline('50', '16', 'já tratei com a equipe', noon(10));
        expect(rec.aceite?.status).toBe('declined');
        expect(rec.aceite?.reason).toBe('já tratei com a equipe');
    });

    it('usa o prazo padrão da cadência quando não informado', () => {
        const svc = newSvc();
        const rec = svc.requestAcceptance('50', { nowMs: noon(10) });
        expect(rec.aceite?.deadlineDay).toBe(11); // DEFAULT_CADENCE.prazoDeAceiteDays = 1
    });
});
