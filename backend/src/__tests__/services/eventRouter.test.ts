import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

const mockNotificationService = vi.hoisted(() => ({
    create: vi.fn(),
}));

const mockRenderTemplate = vi.hoisted(() => vi.fn(() => 'rendered-template'));

const mockSchedulerService = vi.hoisted(() => ({
    getRules: vi.fn(() => []),
    renderTemplate: vi.fn(() => 'rendered-from-template'),
    scheduleMessage: vi.fn(() => ({ id: 'msg-1', sessionId: '', chatId: '' })),
    addLog: vi.fn(),
    // #1439 — helper de resolução por precedência; default 'unset' cobre os testes legados.
    resolveRuleSessionId: vi.fn(() => ({ sessionId: '', source: 'unset' as const })),
}));

vi.mock('../../services/notificationService', () => ({ notificationService: mockNotificationService }));
vi.mock('../../services/notificationTemplates', () => ({ renderTemplate: mockRenderTemplate }));
vi.mock('../../services/schedulerService', () => ({ schedulerService: mockSchedulerService }));

import { eventRouter } from '../../services/eventRouter';

describe('eventRouter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNotificationService.create.mockResolvedValue(undefined);
        mockRenderTemplate.mockReturnValue('rendered-template');
        mockSchedulerService.scheduleMessage.mockReturnValue({ id: 'msg-1', sessionId: '', chatId: '' });
    });

    describe('processEvent (#1439 — sessionIdSource + resolveRuleSessionId)', () => {
        it('regra com sessionId próprio → usa o sessionId da regra e propaga source=rule', async () => {
            mockSchedulerService.getRules.mockReturnValue([
                { id: 'r1', name: 'Fatura Criada', event: 'invoice_created', enabled: true, channel: 'whatsapp', sessionId: 'minha-sess', message: 'Olá {{customerName}}' },
            ]);
            mockSchedulerService.resolveRuleSessionId.mockReturnValue({ sessionId: 'minha-sess', source: 'rule' });

            await eventRouter.processEvent('invoice_created', {
                customerName: 'João',
                customerPhone: '11999999999',
                ref: 'FAC-001',
            });

            // sessionId resolvido pelo helper foi passado para scheduleMessage
            expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'minha-sess' }),
            );
            // addLog registra o source p/ auditoria
            expect(mockSchedulerService.addLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionId: 'minha-sess',
                    metadata: expect.objectContaining({ sessionIdSource: 'rule' }),
                }),
            );
        });

        it('regra SEM sessionId + uiConfig COM default → usa o default global e propaga source=config', async () => {
            mockSchedulerService.getRules.mockReturnValue([
                { id: 'r1', name: 'Fatura', event: 'invoice_created', enabled: true, channel: 'whatsapp', sessionId: '', message: 'Oi' },
            ]);
            mockSchedulerService.resolveRuleSessionId.mockReturnValue({ sessionId: 'global-sess', source: 'config' });

            await eventRouter.processEvent('invoice_created', {
                customerName: 'Maria',
                customerPhone: '11888888888',
            });

            expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'global-sess' }),
            );
            expect(mockSchedulerService.addLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionId: 'global-sess',
                    metadata: expect.objectContaining({ sessionIdSource: 'config' }),
                }),
            );
        });

        it('regra SEM sessionId + uiConfig SEM default → string vazia e propaga source=unset', async () => {
            mockSchedulerService.getRules.mockReturnValue([
                { id: 'r1', name: 'Fatura', event: 'invoice_created', enabled: true, channel: 'whatsapp', sessionId: '', message: 'Oi' },
            ]);
            mockSchedulerService.resolveRuleSessionId.mockReturnValue({ sessionId: '', source: 'unset' });

            await eventRouter.processEvent('invoice_created', {
                customerName: 'Maria',
                customerPhone: '11888888888',
            });

            expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: '' }),
            );
            expect(mockSchedulerService.addLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionId: '',
                    metadata: expect.objectContaining({ sessionIdSource: 'unset' }),
                }),
            );
        });

        it('NÃO chama scheduleMessage se a regra não tiver destination (sem cliente)', async () => {
            // Quando customerEmail e customerPhone são ausentes, a checagem `if (!destination)` deve
            // disparar e pular a regra (não chega a chamar o helper nem agendar mensagem).
            mockSchedulerService.getRules.mockReturnValue([
                {
                    id: 'r1', name: 'Email sem destino', event: 'invoice_created', enabled: true,
                    channel: 'email', sessionId: 's1', message: 'Oi',
                },
            ]);
            await eventRouter.processEvent('invoice_created', { customerName: 'Sem Email' });
            expect(mockSchedulerService.scheduleMessage).not.toHaveBeenCalled();
            // helper não é chamado pq a regra é descartada antes
            expect(mockSchedulerService.resolveRuleSessionId).not.toHaveBeenCalled();
        });

        it('renderiza template via rule.templateId quando setado', async () => {
            mockSchedulerService.getRules.mockReturnValue([
                { id: 'r1', name: 'Fatura', event: 'invoice_created', enabled: true, channel: 'whatsapp', sessionId: 's1', templateId: 'tpl-x', message: 'placeholder' },
            ]);
            mockSchedulerService.renderTemplate.mockReturnValue('Olá João!');
            mockSchedulerService.resolveRuleSessionId.mockReturnValue({ sessionId: 's1', source: 'rule' });

            await eventRouter.processEvent('invoice_created', {
                customerName: 'João',
                customerPhone: '11999999999',
            });

            expect(mockSchedulerService.renderTemplate).toHaveBeenCalledWith('tpl-x', expect.objectContaining({ customerName: 'João' }));
            expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Olá João!' }),
            );
        });
    });
});