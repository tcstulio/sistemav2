import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

const mockDoli = vi.hoisted(() => ({ createAgendaEvent: vi.fn(() => Promise.resolve({ id: '1' })) }));
vi.mock('../../services/dolibarr', () => ({ dolibarrService: mockDoli }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { DelegationEventsService } from '../../services/delegationEventsService';

const STORE = path.join(__dirname, '__delegation_events_test__.json');
const newSvc = () => new DelegationEventsService(STORE);

describe('DelegationEventsService', () => {
    beforeEach(() => vi.clearAllMocks());

    it('getEvents vazio para tarefa desconhecida', () => {
        expect(newSvc().getEvents('999')).toEqual([]);
    });

    it('logEvent acumula em ordem com tipo/by/at', () => {
        const svc = newSvc();
        svc.logEvent('50', 'requested', { by: '9', atMs: 1000 });
        svc.logEvent('50', 'accepted', { by: '16', atMs: 2000 });
        const evs = svc.getEvents('50');
        expect(evs.map((e) => e.type)).toEqual(['requested', 'accepted']);
        expect(evs[1].by).toBe('16');
        expect(evs[0].at).toBe(new Date(1000).toISOString());
    });

    it('espelha cada evento como actioncomm no Dolibarr (best-effort, ligado à tarefa)', () => {
        const svc = newSvc();
        svc.logEvent('50', 'accepted', { by: '16' });
        expect(mockDoli.createAgendaEvent).toHaveBeenCalledWith(expect.objectContaining({
            label: '[Delegação] Delegação aceita',
            type_code: 'AC_DELEG', // categoria própria, escondida da agenda normal
            fk_element: '50',
            elementtype: 'project_task',
            userownerid: '16',
        }));
    });

    it('falha no espelho não derruba o logEvent (best-effort)', () => {
        mockDoli.createAgendaEvent.mockRejectedValueOnce(new Error('dolibarr down'));
        const svc = newSvc();
        expect(() => svc.logEvent('50', 'cobranca')).not.toThrow();
        expect(svc.getEvents('50')).toHaveLength(1);
    });
});
