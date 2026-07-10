import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/legacy/messageService', () => ({
    messageService: {
        sendText: vi.fn(),
        getMessages: vi.fn(),
        getMessageMedia: vi.fn(),
    },
}));

vi.mock('../../services/aiService', () => ({
    aiService: {
        generateReply: vi.fn(),
        transcribeAudio: vi.fn(),
    },
}));

vi.mock('../../services/storeService', () => ({
    storeService: {
        getChatSettings: vi.fn(),
        getSessionSettings: vi.fn(),
        updateChatSettings: vi.fn(),
    },
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {
        getThirdPartyByPhone: vi.fn(),
        getCustomerContext: vi.fn(),
    },
}));

vi.mock('../../services/legacy/sessionService', () => ({
    sessionService: {
        sendTyping: vi.fn(),
    },
}));

vi.mock('../../services/schedulerService', () => ({
    schedulerService: {
        checkConfirmation: vi.fn(),
        handleConfirmationResponse: vi.fn(),
        getActiveFlow: vi.fn(),
        processFlowResponse: vi.fn(),
        checkFlowTrigger: vi.fn(),
        startFlow: vi.fn(),
    },
}));

vi.mock('../../services/approvalService', () => ({
    approvalService: {
        createPendingAction: vi.fn(),
    },
}));

vi.mock('../../services/interApiService', () => ({
    interApiService: {
        getSaldo: vi.fn(),
    },
}));

vi.mock('../../services/itauApiService', () => ({
    itauApiService: {
        getSaldo: vi.fn(),
    },
}));

// #1129: /pagar e /pix agora são gated por isFinancialCommandsEnabled (kill-switch de admin).
// A injeção de contexto CRM é gated por isCrmContextInjectionEnabled (kill-switch de privacidade).
// Default do mock = ambos habilitados (preserva os testes existentes).
const mockFeatureSwitches = vi.hoisted(() => ({
    isFinancialCommandsEnabled: vi.fn(() => true),
    isCrmContextInjectionEnabled: vi.fn(() => true),
}));
vi.mock('../../config/featureSwitches', () => mockFeatureSwitches);

import { botService } from '../../services/botService';
import { messageService } from '../../services/legacy/messageService';
import { aiService } from '../../services/aiService';
import { storeService } from '../../services/storeService';
import { dolibarrService } from '../../services/dolibarrService';
import { sessionService } from '../../services/legacy/sessionService';
import { schedulerService } from '../../services/schedulerService';
import { approvalService } from '../../services/approvalService';
import { interApiService } from '../../services/interApiService';
import { itauApiService } from '../../services/itauApiService';

