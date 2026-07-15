import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/features', () => ({
    FEATURES: {
        WHATSAPP_PROVIDER: 'legacy' as const,
        MOLTBOT_ENABLED: false,
        DRY_RUN_MODE: false,
    },
    isUsingMoltbot: vi.fn(() => false),
}));

vi.mock('../../services/moltbotGateway', () => ({
    moltbotGateway: {
        sendMessage: vi.fn(),
        sendFile: vi.fn(),
        sendVoice: vi.fn(),
        getWhatsAppStatus: vi.fn(),
    },
}));

vi.mock('../../services/legacy/messageService', () => ({
    messageService: {
        sendText: vi.fn(),
        sendFile: vi.fn(),
        sendVoice: vi.fn(),
    },
}));

vi.mock('../../services/emailService', () => ({
    emailService: {
        sendEmail: vi.fn(),
    },
}));

// #1441 — Mock de sessionService agora expõe `getWhatsAppSessions()` (fonte única da verdade
// para o estado de todas as sessões, lido a cada chamada de resolveSession). `getStatus` e
// `getFirstWorkingSessionId` continuam no mock só p/ preservar a API que outros módulos
// possam usar; o caminho LEGADO (sem whatsappPrimarySessionId configurada) ainda os consulta,
// mas a policy de routing sob primary configurada NÃO — ela confia em `getWhatsAppSessions`.
const mockSession = vi.hoisted(() => ({
    getStatus: vi.fn(() => 'STOPPED'),
    getFirstWorkingSessionId: vi.fn(() => undefined as string | undefined),
    getWhatsAppSessions: vi.fn(() => [] as Array<{ id: string; status: string }>),
}));
vi.mock('../../services/legacy/sessionService', () => ({ sessionService: mockSession }));

