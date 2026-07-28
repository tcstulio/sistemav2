import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #1407 — Teste de enforcement do gate central de quiet-hours em notificationService.
//
// Mesmo molde de mocks do notificationService.test.ts (fs/atomicWrite/socketService/
// channelRouter/logger) p/ zerar efeitos colaterais de I/O. O `uiConfigService` fica
// REAL: o teste controla a janela espiando `uiConfigService.getNotificationPolicy`
// (critério de aceite #4 — "mocka getNotificationPolicy p/ retornar diferentes janelas
// em tempo real e valida que dispatch foi chamado/NÃO chamado conforme a janela").
// A lógica real de `isWithinQuietHours` roda e lê a política mockada → o teste exerce
// o gate de ponta-a-ponta, não um stub.

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
    channelRouter: { sendWhatsApp: vi.fn(), sendEmail: vi.fn() },
}));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { notificationService } from '../../services/notificationService';
import { uiConfigService } from '../../services/uiConfigService';
import { channelRouter } from '../../services/channelRouter';

// SP = UTC-3 (DST abolido em 2019). Referências usadas nos testes:
//   23:30 SP Jan 15 = 2025-01-16T02:30:00Z
//   07:00 SP Jan 16 = 2025-01-16T10:00:00.000Z
//   09:00 SP Jan 15 = 2025-01-15T12:00:00Z  (fora do quiet 23-07)

type Rule = { enabled: boolean; startHHmm: string; endHHmm: string; weekdaysOnly: boolean };

const on23_07: Rule = { enabled: true, startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false };
const off: Rule = { enabled: false, startHHmm: '23:00', endHHmm: '07:00', weekdaysOnly: false };

/** Espia getNotificationPolicy p/ devolver uma política com a janela dada por canal. */
function mockPolicy(quietHours: { whatsapp: Rule; email: Rule; 'in-app': Rule }) {
    vi.spyOn(uiConfigService, 'getNotificationPolicy').mockReturnValue({
        cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
        quietHours,
        staleHours: 24,
        invoiceDueHorizonDays: 3,
    });
}

const resetStore = () => {
    (notificationService as any).data.notifications = [];
    (notificationService as any).scheduledDispatches = [];
};