describe('BotService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // #1129: comandos financeiros habilitados por padrão nos testes (comportamento histórico).
        mockFeatureSwitches.isFinancialCommandsEnabled.mockReturnValue(true);
        mockFeatureSwitches.isCrmContextInjectionEnabled.mockReturnValue(true);
        (storeService.getSessionSettings as any).mockReturnValue({
            autoReply: true,
            historyLimit: 10,
            autoReplyContext: 'You are a helpful assistant.',
            signatureName: 'Bot',
        });
        (storeService.getChatSettings as any).mockReturnValue({});
    });

    const createMessage = (overrides = {}) => ({
        from: '5511999999999@c.us',
        fromMe: false,
        body: 'Hello',
        sessionId: 'sess1',
        type: 'chat',
        hasMedia: false,
        id: 'msg_123',
        ...overrides,
    });

    describe('processMessage', () => {
        it('ignores fromMe messages', async () => {
            await botService.processMessage(createMessage({ fromMe: true }));
            expect(messageService.sendText).not.toHaveBeenCalled();
        });

        it('ignores empty messages', async () => {
            await botService.processMessage(createMessage({ body: '' }));
            expect(messageService.sendText).not.toHaveBeenCalled();
        });

        it('ignores short messages', async () => {
            await botService.processMessage(createMessage({ body: 'a' }));
            expect(messageService.sendText).not.toHaveBeenCalled();
        });

        it('handles audio transcription', async () => {
            (messageService.getMessageMedia as any).mockResolvedValue({
                data: Buffer.from('audio-data'),
                contentType: 'audio/ogg',
            });
            (aiService.transcribeAudio as any).mockResolvedValue('Transcribed text');
            (aiService.generateReply as any).mockResolvedValue('AI reply');
            (messageService.getMessages as any).mockResolvedValue([]);

            await botService.processMessage(createMessage({
                type: 'ptt',
                hasMedia: true,
            }));

            expect(aiService.transcribeAudio).toHaveBeenCalled();
        });

        it('handles audio transcription failure', async () => {
            (messageService.getMessageMedia as any).mockRejectedValue(new Error('Media error'));
            (aiService.generateReply as any).mockResolvedValue('AI reply');
            (messageService.getMessages as any).mockResolvedValue([]);

            await botService.processMessage(createMessage({
                type: 'audio',
                hasMedia: true,
                body: '',
            }));

        });

        it('handles /status command', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/status' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Status do Sistema')
            );
        });

        it('handles /ajuda command', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/ajuda' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Comandos')
            );
        });

        it('handles /help command', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/help' }));

            expect(messageService.sendText).toHaveBeenCalled();
        });

        it('handles /resumo command with messages', async () => {
            (messageService.getMessages as any).mockResolvedValue([
                { fromMe: false, body: 'User message', senderName: 'User' },
                { fromMe: true, body: 'Bot reply' },
            ]);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);
            (aiService.generateReply as any).mockResolvedValue('Summary');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/resumo' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Resumo')
            );
        });

        it('handles /resumo command with no messages', async () => {
            (messageService.getMessages as any).mockResolvedValue([]);
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/resumo' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Nenhuma mensagem')
            );
        });

        it('handles /resumo command with AI error', async () => {
            (messageService.getMessages as any).mockResolvedValue([
                { fromMe: false, body: 'Msg', senderName: 'User' },
            ]);
            (aiService.generateReply as any).mockRejectedValue(new Error('AI fail'));
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/resumo' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Erro')
            );
        });

        it('handles /pagar command with valid barcode', async () => {
            (approvalService.createPendingAction as any).mockResolvedValue({ id: 'action-1' });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({
                body: '/pagar ' + '1'.repeat(48),
            }));

            expect(approvalService.createPendingAction).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'pagar_boleto' })
            );
        });

        it('handles /pagar command with invalid barcode', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/pagar 123' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Formato inválido')
            );
        });

        it('handles /pix command with valid params', async () => {
            (approvalService.createPendingAction as any).mockResolvedValue({ id: 'action-1' });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/pix 11999999999 100.00' }));

            expect(approvalService.createPendingAction).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'enviar_pix' })
            );
        });

        it('handles /pix command with insufficient args', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/pix 11999999999' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Formato inválido')
            );
        });

        it('handles /pix command with invalid value', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/pix 11999999999 abc' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Valor inválido')
            );
        });

        it('#1129: /pagar bloqueado quando comandos financeiros estão desligados (kill-switch)', async () => {
            mockFeatureSwitches.isFinancialCommandsEnabled.mockReturnValue(false);
            (approvalService.createPendingAction as any).mockResolvedValue({ id: 'action-1' });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/pagar ' + '1'.repeat(48) }));

            expect(approvalService.createPendingAction).not.toHaveBeenCalled();
            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Comandos financeiros desativados')
            );
        });

        it('#1129: /pix bloqueado quando comandos financeiros estão desligados (kill-switch)', async () => {
            mockFeatureSwitches.isFinancialCommandsEnabled.mockReturnValue(false);
            (approvalService.createPendingAction as any).mockResolvedValue({ id: 'action-1' });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/pix 11999999999 100.00' }));

            expect(approvalService.createPendingAction).not.toHaveBeenCalled();
            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Comandos financeiros desativados')
            );
        });

        it('handles /saldo command with Inter', async () => {
            (interApiService.getSaldo as any).mockResolvedValue({ disponivel: 5000 });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/saldo inter' }));

            expect(interApiService.getSaldo).toHaveBeenCalled();
        });

        it('handles /saldo command with Itau', async () => {
            (itauApiService.getSaldo as any).mockResolvedValue({ disponivel: 3000 });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/saldo itau' }));

            expect(itauApiService.getSaldo).toHaveBeenCalled();
        });

        it('handles /saldo command with itaú accent', async () => {
            (interApiService.getSaldo as any).mockResolvedValue({ disponivel: 1000 });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/saldo itaú' }));

            expect(itauApiService.getSaldo).toHaveBeenCalled();
        });

        it('handles /saldo command error', async () => {
            (interApiService.getSaldo as any).mockRejectedValue(new Error('Bank error'));
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: '/saldo' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Erro')
            );
        });

        it('handles confirmation accepted', async () => {
            (schedulerService.checkConfirmation as any).mockReturnValue({
                messageId: 'm1', callback: 'cb',
            });
            (schedulerService.handleConfirmationResponse as any).mockReturnValue('cb');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: 'sim' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Confirmação')
            );
        });

        it('handles confirmation rejected', async () => {
            (schedulerService.checkConfirmation as any).mockReturnValue({
                messageId: 'm1', callback: 'cb',
            });
            (schedulerService.handleConfirmationResponse as any).mockReturnValue('cb');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: 'não' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Cancelamento')
            );
        });

        it('ignores non-confirm response in confirmation context', async () => {
            (schedulerService.checkConfirmation as any).mockReturnValue({
                messageId: 'm1', callback: 'cb',
            });

            await botService.processMessage(createMessage({ body: 'maybe' }));
            expect(messageService.sendText).not.toHaveBeenCalled();
        });

        it('handles active chatbot flow', async () => {
            (schedulerService.getActiveFlow as any).mockReturnValue({
                flow: { id: 'f1', steps: [] },
                currentStep: { id: 's1', message: 'Step', waitForResponse: false },
            });
            (schedulerService.processFlowResponse as any).mockReturnValue({
                nextStep: null,
                endFlow: true,
                response: 'Done',
            });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: 'response' }));

            expect(messageService.sendText).toHaveBeenCalled();
        });

        it('handles active flow with next step', async () => {
            (schedulerService.getActiveFlow as any).mockReturnValue({
                flow: { id: 'f1', steps: [] },
                currentStep: { id: 's1', message: 'Step', waitForResponse: true },
            });
            (schedulerService.processFlowResponse as any).mockReturnValue({
                nextStep: { id: 's2', message: 'Next' },
                endFlow: false,
                response: undefined,
            });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: 'yes' }));

            expect(messageService.sendText).toHaveBeenCalledTimes(1);
        });

        it('handles triggered flow', async () => {
            (schedulerService.getActiveFlow as any).mockReturnValue(null);
            (schedulerService.checkFlowTrigger as any).mockReturnValue({ id: 'f1', name: 'Test Flow' });
            (schedulerService.startFlow as any).mockReturnValue({ id: 's1', message: 'Welcome!' });
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            await botService.processMessage(createMessage({ body: 'start' }));

            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', 'Welcome!'
            );
        });

        it('skips auto-reply when disabled', async () => {
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: false,
                historyLimit: 10,
            });

            await botService.processMessage(createMessage({ body: 'Hello' }));
            expect(aiService.generateReply).not.toHaveBeenCalled();
        });

        it('generates auto-reply with CRM context', async () => {
            (storeService.getChatSettings as any).mockReturnValue({});
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: true,
                historyLimit: 10,
                autoReplyContext: 'You are a helpful assistant.',
                signatureName: 'Bot',
            });
            (schedulerService.getActiveFlow as any).mockReturnValue(null);
            (schedulerService.checkConfirmation as any).mockReturnValue(null);
            (schedulerService.checkFlowTrigger as any).mockReturnValue(null);
            (messageService.getMessages as any).mockResolvedValue([]);
            (aiService.generateReply as any).mockResolvedValue('AI response');
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue({ id: 'c1', name: 'John' });
            (dolibarrService.getCustomerContext as any).mockResolvedValue('Customer context');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);

            await botService.processMessage(createMessage({ body: 'Hello' }));

            expect(aiService.generateReply).toHaveBeenCalled();
            expect(messageService.sendText).toHaveBeenCalledWith(
                'sess1', '5511999999999@c.us', expect.stringContaining('Bot')
            );
        });

        it('handles CRM lookup failure', async () => {
            (storeService.getChatSettings as any).mockReturnValue({});
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: true,
                historyLimit: 10,
                autoReplyContext: 'You are a helpful assistant.',
                signatureName: 'Bot',
            });
            (schedulerService.getActiveFlow as any).mockReturnValue(null);
            (schedulerService.checkConfirmation as any).mockReturnValue(null);
            (schedulerService.checkFlowTrigger as any).mockReturnValue(null);
            (messageService.getMessages as any).mockResolvedValue([]);
            (aiService.generateReply as any).mockResolvedValue('Reply');
            (dolibarrService.getThirdPartyByPhone as any).mockRejectedValue(new Error('CRM fail'));
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);

            await botService.processMessage(createMessage({ body: 'Hello' }));

            expect(aiService.generateReply).toHaveBeenCalled();
        });

        it('#1129: não injeta dados do cliente no LLM quando CRM context está desligado (kill-switch de privacidade)', async () => {
            mockFeatureSwitches.isCrmContextInjectionEnabled.mockReturnValue(false);
            (storeService.getChatSettings as any).mockReturnValue({});
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: true,
                historyLimit: 10,
                autoReplyContext: 'You are a helpful assistant.',
                signatureName: 'Bot',
            });
            (schedulerService.getActiveFlow as any).mockReturnValue(null);
            (schedulerService.checkConfirmation as any).mockReturnValue(null);
            (schedulerService.checkFlowTrigger as any).mockReturnValue(null);
            (messageService.getMessages as any).mockResolvedValue([]);
            (aiService.generateReply as any).mockResolvedValue('AI response');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);

            await botService.processMessage(createMessage({ body: 'Hello' }));

            // Kill-switch ativo: nenhuma busca de cliente, nenhum dado no prompt do LLM.
            expect(dolibarrService.getThirdPartyByPhone).not.toHaveBeenCalled();
            expect(dolibarrService.getCustomerContext).not.toHaveBeenCalled();
            const ctx = (aiService.generateReply as any).mock.calls[0][1];
            expect(ctx).not.toContain('DADOS DO CLIENTE');
        });

        it('handles history with group messages', async () => {
            (storeService.getChatSettings as any).mockReturnValue({
                groupSettings: { llmEnabled: true },
            });
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: true,
                historyLimit: 10,
                autoReplyContext: '',
                signatureName: 'Bot',
            });
            (schedulerService.getActiveFlow as any).mockReturnValue(null);
            (schedulerService.checkConfirmation as any).mockReturnValue(null);
            (schedulerService.checkFlowTrigger as any).mockReturnValue(null);
            (messageService.getMessages as any).mockResolvedValue([
                { fromMe: false, body: 'Hi', senderName: 'Alice' },
                { fromMe: false, body: '', hasMedia: true, type: 'image' },
                { fromMe: true, body: 'Response' },
                { fromMe: false, body: '', hasMedia: false, type: 'chat' },
            ]);
            (aiService.generateReply as any).mockResolvedValue('Reply');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);

            await botService.processMessage(createMessage({ body: 'Hello', from: 'group@g.us' }));

            expect(aiService.generateReply).toHaveBeenCalled();
        });

        it('handles getMessages failure', async () => {
            (storeService.getChatSettings as any).mockReturnValue({});
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: true,
                historyLimit: 10,
                autoReplyContext: 'You are a helpful assistant.',
                signatureName: 'Bot',
            });
            (schedulerService.getActiveFlow as any).mockReturnValue(null);
            (schedulerService.checkConfirmation as any).mockReturnValue(null);
            (schedulerService.checkFlowTrigger as any).mockReturnValue(null);
            (messageService.getMessages as any).mockRejectedValue(new Error('History fail'));
            (aiService.generateReply as any).mockResolvedValue('Reply');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);

            await botService.processMessage(createMessage({ body: 'Hello' }));

            expect(aiService.generateReply).toHaveBeenCalled();
        });

        it('handles sendTyping failure', async () => {
            (sessionService.sendTyping as any).mockRejectedValue(new Error('Typing fail'));
            (messageService.getMessages as any).mockResolvedValue([]);
            (aiService.generateReply as any).mockResolvedValue('Reply');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);

            await botService.processMessage(createMessage({ body: 'Hello' }));

            expect(messageService.sendText).toHaveBeenCalled();
        });

        it('handles AI retry failure', async () => {
            (messageService.getMessages as any).mockResolvedValue([]);
            (aiService.generateReply as any).mockRejectedValue(new Error('AI down'));
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);

            await botService.processMessage(createMessage({ body: 'Hello' }));

        });

        it('uses chat override for autoReply', async () => {
            (storeService.getChatSettings as any).mockReturnValue({ autoReplyEnabled: false });
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: true,
                historyLimit: 10,
            });

            await botService.processMessage(createMessage({ body: 'Hello' }));
            expect(aiService.generateReply).not.toHaveBeenCalled();
        });

        it('handles group with LLM enabled and burst check', async () => {
            (storeService.getChatSettings as any).mockReturnValue({
                autoReplyEnabled: undefined,
                groupSettings: {
                    llmEnabled: true,
                    burstHandling: { enabled: true, threshold: 3 },
                    messageCounter: 0,
                },
            });
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: false,
                historyLimit: 10,
                autoReplyContext: '',
            });
            (schedulerService.getActiveFlow as any).mockReturnValue(null);
            (schedulerService.checkConfirmation as any).mockReturnValue(null);
            (schedulerService.checkFlowTrigger as any).mockReturnValue(null);

            await botService.processMessage(createMessage({
                body: 'Hello',
                from: 'group@g.us',
            }));

            expect(storeService.updateChatSettings).toHaveBeenCalled();
        });

        it('handles group frequency limit', async () => {
            (storeService.getChatSettings as any).mockReturnValue({
                autoReplyEnabled: undefined,
                groupSettings: {
                    llmEnabled: true,
                    responseFrequency: { value: 1, unit: 'hours' },
                    lastRepliedAt: Date.now(),
                },
            });
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: false,
                historyLimit: 10,
            });

            await botService.processMessage(createMessage({
                body: 'Hello',
                from: 'group@g.us',
            }));

            expect(aiService.generateReply).not.toHaveBeenCalled();
        });

        it('handles group frequency with minutes unit', async () => {
            (storeService.getChatSettings as any).mockReturnValue({
                autoReplyEnabled: undefined,
                groupSettings: {
                    llmEnabled: true,
                    responseFrequency: { value: 30, unit: 'minutes' },
                    lastRepliedAt: Date.now(),
                },
            });
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: false,
                historyLimit: 10,
            });

            await botService.processMessage(createMessage({
                body: 'Hello',
                from: 'group@g.us',
            }));

            expect(aiService.generateReply).not.toHaveBeenCalled();
        });

        it('handles group frequency with days unit', async () => {
            (storeService.getChatSettings as any).mockReturnValue({
                autoReplyEnabled: undefined,
                groupSettings: {
                    llmEnabled: true,
                    responseFrequency: { value: 1, unit: 'days' },
                    lastRepliedAt: Date.now(),
                },
            });
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: false,
                historyLimit: 10,
            });

            await botService.processMessage(createMessage({
                body: 'Hello',
                from: 'group@g.us',
            }));

            expect(aiService.generateReply).not.toHaveBeenCalled();
        });

        it('updates group stats after reply', async () => {
            (schedulerService.getActiveFlow as any).mockReturnValue(null);
            (schedulerService.checkConfirmation as any).mockReturnValue(null);
            (schedulerService.checkFlowTrigger as any).mockReturnValue(null);
            (messageService.getMessages as any).mockResolvedValue([]);
            (aiService.generateReply as any).mockResolvedValue('Reply');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);
            (storeService.getChatSettings as any).mockReturnValue({
                groupSettings: { llmEnabled: true },
            });
            (storeService.getSessionSettings as any).mockReturnValue({
                autoReply: true,
                historyLimit: 10,
                autoReplyContext: '',
                signatureName: 'Bot',
            });

            await botService.processMessage(createMessage({
                body: 'Hello',
                from: 'group@g.us',
            }));

            expect(storeService.updateChatSettings).toHaveBeenCalledWith(
                'group@g.us',
                expect.objectContaining({
                    groupSettings: expect.objectContaining({ messageCounter: 0 }),
                })
            );
        });

        it('handles process error gracefully', async () => {
            (storeService.getSessionSettings as any).mockImplementation(() => {
                throw new Error('Unexpected');
            });

            await expect(botService.processMessage(createMessage({ body: 'Hello' }))).resolves.toBeUndefined();
        });
    });
});