// #1410 — setWhatsAppProvider persiste via uiConfigService.update; mock p/ evitar disco e
// espiar a chamada (sem isso, o teste cairia no fs real e ainda não confirmaria que o setter
// de fato chamou o persist). #1441 — `get` agora é lido a CADA CHAMADA de resolveSession
// (hot-reload), então cada teste que precisa de config específica deve mockar `get` (com
// mockReturnValue para persistir por todo o teste, ou mockImplementationOnce para uma
// única leitura).
const mockUiConfig = vi.hoisted(() => ({
    update: vi.fn((partial: any) => ({ whatsappProvider: partial?.whatsappProvider })),
    get: vi.fn(() => ({})),
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));

import {
    channelRouter,
    ChannelRouter,
    WhatsAppPrimaryUnavailableError,
} from '../../services/channelRouter';
import { FEATURES } from '../../config/features';
import { moltbotGateway } from '../../services/moltbotGateway';
import { messageService as legacyMessageService } from '../../services/legacy/messageService';
import { emailService } from '../../services/emailService';

describe('ChannelRouter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        channelRouter.setWhatsAppProvider('legacy');
        channelRouter.setDefaultSessionId('default');
        (FEATURES as any).DRY_RUN_MODE = false;
        (FEATURES as any).MOLTBOT_ENABLED = false;
        // Defaults seguros: uiConfig vazio (= sem primária) + nenhuma sessão WORKING.
        // Testes que mudam isso sobrescrevem por teste (mockReturnValue / mockImplementationOnce).
        mockUiConfig.get.mockReturnValue({});
        mockSession.getWhatsAppSessions.mockReturnValue([]);
        mockSession.getStatus.mockReturnValue('STOPPED');
        mockSession.getFirstWorkingSessionId.mockReturnValue(undefined);
    });

    describe('constructor & configuration', () => {
        it('sets WhatsApp provider', () => {
            channelRouter.setWhatsAppProvider('moltbot');
            expect(channelRouter.getWhatsAppProvider()).toBe('moltbot');
        });

        it('sets default session ID', () => {
            channelRouter.setDefaultSessionId('my-session');
        });

        // #1410 — setWhatsAppProvider persiste o override em uiConfig (não é mais teatro:
        // só mudar em memória deixava o restart voltar pro env). Aqui validamos o contrato:
        // o setter chama uiConfigService.update com { whatsappProvider }. O teste de "reboot"
        // (persistência sobrevivendo ao reinício) mora em features.test.ts / uiConfigService.test.ts;
        // este aqui cobre o lado do router.
        it('#1410: setWhatsAppProvider persiste o override via uiConfigService.update', () => {
            mockUiConfig.update.mockClear();
            channelRouter.setWhatsAppProvider('moltbot');
            expect(mockUiConfig.update).toHaveBeenCalledWith(expect.objectContaining({ whatsappProvider: 'moltbot' }));
            expect(channelRouter.getWhatsAppProvider()).toBe('moltbot');
        });

        it('#1410: persistência é fail-soft — erro no update NÃO derruba o estado em memória', () => {
            mockUiConfig.update.mockImplementationOnce(() => { throw new Error('disk full'); });
            // setWhatsAppProvider deve logar o erro e manter o provider na memória (até o próximo
            // POST que persista com sucesso ou o restart, que cai no env).
            channelRouter.setWhatsAppProvider('moltbot');
            expect(channelRouter.getWhatsAppProvider()).toBe('moltbot');
        });

        // #1437/#1441 — boot + hot-reload: resolveSession agora lê `uiConfig.whatsappPrimarySessionId`
        // A CADA CHAMADA (sem cache do construtor). Aqui validamos:
        //   - com `whatsappPrimarySessionId` setado no uiConfig → resolveSession devolve esse valor
        //   - com valor vazio/ausente/whitespace → fallback legado para 'default'
        // Verificação é comportamental: instanciamos um ChannelRouter novo e disparamos um envio;
        // `resolveSession` deve devolver exatamente o `primarySessionId` que o uiConfig devolve.
        // (mock de sessionService devolve [] p/ getWhatsAppSessions → resolveLegacySession devolve
        // 'default'; com primary setado + sessions vazias → throw WhatsAppPrimaryUnavailableError;
        // por isso os testes com primary setado mockam getWhatsAppSessions com a primary WORKING.)
        describe('#1437/#1441 — boot wiring + hot-reload: resolveSession lê uiConfig a cada chamada', () => {
            it('com whatsappPrimarySessionId setado: resolveSession usa esse valor (hot-reload)', async () => {
                mockUiConfig.get.mockReturnValue({ whatsappPrimarySessionId: 'primary-x' } as any);
                mockSession.getWhatsAppSessions.mockReturnValue([{ id: 'primary-x', status: 'WORKING' }]);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('primary-x', '5511@c.us', 'Oi');
            });

            it('com whatsappPrimarySessionId vazio (string): fallback legado para \'default\'', async () => {
                mockUiConfig.get.mockReturnValue({ whatsappPrimarySessionId: '' } as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
            });

            it('com whatsappPrimarySessionId ausente (mock retorna {}): fallback legado para \'default\'', async () => {
                mockUiConfig.get.mockReturnValue({} as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
            });

            it('com whatsappPrimarySessionId só de whitespace: trim → vazio → fallback legado', async () => {
                mockUiConfig.get.mockReturnValue({ whatsappPrimarySessionId: '   ' } as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
            });

            it('com whatsappPrimarySessionId com whitespace nas bordas: trim é aplicado', async () => {
                mockUiConfig.get.mockReturnValue({ whatsappPrimarySessionId: '  primary-x  ' } as any);
                mockSession.getWhatsAppSessions.mockReturnValue([{ id: 'primary-x', status: 'WORKING' }]);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('primary-x', '5511@c.us', 'Oi');
            });
        });
    });

    describe('send', () => {
        it('routes to WhatsApp', async () => {
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() });

            const result = await channelRouter.send({
                channel: 'whatsapp',
                recipient: '5511999999999@c.us',
                content: 'Hello',
            });

            expect(result.success).toBe(true);
            expect(result.provider).toBe('legacy');
        });

        it('routes to email', async () => {
            (emailService.sendEmail as any).mockResolvedValue({} as any);

            const result = await channelRouter.send({
                channel: 'email',
                recipient: 'test@test.com',
                content: '<p>Hello</p>',
                subject: 'Test',
            });

            expect(result.success).toBe(true);
            expect(result.provider).toBe('email');
        });

        it('returns error for SMS', async () => {
            const result = await channelRouter.send({
                channel: 'sms',
                recipient: '5511999999999',
                content: 'Hello',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('SMS channel not implemented');
        });
    });

    describe('sendWhatsApp', () => {
        it('uses legacy provider by default', async () => {
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() });

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'Hello');

            expect(result.success).toBe(true);
            expect(result.provider).toBe('legacy');
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Hello');
        });

        it('uses moltbot provider when configured', async () => {
            channelRouter.setWhatsAppProvider('moltbot');
            (FEATURES as any).MOLTBOT_ENABLED = true;
            (moltbotGateway.sendMessage as any).mockResolvedValue({ success: true, messageId: 'mb1' });

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'Hello', 'session1');

            expect(result.success).toBe(true);
            expect(result.provider).toBe('moltbot');
        });

        it('returns dry-run in DRY_RUN_MODE', async () => {
            (FEATURES as any).DRY_RUN_MODE = true;

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'Hello');

            expect(result.success).toBe(true);
            expect(result.provider).toBe('dry-run');
            expect(result.messageId).toMatch(/^dry-run-/);
        });

        it('handles errors', async () => {
            (legacyMessageService.sendText as any).mockRejectedValue(new Error('Send failed'));

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'Hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Send failed');
        });

        it('uses session ID parameter', async () => {
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() });

            await channelRouter.sendWhatsApp('5511@c.us', 'Hello', 'custom-session');
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('custom-session', '5511@c.us', 'Hello');
        });

        it('faz fallback para a sessão WORKING quando a default não está pronta (ex.: só existe "v4")', async () => {
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() });
            mockSession.getStatus.mockReturnValue('STOPPED');                 // 'default' não está WORKING
            mockSession.getFirstWorkingSessionId.mockReturnValue('v4_1747');  // a única conectada

            await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('v4_1747', '5511@c.us', 'Oi');
        });

        it('respeita sessionId explícito mesmo com a default fora (sem fallback)', async () => {
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() });
            mockSession.getStatus.mockReturnValue('STOPPED');
            mockSession.getFirstWorkingSessionId.mockReturnValue('v4_1747');

            await channelRouter.sendWhatsApp('5511@c.us', 'Oi', 'sessao-x');
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('sessao-x', '5511@c.us', 'Oi');
        });

        it('sem nenhuma sessão WORKING, mantém a default (erro fica explícito no envio)', async () => {
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() });
            mockSession.getStatus.mockReturnValue('STOPPED');
            mockSession.getFirstWorkingSessionId.mockReturnValue(undefined);

            await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
        });
    });

    describe('sendWhatsAppFile', () => {
        it('uses legacy for buffer file', async () => {
            (legacyMessageService.sendFile as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await channelRouter.sendWhatsAppFile('5511@c.us', Buffer.from('data'), 'test.pdf');

            expect(result.success).toBe(true);
            expect(result.provider).toBe('legacy');
        });

        it('uses moltbot for file sending', async () => {
            channelRouter.setWhatsAppProvider('moltbot');
            (FEATURES as any).MOLTBOT_ENABLED = true;
            (moltbotGateway.sendFile as any).mockResolvedValue({ success: true, messageId: 'mb1' });

            const result = await channelRouter.sendWhatsAppFile('5511@c.us', Buffer.from('data'), 'test.pdf', 'caption');

            expect(result.success).toBe(true);
            expect(result.provider).toBe('moltbot');
        });

        it('handles string file data with moltbot', async () => {
            channelRouter.setWhatsAppProvider('moltbot');
            (FEATURES as any).MOLTBOT_ENABLED = true;
            (moltbotGateway.sendFile as any).mockResolvedValue({ success: true, messageId: 'mb1' });

            const result = await channelRouter.sendWhatsAppFile('5511@c.us', 'data:application/pdf;base64,SGVsbG8=', 'test.pdf');

            expect(result.success).toBe(true);
        });

        it('returns dry-run in DRY_RUN_MODE', async () => {
            (FEATURES as any).DRY_RUN_MODE = true;

            const result = await channelRouter.sendWhatsAppFile('5511@c.us', Buffer.from('x'), 'f.pdf');
            expect(result.provider).toBe('dry-run');
        });

        it('handles errors', async () => {
            (legacyMessageService.sendFile as any).mockRejectedValue(new Error('File error'));

            const result = await channelRouter.sendWhatsAppFile('5511@c.us', Buffer.from('x'), 'f.pdf');
            expect(result.success).toBe(false);
            expect(result.error).toBe('File error');
        });
    });

    describe('sendWhatsAppVoice', () => {
        it('uses legacy provider', async () => {
            (legacyMessageService.sendVoice as any).mockResolvedValue({ id: 'v1' } as any);

            const result = await channelRouter.sendWhatsAppVoice('5511@c.us', 'base64audio');

            expect(result.success).toBe(true);
            expect(result.provider).toBe('legacy');
        });

        it('uses moltbot provider', async () => {
            channelRouter.setWhatsAppProvider('moltbot');
            (FEATURES as any).MOLTBOT_ENABLED = true;
            (moltbotGateway.sendVoice as any).mockResolvedValue({ success: true, messageId: 'v1' });

            const result = await channelRouter.sendWhatsAppVoice('5511@c.us', 'base64audio', 'sess1');

            expect(result.success).toBe(true);
            expect(result.provider).toBe('moltbot');
        });

        it('returns dry-run in DRY_RUN_MODE', async () => {
            (FEATURES as any).DRY_RUN_MODE = true;
            const result = await channelRouter.sendWhatsAppVoice('5511@c.us', 'audio');
            expect(result.provider).toBe('dry-run');
        });

        it('handles errors', async () => {
            (legacyMessageService.sendVoice as any).mockRejectedValue(new Error('Voice error'));
            const result = await channelRouter.sendWhatsAppVoice('5511@c.us', 'audio');
            expect(result.success).toBe(false);
        });
    });

    describe('sendEmail', () => {
        it('sends email successfully', async () => {
            (emailService.sendEmail as any).mockResolvedValue({} as any);

            const result = await channelRouter.sendEmail('test@test.com', 'Subj', '<p>Body</p>');

            expect(result.success).toBe(true);
            expect(result.provider).toBe('email');
        });

        it('returns dry-run in DRY_RUN_MODE', async () => {
            (FEATURES as any).DRY_RUN_MODE = true;
            const result = await channelRouter.sendEmail('test@test.com', 'Subj', 'Body');
            expect(result.provider).toBe('dry-run');
        });

        it('handles email errors', async () => {
            (emailService.sendEmail as any).mockRejectedValue(new Error('SMTP error'));
            const result = await channelRouter.sendEmail('test@test.com', 'Subj', 'Body');
            expect(result.success).toBe(false);
        });
    });

    describe('getChannelStatus', () => {
        it('returns email status', async () => {
            const status = await channelRouter.getChannelStatus('email');
            expect(status.channel).toBe('email');
            expect(status.connected).toBe(true);
        });

        it('returns unknown for unsupported channel', async () => {
            const status = await channelRouter.getChannelStatus('sms' as any);
            expect(status.connected).toBe(false);
        });

        it('returns legacy WhatsApp status', async () => {
            const status = await channelRouter.getChannelStatus('whatsapp');
            expect(status.channel).toBe('whatsapp');
            expect(status.provider).toBe('legacy');
        });

        it('returns moltbot WhatsApp status', async () => {
            channelRouter.setWhatsAppProvider('moltbot');
            (FEATURES as any).MOLTBOT_ENABLED = true;
            (moltbotGateway.getWhatsAppStatus as any).mockResolvedValue({
                connected: true,
                status: 'ready',
            } as any);

            const status = await channelRouter.getChannelStatus('whatsapp');
            expect(status.provider).toBe('moltbot');
            expect(status.connected).toBe(true);
        });

        it('handles WhatsApp status error', async () => {
            channelRouter.setWhatsAppProvider('moltbot');
            (FEATURES as any).MOLTBOT_ENABLED = true;
            (moltbotGateway.getWhatsAppStatus as any).mockRejectedValue(new Error('Status error'));

            const status = await channelRouter.getChannelStatus('whatsapp');
            expect(status.connected).toBe(false);
            expect(status.status).toBe('error');
        });
    });

    describe('getAllChannelsStatus', () => {
        it('returns status for all channels', async () => {
            const statuses = await channelRouter.getAllChannelsStatus();
            expect(statuses).toHaveLength(2);
            expect(statuses[0].channel).toBe('whatsapp');
            expect(statuses[1].channel).toBe('email');
        });
    });
});
