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
// #1410: getEffectiveWhatsAppProvider é consumido pelo construtor do ChannelRouter, que é
// carregado transitivamente (botService → agentTools → channelRouter). Sem o mock explícito
// aqui o import falha em "export not defined" e o teste nem roda.
const mockFeatureSwitches = vi.hoisted(() => ({
    isFinancialCommandsEnabled: vi.fn(() => true),
    isCrmContextInjectionEnabled: vi.fn(() => true),
    isWhatsappEmployeeElevationEnabled: vi.fn(() => false),
    getEffectiveWhatsAppProvider: vi.fn(() => 'legacy'),
}));
vi.mock('../../config/featureSwitches', () => mockFeatureSwitches);

// Identidade do remetente (funcionário × cliente × desconhecido) — default: desconhecido.
const mockIdentity = vi.hoisted(() => ({
    identifySender: vi.fn(async (): Promise<any> => ({ kind: 'unknown' })),
}));
vi.mock('../../services/whatsappIdentityService', () => ({ whatsappIdentityService: mockIdentity }));

const mockPermissions = vi.hoisted(() => ({
    getProfile: vi.fn(async (): Promise<any> => ({ role: 'user', agent: {} })),
    getProfileForContext: vi.fn(async () => '[PERMISSÕES DO USUÁRIO] ...'),
}));
vi.mock('../../services/userPermissionsService', () => ({ userPermissionsService: mockPermissions }));

