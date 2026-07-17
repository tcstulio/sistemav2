import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

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

// Default do mock: qualquer sessão consultada está WORKING → `resolveSession` devolve a
// primária direto (happy path). Testes que precisam do caminho de política/fallback
// sobrescrevem `mockSession.getStatus.mockReturnValue('STOPPED')` no escopo do `it`.
const mockSession = vi.hoisted(() => ({
    getStatus: vi.fn(() => 'WORKING'),
    getFirstWorkingSessionId: vi.fn(() => undefined as string | undefined),
}));
vi.mock('../../services/legacy/sessionService', () => ({ sessionService: mockSession }));

// #1410 — setWhatsAppProvider persiste via uiConfigService.update; mock p/ evitar disco e
// espiar a chamada. #1438 — `resolveSession` lê `uiConfigService.get()` AO VIVO a cada envio
// (não há mais cache no boot nem setter-fantasma); o mock base devolve um objeto com primária
// `'default'` explícita e política ausente (→ 'fail' default seguro, ou seja, sem fallback)
// para os testes do happy path. Testes que precisam de primária vazia/inespecífica usam
// `mockReturnValueOnce({})` ou similar.
const mockUiConfig = vi.hoisted(() => ({
    update: vi.fn((partial: any) => ({ whatsappProvider: partial?.whatsappProvider })),
    get: vi.fn(() => ({ whatsappPrimarySessionId: 'default' })),
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
        // #1438 — `vi.clearAllMocks()` só zera histórico, NÃO reseta implementação. Os testes de
        // política usam `mockReturnValueOnce('STOPP')` / `mockReturnValue('STOPPED')` que
        // persistiriam nos testes seguintes sem este reset explícito (sintoma: testes
        // sendWhatsAppFile/Voice começavam a falhar com WhatsAppPrimaryUnavailableError mesmo
        // sem mockarem STOPPED). `mockReset` volta ao `vi.fn(() => 'WORKING')` definido no hoisted.
        mockSession.getStatus.mockReset();
        mockSession.getStatus.mockImplementation(() => 'WORKING');
        mockSession.getFirstWorkingSessionId.mockReset();
        mockSession.getFirstWorkingSessionId.mockImplementation(() => undefined);
        mockUiConfig.get.mockReset();
        mockUiConfig.get.mockImplementation(() => ({ whatsappPrimarySessionId: 'default' }));
        mockUiConfig.update.mockReset();
        mockUiConfig.update.mockImplementation((partial: any) => ({ whatsappProvider: partial?.whatsappProvider }));
        channelRouter.setWhatsAppProvider('legacy');
        (FEATURES as any).DRY_RUN_MODE = false;
        (FEATURES as any).MOLTBOT_ENABLED = false;
    });

    describe('constructor & configuration', () => {
        it('sets WhatsApp provider', () => {
            channelRouter.setWhatsAppProvider('moltbot');
            expect(channelRouter.getWhatsAppProvider()).toBe('moltbot');
        });

        // #1438 — `setDefaultSessionId` foi removido (#1437 / #1438): a sessão primária é 100%
        // derivada do `uiConfig.whatsappPrimarySessionId` a cada `resolveSession` (live). Não há
        // mais setter público: trocar o primário é trocar a config persistida (admin via PUT
        // /api/ui-config), não chamar método. Aqui validamos o contrato do live-read — o envio
        // usa o sessionId que o config devolve AGORA, não um valor cacheado em memória.
        it('#1438: primary sessionId é derivado do uiConfig (sem setter) — live read por envio', async () => {
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
            mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'primary-cfg' } as any);
            await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('primary-cfg', '5511@c.us', 'Oi');
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

        // #1437 + #1438 — `resolveSession` lê `uiConfig.whatsappPrimarySessionId` AO VIVO (não há
        // mais caching no boot: o campo `defaultSessionId` e o setter-fantasma `setDefaultSessionId`
        // foram removidos). Aqui validamos a derivação da sessão primária:
        //   - com `whatsappPrimarySessionId` setado no uiConfig → é essa a sessão usada
        //   - com valor vazio/ausente/whitespace → LANÇA `WhatsAppPrimaryUnavailableError`
        //     (admin precisa configurar; antes era fallback legado para 'default' — removido
        //     por reintroduzir a string mágica no hot path que o fix tenta eliminar)
        // Verificação é comportamental: disparamos um envio e conferimos o sessionId que chega ao
        // provider (mock de sessionService devolve WORKING p/ qualquer id → resolveSession devolve
        // a primária diretamente, sem ramificar pela política).
        describe('#1437 — resolveSession deriva a sessão primária do uiConfig (live)', () => {
            it('com whatsappPrimarySessionId setado: resolveSession usa esse valor', async () => {
                mockUiConfig.get.mockImplementationOnce(() => ({ whatsappPrimarySessionId: 'primary-x' }) as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('primary-x', '5511@c.us', 'Oi');
            });

            // #1438 — o fallback legado para 'default' foi REMOVIDO (string mágica no hot path).
            // Adaptado para refletir o novo comportamento: primária vazia LANÇA o erro
            // distinto (caller sabe que é erro de CONFIGURAÇÃO, não do provider).
            it('com whatsappPrimarySessionId vazio (string): lança WhatsAppPrimaryUnavailableError (sem fallback)', async () => {
                mockUiConfig.get.mockImplementationOnce(() => ({ whatsappPrimarySessionId: '' }) as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await expect(router.sendWhatsApp('5511@c.us', 'Oi'))
                    .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                expect(legacyMessageService.sendText).not.toHaveBeenCalled();
            });

            // #1438 — primária ausente do uiConfig: mesma recusa (admin precisa configurar).
            it('com whatsappPrimarySessionId ausente (mock retorna {}): lança WhatsAppPrimaryUnavailableError (sem fallback)', async () => {
                mockUiConfig.get.mockImplementationOnce(() => ({}) as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await expect(router.sendWhatsApp('5511@c.us', 'Oi'))
                    .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                expect(legacyMessageService.sendText).not.toHaveBeenCalled();
            });

            // #1438 — whitespace-only é tratado como vazio após trim (e recusa, sem fallback).
            it('com whatsappPrimarySessionId só de whitespace: trim → vazio → lança (sem fallback)', async () => {
                mockUiConfig.get.mockImplementationOnce(() => ({ whatsappPrimarySessionId: '   ' }) as any);
                const router = new ChannelRouter();
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);
                await expect(router.sendWhatsApp('5511@c.us', 'Oi'))
                    .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                expect(legacyMessageService.sendText).not.toHaveBeenCalled();
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

        it('faz fallback para a sessão WORKING quando a primária não está pronta e a política é "first-working"', async () => {
            // #1438 — adaptado: o fallback deixou de ser incondicional; agora exige
            // `whatsappFallbackPolicy: 'first-working'` no uiConfig. Asserção equivalente
            // (cai em 'v4_1747'), apenas explicitando a política que o habilita.
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() });
            mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'first-working' } as any);
            mockSession.getStatus.mockReturnValue('STOPPED');                 // primária ('default') não está WORKING
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

        it('sem nenhuma sessão WORKING e policy ausente: lança WhatsAppPrimaryUnavailableError (não envia)', async () => {
            // #1438 — antes deste fix, o `resolveSession` devolvia silenciosamente 'default' quando
            // não havia sessão WORKING, e o erro "Session X not found" só aparecia DEPOIS do provider
            // tentar enviar. Agora (política default 'fail' = secure default) ele LANÇA um erro
            // distinto ANTES do envio — não desvia, não envia pelo número errado, e o caller sabe
            // que é erro de CONFIGURAÇÃO (não erro do provider).
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() });
            mockSession.getStatus.mockReturnValue('STOPPED');
            mockSession.getFirstWorkingSessionId.mockReturnValue(undefined);
            // uiConfig mock base devolve `{ whatsappPrimarySessionId: 'default' }` (sem
            // whatsappFallbackPolicy) → política default 'fail'.

            await expect(channelRouter.sendWhatsApp('5511@c.us', 'Oi'))
                .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
            // Crítico: sendText NÃO foi chamado (recusa antes do envio, não envio pelo número errado).
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });

        // #1438 — bloco de enforcement da política de fallback. Critérios de aceite:
        //  - primária OFFLINE + 'fail' (explícito) → erro explícito (não envia, não desvia)
        //  - primária OFFLINE + 'first-working' → cai na 1ª WORKING com log.warn
        //  - primária WORKING → usa primária, ignora policy
        //  - log continua registrando a sessão escolhida
        //  - erro lançado tem tipo distinto p/ o caller poder tratar
        describe('#1438 — política de fallback de resolveSession', () => {
            it('primária WORKING: usa a primária, ignora a política', async () => {
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockSession.getStatus.mockReturnValue('WORKING'); // 'default' WORKING
                // Política irrelevante — mesmo se for 'fail', WORKING não ramifica.
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'fail' } as any);

                await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
            });

            it('primária OFFLINE + policy "fail" (explícita): lança WhatsAppPrimaryUnavailableError, NÃO desvia', async () => {
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'fail' } as any);
                mockSession.getStatus.mockReturnValue('STOPPED');
                mockSession.getFirstWorkingSessionId.mockReturnValue('v4_1747'); // existe WORKING — mesmo assim não desvia

                const promise = channelRouter.sendWhatsApp('5511@c.us', 'Oi');
                await expect(promise).rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                await expect(promise).rejects.toMatchObject({
                    sessionId: 'default',
                    policy: 'fail',
                });
                // Mensagem cita a sessão E que NÃO desviamos (claro p/ log/diagnóstico).
                await expect(promise).rejects.toThrow(/Sessão primária 'default' indisponível/);
                await expect(promise).rejects.toThrow(/não desviamos para outro número/);
                // Crítico: sendText NÃO foi chamado (recusa antes do envio).
                expect(legacyMessageService.sendText).not.toHaveBeenCalled();
            });

            it('primária OFFLINE + policy ausente no uiConfig: trata como "fail" (default seguro)', async () => {
                // Política default 'fail' garante secure-default: arquivo corrompido, config nova,
                // migração — sempre recusa em vez de enviar silenciosamente pelo número errado.
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default' } as any); // sem whatsappFallbackPolicy → fail
                mockSession.getStatus.mockReturnValue('STOPPED');
                mockSession.getFirstWorkingSessionId.mockReturnValue('v4_1747');

                await expect(channelRouter.sendWhatsApp('5511@c.us', 'Oi'))
                    .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                expect(legacyMessageService.sendText).not.toHaveBeenCalled();
            });

            it('primária OFFLINE + policy "first-working" + WORKING disponível: cai na WORKING (warn, não throw)', async () => {
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'first-working' } as any);
                mockSession.getStatus.mockReturnValue('STOPPED');
                mockSession.getFirstWorkingSessionId.mockReturnValue('v4_1747');

                const result = await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
                expect(result.success).toBe(true);
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('v4_1747', '5511@c.us', 'Oi');
            });

            it('primária OFFLINE + policy "first-working" mas SEM WORKING: lança (não tem pra onde cair)', async () => {
                // Política fail-by-default: 'first-working' sem WORKING = mesma recusa explícita.
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'first-working' } as any);
                mockSession.getStatus.mockReturnValue('STOPPED');
                mockSession.getFirstWorkingSessionId.mockReturnValue(undefined);

                await expect(channelRouter.sendWhatsApp('5511@c.us', 'Oi'))
                    .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                expect(legacyMessageService.sendText).not.toHaveBeenCalled();
            });

            it('primária OFFLINE + policy "first-working" mas WORKING == primária: lança (nada pra onde cair)', async () => {
                // Defesa contra corrida: se a "primeira WORKING" for a própria primária (porque
                // alguém mudou o nome mas o status ficou stale), ainda é a mesma sessão fora.
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'first-working' } as any);
                mockSession.getStatus.mockReturnValue('STOPPED');
                mockSession.getFirstWorkingSessionId.mockReturnValue('default'); // == primária

                await expect(channelRouter.sendWhatsApp('5511@c.us', 'Oi'))
                    .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                expect(legacyMessageService.sendText).not.toHaveBeenCalled();
            });

            it('sessionId explícito: política é IGNORADA (caller é soberano, não passa pelo resolveSession)', async () => {
                // Quando o caller passa `sessionId` explícito (ex.: scheduler com override),
                // `resolveSession` retorna SEM consultar a política. Garante que a política
                // NUNCA bloqueia envios com sessionId explícito (importante p/ HITL/allowlist).
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'fail' } as any);
                mockSession.getStatus.mockReturnValue('STOPPED'); // mesmo que esteja fora, ignora

                await channelRouter.sendWhatsApp('5511@c.us', 'Oi', 'sessao-explicita');
                expect(legacyMessageService.sendText).toHaveBeenCalledWith('sessao-explicita', '5511@c.us', 'Oi');
            });

            it('WhatsAppPrimaryUnavailableError é Error e tem tipo distinto (instanceof funciona)', async () => {
                // Critério de aceite: tipo distinto p/ o caller poder tratar diferente de erros
                // do provider. `instanceof Error` cobre a base (ex.: axios intercepta tudo);
                // `instanceof WhatsAppPrimaryUnavailableError` é o discriminador fino.
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockSession.getStatus.mockReturnValue('STOPPED');
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'fail' } as any);

                let captured: unknown;
                try {
                    await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
                } catch (e) {
                    captured = e;
                }
                expect(captured).toBeInstanceOf(Error);
                expect(captured).toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                // Não é erro genérico qualquer: discriminador está nas props, não na message string.
                expect((captured as WhatsAppPrimaryUnavailableError).sessionId).toBe('default');
                expect((captured as WhatsAppPrimaryUnavailableError).policy).toBe('fail');
                expect((captured as Error).name).toBe('WhatsAppPrimaryUnavailableError');
            });

            it('WhatsAppPrimaryUnavailableError cita o sessionId primário configurado (não o default legado)', async () => {
                // Sanity check do acceptance: a mensagem cita QUAL sessão primária falhou.
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockUiConfig.get.mockReturnValueOnce({
                    whatsappPrimarySessionId: 'institucional-x',
                    whatsappFallbackPolicy: 'fail',
                } as any);
                mockSession.getStatus.mockReturnValue('STOPPED');

                const promise = channelRouter.sendWhatsApp('5511@c.us', 'Oi');
                await expect(promise).rejects.toMatchObject({ sessionId: 'institucional-x' });
                await expect(promise).rejects.toThrow(/Sessão primária 'institucional-x' indisponível/);
            });

            it('live read: trocar a config persistida muda o desfecho no MESMO router, sem restart', async () => {
                // Análogo do critério de "reboot → valor persiste": como o router lê o uiConfig
                // a cada envio, a troca do admin via PUT /api/ui-config é refletida IMEDIATAMENTE
                // na mesma instância singleton — sem restart, sem cache obsoleto. Aqui
                // simulamos essa troca com `mockReturnValueOnce` em sequência.
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockSession.getStatus.mockReturnValue('WORKING');

                // 1ª config: primária 'sess-A', WORKING → usa ela.
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'sess-A' } as any);
                await channelRouter.sendWhatsApp('5511@c.us', 'a');
                expect(legacyMessageService.sendText).toHaveBeenLastCalledWith('sess-A', '5511@c.us', 'a');

                // 2ª config: admin troca para 'sess-B' via PUT — já reflete no próximo envio.
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'sess-B' } as any);
                await channelRouter.sendWhatsApp('5511@c.us', 'b');
                expect(legacyMessageService.sendText).toHaveBeenLastCalledWith('sess-B', '5511@c.us', 'b');
            });

            it('live read: trocar a política persistida muda o desfecho no MESMO router (de fail → first-working)', async () => {
                // Espelho do anterior, agora trocando só a POLÍTICA. Mostra que o admin pode
                // "abrir a válvula" sem restart: hoje recusa, amanhã cai na WORKING.
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockSession.getStatus.mockReturnValue('STOPPED');
                mockSession.getFirstWorkingSessionId.mockReturnValue('v4_1747');

                // Política 'fail' (default) → recusa.
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'fail' } as any);
                await expect(channelRouter.sendWhatsApp('5511@c.us', 'Oi'))
                    .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);

                // Admin troca para 'first-working' (mesma instância, sem restart) → cai na v4.
                mockUiConfig.get.mockReturnValueOnce({ whatsappPrimarySessionId: 'default', whatsappFallbackPolicy: 'first-working' } as any);
                await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
                expect(legacyMessageService.sendText).toHaveBeenLastCalledWith('v4_1747', '5511@c.us', 'Oi');
            });

            // #1438 — cobertura do caso "primária NÃO configurada" (vazia/whitespace). Antes
            // desta entrega caía em fallback legado 'default' (string mágica); agora LANÇA
            // explicitamente. Aqui cobrimos as duas políticas + log.warn no first-working.
            it('primária vazia + policy "fail" (explícita): lança com detail "não configurado" e NÃO desvia', async () => {
                (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                mockUiConfig.get.mockReturnValueOnce({ whatsappFallbackPolicy: 'fail' } as any); // whatsappPrimarySessionId AUSENTE
                mockSession.getFirstWorkingSessionId.mockReturnValue('v4_1747'); // existe WORKING — não desvia mesmo assim

                const promise = channelRouter.sendWhatsApp('5511@c.us', 'Oi');
                await expect(promise).rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                await expect(promise).rejects.toMatchObject({
                    sessionId: '',                                  // vazia (não configurada)
                    policy: 'fail',
                });
                // Detail explica o motivo (caller sabe que é config, não runtime).
                await expect(promise).rejects.toThrow(/whatsappPrimarySessionId não configurado/);
                await expect(promise).rejects.toThrow(/Sessão primária \(não configurada\)/);
                // Crítico: sendText NÃO foi chamado (recusa antes do envio).
                expect(legacyMessageService.sendText).not.toHaveBeenCalled();
            });

            // #1438 — primária NÃO configurada + 'first-working' → ainda cai na primeira
            // WORKING (a política é sobre o que fazer QUANDO a primária não está ok — e
            // "não configurada" é um caso particular de "não está ok"). Importante: log.warn
            // deixa rastro do desvio, mesmo sem nome de primária.
            it('primária vazia + policy "first-working" + WORKING disponível: cai na WORKING (warn, não throw)', async () => {
                const logWarn = vi.spyOn((channelRouter as any).log ?? console, 'warn').mockImplementation(() => {});
                try {
                    (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1', timestamp: Date.now() } as any);
                    mockUiConfig.get.mockReturnValueOnce({ whatsappFallbackPolicy: 'first-working' } as any); // primária AUSENTE
                    mockSession.getFirstWorkingSessionId.mockReturnValue('v4_1747');

                    const result = await channelRouter.sendWhatsApp('5511@c.us', 'Oi');
                    expect(result.success).toBe(true);
                    expect(legacyMessageService.sendText).toHaveBeenCalledWith('v4_1747', '5511@c.us', 'Oi');
                } finally {
                    logWarn.mockRestore();
                }
            });
        });
    });

    // #1438 — VALIDAÇÃO EXPLÍCITA DE BYPASS: o issue lista os 3 pontos institucionais de
    // envio com a instrução "validar que não há bypass". Aqui lemos o código-fonte de cada
    // arquivo e afirmamos que (a) chamam `channelRouter.sendWhatsApp` e (b) NÃO passam
    // sessionId explícito (o que faria `resolveSession` ser pulado, e a política ignorada).
    // Se algum desses pontos for refatorado pra chamar `legacyMessageService.sendText`
    // direto (bypass do router), este teste falha antes do código ir pra produção.
    describe('#1438 — bypass: os 3 pontos institucionais passam pelo resolveSession', () => {
        // Lê a fonte real de cada arquivo a partir do disco. Importante: NÃO importar os
        // módulos alvo (notificationService / agentActionConfirm / agentTools) porque eles
        // já estão mockados pelos vi.mock no topo do teste — `import` daria a versão
        // mockada e perderíamos a verificação estática do código real. O `fs` também está
        // mockado globalmente pelo setup.ts (devolve Buffer); carregamos o `fs` real via
        // `vi.importActual` em beforeAll (async) para uso síncrono nos testes.
        let realFs: typeof import('fs');
        beforeAll(async () => {
            realFs = await vi.importActual<typeof import('fs')>('fs');
        });
        const readSrc = (rel: string): string => {
            const p = path.join(__dirname, '..', '..', 'services', rel);
            return realFs.readFileSync(p, 'utf-8');
        };

        // Localiza a chamada `channelRouter.sendWhatsApp(` DENTRO do bloco/função relevante
        // (âncora estável), NÃO por número de linha — robusto a shift de linhas (ex.: quando
        // o TOOLS_PROMPT cresce). Conta os argumentos com balanceamento de parênteses/strings:
        // 2 = OK (chatId, content); 3+ = bypass de sessionId (a política do resolveSession seria
        // pulada). O detector negativo abaixo prova que 3 args ainda é pego.
        const CALL = 'channelRouter.sendWhatsApp(';
        function sendWhatsAppArgCount(code: string, anchor: RegExp): { found: boolean; argCount: number } {
            const m = code.match(anchor);
            if (!m || m.index === undefined) return { found: false, argCount: -1 };
            const callIdx = code.indexOf(CALL, m.index);
            if (callIdx === -1) return { found: false, argCount: -1 };
            let depth = 1, args = 1, sawAny = false;
            let str: string | null = null;
            for (let i = callIdx + CALL.length; i < code.length && depth > 0; i++) {
                const c = code[i];
                if (str) { if (c === str && code[i - 1] !== '\\') str = null; else sawAny = true; continue; }
                if (c === '"' || c === "'" || c === '`') { str = c; sawAny = true; continue; }
                if (c === '(' || c === '[' || c === '{') depth++;
                else if (c === ')' || c === ']' || c === '}') depth--;
                else if (c === ',' && depth === 1) args++;
                else if (!/\s/.test(c)) sawAny = true;
            }
            return { found: true, argCount: sawAny ? args : 0 };
        }

        const SOURCES = [
            { file: 'notificationService.ts', anchor: /private async deliverWhatsApp/, fn: 'deliverWhatsApp' },
            { file: 'agentActionConfirm.ts', anchor: /send_whatsapp:\s*\{/, fn: 'send_whatsapp.execute' },
            { file: 'agentTools.ts', anchor: /case 'send_whatsapp':/, fn: 'send_whatsapp' },
        ] as const;

        for (const src of SOURCES) {
            it(`${src.file} (${src.fn}) chama channelRouter.sendWhatsApp SEM sessionId explícito`, () => {
                const code = readSrc(src.file);
                const r = sendWhatsAppArgCount(code, src.anchor);
                expect(r.found).toBe(true);   // (a) achou a chamada dentro do bloco
                expect(r.argCount).toBe(2);   // (b) exatamente 2 args (chatId, content) — 3+ = bypass
            });
        }

        it('o detector PEGA um bypass de sessionId (3º arg) — teste negativo', () => {
            const bypass = `const send_whatsapp = {\n  execute() {\n    return channelRouter.sendWhatsApp(chatId, msg, 'sess-1');\n  }\n};`;
            expect(sendWhatsAppArgCount(bypass, /const send_whatsapp =/).argCount).toBe(3);
            const ok = `function deliverWhatsApp() { channelRouter.sendWhatsApp(chatId, content); }`;
            expect(sendWhatsAppArgCount(ok, /function deliverWhatsApp/).argCount).toBe(2);
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
