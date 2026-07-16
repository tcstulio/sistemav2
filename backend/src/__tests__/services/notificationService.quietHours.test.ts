import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    promises: {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/channelRouter', () => ({
    channelRouter: { sendWhatsApp: vi.fn().mockResolvedValue({ success: true }), sendEmail: vi.fn().mockResolvedValue({ success: true }) },
}));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { notificationService, CRITICAL_EVENTS } from '../../services/notificationService';
import { uiConfigService } from '../../services/uiConfigService';
import { channelRouter } from '../../services/channelRouter';
import { socketService } from '../../services/socketService';

const mockedRouterSendWhatsApp = vi.mocked(channelRouter.sendWhatsApp);
const mockedRouterSendEmail = vi.mocked(channelRouter.sendEmail);
const mockedSocketEmit = vi.mocked(socketService.emit);

// Spies sobre o singleton real — assim mantemos a integração real entre
// `notificationService` e os helpers de `uiConfigService` e controlamos só o
// resultado do gate. Cada teste ajusta o retorno conforme a janela que quer simular.
let isWithinSpy: ReturnType<typeof vi.spyOn>;
let nextEndSpy: ReturnType<typeof vi.spyOn>;
let getPolicySpy: ReturnType<typeof vi.spyOn>;

const OFF_POLICY: any = {
    cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
    quietHours: {
        whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        email:    { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
    },
    staleHours: 24,
    invoiceDueHorizonDays: 3,
};

const ON_POLICY_23_07: any = {
    ...OFF_POLICY,
    quietHours: {
        whatsapp: { enabled: true, startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false },
        email:    { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
    },
};

// Helper: deriva `isWithinQuietHours` direto do relógio fake, baseado na janela
// 23:00–07:00 America/Sao_Paulo (cobre o enforcement do critério #4 sem depender
// de detalhes de implementação do helper puro).
const isWithin23to07 = (channel?: any): boolean => {
    if (channel && channel !== 'whatsapp') return false;
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const nowMin = h * 60 + m;
    return nowMin >= 23 * 60 || nowMin < 7 * 60;
};

describe('notificationService — quietHours central gate (#1407)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Limpa estado da fila do singleton entre testes (sem isso, restos vazariam entre casos).
        (notificationService as any).scheduledDispatch = [];
        (notificationService as any).scheduledDispatchTimer = null;

        // default: policy desabilitada, nada em quiet hours, nextEnd = now
        getPolicySpy = vi.spyOn(uiConfigService, 'getNotificationPolicy').mockReturnValue(OFF_POLICY);
        isWithinSpy = vi.spyOn(uiConfigService, 'isWithinQuietHours').mockReturnValue(false);
        nextEndSpy = vi.spyOn(uiConfigService, 'nextQuietHoursEnd').mockReturnValue(new Date());
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // ─── Critério de aceite 2: sem regressão ─────────────────────────────────────
    it('CRITÉRIO 2: janela desabilitada/vazia → envio normal (sem regressão)', async () => {
        // policy default já tem tudo enabled=false; spy confirma
        const notif = await notificationService.create({
            event: 'invoice.overdue',
            title: 'T',
            message: 'M',
            channels: ['whatsapp', 'email'],
            recipientPhone: '5511999999999',
            recipientEmail: 'a@b.com',
        });

        expect(mockedRouterSendWhatsApp).toHaveBeenCalledTimes(1);
        expect(mockedRouterSendEmail).toHaveBeenCalledTimes(1);
        expect(notif.deliveredTo.sort()).toEqual(['email', 'whatsapp']);
        expect(notif.failedChannels).toEqual([]);
        expect(notificationService.getScheduledDispatchSize()).toBe(0);
    });

    // ─── Critério de aceite 1: bloqueia em quiet hours, agenda para 07:00 ─────────
    it('CRITÉRIO 1: whatsapp em quiet hours (23:00–07:00) às 23:30 → NÃO despacha agora, agenda para 07:00 do dia seguinte', async () => {
        // janela 23-07 ativa para whatsapp
        getPolicySpy.mockReturnValue(ON_POLICY_23_07);
        isWithinSpy.mockImplementation((channel: any) => channel === 'whatsapp');
        const scheduledEnd = new Date('2025-01-16T09:00:00.000Z'); // 06:00 SP = 09:00Z (SP = UTC-3, sem DST)
        nextEndSpy.mockReturnValue(scheduledEnd);

        const notif = await notificationService.create({
            event: 'invoice.overdue',
            title: 'Fatura',
            message: 'msg',
            channels: ['whatsapp', 'email'],
            recipientPhone: '5511999999999',
            recipientEmail: 'a@b.com',
        });

        // whatsapp bloqueado: provider NÃO chamado, email passa normal
        expect(mockedRouterSendWhatsApp).not.toHaveBeenCalled();
        expect(mockedRouterSendEmail).toHaveBeenCalledTimes(1);

        // canal bloqueado NÃO entra em deliveredTo (ainda não saiu da fila)
        expect(notif.deliveredTo).not.toContain('whatsapp');
        expect(notif.deliveredTo).toContain('email');

        // item agendado na fila, com scheduledFor = 07:00 SP
        expect(notificationService.getScheduledDispatchSize()).toBe(1);
        const snapshot = notificationService.getScheduledDispatchSnapshot();
        expect(snapshot).toHaveLength(1);
        expect(snapshot[0].channel).toBe('whatsapp');
        expect(snapshot[0].notification.id).toBe(notif.id);
        expect(snapshot[0].scheduledFor).toBe(scheduledEnd.getTime());
    });

    // ─── Critério de aceite 3: evento crítico fura o gate ─────────────────────────
    it('CRITÉRIO 3: evento crítico (otp/security/agent.action) fura o gate mesmo em quiet hours', async () => {
        // whatsapp em quiet hours, mas evento crítico
        getPolicySpy.mockReturnValue(ON_POLICY_23_07);
        isWithinSpy.mockReturnValue(true); // regra diria "bloqueia", mas o gate NÃO consulta p/ crítico

        const notif = await notificationService.create({
            event: 'otp',
            title: 'Seu código',
            message: '123456',
            channels: ['whatsapp', 'email'],
            recipientPhone: '5511999999999',
            recipientEmail: 'a@b.com',
        });

        // bypass: ambos os canais saem na hora
        expect(mockedRouterSendWhatsApp).toHaveBeenCalledTimes(1);
        expect(mockedRouterSendEmail).toHaveBeenCalledTimes(1);
        expect(notif.deliveredTo.sort()).toEqual(['email', 'whatsapp']);
        expect(notificationService.getScheduledDispatchSize()).toBe(0);

        // sanity: CRITICAL_EVENTS contém exatamente os 3 documentados
        expect(CRITICAL_EVENTS.has('otp')).toBe(true);
        expect(CRITICAL_EVENTS.has('security')).toBe(true);
        expect(CRITICAL_EVENTS.has('agent.action')).toBe(true);
        expect(CRITICAL_EVENTS.has('invoice.overdue')).toBe(false);
    });

    // ─── Critério de aceite 4: enforcement com fake timers ───────────────────────
    it('CRITÉRIO 4 (enforcement OBRIGATÓRIO): muda a janela em tempo real e dispatch é chamado/NÃO chamado conforme', async () => {
        vi.useFakeTimers();
        // helpers dirigidos pelo relógio fake — assim o teste reflete um enforcement
        // REAL do gate (a decisão de bloquear muda só com a hora, sem mockar a hora).
        getPolicySpy.mockReturnValue(ON_POLICY_23_07);
        isWithinSpy.mockImplementation((channel: any) => isWithin23to07(channel));
        nextEndSpy.mockImplementation((channel: any, now: Date) => {
            // 07:00 SP do próximo dia em que a janela abre; implementação simplificada p/ teste
            // (07:00 SP = 10:00Z — SP=UTC-3 sem DST, simplificado). Avança até o item ser > now.
            const candidate = new Date(now);
            candidate.setUTCHours(10, 0, 0, 0);
            while (candidate.getTime() <= now.getTime()) {
                candidate.setUTCDate(candidate.getUTCDate() + 1);
            }
            return candidate;
        });

        // ── Fase 1: agora = 12:00 SP (fora de 23-07), policy ON → DESPACHA ──────
        vi.setSystemTime(new Date('2025-01-15T15:00:00.000Z')); // 12:00 SP, fora da janela
        await notificationService.create({
            event: 'invoice.overdue',
            title: 'A',
            message: 'A',
            channels: ['whatsapp'],
            recipientPhone: '5511999999999',
        });
        expect(mockedRouterSendWhatsApp).toHaveBeenCalledTimes(1);
        expect(notificationService.getScheduledDispatchSize()).toBe(0);

        // ── Fase 2: agora = 23:30 SP (em quiet hours), mesma policy → BLOQUEIA ──
        mockedRouterSendWhatsApp.mockClear();
        vi.setSystemTime(new Date('2025-01-16T02:30:00.000Z')); // 23:30 SP Jan 15
        await notificationService.create({
            event: 'invoice.overdue',
            title: 'B',
            message: 'B',
            channels: ['whatsapp'],
            recipientPhone: '5511999999999',
        });
        expect(mockedRouterSendWhatsApp).not.toHaveBeenCalled();
        expect(notificationService.getScheduledDispatchSize()).toBe(1);

        // ── Fase 3: avançar o relógio para depois das 07:00 SP → drain → DESPACHA
        mockedRouterSendWhatsApp.mockClear();
        vi.setSystemTime(new Date('2025-01-16T11:00:00.000Z')); // 08:00 SP Jan 16 (janela abriu)
        // O drain lazy acontece no próximo create(); dispara um create inócuo p/ forçar.
        await notificationService.create({
            event: 'custom',
            title: 'tickle',
            message: '.',
            channels: ['in-app'],
        });
        expect(mockedRouterSendWhatsApp).toHaveBeenCalledTimes(1); // o item diferido finalmente saiu
        expect(notificationService.getScheduledDispatchSize()).toBe(0);
    });

    // ─── Sanity: in-app nunca bloqueia, mesmo se regra[in-app].enabled=true ─────
    it('in-app SEMPRE passa, mesmo se a regra[in-app].enabled=true (canal benigno)', async () => {
        getPolicySpy.mockReturnValue({
            ...OFF_POLICY,
            quietHours: {
                whatsapp: { enabled: true, startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false },
                email:    { enabled: true, startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false },
                'in-app': { enabled: true, startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false },
            },
        });
        isWithinSpy.mockReturnValue(true); // simula "tudo em quiet" — mas in-app não consulta

        const notif = await notificationService.create({
            event: 'invoice.overdue',
            title: 'X',
            message: 'X',
            channels: ['in-app', 'whatsapp', 'email'],
            recipientPhone: '5511999999999',
            recipientEmail: 'a@b.com',
        });

        // in-app foi emitido; externos bloqueados
        expect(mockedSocketEmit).toHaveBeenCalled();
        expect(mockedRouterSendWhatsApp).not.toHaveBeenCalled();
        expect(mockedRouterSendEmail).not.toHaveBeenCalled();
        expect(notif.deliveredTo).toEqual(['in-app']);
        expect(notificationService.getScheduledDispatchSize()).toBe(2); // whatsapp + email na fila
    });

    // ─── Sanity: queue draining reentregou o canal após janela abrir ─────────────
    it('queue drena via tickScheduledDispatch(): itens cujo scheduledFor chegou saem pelo dispatch', async () => {
        // Força dois itens na fila (mock direto, sem passar por create — testa o drain isolado)
        const notif1: any = {
            id: 'n1', event: 'invoice.overdue', title: 'A', message: 'A', channels: ['whatsapp'],
            priority: 'medium', read: false, createdAt: Date.now(),
            deliveredTo: [], failedChannels: [], recipientPhone: '5511999999999',
        };
        const notif2: any = {
            id: 'n2', event: 'invoice.overdue', title: 'B', message: 'B', channels: ['email'],
            priority: 'medium', read: false, createdAt: Date.now(),
            deliveredTo: [], failedChannels: [], recipientEmail: 'a@b.com',
        };
        const past = Date.now() - 1000;
        (notificationService as any).scheduledDispatch = [
            { id: 'q1', notification: notif1, channel: 'whatsapp', scheduledFor: past, originalDueAt: past },
            { id: 'q2', notification: notif2, channel: 'email',    scheduledFor: past, originalDueAt: past },
        ];
        // janela aberta (default mock = false)
        await notificationService.tickScheduledDispatch();

        expect(mockedRouterSendWhatsApp).toHaveBeenCalledTimes(1);
        expect(mockedRouterSendEmail).toHaveBeenCalledTimes(1);
        expect(notif1.deliveredTo).toContain('whatsapp');
        expect(notif2.deliveredTo).toContain('email');
        expect(notificationService.getScheduledDispatchSize()).toBe(0);
    });

    // ─── Sanity: tickScheduledDispatch preserva itens cujo scheduledFor é futuro ─
    it('queue: itens com scheduledFor no futuro permanecem na fila', async () => {
        const notif: any = {
            id: 'n1', event: 'invoice.overdue', title: 'A', message: 'A', channels: ['whatsapp'],
            priority: 'medium', read: false, createdAt: Date.now(), deliveredTo: [], failedChannels: [],
        };
        const future = Date.now() + 60 * 60 * 1000; // +1h
        (notificationService as any).scheduledDispatch = [
            { id: 'q1', notification: notif, channel: 'whatsapp', scheduledFor: future, originalDueAt: Date.now() },
        ];
        await notificationService.tickScheduledDispatch();
        expect(mockedRouterSendWhatsApp).not.toHaveBeenCalled();
        expect(notificationService.getScheduledDispatchSize()).toBe(1);
    });

    // ─── Sanity: snapshot é defensivo contra mutação externa ─────────────────────
    it('getScheduledDispatchSnapshot devolve clones — mutar não afeta estado interno', () => {
        const notif: any = { id: 'n1', event: 'custom', title: 'A', message: 'A', channels: ['whatsapp'], priority: 'medium', read: false, createdAt: Date.now(), deliveredTo: [], failedChannels: [] };
        (notificationService as any).scheduledDispatch = [
            { id: 'q1', notification: notif, channel: 'whatsapp', scheduledFor: Date.now() + 1000, originalDueAt: Date.now() },
        ];
        const snap = notificationService.getScheduledDispatchSnapshot();
        snap[0].channel = 'email';
        snap.length = 0;
        // original intacto
        expect(notificationService.getScheduledDispatchSize()).toBe(1);
        expect(notificationService.getScheduledDispatchSnapshot()[0].channel).toBe('whatsapp');
    });
});