import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { DAY_MS } from '../../services/delegationFollowUpLogic';

const mockDoli = vi.hoisted(() => ({
    listTasksFull: vi.fn(),
    getAllTaskContacts: vi.fn(() => []),
}));
const mockDispatch = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../../services/dolibarr', () => ({ dolibarrService: mockDoli }));
vi.mock('../../services/taskNotificationService', () => ({ dispatchTaskNotification: mockDispatch }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { DelegationFollowUpService } from '../../services/delegationFollowUpService';

const noon = (dayNum: number) => dayNum * DAY_MS + DAY_MS / 2;
const dueSec = (dayNum: number) => (dayNum * DAY_MS) / 1000;
// dir existe (pasta do teste), arquivo não -> store começa vazio; atomicWrite é mockado.
const STORE = path.join(__dirname, '__delegation_store_test__.json');

const newSvc = () => new DelegationFollowUpService(STORE);

describe('DelegationFollowUpService.runTick', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDoli.getAllTaskContacts.mockReturnValue([]);
    });

    it('1º tick: só cria baseline, NÃO dispara nada', async () => {
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();
        const r = await svc.runTick(noon(11)); // tarefa já atrasada, mas é a 1ª observação
        expect(r.baselines).toBe(1);
        expect(r.overdue).toBe(0);
        expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('2º tick: cobra a tarefa atrasada (Responsável) via dispatch overdue', async () => {
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();
        await svc.runTick(noon(11));            // baseline
        const r = await svc.runTick(noon(12));  // agora cobra
        expect(r.overdue).toBe(1);
        expect(mockDispatch).toHaveBeenCalledWith(
            'overdue',
            expect.objectContaining({ id: '50' }),
            expect.objectContaining({ taskContacts: expect.any(Array) }),
        );
    });

    it('reporta a conclusão ao detectar a transição p/ 100%', async () => {
        const svc = newSvc();
        mockDoli.listTasksFull.mockResolvedValueOnce([{ id: '50', progress: 50, fk_user_creat: '9' }]);
        await svc.runTick(noon(5)); // baseline (não concluída)
        mockDoli.listTasksFull.mockResolvedValueOnce([{ id: '50', progress: 100, fk_user_creat: '9' }]);
        const r = await svc.runTick(noon(6));
        expect(r.completed).toBe(1);
        expect(mockDispatch).toHaveBeenCalledWith('completed', expect.objectContaining({ id: '50' }), expect.anything());
    });

    it('tarefa já concluída na 1ª observação não gera reporte', async () => {
        mockDoli.listTasksFull.mockResolvedValue([{ id: '77', progress: 100, fk_user_creat: '9' }]);
        const svc = newSvc();
        await svc.runTick(noon(5));
        const r = await svc.runTick(noon(6));
        expect(r.completed).toBe(0);
        expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('passa os contatos da tarefa ao dispatch (indexados por task_id)', async () => {
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        mockDoli.getAllTaskContacts.mockReturnValue([
            { task_id: '50', user_id: '16', type_id: '45' },
            { task_id: '99', user_id: '20', type_id: '46' },
        ]);
        const svc = newSvc();
        await svc.runTick(noon(11));
        await svc.runTick(noon(12));
        const call = mockDispatch.mock.calls.find((c) => c[0] === 'overdue');
        expect(call?.[2].taskContacts).toEqual([{ task_id: '50', user_id: '16', type_id: '45' }]);
    });

    it('sem tarefas: retorna zero e não dispara', async () => {
        mockDoli.listTasksFull.mockResolvedValue([]);
        const svc = newSvc();
        const r = await svc.runTick(noon(11));
        expect(r.tasks).toBe(0);
        expect(mockDispatch).not.toHaveBeenCalled();
    });
});