describe('notificationService — gate central de quiet-hours (#1407)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (channelRouter.sendWhatsApp as any).mockResolvedValue({ success: true, messageId: 'x' });
        (channelRouter.sendEmail as any).mockResolvedValue({ success: true });
        // default: janela desabilitada (fail-open) — cada teste sobrescreve conforme a janela.
        mockPolicy({ whatsapp: off, email: off, 'in-app': off });
        resetStore();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('AC#1: em quiet hours (23:30 SP) whatsapp/email NÃO despachados agora, ficam agendados p/ 07:00', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP Jan 15
        mockPolicy({ whatsapp: on23_07, email: on23_07, 'in-app': off });
        const deliverSpy = vi.spyOn(notificationService as any, 'deliver');

        await notificationService.create({
            event: 'invoice.overdue', title: 'T', message: 'M',
            channels: ['whatsapp', 'email', 'in-app'],
            recipient: 'u1', recipientPhone: '5511999990000', recipientEmail: 'a@b.com',
        });

        // Canais externos NÃO chegaram ao provider neste instante.
        expect(channelRouter.sendWhatsApp).not.toHaveBeenCalled();
        expect(channelRouter.sendEmail).not.toHaveBeenCalled();
        // deliver (despacho) foi chamado SÓ p/ in-app (benigno, sempre passa).
        expect(deliverSpy.mock.calls.map((c: any[]) => c[1])).toEqual(['in-app']);

        // Ficaram agendados — ambos p/ 07:00 SP Jan 16 (2025-01-16T10:00:00Z).
        const queue = notificationService.getScheduledDispatches();
        expect(queue).toHaveLength(2);
        const expectedFor = new Date('2025-01-16T10:00:00.000Z').getTime();
        expect(queue.every((d) => d.scheduledFor === expectedFor)).toBe(true);
        expect(queue.map((d) => d.channel).sort()).toEqual(['email', 'whatsapp']);
    });

    it('AC#2: janela desabilitada/vazia → despacho normal (sem regressão)', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP — estaria em quiet se ON
        mockPolicy({ whatsapp: off, email: off, 'in-app': off });

        await notificationService.create({
            event: 'custom', title: 'T', message: 'M',
            channels: ['whatsapp'], recipient: 'u1', recipientPhone: '5511999990000',
        });

        expect(channelRouter.sendWhatsApp).toHaveBeenCalledTimes(1);
        expect(notificationService.getScheduledDispatches()).toHaveLength(0);
    });

    it('AC#3: notificação crítica (ex.: OTP) fura o gate mesmo em quiet hours', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // quiet
        mockPolicy({ whatsapp: on23_07, email: on23_07, 'in-app': on23_07 });

        await notificationService.create({
            event: 'custom', title: 'Seu código', message: 'OTP 123456',
            channels: ['whatsapp'], recipient: 'u1', recipientPhone: '5511999990000',
            critical: true,
        });

        expect(channelRouter.sendWhatsApp).toHaveBeenCalledTimes(1);
        expect(notificationService.getScheduledDispatches()).toHaveLength(0);
    });

    it('AC#4 (enforcement): getNotificationPolicy controla o gate — mesma hora, janela diferente muda o despacho', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP

        // Janela ON p/ whatsapp → NÃO despacha (dispatch NÃO chamado).
        mockPolicy({ whatsapp: on23_07, email: off, 'in-app': off });
        await notificationService.create({
            event: 'custom', title: 'T', message: 'M',
            channels: ['whatsapp'], recipient: 'u1', recipientPhone: '5511999990000',
        });
        expect(channelRouter.sendWhatsApp).not.toHaveBeenCalled();

        // Mesma hora, troca a política p/ janela OFF → despacha agora (dispatch chamado).
        mockPolicy({ whatsapp: off, email: off, 'in-app': off });
        await notificationService.create({
            event: 'custom', title: 'T2', message: 'M2',
            channels: ['whatsapp'], recipient: 'u2', recipientPhone: '5511999990001',
        });
        expect(channelRouter.sendWhatsApp).toHaveBeenCalledTimes(1);
    });

    it('AC#1 (reschedule): worker despacha o adiado quando a janela abre (07:00 SP)', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP — quiet
        mockPolicy({ whatsapp: on23_07, email: off, 'in-app': off });

        await notificationService.create({
            event: 'custom', title: 'T', message: 'M',
            channels: ['whatsapp'], recipient: 'u1', recipientPhone: '5511999990000',
        });
        expect(channelRouter.sendWhatsApp).not.toHaveBeenCalled();
        expect(notificationService.getScheduledDispatches()).toHaveLength(1);

        // Avança o relógio p/ 07:00 SP (fim da janela) e processa a fila.
        vi.setSystemTime(new Date('2025-01-16T10:00:00.000Z'));
        const delivered = await notificationService.processScheduledDispatch();

        expect(delivered).toBe(1);
        expect(channelRouter.sendWhatsApp).toHaveBeenCalledTimes(1);
        expect(notificationService.getScheduledDispatches()).toHaveLength(0);
    });

    it('in-app SEMPRE passa pelo gate (canal benigno) mesmo com quietHours[in-app] ON', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // quiet
        mockPolicy({ whatsapp: on23_07, email: on23_07, 'in-app': on23_07 });

        await notificationService.create({
            event: 'custom', title: 'T', message: 'M',
            channels: ['in-app'], recipient: 'u1',
        });

        const { socketService } = await import('../../services/socketService');
        expect((socketService.emit as any)).toHaveBeenCalled();
        expect(notificationService.getScheduledDispatches()).toHaveLength(0);
    });

    it('canal por canal: whatsapp ON + email OFF → só whatsapp é adiado', async () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // quiet
        mockPolicy({ whatsapp: on23_07, email: off, 'in-app': off });

        await notificationService.create({
            event: 'custom', title: 'T', message: 'M',
            channels: ['whatsapp', 'email', 'in-app'],
            recipient: 'u1', recipientPhone: '5511999990000', recipientEmail: 'a@b.com',
        });

        // email passou agora; whatsapp adiado; in-app passou agora.
        expect(channelRouter.sendEmail).toHaveBeenCalledTimes(1);
        expect(channelRouter.sendWhatsApp).not.toHaveBeenCalled();
        const queue = notificationService.getScheduledDispatches();
        expect(queue).toHaveLength(1);
        expect(queue[0].channel).toBe('whatsapp');
    });

    it('isWithinQuietHours é o ponto de leitura isolável: lê getNotificationPolicy ao vivo', () => {
        vi.setSystemTime(new Date('2025-01-16T02:30:00Z')); // 23:30 SP
        mockPolicy({ whatsapp: on23_07, email: off, 'in-app': off });

        expect(uiConfigService.isWithinQuietHours(new Date('2025-01-16T02:30:00Z'), 'whatsapp')).toBe(true);
        expect(uiConfigService.isWithinQuietHours(new Date('2025-01-16T02:30:00Z'), 'email')).toBe(false);

        // Fora da janela (09:00 SP) → false mesmo p/ whatsapp.
        expect(uiConfigService.isWithinQuietHours(new Date('2025-01-15T12:00:00Z'), 'whatsapp')).toBe(false);
    });
});
