import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { DAY_MS, DEFAULT_CADENCE } from '../../services/delegationFollowUpLogic';

const mockDoli = vi.hoisted(() => ({
    listTasksFull: vi.fn(),
    getAllTaskContacts: vi.fn(() => []),
}));
const mockDispatch = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockDelegation = vi.hoisted(() => ({ getAceite: vi.fn(() => undefined as any) }));

// #1290 — mock do uiConfigService para controlar a cadência em runtime. Defaults espelham
// DEFAULT_CADENCE para preservar o comportamento dos testes existentes quando não há override.
const mockUiConfig = vi.hoisted(() => ({
    getCobrancaCadence: vi.fn(() => ({ ...DEFAULT_CADENCE })),
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
});

// #1290 — Cadência dinâmica do UiConfig.notificationPolicy.cobrancaCadence.
// Regras de aceite: comportamento idêntico ao atual com defaults; alterar os campos do UiConfig em
// runtime muda o intervalo do próximo follow-up sem reiniciar o worker.
describe('DelegationFollowUpService — UiConfig.notificationCadence (#1290)', () => {
    beforeEach(() => {
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE });
    });

    it('com UiConfig defaults o comportamento é idêntico ao hardcoded (recobranca a cada 2 dias)', async () => {
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();
        await svc.runTick(noon(11)); // baseline
        await svc.runTick(noon(12)); // 1ª cobrança (lastCobrancaDay undefined → Infinity)
        const r2 = await svc.runTick(noon(13)); // 1 dia após → ainda não recobra (precisa 2)
        expect(r2.overdue).toBe(0);
        const r3 = await svc.runTick(noon(14)); // 2 dias após → recobra
        expect(r3.overdue).toBe(1);
        expect(mockUiConfig.getCobrancaCadence).toHaveBeenCalled();
    });

    it('recobrancaIntervalDays=1 no UiConfig: re-cobra no dia seguinte', async () => {
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE, recobrancaIntervalDays: 1 });
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();
        await svc.runTick(noon(11)); // baseline
        await svc.runTick(noon(12)); // 1ª cobrança
        const r = await svc.runTick(noon(13)); // 1 dia após → recobra (intervalo = 1)
        expect(r.overdue).toBe(1);
    });

    it('recobrancaIntervalDays=5 no UiConfig: NÃO re-cobra com 2 dias de intervalo', async () => {
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE, recobrancaIntervalDays: 5 });
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();
        await svc.runTick(noon(11)); // baseline
        await svc.runTick(noon(12)); // 1ª cobrança
        const r2 = await svc.runTick(noon(13)); // 1 dia após → NÃO recobra (intervalo = 5)
        expect(r2.overdue).toBe(0);
        const r3 = await svc.runTick(noon(17)); // 5 dias após → recobra
        expect(r3.overdue).toBe(1);
    });

    it('escalateAfterCobrancas=2 no UiConfig: escala após 2 cobranças (não após 3)', async () => {
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE, escalateAfterCobrancas: 2, recobrancaIntervalDays: 1 });
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();
        // baseline + 1ª cobrança + re-cobrança + 2ª re-cobrança (que dispara stalled após 2 cobranças)
        await svc.runTick(noon(11)); // baseline
        await svc.runTick(noon(12)); // 1ª cobrança (cobrancas=1)
        const r = await svc.runTick(noon(13)); // 2ª cobrança (cobrancas=2) + escalonamento
        expect(r.overdue).toBe(1);
        expect(r.stalled).toBe(1);
    });

    it('escalateAfterCobrancas=5 no UiConfig: NÃO escala com 3 cobranças', async () => {
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE, escalateAfterCobrancas: 5, recobrancaIntervalDays: 1 });
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();
        await svc.runTick(noon(11)); // baseline
        await svc.runTick(noon(12)); // 1ª cobrança
        await svc.runTick(noon(13)); // 2ª cobrança
        const r = await svc.runTick(noon(14)); // 3ª cobrança → NÃO escala (precisa 5)
        expect(r.overdue).toBe(1);
        expect(r.stalled).toBe(0);
    });

    it('prazoDeAceiteDays do UiConfig aparece na cadência lida em runtime', () => {
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE, prazoDeAceiteDays: 7 });
        const svc = newSvc() as any;
        const cadence = svc.getNotificationCadence();
        expect(cadence.prazoDeAceiteDays).toBe(7);
    });

    it('leitura dinâmica: tick seguinte reflete mudança do UiConfig sem reiniciar worker', async () => {
        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();
        // Tick 1+2 com cadência "lenta" (intervalo 5) — admin muda em runtime
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE, recobrancaIntervalDays: 5 });
        await svc.runTick(noon(11)); // baseline
        await svc.runTick(noon(12)); // 1ª cobrança
        // Admin encurta o intervalo p/ 1 dia via UI; próximo tick DEVE refletir sem restart.
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE, recobrancaIntervalDays: 1 });
        const r = await svc.runTick(noon(13)); // com novo intervalo 1 → recobra (1 dia após)
        expect(r.overdue).toBe(1);
    });

    it('UiConfig inválido (campo não-numérico): cai no fallback (DEFAULT_CADENCE)', () => {
        mockUiConfig.getCobrancaCadence.mockReturnValue({
            reminderDaysBefore: 'lixo' as any,
            recobrancaIntervalDays: 2,
            escalateAfterCobrancas: 3,
            prazoDeAceiteDays: 1,
        });
        const svc = newSvc() as any;
        const cadence = svc.getNotificationCadence();
        expect(cadence).toEqual(DEFAULT_CADENCE);
    });

    it('UiConfig lança exceção: cai no fallback (cadência passada no construtor)', () => {
        mockUiConfig.getCobrancaCadence.mockImplementation(() => { throw new Error('disk down'); });
        const customFallback = { reminderDaysBefore: 9, recobrancaIntervalDays: 8, escalateAfterCobrancas: 7, prazoDeAceiteDays: 6 };
        const svc = new (require('../../services/delegationFollowUpService').DelegationFollowUpService)(STORE, customFallback) as any;
        const cadence = svc.getNotificationCadence();
        expect(cadence).toEqual(customFallback);
    });
});
