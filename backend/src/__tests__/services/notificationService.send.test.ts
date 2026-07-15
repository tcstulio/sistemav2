/**
 * notificationService.send — enforcement tests do gate de quiet-hours (#1407).
 *
 * Estes testes são o "teste de enforcement OBRIGATÓRIO" do acceptance criteria
 * do issue #1407: mocka `uiConfigService.getNotificationPolicy` para devolver
 * janelas diferentes em tempo real e valida que `dispatch()` (via
 * `channelRouter.sendWhatsApp` / `sendEmail`) é ou não chamado conforme a
 * janela. Sem o teste, PR rejeitado.
 *
 * Usa `vi.useFakeTimers()` + `vi.setSystemTime()` para controlar o relógio
 * do Node (espelha o que o spec pediu com `jest.useFakeTimers`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks hoistados ──────────────────────────────────────────────────────────
const mockGetNotificationPolicy = vi.hoisted(() => vi.fn());
const mockIsWithinQuietHours = vi.hoisted(() => vi.fn());
const sendWhatsAppSpy = vi.hoisted(() => vi.fn());
const sendEmailSpy = vi.hoisted(() => vi.fn());

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
    channelRouter: { sendWhatsApp: sendWhatsAppSpy, sendEmail: sendEmailSpy },
}));
vi.mock('../../services/uiConfigService', () => ({
    uiConfigService: {
        getNotificationPolicy: mockGetNotificationPolicy,
        isWithinQuietHours: mockIsWithinQuietHours,
    },
}));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { notificationService } from '../../services/notificationService';
import { isWithinQuietWindow } from '../../services/notifications/quietHours';

// ── Helpers ──────────────────────────────────────────────────────────────────
// Janela default — todas desabilitadas (regressão). Cada teste sobrescreve.
const allDisabled = () => ({
    quietHours: {
        whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        email:    { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
    },
    cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
    staleHours: 24,
    invoiceDueHorizonDays: 3,
});

// Janela whatsapp 23:00-07:00 SP (do acceptance criteria #1).
const whatsappNight = (over: any = {}) => ({
    quietHours: {
        whatsapp: { enabled: true, startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false, ...over },
        email:    { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
    },
    cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
    staleHours: 24,
    invoiceDueHorizonDays: 3,
});

// SP = UTC-3 (sem DST desde 2019).
//   2025-01-15 (Wed): 02:30Z = 23:30 SP Jan 15
//                      12:00Z = 09:00 SP
//                      13:00Z = 10:00 SP
//   2025-01-16 (Thu): 10:00Z = 07:00 SP (fim da janela 23-07)

describe('notificationService.send — quiet-hours enforcement (#1407)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        notificationService.dispose();
        vi.useFakeTimers();
        // Faz `isWithinQuietHours` (mockado) refletir a policy mockada —
        // delega para o `isWithinQuietWindow` real. Assim, mudar
        // `mockGetNotificationPolicy` muda o gate automaticamente.
        mockIsWithinQuietHours.mockImplementation((now?: Date, channel?: any) => {
            if (channel === 'in-app') return false;
            const policy = mockGetNotificationPolicy();
            const ch: any = channel || 'whatsapp';
            return isWithinQuietWindow(now ?? new Date(), policy.quietHours[ch]);
        });
    });

    afterEach(() => {
        notificationService.dispose();
        vi.useRealTimers();
    });

    // ── AC #1 — spec literal do issue: 23:00-07:00 SP, envio às 23:30 ────────
    it('AC#1 — quietHours 23:00-07:00 SP + envio às 23:30 → NÃO despacha agora; agenda para 07:00 SP', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP Jan 15
        mockGetNotificationPolicy.mockReturnValue(whatsappNight());

        const result = await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: ['whatsapp'],
            recipientPhone: '+5511999999999',
        });

        // NÃO despachou agora.
        expect(sendWhatsAppSpy).not.toHaveBeenCalled();
        expect(result.dispatchedChannels).toEqual([]);
        // scheduledFor = 07:00 SP Jan 16 = 2025-01-16T10:00:00.000Z
        expect(result.deferred).toEqual([
            { channel: 'whatsapp', scheduledFor: new Date('2025-01-16T10:00:00.000Z') },
        ]);
        // Notificação persistida com channels=[] (placeholder) — ID reservado p/ update futuro.
        expect(result.notification.id).toMatch(/^notif_/);
        expect(result.notification.channels).toEqual([]);
        expect(result.notification.deliveredTo).toEqual([]);
        // Há exatamente 1 agendamento vivo.
        expect(notificationService.getScheduledCount()).toBe(1);

        // Avança o relógio fake para o instante alvo (07:30 SP Jan 16) e dispara o timer.
        await vi.advanceTimersByTimeAsync(7.5 * 60 * 60 * 1000);

        // Agora sim, whatsapp foi despachado via channelRouter.sendWhatsApp.
        expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
        expect(sendWhatsAppSpy).toHaveBeenCalledWith('+5511999999999@c.us', 'msg');
        expect(notificationService.getScheduledCount()).toBe(0);
    });

    // ── AC #2 — janela desabilitada / vazia → envio normal (sem regressão) ──
    it('AC#2 — janela DESABILITADA → todos os canais despachados normalmente (sem regressão)', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP
        mockGetNotificationPolicy.mockReturnValue(allDisabled());

        const result = await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: ['whatsapp', 'email'],
            recipientPhone: '+5511999999999',
            recipientEmail: 'u@x.com',
        });

        expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
        expect(sendEmailSpy).toHaveBeenCalledTimes(1);
        expect(result.dispatchedChannels).toEqual(['whatsapp', 'email']);
        expect(result.deferred).toEqual([]);
        expect(notificationService.getScheduledCount()).toBe(0);
    });

    it('AC#2 — channels vazio cai em ["in-app"] e despacha sem passar pelo gate', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z'));
        mockGetNotificationPolicy.mockReturnValue(whatsappNight());

        const result = await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: [],
        });

        // in-app sempre passa (regra benigna) — gate não consulta.
        expect(result.dispatchedChannels).toEqual(['in-app']);
        expect(result.deferred).toEqual([]);
        expect(notificationService.getScheduledCount()).toBe(0);
    });

    // ── AC #3 — canal crítico (security/OTP) fura o gate ────────────────────
    it('AC#3 — critical=true FURA o gate: notificação despachada mesmo em quiet hours', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP Jan 15 — dentro do silêncio
        mockGetNotificationPolicy.mockReturnValue(whatsappNight());

        const result = await notificationService.send({
            event: 'custom',
            title: 'OTP 123456',
            message: 'Seu código de acesso',
            channels: ['whatsapp'],
            recipientPhone: '+5511999999999',
            critical: true,
        });

        // Despachou imediatamente, sem agendamento.
        expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
        expect(sendWhatsAppSpy).toHaveBeenCalledWith('+5511999999999@c.us', 'Seu código de acesso');
        expect(result.dispatchedChannels).toEqual(['whatsapp']);
        expect(result.deferred).toEqual([]);
        expect(notificationService.getScheduledCount()).toBe(0);
    });

    // ── AC #4 — ENFORCEMENT TEST: muda a janela em tempo real ──────────────
    it('AC#4 — ENFORCEMENT: muda getNotificationPolicy em tempo real → dispatch obedece à janela vigente', async () => {
        // Tick 1: janela desabilitada → envia normal.
        vi.setSystemTime(new Date('2025-01-15T12:00:00Z')); // 09:00 SP
        mockGetNotificationPolicy.mockReturnValue(allDisabled());

        const r1 = await notificationService.send({
            event: 'custom',
            title: 'tick1',
            message: 'm1',
            channels: ['whatsapp'],
            recipientPhone: '+5511111111111',
        });
        expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
        expect(r1.dispatchedChannels).toEqual(['whatsapp']);
        expect(notificationService.getScheduledCount()).toBe(0);

        // Tick 2: mesma hora, mas admin acabou de LIGAR quiet hours 23-07 — não
        // estamos no silêncio (09:00 SP), então passa. Mas se mudarmos o relógio
        // para 23:30 SP COM a janela ligada, deve adiar.
        mockGetNotificationPolicy.mockReturnValue(whatsappNight());
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP

        const r2 = await notificationService.send({
            event: 'custom',
            title: 'tick2',
            message: 'm2',
            channels: ['whatsapp'],
            recipientPhone: '+5522222222222',
        });
        // NÃO despachou agora — está dentro da janela.
        expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1); // continua 1 (não somou)
        expect(r2.deferred).toEqual([
            { channel: 'whatsapp', scheduledFor: new Date('2025-01-16T10:00:00.000Z') },
        ]);
        expect(notificationService.getScheduledCount()).toBe(1);

        // Avança para 07:00 SP — o agendamento dispara.
        await vi.advanceTimersByTimeAsync(7.5 * 60 * 60 * 1000);
        expect(sendWhatsAppSpy).toHaveBeenCalledTimes(2);
        expect(sendWhatsAppSpy).toHaveBeenLastCalledWith('+5522222222222@c.us', 'm2');

        // Tick 3: admin DESLIGA a janela (já estamos em 07:30 SP, fora do silêncio anyway).
        mockGetNotificationPolicy.mockReturnValue(allDisabled());
        const r3 = await notificationService.send({
            event: 'custom',
            title: 'tick3',
            message: 'm3',
            channels: ['whatsapp'],
            recipientPhone: '+5533333333333',
        });
        expect(sendWhatsAppSpy).toHaveBeenCalledTimes(3);
        expect(r3.dispatchedChannels).toEqual(['whatsapp']);
    });

    // ── Casos adicionais / regression guards ────────────────────────────────
    it('canal in-app SEMPRE passa, mesmo com janela do canal enabled', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP
        mockGetNotificationPolicy.mockReturnValue({
            quietHours: {
                whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
                email:    { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
                'in-app': { enabled: true,  startHHmm: '00:00', endHHmm: '23:59', weekdaysOnly: false },
            },
            cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
            staleHours: 24,
            invoiceDueHorizonDays: 3,
        });

        const r = await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: ['in-app'],
        });
        expect(r.dispatchedChannels).toEqual(['in-app']);
        expect(r.deferred).toEqual([]);
    });

    it('canais mistos (in-app + whatsapp em silêncio) → in-app agora, whatsapp agendado', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP
        mockGetNotificationPolicy.mockReturnValue(whatsappNight());

        const r = await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: ['in-app', 'whatsapp'],
            recipientPhone: '+5511999999999',
        });

        // in-app agora, whatsapp adiado.
        expect(r.dispatchedChannels).toEqual(['in-app']);
        expect(r.deferred).toEqual([
            { channel: 'whatsapp', scheduledFor: new Date('2025-01-16T10:00:00.000Z') },
        ]);
        expect(sendWhatsAppSpy).not.toHaveBeenCalled();
        expect(notificationService.getScheduledCount()).toBe(1);

        // Notificação persistida tem channels=['in-app'] (entrega imediata).
        expect(r.notification.channels).toEqual(['in-app']);
        expect(r.notification.deliveredTo).toEqual(['in-app']);

        // Avança o relógio → whatsapp é entregue; channels/deliveredTo atualizam.
        await vi.advanceTimersByTimeAsync(7.5 * 60 * 60 * 1000);
        expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
        const updated = notificationService.getById(r.notification.id);
        expect(updated?.deliveredTo).toContain('whatsapp');
        expect(updated?.channels).toContain('whatsapp');
    });

    it('email em quiet hours → canal removido do dispatch imediato e agendado', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z'));
        mockGetNotificationPolicy.mockReturnValue({
            quietHours: {
                whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
                email:    { enabled: true,  startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false },
                'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
            },
            cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
            staleHours: 24,
            invoiceDueHorizonDays: 3,
        });

        const r = await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: ['in-app', 'email'],
            recipientEmail: 'u@x.com',
        });

        expect(r.dispatchedChannels).toEqual(['in-app']);
        expect(r.deferred.map((d) => d.channel)).toEqual(['email']);
        expect(sendEmailSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(7.5 * 60 * 60 * 1000);
        expect(sendEmailSpy).toHaveBeenCalledTimes(1);
        expect(sendEmailSpy).toHaveBeenCalledWith('u@x.com', 'oi', 'msg');
    });

    it('weekdaysOnly + sábado 12:00 SP (fora do HH:mm) → whatsapp ainda bloqueado', async () => {
        // 2025-01-18 (Sat) 12:00 SP = 15:00Z — fora de 23-07, mas fim de semana.
        vi.setSystemTime(new Date('2025-01-18T15:00:00Z'));
        mockGetNotificationPolicy.mockReturnValue(whatsappNight({ weekdaysOnly: true }));

        const r = await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: ['whatsapp'],
            recipientPhone: '+5511999999999',
        });

        expect(r.deferred).toHaveLength(1);
        expect(r.deferred[0].channel).toBe('whatsapp');
        expect(sendWhatsAppSpy).not.toHaveBeenCalled();

        // scheduledFor pula o fim de semana → segunda 07:00 SP = 2025-01-20T10:00:00.000Z.
        // (window endHHmm='07:00', então `nextQuietEnd` retorna 07:00 SP do próximo dia útil.)
        expect(r.deferred[0].scheduledFor.toISOString()).toBe('2025-01-20T10:00:00.000Z');
    });

    it('TODOS os canais adiados → cria placeholder (channels=[]), scheduledCount=1', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z'));
        mockGetNotificationPolicy.mockReturnValue({
            quietHours: {
                whatsapp: { enabled: true, startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false },
                email:    { enabled: true, startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false },
                'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
            },
            cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
            staleHours: 24,
            invoiceDueHorizonDays: 3,
        });

        const r = await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: ['whatsapp', 'email'],
            recipientPhone: '+5511999999999',
            recipientEmail: 'u@x.com',
        });

        expect(r.dispatchedChannels).toEqual([]);
        expect(r.deferred.map((d) => d.channel).sort()).toEqual(['email', 'whatsapp']);
        expect(sendWhatsAppSpy).not.toHaveBeenCalled();
        expect(sendEmailSpy).not.toHaveBeenCalled();
        expect(notificationService.getScheduledCount()).toBe(2);
        // Placeholder: ID reservado, channels=[].
        expect(r.notification.id).toMatch(/^notif_/);
        expect(r.notification.channels).toEqual([]);

        // Avança o relógio para 07:00 SP — ambos disparam.
        await vi.advanceTimersByTimeAsync(7.5 * 60 * 60 * 1000);
        expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
        expect(sendEmailSpy).toHaveBeenCalledTimes(1);
        expect(notificationService.getScheduledCount()).toBe(0);
        const updated = notificationService.getById(r.notification.id);
        expect(updated?.deliveredTo.sort()).toEqual(['email', 'whatsapp']);
        expect(updated?.channels.sort()).toEqual(['email', 'whatsapp']);
    });

    it('dispose() limpa todos os timers pendentes (sem fire)', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z'));
        mockGetNotificationPolicy.mockReturnValue(whatsappNight());

        await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: ['whatsapp'],
            recipientPhone: '+5511999999999',
        });
        expect(notificationService.getScheduledCount()).toBe(1);

        notificationService.dispose();
        expect(notificationService.getScheduledCount()).toBe(0);

        // Avança o relógio — não há mais nada agendado, então não dispara.
        await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
        expect(sendWhatsAppSpy).not.toHaveBeenCalled();
    });

    it('quando o canal deferido falha no fire, marca failedChannels e NÃO joga', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z'));
        mockGetNotificationPolicy.mockReturnValue(whatsappNight());

        // Faz o channelRouter LANÇAR no fire (WhatsApp sem chatId tratado).
        sendWhatsAppSpy.mockImplementation(() => { throw new Error('whatsapp down'); });

        const r = await notificationService.send({
            event: 'custom',
            title: 'oi',
            message: 'msg',
            channels: ['whatsapp'],
            recipientPhone: '+5511999999999',
        });
        expect(notificationService.getScheduledCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(7.5 * 60 * 60 * 1000);

        const updated = notificationService.getById(r.notification.id);
        expect(updated?.failedChannels).toContain('whatsapp');
        expect(updated?.deliveredTo).not.toContain('whatsapp');
    });
});