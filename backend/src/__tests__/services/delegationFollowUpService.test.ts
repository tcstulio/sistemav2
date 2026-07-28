import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { DAY_MS, DEFAULT_CADENCE } from '../../services/delegationFollowUpLogic';

const mockDoli = vi.hoisted(() => ({
    listTasksFull: vi.fn(),
    getAllTaskContacts: vi.fn(() => []),
}));
const mockDispatch = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockDelegation = vi.hoisted(() => ({ getAceite: vi.fn(() => undefined as any) }));
// #1406 — mock do uiConfigService p/ controlar o `cobrancaCadence` lido em runtime.
// O default devolve a cadência saneada (igual ao DEFAULT_CADENCE) p/ preservar o
// comportamento dos testes antigos que não mexem no dial.
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
        // #1406 — reset do mock do uiConfig para a cadência default. Garantia de isolamento
        // entre testes que sobrescrevem getCobrancaCadence (vi.clearAllMocks não reseta implementação).
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE });
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

// #1406 — TESTE DE ENFORCEMENT (obrigatório pela issue #1406 AC#3).
// Valida que o dial `notificationPolicy.cobrancaCadence` do uiConfigService é lido em RUNTIME
// (sem restart) e que o próximo envio reflete EXATAMENTE o valor configurado — não os
// defaults hard-coded. Sem este teste o PR seria teatro (palavras textuais da issue).
describe('DelegationFollowUpService — runtime cobrancaCadence (#1406)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // reset do mock (vi.clearAllMocks não reseta implementação)
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE });
        mockDoli.getAllTaskContacts.mockReturnValue([]);
        mockDelegation.getAceite.mockReturnValue(undefined);
    });

    it('enforcement #1406: recobrancaIntervalDays=1 do uiConfig → re-cobra no dia seguinte (default 2 NÃO re-cobraria)', async () => {
        // Admin setou `recobrancaIntervalDays=1` (≠ default 2) via PUT /api/ui-config.
        // Equivalente, em dias, do "cadence=1h" do critério de aceite (a cadência é
        // armazenada em dias; 1 dia é a janela mais curta que o sanitize aceita).
        mockUiConfig.getCobrancaCadence.mockReturnValue({
            reminderDaysBefore: 0,
            recobrancaIntervalDays: 1, // CHAVE DO TESTE: 1 dia entre re-cobranças
            escalateAfterCobrancas: 99, // alto, p/ não escalar durante o teste
            prazoDeAceiteDays: 1,
        });

        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();

        // baseline em D+11 (tarefa atrasada, 1ª observação — não dispara)
        await svc.runTick(noon(11));
        // 1ª cobrança em D+12 (lastCobrancaDay era undefined → daysSinceLast = Infinity >= 1)
        const r1 = await svc.runTick(noon(12));
        expect(r1.overdue).toBe(1);
        expect(mockDispatch).toHaveBeenCalledTimes(1);
        expect(mockDispatch).toHaveBeenLastCalledWith('overdue', expect.objectContaining({ id: '50' }), expect.anything());

        // Com cadence=1 dia: a 2ª cobrança dispara após 1 dia (D+13). Com o DEFAULT=2 dias
        // (sem o override), daysSinceLast=1 < 2 e NÃO dispararia. Esta é a prova viva de
        // que o motor lê a config em runtime, não o DEFAULT_CADENCE hard-coded.
        const r2 = await svc.runTick(noon(13));
        expect(r2.overdue).toBe(1);
        expect(mockDispatch).toHaveBeenCalledTimes(2);

        // mais um dia → outra cobrança (cadence=1 persiste)
        const r3 = await svc.runTick(noon(14));
        expect(r3.overdue).toBe(1);
        expect(mockDispatch).toHaveBeenCalledTimes(3);

        // helper do config foi consultado em cada tick (runtime, sem cache de construção).
        expect(mockUiConfig.getCobrancaCadence).toHaveBeenCalled();
        expect(mockUiConfig.getCobrancaCadence.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('controle #1406: com DEFAULT_CADENCE (recobrancaIntervalDays=2), NÃO re-cobra no dia seguinte', async () => {
        // CONTROLE do enforcement acima: com cadence=2 (default) e 1 dia entre cobranças,
        // a 2ª cobrança NÃO dispara — confirma que o teste positivo não é trivial e que o
        // sucesso do teste anterior é CAUSADO pelo dial, não por coincidência de timing.
        mockUiConfig.getCobrancaCadence.mockReturnValue({
            reminderDaysBefore: 1,
            recobrancaIntervalDays: 2, // DEFAULT — intervalo de 2 dias entre cobranças
            escalateAfterCobrancas: 99,
            prazoDeAceiteDays: 1,
        });

        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();

        await svc.runTick(noon(11)); // baseline
        await svc.runTick(noon(12)); // 1ª cobrança (lastCobrancaDay=undefined → Infinity >= 2)
        const dispatchesOverdueBefore = mockDispatch.mock.calls.filter((c) => c[0] === 'overdue').length;
        expect(dispatchesOverdueBefore).toBe(1); // só a 1ª cobrança

        // 1 dia após → daysSinceLast=1 < cadence=2 → NÃO cobra
        const r = await svc.runTick(noon(13));
        expect(r.overdue).toBe(0);
        // nenhuma chamada de dispatch overdue adicional — confirma que o cadence=2 foi respeitado.
        const dispatchesOverdueAfter = mockDispatch.mock.calls.filter((c) => c[0] === 'overdue').length;
        expect(dispatchesOverdueAfter).toBe(dispatchesOverdueBefore);
    });

    it('enforcement #1406: helper é consultado a cada tick (não cache de construção)', async () => {
        // Prova que NÃO há cache no construtor — uma mudança no config entre dois ticks é
        // visível no segundo tick (sem restart do serviço).
        mockUiConfig.getCobrancaCadence.mockReturnValueOnce({
            reminderDaysBefore: 0,
            recobrancaIntervalDays: 2,
            escalateAfterCobrancas: 99,
            prazoDeAceiteDays: 1,
        });
        mockUiConfig.getCobrancaCadence.mockReturnValueOnce({
            reminderDaysBefore: 0,
            recobrancaIntervalDays: 1, // muda entre ticks — sem restart, novo valor vale
            escalateAfterCobrancas: 99,
            prazoDeAceiteDays: 1,
        });

        mockDoli.listTasksFull.mockResolvedValue([{ id: '50', date_end: dueSec(10), progress: 0, fk_user_creat: '9' }]);
        const svc = newSvc();

        await svc.runTick(noon(11)); // baseline
        await svc.runTick(noon(12)); // 1ª cobrança (cadence=2 consumido)
        await svc.runTick(noon(13)); // com cadence=1 — re-cobra (1 dia após)
        const r = await svc.runTick(noon(14)); // continua cadence=1 — re-cobra
        expect(r.overdue).toBe(1);

        // pelo menos 3 leituras de config (uma por tick com tasks > 0)
        expect(mockUiConfig.getCobrancaCadence.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
});
