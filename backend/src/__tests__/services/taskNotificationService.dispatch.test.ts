import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks hoistados ──────────────────────────────────────────────────────────
const mockCreate = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'notif_test' }));

const mockDoli = vi.hoisted(() => ({
    getTaskContacts: vi.fn(),
    getUserById: vi.fn(async (id: string) => ({
        id,
        firstname: 'Test',
        lastname: 'User',
        email: `${id}@x.com`,
        user_mobile: '+5511999999999',
    })),
}));

const mockUiGet = vi.hoisted(() => vi.fn());

const loggerSpies = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({ createLogger: () => loggerSpies }));

vi.mock('../../services/notificationService', () => ({
    notificationService: { create: mockCreate },
}));

vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDoli }));

vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: mockUiGet } }));

vi.mock('../../services/notificationTemplates', () => ({
    renderTaskTemplate: vi.fn(() => ({ title: 'T', message: 'M' })),
}));

import { dispatchTaskNotification } from '../../services/taskNotificationService';

// ── Helpers de config ────────────────────────────────────────────────────────
const baseTaskNotifications: any = {
    overdue: { responsavel: ['in-app', 'whatsapp', 'email'], interveniente: [], criador: [] },
    completed: { responsavel: [], interveniente: ['in-app'], criador: [] },
    assigned: { responsavel: ['whatsapp'], interveniente: [], criador: [] },
    acceptance_pending: { responsavel: [], interveniente: [], criador: [] },
    acceptance_overdue: { responsavel: [], interveniente: [], criador: [] },
    deadline_reminder: { responsavel: [], interveniente: [], criador: [] },
    stalled: { responsavel: [], interveniente: [], criador: [] },
    comment: { responsavel: [], interveniente: [], criador: [] },
};

const qhRule = (over: any = {}) => ({
    enabled: false,
    startHHmm: '22:00',
    endHHmm: '06:00',
    weekdaysOnly: false,
    ...over,
});

const qhOff = {
    whatsapp: qhRule(),
    email: qhRule(),
    'in-app': qhRule(),
};

const buildConfig = (opts: {
    quietHours?: any;
    externalOn?: boolean;
    taskNotifications?: any;
} = {}) => ({
    taskNotificationsExternalEnabled: opts.externalOn ?? true,
    taskNotifications: opts.taskNotifications ?? baseTaskNotifications,
    notificationPolicy: {
        quietHours: opts.quietHours ?? qhOff,
        cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
        staleHours: 24,
        invoiceDueHorizonDays: 3,
    },
});

// Helper para encontrar a chamada do log estruturado.
const findDeferredLog = () =>
    loggerSpies.info.mock.calls.find((c: any[]) => c[0] === 'notification.quietHours.deferred');

