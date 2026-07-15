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

import { channelRouter, ChannelRouter } from '../../services/channelRouter';
import { FEATURES } from '../../config/features';
import { moltbotGateway } from '../../services/moltbotGateway';
import { messageService as legacyMessageService } from '../../services/legacy/messageService';
import { emailService } from '../../services/emailService';

describe('ChannelRouter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        channelRouter.setWhatsAppProvider('legacy');
        // #1409 — `setDefaultSessionId` foi removido (path B do issue): o `defaultSessionId` é
        // uma constante interna do router (hidratada no boot a partir de
        // `uiConfig.whatsappPrimarySessionId` — ver #1437), não há mais API pública para
        // resetar entre testes. O default é 'default' a menos que cada teste mocke o
        // `mockUiConfig.get` antes de instanciar um `ChannelRouter` novo (ver describe #1437).
        (FEATURES as any).DRY_RUN_MODE = false;
        (FEATURES as any).MOLTBOT_ENABLED = false;
    });

    describe('constructor & configuration', () => {
        it('sets WhatsApp provider', () => {
            channelRouter.setWhatsAppProvider('moltbot');
            expect(channelRouter.getWhatsAppProvider()).toBe('moltbot');
        });

        // #1409 — adaptação do antigo teste `'sets default session ID'` (que validava um setter
        // REMOVIDO no path B): a asserção equivalente é que `resolveSession` propaga 'default'
        // quando nenhum sessionId explícito é fornecido, sem depender de setter em runtime.
        // Comportamento observável = default interno do router chega ao provider como argumento.
        it('#1409: propaga "default" como sessionId quando nenhum sessionId explícito é fornecido', async () => {
            vi.mocked(legacyMessageService.sendText).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
            mockSession.getStatus.mockReturnValue('WORKING'); // 'default' está WORKING
            mockSession.getFirstWorkingSessionId.mockReturnValue(undefined);
            await channelRouter.sendWhatsApp('5511@c.us', 'Hello');
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Hello');
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

        // #1437 + #1409 — boot: hidrata `defaultSessionId` a partir de `uiConfig.whatsappPrimarySessionId`.
        // O construtor faz field assignment direto (não chama setter) porque o setter público
        // `setDefaultSessionId` foi removido em #1409 (path B): só era chamado em teste, sem caller
        // de produção e sem persistência — manter era "teatro". Aqui validamos:
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

        // #1409 — path B: `setDefaultSessionId` removido (era setter-fantasma, só chamado em
        // teste, sem caller de produção e sem persistência). O default institucional vive em
        // `uiConfig.whatsappPrimarySessionId` (#1439); o router mantém a string 'default' apenas
        // como placeholder usado pelo `resolveSession` quando não há sessão WORKING disponível
        // (alvo para a mensagem de erro "Session X not found" ficar explícita).
        // Casts via `unknown as Record<string, unknown>` evitam `any` (warning do
        // @typescript-eslint/no-explicit-any) e ainda permitem checar ausência de método na API pública.
        describe('#1409 — setDefaultSessionId removido', () => {
            it('não expõe mais setDefaultSessionId na API pública', () => {
                expect((channelRouter as unknown as Record<string, unknown>).setDefaultSessionId).toBeUndefined();
                expect((ChannelRouter.prototype as unknown as Record<string, unknown>).setDefaultSessionId).toBeUndefined();
            });

            it('mantém o default interno como \'default\' (observável via resolveSession)', async () => {
                vi.mocked(legacyMessageService.sendText).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                // 'default' WORKING → resolveSession devolve 'default', usado como argumento.
                mockSession.getStatus.mockReturnValue('WORKING');
                mockSession.getFirstWorkingSessionId.mockReturnValue(undefined);
                await channelRouter.sendWhatsApp('5511@c.us', 'oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'oi');
            });

            it('chamadas sem sessionId explícito sempre usam "default" (nenhum caller runtime pode alterar)', async () => {
                vi.mocked(legacyMessageService.sendText).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockSession.getStatus.mockReturnValue('WORKING');
                mockSession.getFirstWorkingSessionId.mockReturnValue(undefined);

                // Sequência realista: alterna providers e dispara envios sem sessionId explícito.
                // Todas as chamadas devem cair em 'default' — não existe mais como alguém ter
                // "setado" outro valor em runtime.
                channelRouter.setWhatsAppProvider('moltbot');
                await channelRouter.sendWhatsApp('5511@c.us', 'com-x', 'sessao-x'); // explícito: 'sessao-x'
                vi.mocked(legacyMessageService.sendText).mockClear();

                channelRouter.setWhatsAppProvider('legacy');
                await channelRouter.sendWhatsApp('5511@c.us', 'sem-1');
                await channelRouter.sendWhatsApp('5511@c.us', 'sem-2');
                channelRouter.setWhatsAppProvider('moltbot');
                await channelRouter.sendWhatsApp('5511@c.us', 'sem-3');

                const calls = vi.mocked(legacyMessageService.sendText).mock.calls;
                expect(calls).toHaveLength(3);
                expect(calls.every((c) => c[0] === 'default')).toBe(true);
            });

            it('referência órfã a setDefaultSessionId no código de produção: nenhuma', async () => {
                // Enforcement real do critério de aceite #3 do issue (nenhuma referência órfã).
                // `fs` está mockado em `__tests__/setup.ts` (`readdirSync → []`), por isso usamos
                // `vi.importActual` para acessar a implementação real do módulo. Sem isso o
                // walker não listaria nenhum arquivo e o teste passaria trivialmente.
                // `path` não é mockado no setup, então `import` direto é seguro.
                const fsReal = await vi.importActual<typeof import('fs')>('fs');
                const path = await import('path');
                const rootSrc = path.resolve(__dirname, '../../');
                const offenders: string[] = [];
                const walk = (dir: string) => {
                    for (const entry of fsReal.readdirSync(dir, { withFileTypes: true })) {
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
                            walk(full);
                        } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
                            const content = fsReal.readFileSync(full, 'utf-8');
                            if (/setDefaultSessionId\s*\(/.test(content)) offenders.push(full);
                        }
                    }
                };
                walk(rootSrc);
                expect(offenders).toEqual([]);
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