import { botService, __resetMessageDedupForTests, getWhatsAppBotToolsPrompt, validateWhatsAppBotToolsPrompt, buildAgentHistory, isAgentHistoryExcluded } from '../../services/botService';
import { getToolContext, DEV_TOOLS, getToolsPrompt } from '../../services/agentTools';
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
        __resetMessageDedupForTests(); // o dedup de msg é de processo; os testes reusam o mesmo id
        // #1129: comandos financeiros habilitados por padrão nos testes (comportamento histórico).
        mockFeatureSwitches.isFinancialCommandsEnabled.mockReturnValue(true);
        mockFeatureSwitches.isCrmContextInjectionEnabled.mockReturnValue(true);
        mockFeatureSwitches.isWhatsappEmployeeElevationEnabled.mockReturnValue(false);
        mockIdentity.identifySender.mockResolvedValue({ kind: 'unknown' });
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

        it('deduplica re-emissão: MESMA mensagem entregue 2× → processa 1× (não gera resposta dupla)', async () => {
            (aiService.generateReply as any).mockResolvedValue('AI reply');
            (messageService.getMessages as any).mockResolvedValue([]);
            const msg = createMessage({ body: 'valide a fatura 50', id: 'msg_DEDUP_1' });
            await botService.processMessage(msg);
            await botService.processMessage(msg); // re-emissão (reconexão/replay do whatsapp-web.js)
            expect(aiService.generateReply).toHaveBeenCalledTimes(1);
            expect(messageService.sendText).toHaveBeenCalledTimes(1);
        });

        it('mensagens DIFERENTES (ids distintos) processam normalmente', async () => {
            (aiService.generateReply as any).mockResolvedValue('AI reply');
            (messageService.getMessages as any).mockResolvedValue([]);
            await botService.processMessage(createMessage({ body: 'oi', id: 'msg_A' }));
            await botService.processMessage(createMessage({ body: 'tudo bem?', id: 'msg_B' }));
            expect(aiService.generateReply).toHaveBeenCalledTimes(2);
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

        it('/resumo roda o generateReply em contexto READONLY (sem bypass de escrita)', async () => {
            (messageService.getMessages as any).mockResolvedValue([
                { fromMe: false, body: 'oi', senderName: 'User' },
            ]);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            let capturedReadOnly: any = 'NÃO-CAPTURADO';
            (aiService.generateReply as any).mockImplementation(async () => {
                capturedReadOnly = getToolContext().readOnly; // o que executeTool veria
                return 'Summary';
            });

            await botService.processMessage(createMessage({ body: '/resumo', id: 'msg_RESUMO' }));

            expect(capturedReadOnly).toBe(true); // escrita bloqueada nesta rota alcançável por WhatsApp
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
            mockIdentity.identifySender.mockResolvedValue({ kind: 'customer', thirdpartyId: 'c1', name: 'John' });
            (dolibarrService.getCustomerContext as any).mockResolvedValue('Customer context');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);

            await botService.processMessage(createMessage({ body: 'Hello' }));

            expect(dolibarrService.getCustomerContext).toHaveBeenCalledWith('c1');
            const ctx = (aiService.generateReply as any).mock.calls[0][1];
            expect(ctx).toContain('DADOS DO CLIENTE IDENTIFICADO NO CRM');
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
            mockIdentity.identifySender.mockResolvedValue({ kind: 'customer', thirdpartyId: 'c1', name: 'John' });
            (dolibarrService.getCustomerContext as any).mockRejectedValue(new Error('CRM fail'));
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

        it('#1658: exclui notificações automáticas do histórico, preservando a conversa real', async () => {
            (messageService.getMessages as any).mockResolvedValue([
                { fromMe: true, body: 'Olá TULIO, a tarefa TK2511-0494 venceu em 20/07/2026.', metadata: { systemNotification: true } },
                { fromMe: true, body: 'Olá TULIO, a tarefa TK2606-3559 vence em 21/07/2026.' },
                { fromMe: true, body: 'Olá TULIO, a tarefa TK2606-3560 está sem progresso.' },
                { fromMe: false, body: 'oi' },
            ]);
            (aiService.generateReply as any).mockResolvedValue('Reply');
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
            (sessionService.sendTyping as any).mockResolvedValue(undefined);

            await botService.processMessage(createMessage({ body: 'oi', id: 'msg_1658' }));

            const history = (aiService.generateReply as any).mock.calls[0][0];
            expect(history).toEqual([{ role: 'user', parts: 'oi' }]);
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

        // Identidade do remetente → contexto de permissões (kill-switch whatsappEmployeeElevation).
        // Captura o ToolContext efetivo de DENTRO do generateReply (AsyncLocalStorage real).
        describe('elevação de funcionário identificado', () => {
            let capturedCtx: any;

            const setupReplyFlow = () => {
                capturedCtx = null;
                (schedulerService.getActiveFlow as any).mockReturnValue(null);
                (schedulerService.checkConfirmation as any).mockReturnValue(null);
                (schedulerService.checkFlowTrigger as any).mockReturnValue(null);
                (messageService.getMessages as any).mockResolvedValue([]);
                (aiService.generateReply as any).mockImplementation(async () => {
                    capturedCtx = getToolContext();
                    return 'Reply';
                });
                (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
                (sessionService.sendTyping as any).mockResolvedValue(undefined);
            };

            it('funcionário 1:1 com a flag LIGADA roda com o próprio perfil (readOnly=false, isAdmin=false)', async () => {
                setupReplyFlow();
                mockFeatureSwitches.isWhatsappEmployeeElevationEnabled.mockReturnValue(true);
                mockIdentity.identifySender.mockResolvedValue({ kind: 'employee', userId: '7', displayName: 'Túlio Silva', matchStrength: 'full' });
                const profile = { role: 'user', agent: { canCreate: ['proposal'] } };
                mockPermissions.getProfile.mockResolvedValue(profile);

                await botService.processMessage(createMessage({ body: 'Prepara uma proposta' }));

                expect(capturedCtx).toMatchObject({ readOnly: false, userId: '7', isAdmin: false });
                expect(capturedCtx.permissionProfile).toBe(profile);
                const ctx = (aiService.generateReply as any).mock.calls[0][1];
                expect(ctx).toContain('FUNCIONÁRIO IDENTIFICADO');
                expect(ctx).toContain('Túlio Silva');
            });

            it('flag DESLIGADA: funcionário identificado continua somente-leitura', async () => {
                setupReplyFlow();
                mockFeatureSwitches.isWhatsappEmployeeElevationEnabled.mockReturnValue(false);
                mockIdentity.identifySender.mockResolvedValue({ kind: 'employee', userId: '7', displayName: 'Túlio Silva', matchStrength: 'full' });

                await botService.processMessage(createMessage({ body: 'Prepara uma proposta' }));

                expect(capturedCtx.readOnly).toBe(true);
                expect(capturedCtx.userId).toBeUndefined();
                expect(mockPermissions.getProfile).not.toHaveBeenCalled();
            });

            it('grupo NUNCA identifica nem eleva, mesmo com a flag ligada', async () => {
                setupReplyFlow();
                mockFeatureSwitches.isWhatsappEmployeeElevationEnabled.mockReturnValue(true);
                (storeService.getChatSettings as any).mockReturnValue({ groupSettings: { llmEnabled: true } });

                await botService.processMessage(createMessage({ body: 'Hello', from: 'g1@g.us' }));

                expect(mockIdentity.identifySender).not.toHaveBeenCalled();
                expect(capturedCtx.readOnly).toBe(true);
            });

            it('falha ao carregar o perfil ⇒ fail-closed em somente-leitura', async () => {
                setupReplyFlow();
                mockFeatureSwitches.isWhatsappEmployeeElevationEnabled.mockReturnValue(true);
                mockIdentity.identifySender.mockResolvedValue({ kind: 'employee', userId: '7', displayName: 'Túlio Silva', matchStrength: 'full' });
                mockPermissions.getProfile.mockRejectedValue(new Error('Dolibarr caiu'));

                await botService.processMessage(createMessage({ body: 'Hello' }));

                expect(capturedCtx.readOnly).toBe(true);
                expect(capturedCtx.userId).toBeUndefined();
            });

            it('cliente identificado continua somente-leitura, mesmo com a flag ligada', async () => {
                setupReplyFlow();
                mockFeatureSwitches.isWhatsappEmployeeElevationEnabled.mockReturnValue(true);
                mockIdentity.identifySender.mockResolvedValue({ kind: 'customer', thirdpartyId: 'c1', name: 'John' });
                (dolibarrService.getCustomerContext as any).mockResolvedValue('Customer context');

                await botService.processMessage(createMessage({ body: 'Hello' }));

                expect(capturedCtx.readOnly).toBe(true);
                expect(mockPermissions.getProfile).not.toHaveBeenCalled();
            });
        });

        it('handles process error gracefully', async () => {
            (storeService.getSessionSettings as any).mockImplementation(() => {
                throw new Error('Unexpected');
            });

            await expect(botService.processMessage(createMessage({ body: 'Hello' }))).resolves.toBeUndefined();
        });

        // #1501 — canal WhatsApp NUNCA é admin. O bot atende Comercial/Financeiro/Produtor, então
        // mesmo que o remetente tenha cargo admin no ERP, no WhatsApp ele é tratado como usuário
        // de negócio. Cobre três eixos:
        //   (a) getWhatsAppBotToolsPrompt() exportado não contém nenhuma das 13 DEV_TOOLS — se o
        //       filtro #1498 regredir, o módulo joga throw no boot (já testado indiretamente: a
        //       mera importação de botService.ts passaria a falhar).
        //   (b) O ToolContext efetivo dentro do generateReply tem isAdmin !== true em TODOS os
        //       caminhos: unknown default, customer, employee-com-elevação, employee-sem-elevação,
        //       grupo.
        //   (c) O default toolCtx do bloco principal tem isAdmin explicitamente false (não undefined
        //       silencioso) — defesa em profundidade contra alguém esquecer o campo.
        describe('#1501: botService sempre passa isAdmin: false (canal WhatsApp nunca é admin)', () => {
            let capturedCtx: any;

            const captureCtxFromReply = () => {
                capturedCtx = null;
                (schedulerService.getActiveFlow as any).mockReturnValue(null);
                (schedulerService.checkConfirmation as any).mockReturnValue(null);
                (schedulerService.checkFlowTrigger as any).mockReturnValue(null);
                (messageService.getMessages as any).mockResolvedValue([]);
                (aiService.generateReply as any).mockImplementation(async () => {
                    capturedCtx = getToolContext();
                    return 'Reply';
                });
                (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);
                (sessionService.sendTyping as any).mockResolvedValue(undefined);
            };

            it('getWhatsAppBotToolsPrompt() NÃO contém nenhuma das 13 DEV_TOOLS (filtro #1498 ok)', () => {
                for (const devTool of DEV_TOOLS) {
                    expect(getWhatsAppBotToolsPrompt()).not.toContain(devTool);
                }
            });

            // (c) Chain-of-trust: o prompt EXPORTADO pelo botService TEM que ser idêntico ao
            //     que aiService.generateReply resolveria via getToolsPrompt({isAdmin:false}).
            //     Como aiService.ts:359 chama `getToolsPrompt({ isAdmin: getToolContext().isAdmin
            //     === true })` e o botService passa toolCtx com isAdmin:false, o que a IA
            //     vê é literalmente `getToolsPrompt({isAdmin: false})` — equivalência abaixo
            //     PROVA o caminho sem precisar mockar aiService. Defesa contra mudanças
            //     silenciosas em aiService.
            it('chain-of-trust: getWhatsAppBotToolsPrompt() === getToolsPrompt({isAdmin: false})', () => {
                expect(getWhatsAppBotToolsPrompt()).toBe(getToolsPrompt({ isAdmin: false }));
            });

            // (d) Self-check é idempotente em runtime (cache em `_whatsappBotToolsPrompt` +
            //     flag `_whatsappBotToolsPromptValidated`). Chamadas repetidas não re-pintam
            //     o cache nem rebuscam as DEV_TOOLS — call site em processMessage pode rodar
            //     toda mensagem sem custo.
            it('validateWhatsAppBotToolsPrompt() é idempotente (chamadas repetidas não re-checam DEV_TOOLS)', () => {
                expect(() => validateWhatsAppBotToolsPrompt()).not.toThrow();
                expect(() => validateWhatsAppBotToolsPrompt()).not.toThrow();
            });

            it('getWhatsAppBotToolsPrompt() continua listando ferramentas de negócio (search, list_invoices, prepare_*)', () => {
                expect(getWhatsAppBotToolsPrompt()).toContain('search(query');
                expect(getWhatsAppBotToolsPrompt()).toContain('list_invoices');
                expect(getWhatsAppBotToolsPrompt()).toContain('prepare_create_proposal');
                expect(getWhatsAppBotToolsPrompt()).toContain('validate_invoice');
                expect(getWhatsAppBotToolsPrompt()).toContain('notify_person');
            });

            it('sender=unknown 1:1: isAdmin NUNCA é true (default readOnly)', async () => {
                captureCtxFromReply();
                mockIdentity.identifySender.mockResolvedValue({ kind: 'unknown' });

                await botService.processMessage(createMessage({ body: 'Olá' }));

                expect(capturedCtx).toBeDefined();
                expect(capturedCtx.isAdmin).not.toBe(true);
            });

            it('sender=customer identificado: isAdmin NUNCA é true (permanece readOnly)', async () => {
                captureCtxFromReply();
                mockIdentity.identifySender.mockResolvedValue({ kind: 'customer', thirdpartyId: 'c1', name: 'John' });
                (dolibarrService.getCustomerContext as any).mockResolvedValue('Customer context');

                await botService.processMessage(createMessage({ body: 'Olá' }));

                expect(capturedCtx.isAdmin).not.toBe(true);
                expect(capturedCtx.readOnly).toBe(true);
            });

            it('sender=employee COM elevação de perfil: isAdmin explicitamente false (não undefined)', async () => {
                captureCtxFromReply();
                mockFeatureSwitches.isWhatsappEmployeeElevationEnabled.mockReturnValue(true);
                mockIdentity.identifySender.mockResolvedValue({ kind: 'employee', userId: '7', displayName: 'Túlio Silva', matchStrength: 'full' });
                mockPermissions.getProfile.mockResolvedValue({ role: 'admin', agent: { canCreate: ['*'] } });

                await botService.processMessage(createMessage({ body: 'Prepara proposta' }));

                // Garante que mesmo funcionário com perfil admin no ERP NÃO vira admin no canal
                // WhatsApp. isAdmin deve ser explicitamente false (nunca true, nunca silenciosamente
                // undefined que poderia virar true num refactor futuro).
                expect(capturedCtx.isAdmin).toBe(false);
                expect(capturedCtx.readOnly).toBe(false);
                expect(capturedCtx.userId).toBe('7');
            });

            it('sender=employee SEM elevação (kill-switch off): isAdmin continua false/undefined', async () => {
                captureCtxFromReply();
                mockFeatureSwitches.isWhatsappEmployeeElevationEnabled.mockReturnValue(false);
                mockIdentity.identifySender.mockResolvedValue({ kind: 'employee', userId: '7', displayName: 'Túlio Silva', matchStrength: 'full' });

                await botService.processMessage(createMessage({ body: 'Olá' }));

                expect(capturedCtx.isAdmin).not.toBe(true);
                expect(capturedCtx.readOnly).toBe(true);
                expect(capturedCtx.userId).toBeUndefined();
            });

            it('grupo (@g.us): isAdmin NUNCA é true (sender fica como unknown)', async () => {
                captureCtxFromReply();
                mockFeatureSwitches.isWhatsappEmployeeElevationEnabled.mockReturnValue(true);
                (storeService.getChatSettings as any).mockReturnValue({ groupSettings: { llmEnabled: true } });

                await botService.processMessage(createMessage({ body: 'Olá', from: 'g1@g.us' }));

                expect(mockIdentity.identifySender).not.toHaveBeenCalled();
                expect(capturedCtx.isAdmin).not.toBe(true);
            });
        });
    });
});

// #1501 — fail-fast self-check de produção. Isola o módulo agentTools via vi.doMock +
// vi.resetModules (mesmo padrão usado em logger.test / centrovibeStoreService.test) para
// simular uma REGRESSÃO do filtro não-admin de #1498 e confirmar que os helpers do
// botService jogam throw ALTO com a mensagem identificável. Sem isto, a defesa em
// profundidade só estaria provada pelos testes de filtragem do agentTools — o que não
// cobre o caso "call-site em produção nunca disparou".
describe('#1501: self-check fail-fast com agentTools mockado (regressão #1498)', () => {
    it('getWhatsAppBotToolsPrompt() joga throw #1501 se getToolsPrompt({isAdmin:false}) vazar search_code', async () => {
        vi.resetModules();
        vi.doMock('../../services/agentTools', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../../services/agentTools')>();
            return {
                ...actual,
                getToolsPrompt: vi.fn(() => 'PROMPT COM search_code EMBUTIDO'),
            };
        });

        const botServiceMod = await import('../../services/botService');
        expect(() => botServiceMod.getWhatsAppBotToolsPrompt())
            .toThrow(/#1501: WHATSAPP_BOT_TOOLS_PROMPT contém DEV_TOOL "search_code"/);

        vi.doUnmock('../../services/agentTools');
        vi.resetModules();
    });

    it('validateWhatsAppBotToolsPrompt() propaga o throw (caminho de produção via processMessage)', async () => {
        vi.resetModules();
        vi.doMock('../../services/agentTools', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../../services/agentTools')>();
            return {
                ...actual,
                getToolsPrompt: vi.fn(() => 'PROMPT COM git_recent EMBUTIDO'),
            };
        });

        const botServiceMod = await import('../../services/botService');
        expect(() => botServiceMod.validateWhatsAppBotToolsPrompt())
            .toThrow(/#1501: WHATSAPP_BOT_TOOLS_PROMPT contém DEV_TOOL "git_recent"/);

        vi.doUnmock('../../services/agentTools');
        vi.resetModules();
    });

    it('validateWhatsAppBotToolsPrompt() é idempotente (1ª call popula cache+flag, 2ª+ call é no-op)', async () => {
        vi.resetModules();
        const botServiceMod = await import('../../services/botService');

        expect(() => botServiceMod.validateWhatsAppBotToolsPrompt()).not.toThrow();
        expect(() => botServiceMod.validateWhatsAppBotToolsPrompt()).not.toThrow();

        vi.resetModules();
    });
});

// #1658 — testes unitários das funções PURAS `buildAgentHistory` e
// `isAgentHistoryExcluded`. Sem I/O, sem LLM, sem mocks: asserção direta na
// transformação do histórico. Garante que a EXCLUSÃO de notificações automáticas
// sobrevive a refactors futuros e cobre os caminhos aceitos pelo prompt da issue:
//   (a) flag `metadata.systemNotification === true` (scheduler + notificationService)
//   (b) fallback regex do template de cobrança (cobre histórico antigo / moltbot /
//       restart antes da persistência)
//   (c) fallback de segurança via regex caso o template mude (notificações parciais)
//   (d) preserva conversa real (model + user) intacta, sem cair em nenhum dos
//       falsos-positivos clássicos ("Olá, fulano" do usuário, comandos `/...`, etc).
describe('#1658 — isAgentHistoryExcluded / buildAgentHistory (função pura)', () => {
    it('isAgentHistoryExcluded: true quando metadata.systemNotification === true (flag do scheduler)', () => {
        expect(isAgentHistoryExcluded({ metadata: { systemNotification: true } })).toBe(true);
        expect(isAgentHistoryExcluded({ body: 'qualquer', metadata: { systemNotification: true } })).toBe(true);
    });

    it('isAgentHistoryExcluded: true para o template canônico de cobrança (regex fallback #1658)', () => {
        expect(isAgentHistoryExcluded({ body: 'Olá TULIO, a tarefa TK2511-0494 venceu em 20/07/2026.' })).toBe(true);
        expect(isAgentHistoryExcluded({ body: 'Olá X, você é responsável pela tarefa TK9999-0001.' })).toBe(true);
        // Template com descrição rica (caso do comentário da issue: vencimento + valor)
        expect(isAgentHistoryExcluded({ body: 'Olá TULIO, a fatura FA2601-0042 venceu em 10/07/2026. Valor: R$ 1.234,56. Por favor, regularize.' })).toBe(false); // template de fatura é OUTRO — só cobramos tarefa
    });

    it('isAgentHistoryExcluded: FALSE para "Olá, fulano" SEM o template de tarefa (não é notificação)', () => {
        expect(isAgentHistoryExcluded({ body: 'Olá, tudo bem?' })).toBe(false);
        expect(isAgentHistoryExcluded({ body: 'Oi pessoal do grupo' })).toBe(false);
        expect(isAgentHistoryExcluded({ body: 'Oi TULIO, beleza?' })).toBe(false);
    });

    it('isAgentHistoryExcluded: true para saída de /status e /ajuda (metadados do bot)', () => {
        expect(isAgentHistoryExcluded({ body: '📊 *Status do Sistema*\n\n✅ Bot: Ativo' })).toBe(true);
        expect(isAgentHistoryExcluded({ body: '📖 *Comandos Disponíveis*\n\n*Gerais:*' })).toBe(true);
    });

    it('isAgentHistoryExcluded: true para qualquer comando /…', () => {
        expect(isAgentHistoryExcluded({ body: '/pagar 123' })).toBe(true);
        expect(isAgentHistoryExcluded({ body: '/status' })).toBe(true);
    });

    it('isAgentHistoryExcluded: false para conversa real usuário↔agente', () => {
        expect(isAgentHistoryExcluded({ body: 'oi' })).toBe(false);
        expect(isAgentHistoryExcluded({ body: 'Como posso ajudar?' })).toBe(false);
        expect(isAgentHistoryExcluded({ body: 'qual o status da TK2606-3559?' })).toBe(false);
    });

    it('buildAgentHistory: PRESERVA apenas a mensagem real do usuário após 3 notificações + "oi" (cenário do chat 59936436445425@lid)', () => {
        const raw = [
            { fromMe: true, body: 'Olá TULIO, a tarefa TK2511-0494 venceu em 20/07/2026.', metadata: { systemNotification: true } },
            { fromMe: true, body: 'Olá TULIO, a tarefa TK2606-3559 vence em 21/07/2026.' },
            { fromMe: true, body: 'Olá TULIO, a tarefa TK2606-3560 está sem progresso.' },
            { fromMe: false, body: 'oi' },
        ];
        expect(buildAgentHistory(raw, false)).toEqual([{ role: 'user', parts: 'oi' }]);
    });

    it('buildAgentHistory: cobre as 4 vias do prompt da issue — flag, regex, conversa real, sem quebrar com mídia', () => {
        // Mistura notificação COM flag (scheduler) + notificação SEM flag (histórico antigo /
        // moltbot) + comando + conversa real. Garante que TODAS as vias do critério de aceite
        // estão cobertas em UM único teste integrado.
        const raw = [
            { fromMe: true, body: 'Olá X, a tarefa TK1111-1111 venceu.', metadata: { systemNotification: true } }, // (a) flag
            { fromMe: true, body: 'Olá Y, a tarefa TK2222-2222 está atrasada.' }, // (b) só regex
            { fromMe: true, body: '/status' },                                  // comando → excluído
            { fromMe: false, body: 'oi' },                                      // conversa real
            { fromMe: true, body: 'tudo bem?' },                                // réplica do bot
        ];
        // 1:1 (isGroup=false): nenhuma consolidação entre "user" e "model"
        expect(buildAgentHistory(raw, false)).toEqual([
            { role: 'user', parts: 'oi' },
            { role: 'model', parts: 'tudo bem?' },
        ]);
    });

    it('buildAgentHistory: em GRUPO, prepende [senderName] e NÃO consolida entre falantes diferentes', () => {
        const raw = [
            { fromMe: false, body: 'oi', senderName: 'Alice' },
            { fromMe: false, body: 'tudo bem?', senderName: 'Bob' },
            { fromMe: true, body: 'Tudo certo!' },
            { fromMe: false, body: '?', senderName: 'Alice' },
        ];
        expect(buildAgentHistory(raw, true)).toEqual([
            { role: 'user', parts: '[Alice]: oi' },
            { role: 'user', parts: '[Bob]: tudo bem?' },
            { role: 'model', parts: 'Tudo certo!' },
            { role: 'user', parts: '[Alice]: ?' },
        ]);
    });

    it('buildAgentHistory: mídia sem texto do usuário vira "[Mídia recebida: tipo]" e, em 1:1, consolida com texto subsequente do mesmo remetente', () => {
        const raw = [
            { fromMe: false, body: '', hasMedia: true, type: 'image' },
            { fromMe: false, body: 'viu a foto?' },
        ];
        // 1:1 (isGroup=false): mesma role + mesmo sender → consolida na mesma linha do LLM.
        expect(buildAgentHistory(raw, false)).toEqual([
            { role: 'user', parts: '[Mídia recebida: image]\nviu a foto?' },
        ]);
    });

    it('buildAgentHistory: mídia do próprio bot consolida com a próxima resposta textual do bot (1:1)', () => {
        const raw = [
            { fromMe: true, body: '', hasMedia: true, type: 'image' },
            { fromMe: true, body: 'Prontinho, aí vai.' },
        ];
        // 1:1: mesma role "model" + mesmo sender (null) → consolida em uma única linha
        expect(buildAgentHistory(raw, false)).toEqual([
            { role: 'model', parts: '[Mídia recebida: image]\nProntinho, aí vai.' },
        ]);
    });

    it('buildAgentHistory: entradas com body vazio (sem mídia) são descartadas (nada para o LLM)', () => {
        const raw = [
            { fromMe: false, body: '' },
            { fromMe: false, body: 'oi' },
            { fromMe: false, body: '  ' }, // whitespace só
        ];
        expect(buildAgentHistory(raw, false)).toEqual([{ role: 'user', parts: 'oi' }]);
    });

    it('buildAgentHistory: histórico só com notificações ⇒ array VAZIO (LLM começa do zero, sem paranóia)', () => {
        const raw = [
            { fromMe: true, body: 'Olá TULIO, a tarefa TK2511-0494 venceu.', metadata: { systemNotification: true } },
            { fromMe: true, body: 'Olá TULIO, a tarefa TK2606-3559 está atrasada.' },
        ];
        expect(buildAgentHistory(raw, false)).toEqual([]);
    });

    it('buildAgentHistory: preserva conversa MISTA (filtra só notificações + comandos; mantém a interação humana↔agente)', () => {
        const raw = [
            { fromMe: true, body: 'Olá TULIO, a tarefa TK2606-3559 venceu em 14/07/2026. Finalize.', metadata: { systemNotification: true } },
            { fromMe: false, body: 'qual o status da TK2606-3559?' },
            { fromMe: true, body: 'Vou consultar pra você.' },
            { fromMe: true, body: 'Olá TULIO, a tarefa TK2606-3560 venceu em 13/07/2026.' },
            { fromMe: false, body: 'oi' },
        ];
        const history = buildAgentHistory(raw, false);
        const bodies = history.map(h => h.parts).join('\n---\n');
        expect(bodies).not.toContain('Olá TULIO');
        expect(bodies).not.toContain('TK2606-3559 venceu em');
        expect(bodies).not.toContain('TK2606-3560');
        // conversation tem que estar lá
        expect(history.some(h => h.parts === 'qual o status da TK2606-3559?')).toBe(true);
        expect(history.some(h => h.parts === 'Vou consultar pra você.')).toBe(true);
        expect(history.some(h => h.parts === 'oi')).toBe(true);
        // ordem preservada
        expect(history.length).toBe(3);
    });
});