// ── Tests ────────────────────────────────────────────────────────────────────
describe('dispatchTaskNotification — quiet-hours gate (#1291)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-01-15T12:00:00Z')); // 09:00 SP Wed (default fora do quiet 22-06)
        mockDoli.getTaskContacts.mockResolvedValue([{ user_id: '7', type_id: '45' }]); // user 7 = responsável
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('quietHours desabilitado (default) → todos os canais externos despachados, sem log deferred', async () => {
        mockUiGet.mockReturnValue(buildConfig()); // quietHours todas enabled=false

        await dispatchTaskNotification('overdue', { id: '99', ref: 'T-99', label: 'X' });

        expect(mockCreate).toHaveBeenCalledTimes(1);
        const arg = mockCreate.mock.calls[0][0];
        expect(arg.channels.sort()).toEqual(['email', 'in-app', 'whatsapp']);
        expect(arg.recipient).toBe('7');
        expect(arg.entityId).toBe('99');
        expect(findDeferredLog()).toBeUndefined();
    });

    it('whatsapp em quiet hours (02:00 SP) → whatsapp removido do dispatch, in-app/email passam', async () => {
        vi.setSystemTime(new Date('2025-01-16T05:00:00Z')); // 02:00 SP Thu (em quiet 22-06)
        mockUiGet.mockReturnValue(buildConfig({
            quietHours: {
                whatsapp: qhRule({ enabled: true }),
                email: qhRule(), // disabled
                'in-app': qhRule(),
            },
        }));

        await dispatchTaskNotification('overdue', { id: '99', ref: 'T-99', label: 'X' });

        expect(mockCreate).toHaveBeenCalledTimes(1);
        const arg = mockCreate.mock.calls[0][0];
        expect(arg.channels).not.toContain('whatsapp');
        expect(arg.channels).toContain('in-app');
        expect(arg.channels).toContain('email');

        const log = findDeferredLog();
        expect(log).toBeDefined();
        expect(log![1]).toMatchObject({
            canal: 'whatsapp',
            originalDueAt: '2025-01-16T05:00:00.000Z',
            event: 'task.overdue',
            taskId: '99',
            userId: '7',
        });
        expect(log![1].scheduledFor).toEqual(expect.any(String));
    });

    it('scheduledFor = próximo fim de janela em SP (06:00 SP do mesmo dia) quando now=02:00 SP', async () => {
        vi.setSystemTime(new Date('2025-01-16T05:00:00Z')); // 02:00 SP Jan 16
        mockUiGet.mockReturnValue(buildConfig({
            quietHours: {
                whatsapp: qhRule({ enabled: true }),
                email: qhRule(),
                'in-app': qhRule(),
            },
        }));

        await dispatchTaskNotification('overdue', { id: '99', ref: 'T-99', label: 'X' });

        const log = findDeferredLog();
        expect(log).toBeDefined();
        expect(log![1].scheduledFor).toBe('2025-01-16T09:00:00.000Z'); // 06:00 SP Jan 16
        expect(log![1].originalDueAt).toBe('2025-01-16T05:00:00.000Z'); // agora
    });

    it('email em quiet hours → canal removido e log emite canal=email', async () => {
        vi.setSystemTime(new Date('2025-01-16T05:00:00Z'));
        mockUiGet.mockReturnValue(buildConfig({
            quietHours: {
                whatsapp: qhRule(),
                email: qhRule({ enabled: true }),
                'in-app': qhRule(),
            },
        }));

        await dispatchTaskNotification('overdue', { id: '99', ref: 'T-99', label: 'X' });

        const arg = mockCreate.mock.calls[0][0];
        expect(arg.channels).not.toContain('email');
        expect(arg.channels).toContain('whatsapp'); // whatsapp rule.enabled=false → passa
        expect(arg.channels).toContain('in-app');
        const log = findDeferredLog();
        expect(log![1].canal).toBe('email');
    });

    it('canal in-app SEMPRE passa (regra benigna), mesmo se quietHours[in-app].enabled=true', async () => {
        vi.setSystemTime(new Date('2025-01-16T05:00:00Z')); // 02:00 SP em quiet
        mockUiGet.mockReturnValue(buildConfig({
            quietHours: {
                whatsapp: qhRule({ enabled: true }),
                email: qhRule({ enabled: true }),
                'in-app': qhRule({ enabled: true }), // mesmo assim, gate não consulta
            },
            taskNotifications: {
                ...baseTaskNotifications,
                overdue: { responsavel: ['in-app'], interveniente: [], criador: [] },
            },
        }));

        await dispatchTaskNotification('overdue', { id: '99', ref: 'T-99', label: 'X' });

        expect(mockCreate).toHaveBeenCalledTimes(1);
        const arg = mockCreate.mock.calls[0][0];
        expect(arg.channels).toEqual(['in-app']);
        expect(findDeferredLog()).toBeUndefined();
    });

    it('weekdaysOnly + sábado 12:00 SP → whatsapp bloqueado pelo flag de fim de semana', async () => {
        // 2025-01-18 = Saturday. 12:00 SP = 15:00Z (fora do quiet HH 22-06, mas é sábado)
        vi.setSystemTime(new Date('2025-01-18T15:00:00Z'));
        mockUiGet.mockReturnValue(buildConfig({
            quietHours: {
                whatsapp: qhRule({ enabled: true, weekdaysOnly: true }),
                email: qhRule(),
                'in-app': qhRule(),
            },
        }));

        await dispatchTaskNotification('overdue', { id: '99', ref: 'T-99', label: 'X' });

        const arg = mockCreate.mock.calls[0][0];
        expect(arg.channels).not.toContain('whatsapp');
        expect(findDeferredLog()).toBeDefined();
    });

    it('kill switch (externalOn=false) corta externos ANTES do gate — sem log deferred', async () => {
        vi.setSystemTime(new Date('2025-01-16T05:00:00Z')); // em quiet
        mockUiGet.mockReturnValue(buildConfig({
            externalOn: false,
            quietHours: {
                whatsapp: qhRule({ enabled: true }),
                email: qhRule({ enabled: true }),
                'in-app': qhRule({ enabled: true }),
            },
        }));

        await dispatchTaskNotification('overdue', { id: '99', ref: 'T-99', label: 'X' });

        expect(mockCreate).toHaveBeenCalledTimes(1);
        const arg = mockCreate.mock.calls[0][0];
        expect(arg.channels).toEqual(['in-app']); // só in-app
        expect(findDeferredLog()).toBeUndefined();
    });

    it('múltiplos canais externos em quiet → cada um gera um log independente', async () => {
        vi.setSystemTime(new Date('2025-01-16T05:00:00Z'));
        mockUiGet.mockReturnValue(buildConfig({
            quietHours: {
                whatsapp: qhRule({ enabled: true }),
                email: qhRule({ enabled: true }),
                'in-app': qhRule(),
            },
        }));

        await dispatchTaskNotification('overdue', { id: '99', ref: 'T-99', label: 'X' });

        const logs = loggerSpies.info.mock.calls.filter(
            (c: any[]) => c[0] === 'notification.quietHours.deferred',
        );
        expect(logs).toHaveLength(2);
        const canais = logs.map((l) => l[1].canal).sort();
        expect(canais).toEqual(['email', 'whatsapp']);
        const arg = mockCreate.mock.calls[0][0];
        expect(arg.channels).toEqual(['in-app']);
    });

    it('NENHUM WhatsApp/Email é enviado em horário bloqueado (asserção do critério de aceite)', async () => {
        vi.setSystemTime(new Date('2025-01-16T05:00:00Z')); // 02:00 SP — quiet
        mockUiGet.mockReturnValue(buildConfig({
            quietHours: {
                whatsapp: qhRule({ enabled: true }),
                email: qhRule({ enabled: true }),
                'in-app': qhRule(),
            },
        }));

        await dispatchTaskNotification('overdue', { id: '99', ref: 'T-99', label: 'X' });

        // O gate acontece ANTES de notificationService.create → o canal bloqueado nunca chega ao provider.
        const arg = mockCreate.mock.calls[0][0];
        expect(arg.channels).not.toContain('whatsapp');
        expect(arg.channels).not.toContain('email');
    });
});