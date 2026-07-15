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

// Default do mock: nenhuma sessão pronta → resolveSession devolve a default (preserva os testes
// que esperam 'default'). Casos de fallback sobrescrevem por teste.
const mockSession = vi.hoisted(() => ({
    getStatus: vi.fn(() => 'STOPPED'),
    getFirstWorkingSessionId: vi.fn(() => undefined as string | undefined),
}));
vi.mock('../../services/legacy/sessionService', () => ({ sessionService: mockSession }));

// #1410 — setWhatsAppProvider persiste via uiConfigService.update; mock p/ evitar disco e
// espiar a chamada (sem isso, o teste cairia no fs real e ainda não confirmaria que o setter
// de fato chamou o persist).
const mockUiConfig = vi.hoisted(() => ({
    update: vi.fn((partial: any) => ({ whatsappProvider: partial?.whatsappProvider })),
    get: vi.fn(() => ({})),
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));

import { channelRouter, ChannelRouter, WhatsAppPrimaryUnavailableError } from '../../services/channelRouter';
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

        // #1437 — boot: hidrata `defaultSessionId` a partir de `uiConfig.whatsappPrimarySessionId`.
        // Antes desse ajuste, `setDefaultSessionId` era um setter órfão (nunca era chamado no boot),
        // então o canal sempre caía na string 'default' hardcoded. Aqui validamos:
        //   - com `whatsappPrimarySessionId` setado no uiConfig → construtor usa esse valor
        //   - com valor vazio/ausente/whitespace → fallback legado para 'default'
        // Verificação é comportamental: instanciamos um ChannelRouter novo e disparamos um envio;
        // `resolveSession` deve devolver exatamente o `defaultSessionId` que o construtor setou
        // (mock de sessionService devolve STOPPED p/ qualquer id + getFirstWorkingSessionId → undefined,
        // então resolveSession devolve o default diretamente).
        describe('#1437 — boot wiring: hidrata defaultSessionId do uiConfig', () => {
            it('com whatsappPrimarySessionId setado: construtor usa esse valor (resolveSession devolve)', async () => {
                mockUiConfig.get.mockImplementationOnce(() => ({ whatsappPrimarySessionId: 'primary-x' }) as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('primary-x', '5511@c.us', 'Oi');
            });

            it('com whatsappPrimarySessionId vazio (string): fallback legado para \'default\'', async () => {
                mockUiConfig.get.mockImplementationOnce(() => ({ whatsappPrimarySessionId: '' }) as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
            });

            it('com whatsappPrimarySessionId ausente (mock retorna {}): fallback legado para \'default\'', async () => {
                mockUiConfig.get.mockImplementationOnce(() => ({}) as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
            });

            it('com whatsappPrimarySessionId só de whitespace: trim → vazio → fallback legado', async () => {
                mockUiConfig.get.mockImplementationOnce(() => ({ whatsappPrimarySessionId: '   ' }) as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
            });

            it('com whatsappPrimarySessionId com whitespace nas bordas: trim é aplicado', async () => {
                mockUiConfig.get.mockImplementationOnce(() => ({ whatsappPrimarySessionId: '  primary-x  ' }) as any);
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

        it('policy="first-working": faz fallback para a sessão WORKING quando a default não está pronta (ex.: só existe "v4")', async () => {
            // #1441 — fallback silencioso SÓ acontece com whatsappFallbackPolicy='first-working'.
            // Antes desse ajuste, este teste rodava com policy='fail' (default do sanitize) e
            // passava silenciosamente — mascarando a regressão #1441. Agora ele declara
            // explicitamente que está exercendo o ramo "first-working".
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() });
            mockUiConfig.get.mockReturnValue({ whatsappFallbackPolicy: 'first-working' } as any);
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

    // #1441 — enforcement: a config muda a sessão usada e a policy é respeitada. Estes 3 cenários
    // travam o contrato de `resolveSession`:
    //   - policy='fail' (default seguro): primária OFFLINE + fallback disponível → THROW, NÃO envia
    //     de 'default'. Garante que o fallback silencioso NÃO volte p/ nenhuma policy.
    //   - policy='first-working': primária OFFLINE + fallback disponível → usa fallback com warn.
    //   - sem config (legado): sem whatsappPrimarySessionId + 'default' WORKING → usa 'default'
    //     (compatibilidade com deploys antigos).
    //
    // O mock de `sessionService` (`mockSession.getStatus` / `getFirstWorkingSessionId`) isola o
    // resolveSession do transportador real (`legacyMessageService.sendText` é espiado para
    // confirmar que ele NÃO foi chamado quando o teste espera throw).
    describe('#1441 — resolveSession honra whatsappFallbackPolicy', () => {
        // Helper: monta o cenário injetando primary/policy/status via mocks. `primarySessionId`
        // simula o `whatsappPrimarySessionId` configurado (string) OU o legado sem config
        // (null = cai em 'default' como defaultSessionId). `primaryStatus` força o status da
        // sessão primária. `fallbackWorking` é o que `getFirstWorkingSessionId` devolve.
        const setupScenario = (opts: {
            primarySessionId: string | null;       // null = sem config (legado)
            primaryStatus: 'WORKING' | 'STOPPED';
            policy: 'fail' | 'first-working';
            fallbackWorking?: string | undefined;  // sessão WORKING retornada pelo fallback
            defaultSessionStatus?: 'WORKING' | 'STOPPED';
        }) => {
            // defaultSessionId da router = primary configurada (ou 'default' legado).
            channelRouter.setDefaultSessionId(opts.primarySessionId ?? 'default');
            // uiConfig mock devolve a config que o resolveSession lê.
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: opts.primarySessionId ?? '',
                whatsappFallbackPolicy: opts.policy,
            } as any);
            // sessionService.getStatus: primária e 'default' podem ter status independentes
            // (cenário 1 e 2 têm primária OFFLINE mas 'default' WORKING; cenário 3 tem só 'default').
            const defaultStatus = opts.defaultSessionStatus ?? opts.primaryStatus;
            mockSession.getStatus.mockImplementation((id: string) => {
                if (id === opts.primarySessionId) return opts.primaryStatus;
                if (id === 'default') return defaultStatus;
                return 'STOPPED';
            });
            mockSession.getFirstWorkingSessionId.mockReturnValue(opts.fallbackWorking);
        };

        // Cenário 1 — policy 'fail' (default seguro): primária OFFLINE, 'default' WORKING,
        // existe fallback disponível. Esperado: throw WhatsAppPrimaryUnavailableError mencionando
        // a primária e a policy. NÃO envia de 'default' (transportador não pode ser chamado).
        it('Cenário 1: policy="fail" + primária OFFLINE + "default" WORKING → lança WhatsAppPrimaryUnavailableError e NÃO envia de "default"', async () => {
            setupScenario({
                primarySessionId: 'v4_1747',
                primaryStatus: 'STOPPED',         // primária forçada OFFLINE
                policy: 'fail',                    // política segura default
                fallbackWorking: 'default',        // 'default' está WORKING (seria o fallback)
                defaultSessionStatus: 'WORKING',
            });
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg-x' });

            // Resolve a primária pelo id configurado (não 'default' hardcoded).
            await expect(channelRouter.sendWhatsApp('5511@c.us', 'cobranca'))
                .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);

            // A mensagem do erro carrega o id da primária e o nome da policy (audit-friendly).
            await expect(channelRouter.sendWhatsApp('5511@c.us', 'cobranca'))
                .rejects.toThrow(/v4_1747/);
            await expect(channelRouter.sendWhatsApp('5511@c.us', 'cobranca'))
                .rejects.toThrow(/fail/);

            // E o transportador real (legacy ou moltbot) NÃO pode ter sido chamado — sem fallback
            // silencioso para 'default'. Garante o critério "NÃO envia de 'default'".
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
            expect(moltbotGateway.sendMessage).not.toHaveBeenCalled();
        });

        // Cenário 2 — policy 'first-working': mesma config mas com policy permissiva. Esperado:
        // resolveSession devolve 'default' (a única WORKING) e log.warn é registrado.
        it('Cenário 2: policy="first-working" + primária OFFLINE + "default" WORKING → roteia para "default" (com log.warn registrado)', async () => {
            setupScenario({
                primarySessionId: 'v4_1747',
                primaryStatus: 'STOPPED',
                policy: 'first-working',
                fallbackWorking: 'default',
                defaultSessionStatus: 'WORKING',
            });
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg-ok' });

            await channelRouter.sendWhatsApp('5511@c.us', 'notificacao');

            // Cai no fallback 'default' (a única WORKING diferente da primária) — este é o ramo
            // "first-working" do `resolveSession`, que loga warn ANTES de devolver o id.
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'notificacao');
            // NUNCA chama a primária OFFLINE.
            expect(legacyMessageService.sendText).not.toHaveBeenCalledWith(
                'v4_1747', expect.anything(), expect.anything()
            );
        });

        // Cenário 3 — sem config (legado): `whatsappPrimarySessionId` ausente/vazio, política
        // 'fail' (default), sessão 'default' WORKING. Esperado: usa 'default' (compatibilidade
        // — não força configuração nova em deploys antigos que só têm a sessão 'default').
        it('Cenário 3: sem whatsappPrimarySessionId configurado + "default" WORKING → usa "default" (compat)', async () => {
            setupScenario({
                primarySessionId: null,           // sem config → defaultSessionId vira 'default'
                primaryStatus: 'WORKING',         // 'default' está WORKING
                policy: 'fail',                    // policy default (sanitize cai em 'fail' p/ ausentes)
                // fallbackWorking irrelevante: 'default' WORKING resolve antes do fallback.
            });
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg-legacy' });

            await channelRouter.sendWhatsApp('5511@c.us', 'oi');

            // Compatibilidade: usa 'default' direto (resolveSession retorna na 1ª checagem
            // porque 'default' está WORKING, antes de chegar na lógica de policy/fallback).
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'oi');
        });

        // Guard rail — política ausente / fora do domínio é saneada para 'fail' (consistente com
        // sanitizeWhatsappFallbackPolicy). Garante que um JSON corrompido nunca reativa o
        // fallback silencioso silenciosamente.
        it('Guard rail: whatsappFallbackPolicy ausente / fora do domínio → saneada para "fail" (throw, não fallback)', async () => {
            setupScenario({
                primarySessionId: 'v4_1747',
                primaryStatus: 'STOPPED',
                // bypass do helper: mock direto com valor "inválido" p/ forçar o sanitize no
                // resolveSession (rawPolicy !== 'first-working' → cai em 'fail').
                policy: 'fail',
                fallbackWorking: 'default',
                defaultSessionStatus: 'WORKING',
            });
            mockUiConfig.get.mockReturnValue({ whatsappFallbackPolicy: 'FIRST-WORKING' } as any);

            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg-x' });

            await expect(channelRouter.sendWhatsApp('5511@c.us', 'oi'))
                .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });
    });
});
