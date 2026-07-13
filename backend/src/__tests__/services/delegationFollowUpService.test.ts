import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { DAY_MS } from '../../services/delegationFollowUpLogic';

const mockDoli = vi.hoisted(() => ({
    listTasksFull: vi.fn(),
    getAllTaskContacts: vi.fn(() => []),
}));
const mockDispatch = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockDelegation = vi.hoisted(() => ({ getAceite: vi.fn(() => undefined as any) }));

// #1397 (Dial 1) — mock do uiConfigService.controla a cadência lida pelo motor. Default da
// cadência é a DEFAULT_CADENCE (1/2/3/1); cada teste pode sobrescrever p/ verificar que o motor
// de fato CONSOME o dial (regra de aceite da issue).
const mockUiConfig = vi.hoisted(() => ({
    getCobrancaCadence: vi.fn(() => ({
        reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1,
    })),
    getQuietHours: vi.fn(() => ({
        whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        email: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
    })),
}));

vi.mock('../../services/dolibarr', () => ({ dolibarrService: mockDoli }));
vi.mock('../../services/taskNotificationService', () => ({ dispatchTaskNotification: mockDispatch }));
vi.mock('../../services/delegationService', () => ({ delegationService: mockDelegation }));
vi.mock('../../services/delegationEventsService', () => ({ delegationEventsService: { logEvent: vi.fn() } }));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));
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
        mockDelegation.getAceite.mockReturnValue(undefined);
        // restaura cadência default a cada teste (cada caso pode sobrescrever)
        mockUiConfig.getCobrancaCadence.mockReturnValue({
            reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1,
        });
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

    it('cobrança: destinatário = Responsável, autor = Sistema (by undefined), nota com contexto (#526)', async () => {
        const { delegationEventsService } = await import('../../services/delegationEventsService');
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', ref: 'TK50', label: 'Entregar relatório', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        mockDoli.getAllTaskContacts.mockReturnValue([{ task_id: '50', user_id: '16', type_id: '45' }]); // 45 = responsável
        const svc = newSvc();
        await svc.runTick(noon(11)); // baseline
        await svc.runTick(noon(12)); // cobra
        const arg = (delegationEventsService.logEvent as any).mock.calls.find((c: any[]) => c[1] === 'cobranca')?.[2];
        expect(arg.to).toBe('16');       // destinatário = Responsável (para quem foi a cobrança)
        expect(arg.by).toBeUndefined();  // autor = Sistema
        expect(arg.note).toContain('Entregar relatório');
    });

    it('cobrança sem responsável: destinatário cai p/ o criador (solicitante)', async () => {
        const { delegationEventsService } = await import('../../services/delegationEventsService');
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', label: 'X', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        mockDoli.getAllTaskContacts.mockReturnValue([]); // sem responsável
        const svc = newSvc();
        await svc.runTick(noon(11));
        await svc.runTick(noon(12));
        expect(delegationEventsService.logEvent).toHaveBeenCalledWith('50', 'cobranca', expect.objectContaining({ to: '9' }));
    });

    it('sem tarefas: retorna zero e não dispara', async () => {
        mockDoli.listTasksFull.mockResolvedValue([]);
        const svc = newSvc();
        const r = await svc.runTick(noon(11));
        expect(r.tasks).toBe(0);
        expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('aceite pendente com prazo estourado: escala ao solicitante (acceptance_overdue)', async () => {
        const { delegationEventsService } = await import('../../services/delegationEventsService');
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', progress: 0, fk_user_creat: '9' }]);
        mockDoli.getAllTaskContacts.mockReturnValue([{ task_id: '50', user_id: '16', type_id: '45' }]); // responsável existe
        mockDelegation.getAceite.mockReturnValue({ status: 'pending', deadlineDay: 12 });
        const svc = newSvc();
        await svc.runTick(noon(11)); // baseline (dentro do prazo de aceite)
        const r = await svc.runTick(noon(13)); // prazo estourado -> escala
        expect(r.acceptance_overdue).toBe(1);
        expect(mockDispatch).toHaveBeenCalledWith('acceptance_overdue', expect.objectContaining({ id: '50' }), expect.anything());
        // escalada vai ao SOLICITANTE (criador '9'), não ao responsável
        expect(delegationEventsService.logEvent).toHaveBeenCalledWith('50', 'escalated', expect.objectContaining({ to: '9' }));
    });

    it('aceite pendente dentro do prazo: não cobra a entrega', async () => {
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(5), progress: 0, fk_user_creat: '9' }]);
        mockDelegation.getAceite.mockReturnValue({ status: 'pending', deadlineDay: 99 });
        const svc = newSvc();
        await svc.runTick(noon(11)); // baseline
        const r = await svc.runTick(noon(12)); // atrasada na entrega, mas aguardando aceite
        expect(r.overdue).toBe(0);
        expect(mockDispatch).not.toHaveBeenCalled();
    });

    // #1397 — ENFORCEMENT TEST (regra inegociável da issue): mudar o dial MUDA o comportamento
    // observável. Sem este teste, o PR é teatro de novo (mesmo padrão do approvalValueThreshold
    // pré-#1370).
    describe('Dial 1 — notificationPolicy.cobrancaCadence (#1397)', () => {
        it('recobrancaIntervalDays muda o intervalo de re-cobrança', async () => {
            // cadência=2: 1ª cobrança no dia do vencimento (noon 12, 1 dia após baseline em 11);
            // 2ª cobrança só no dia 14 (daysSinceLast=2 >= recobrancaIntervalDays=2).
            // cadência=1: 2ª cobrança já no dia 13 (daysSinceLast=1 >= recobrancaIntervalDays=1).
            mockUiConfig.getCobrancaCadence.mockReturnValue({
                reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1,
            });
            mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
            const svcA = newSvc();
            await svcA.runTick(noon(11)); // baseline
            await svcA.runTick(noon(12)); // 1ª cobrança (lastCobrancaDay=12)
            const rA = await svcA.runTick(noon(13)); // cadência=2, 1d após → não cobra
            expect(rA.overdue).toBe(0);
            vi.clearAllMocks();

            // Mesmo cenário, cadência=1 → no dia 13 já re-cobra.
            mockUiConfig.getCobrancaCadence.mockReturnValue({
                reminderDaysBefore: 1, recobrancaIntervalDays: 1, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1,
            });
            mockDoli.getAllTaskContacts.mockReturnValue([]);
            mockDelegation.getAceite.mockReturnValue(undefined);
            mockDoli.listTasksFull.mockResolvedValue([{ id: '60', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
            const svcB = newSvc();
            await svcB.runTick(noon(11)); // baseline da 60
            await svcB.runTick(noon(12)); // 1ª cobrança
            const rB = await svcB.runTick(noon(13)); // cadência=1 → re-cobra
            expect(rB.overdue).toBe(1);
            expect(mockDispatch).toHaveBeenCalledWith('overdue', expect.objectContaining({ id: '60' }), expect.anything());
        });

        it('reminderDaysBefore muda a janela do lembrete antes do prazo', async () => {
            // Com reminderDaysBefore=1, no dia-2 antes do prazo ainda NÃO lembra.
            mockUiConfig.getCobrancaCadence.mockReturnValue({
                reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1,
            });
            mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
            const svcA = newSvc();
            await svcA.runTick(noon(7));
            const rA = await svcA.runTick(noon(8)); // 2 dias antes
            expect(rA.deadline_reminder).toBe(0);
            expect(mockDispatch).not.toHaveBeenCalled();
            vi.clearAllMocks();

            // Com reminderDaysBefore=3, o MESMO dia-2 PASSA a lembrar.
            mockUiConfig.getCobrancaCadence.mockReturnValue({
                reminderDaysBefore: 3, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1,
            });
            mockDoli.getAllTaskContacts.mockReturnValue([]);
            mockDelegation.getAceite.mockReturnValue(undefined);
            mockDoli.listTasksFull.mockResolvedValue([{ id: '60', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
            const svcB = newSvc();
            await svcB.runTick(noon(7));
            const rB = await svcB.runTick(noon(8)); // 2 dias antes — entra na janela 3
            expect(rB.deadline_reminder).toBe(1);
            expect(mockDispatch).toHaveBeenCalledWith('deadline_reminder', expect.objectContaining({ id: '60' }), expect.anything());
        });

        it('escalateAfterCobrancas muda o nº de cobranças p/ escalar', async () => {
            // Cadência com escalate=3: após 3 cobranças, escala.
            mockUiConfig.getCobrancaCadence.mockReturnValue({
                reminderDaysBefore: 1, recobrancaIntervalDays: 1, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1,
            });
            mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(5), progress: 0, fk_user_creat: '9' }]);
            const svcA = newSvc();
            await svcA.runTick(noon(11)); // baseline
            await svcA.runTick(noon(12)); // cobra 1 (overdue)
            await svcA.runTick(noon(13)); // cobra 2 (recobranca, +1d)
            await svcA.runTick(noon(14)); // cobra 3 (recobranca, +1d)
            const rA = await svcA.runTick(noon(15)); // 4 cobranças → escala
            expect(rA.stalled).toBe(1);
            expect(mockDispatch).toHaveBeenCalledWith('stalled', expect.objectContaining({ id: '50' }), expect.anything());
            vi.clearAllMocks();

            // Mesma sequência, cadência escalate=10: nunca chega a escalar.
            mockUiConfig.getCobrancaCadence.mockReturnValue({
                reminderDaysBefore: 1, recobrancaIntervalDays: 1, escalateAfterCobrancas: 10, prazoDeAceiteDays: 1,
            });
            mockDoli.getAllTaskContacts.mockReturnValue([]);
            mockDelegation.getAceite.mockReturnValue(undefined);
            mockDoli.listTasksFull.mockResolvedValue([{ id: '60', date_end: dueSec(5), progress: 0, fk_user_creat: '9' }]);
            const svcB = newSvc();
            await svcB.runTick(noon(11));
            await svcB.runTick(noon(12));
            await svcB.runTick(noon(13));
            await svcB.runTick(noon(14));
            const rB = await svcB.runTick(noon(15));
            expect(rB.stalled).toBe(0);
        });
    });
});
