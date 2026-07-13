import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as atomicWriteMod from '../../utils/atomicWrite';
import * as fsMod from 'fs';
import fs from 'fs';

// fs é mockado globalmente (setup.ts); mockamos atomicWrite p/ espiar a persistência.
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
import { atomicWriteSync } from '../../utils/atomicWrite';
const mockedFs = vi.mocked(fs);
const mockedWrite = vi.mocked(atomicWriteSync);

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

// #1397 (Dial 2) — mock do uiConfigService para quiet-hours. Default = tudo DESLIGADO (não
// silencia nada) — preserva os testes existentes. Os testes de enforcement sobrescrevem por
// caso. Também expõe `.get()` para o resolver `isDryRunEnabled` (featureSwitches) não quebrar.
const mockUiConfig = vi.hoisted(() => ({
    isInQuietHours: vi.fn(() => false),
    getQuietHours: vi.fn(() => ({
        whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        email: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
    })),
    get: vi.fn(() => ({
        featureSwitches: { dryRunMode: false, financialCommands: false, crmContextInjection: true },
        notificationPolicy: {
            quietHours: {
                whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
                email: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
                'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
            },
            cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
            staleHours: 24,
            invoiceDueHorizonDays: 3,
        },
    })),
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));

// Default do mock: nenhuma sessão pronta → resolveSession devolve a default (preserva os testes
// que esperam 'default'). Casos de fallback sobrescrevem por teste.
const mockSession = vi.hoisted(() => ({
    getStatus: vi.fn(() => 'STOPPED'),
    getFirstWorkingSessionId: vi.fn(() => undefined as string | undefined),
}));
vi.mock('../../services/legacy/sessionService', () => ({ sessionService: mockSession }));

import { channelRouter, ChannelRouter } from '../../services/channelRouter';
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
        // padrão: nada silenciado (regra de teste default)
        mockUiConfig.isInQuietHours.mockReturnValue(false);
    });

    describe('constructor & configuration', () => {
        it('sets WhatsApp provider', () => {
            channelRouter.setWhatsAppProvider('moltbot');
            expect(channelRouter.getWhatsAppProvider()).toBe('moltbot');
        });

        it('sets default session ID', () => {
            channelRouter.setDefaultSessionId('my-session');
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

    // #1397 — ENFORCEMENT TEST (Dial 2): mudar quietHours MUDA o envio. Sem este teste, o PR é
    // teatro (a UI mostra o dial, mas o motor ignora). Mesmo padrão do approvalValueThreshold
    // pré-#1370 e do cobrancaCadence deste PR.
    describe('Dial 2 — notificationPolicy.quietHours (#1397)', () => {
        it('whatsapp: canal silenciado pela config → sendWhatsApp falha sem chamar provider', async () => {
            mockUiConfig.isInQuietHours.mockImplementation((channel: string) => channel === 'whatsapp');
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' });

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'Oi');

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/quiet-hours/);
            expect(legacyMessageService.sendText).not.toHaveBeenCalled(); // nunca chamou o provider
        });

        it('whatsapp: canal NÃO silenciado → envio segue normal', async () => {
            mockUiConfig.isInQuietHours.mockReturnValue(false);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' });

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'Oi');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
        });

        it('email: canal silenciado → sendEmail falha sem chamar SMTP', async () => {
            mockUiConfig.isInQuietHours.mockImplementation((channel: string) => channel === 'email');
            (emailService.sendEmail as any).mockResolvedValue({} as any);

            const result = await channelRouter.sendEmail('x@y.com', 'Subj', 'Body');

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/quiet-hours/);
            expect(emailService.sendEmail).not.toHaveBeenCalled();
        });

        it('dry-run tem precedência sobre quiet-hours (debug não pode ser bloqueado)', async () => {
            mockUiConfig.isInQuietHours.mockReturnValue(true); // tudo silenciado
            (FEATURES as any).DRY_RUN_MODE = true;

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'Oi');

            expect(result.success).toBe(true);
            expect(result.provider).toBe('dry-run');
        });

        it('isChannelSilenced delega à uiConfigService (sem cache próprio)', () => {
            mockUiConfig.isInQuietHours.mockReturnValueOnce(true);
            expect(channelRouter.isChannelSilenced('whatsapp')).toBe(true);
            expect(mockUiConfig.isInQuietHours).toHaveBeenCalledWith('whatsapp', undefined);

            mockUiConfig.isInQuietHours.mockReturnValueOnce(false);
            const at = new Date('2026-07-13T03:00:00Z');
            expect(channelRouter.isChannelSilenced('email', at)).toBe(false);
            expect(mockUiConfig.isInQuietHours).toHaveBeenCalledWith('email', at);
        });
    });

    // #1397 (Dials 5 e 6) — ENFORCEMENT TEST: setWhatsAppProvider e setDefaultSessionId
    // PERSISTEM em disco (data/channel_router.json). Antes as rotas admin/integration mudavam só
    // em memória (config-teatro da auditoria #1124). Aqui validamos:
    //  (a) o setter chama atomicWriteSync com o JSON certo;
    //  (b) uma nova instância do ChannelRouter rehidrata o estado do disco (sobrevive a restart);
    //  (c) mudança do dial MUDA o roteamento observável.
    describe('Dials 5 + 6 — channelRouter state persiste em disco (#1397)', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            // defaults: arquivo NÃO existe → store vazio → fresh defaults
            mockedFs.existsSync.mockReturnValue(false);
            mockedFs.readFileSync.mockReturnValue(Buffer.from('{}') as any);
        });

        it('setWhatsAppProvider chama atomicWriteSync com o novo provider', async () => {
            // Forçamos o fs a dizer que o arquivo existe, e configuramos o writeSync para criar
            // uma captura determinística.
            mockedFs.existsSync.mockReturnValue(true);
            const writeSpy = vi.spyOn(atomicWriteMod, 'atomicWriteSync');

            channelRouter.setWhatsAppProvider('moltbot');
            expect(channelRouter.getWhatsAppProvider()).toBe('moltbot');
            expect(writeSpy).toHaveBeenCalled();
            const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1];
            // O path do store contém 'channel_router.json'
            expect(String(lastCall[0])).toMatch(/channel_router\.json$/);
            // O objeto persistido contém whatsAppProvider='moltbot'
            expect((lastCall[1] as any).whatsAppProvider).toBe('moltbot');
        });

        it('setDefaultSessionId chama atomicWriteSync e tem getter (Dial 5)', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            const writeSpy = vi.spyOn(atomicWriteMod, 'atomicWriteSync');

            channelRouter.setDefaultSessionId('minha-sessao-primaria');
            expect(channelRouter.getDefaultSessionId()).toBe('minha-sessao-primaria');
            expect(writeSpy).toHaveBeenCalled();
            const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1];
            expect(String(lastCall[0])).toMatch(/channel_router\.json$/);
            expect((lastCall[1] as any).defaultSessionId).toBe('minha-sessao-primaria');
        });

        it('setDefaultSessionId rejeita valor vazio/whitespace (não persiste, mantém o anterior)', () => {
            const before = channelRouter.getDefaultSessionId();
            const writeSpy = vi.spyOn(atomicWriteMod, 'atomicWriteSync');
            channelRouter.setDefaultSessionId('');
            channelRouter.setDefaultSessionId('   ');
            expect(channelRouter.getDefaultSessionId()).toBe(before);
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it('ambos os setters coexistem no mesmo arquivo (campos distintos)', () => {
            const writeSpy = vi.spyOn(atomicWriteMod, 'atomicWriteSync');
            channelRouter.setWhatsAppProvider('moltbot');
            channelRouter.setDefaultSessionId('sessao-X');
            const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1];
            const persisted = lastCall[1] as any;
            expect(persisted.whatsAppProvider).toBe('moltbot');
            expect(persisted.defaultSessionId).toBe('sessao-X');
        });

        it('DIAL CONSUMIDO: setDefaultSessionId MUDA a sessão usada no envio (enforcement core)', async () => {
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' });

            // default 'default' → envia para 'default'
            await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
            expect(legacyMessageService.sendText).toHaveBeenLastCalledWith('default', '5511@c.us', 'Oi');

            // muda dial → envia para a nova sessão
            channelRouter.setDefaultSessionId('sessao-primaria');
            mockSession.getStatus.mockImplementation((sid: string) => sid === 'sessao-primaria' ? 'WORKING' : 'STOPPED');
            await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
            expect(legacyMessageService.sendText).toHaveBeenLastCalledWith('sessao-primaria', '5511@c.us', 'Oi');
        });

        it('construtor rehidrata whatsAppProvider do disco quando o arquivo existe (restart)', async () => {
            // mocka fs.existsSync/readFileSync SÓ para o STORE_PATH do channelRouter.
            const originalExists = fsMod.existsSync;
            const originalRead = fsMod.readFileSync;
            // rota storePath é derivada de __dirname; não dá pra cravar — mas o `loadPersisted`
            // usa o caminho que o constructor computou. Hack: mockamos readFileSync p/ retornar
            // o JSON p/ QUALQUER arquivo (o loadPersisted só lê o storePath, então só ele casa).
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ whatsAppProvider: 'moltbot' }) as any);

            const fresh = new ChannelRouter();
            // O construtor carregou o estado persistido (sobreviveu ao restart)
            expect(fresh.getWhatsAppProvider()).toBe('moltbot');
            // ... e NÃO usou o env WHATSAPP_PROVIDER=legacy
            expect(fresh.getWhatsAppProvider()).not.toBe('legacy');
            // restaura fs originals (cleanup)
            void originalExists;
            void originalRead;
        });

        it('construtor trata arquivo corrompido (cai no default do env)', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue('{inválido' as any);
            const fresh = new ChannelRouter();
            // Arquivo corrompido → cai no env WHATSAPP_PROVIDER=legacy (do mock de FEATURES)
            expect(fresh.getWhatsAppProvider()).toBe('legacy');
            expect(fresh.getDefaultSessionId()).toBe('default');
        });
    });
});
