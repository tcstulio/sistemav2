/**
 * Teste de ENFORCEMENT (#1441) — garante que a config de uiConfig muda a sessão usada e que
 * a `whatsappFallbackPolicy` é respeitada. Cobre os 3 cenários críticos do issue #1441 + os
 * critérios de aceite (regressões: reintroduzir fallback silencioso OU hardcoded 'default').
 *
 * Isolamento: mocka `getWhatsAppSessions()` (fonte de verdade da `resolveSession`) e o
 * transportador real (`legacyMessageService.sendText`). O `resolveSession` é exercitado
 * indiretamente via `sendWhatsApp` — se a sessão roteada for a errada, o transportador
 * recebe o sessionId errado e a asserção quebra.
 *
 * @see backend/src/services/channelRouter.ts
 * @see backend/src/services/uiConfigService.ts (whatsappPrimarySessionId / whatsappFallbackPolicy)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/features', () => ({
    FEATURES: {
        WHATSAPP_PROVIDER: 'legacy' as const,
        MOLTBOT_ENABLED: false,
        DRY_RUN_MODE: false,
    },
    isUsingMoltbot: vi.fn(() => false),
}));

// #1441 — mock do `createLogger` para esta SUITE (sobrescreve o do setup.ts só para esta
// arquivo). Devolve um objeto ESTÁVEL por `createLogger` ser chamado uma vez no import do
// `channelRouter` — assim o spy em `mockLog.warn` consegue capturar os `log.warn` feitos
// pelo `resolveSession` ao desviar p/ 'first-working'.
const mockLog = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => mockLog),
}));
vi.mock('../utils/logger', () => ({
    createLogger: () => mockLog,
    logger: mockLog,
    default: mockLog,
}));

vi.mock('../services/moltbotGateway', () => ({
    moltbotGateway: {
        sendMessage: vi.fn(),
        sendFile: vi.fn(),
        sendVoice: vi.fn(),
        getWhatsAppStatus: vi.fn(),
    },
}));

// #1441 — o transportador real (legacy) é o ponto onde `resolveSession` desemboca. Mockando
// o `sendText` conseguimos afirmar COM QUAL sessionId o router de fato chamou o envio,
// que é exatamente o que o enforcement garante: "config muda a sessão usada".
vi.mock('../services/legacy/messageService', () => ({
    messageService: {
        sendText: vi.fn(),
        sendFile: vi.fn(),
        sendVoice: vi.fn(),
    },
}));

vi.mock('../services/emailService', () => ({
    emailService: {
        sendEmail: vi.fn(),
    },
}));

// #1441 — mock central de `getWhatsAppSessions()`. Default = lista vazia (nada WORKING). Cada
// teste sobrescreve explicitamente via `mockSession.getWhatsAppSessions.mockReturnValue(...)`
// para refletir o cenário (default WORKING, primary OFFLINE, etc.).
const mockSession = vi.hoisted(() => ({
    getStatus: vi.fn(() => 'STOPPED'),
    getFirstWorkingSessionId: vi.fn(() => undefined as string | undefined),
    getWhatsAppSessions: vi.fn(() => [] as Array<{ id: string; status: string }>),
}));
vi.mock('../services/legacy/sessionService', () => ({
    sessionService: mockSession,
    // O `channelRouter` importa a função top-level `getWhatsAppSessions` (não o método). Mock
    // dela aqui delega ao mesmo `vi.fn`, então o teste controla a lista por UM único ponto.
    getWhatsAppSessions: (...args: any[]) => (mockSession.getWhatsAppSessions as any)(...args),
    WhatsAppSessionStatus: undefined,
}));

// uiConfig mockado — o `channelRouter` lê `whatsappPrimarySessionId` e `whatsappFallbackPolicy`
// a CADA chamada de `resolveSession` (não cacheia em memória), portanto o default deste mock
// afeta o resultado de TODOS os testes que não sobrescrevem.
const mockUiConfig = vi.hoisted(() => ({
    update: vi.fn((partial: any) => ({ ...partial })),
    get: vi.fn(() => ({
        whatsappPrimarySessionId: '',
        whatsappFallbackPolicy: 'fail' as 'fail' | 'first-working',
    })),
}));
vi.mock('../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));

import { channelRouter, ChannelRouter, WhatsAppPrimaryUnavailableError } from '../services/channelRouter';
import { messageService as legacyMessageService } from '../services/legacy/messageService';

describe('ChannelRouter — enforcement de config (issue #1441)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // #1441 — defaults explícitos a cada teste (vi.clearAllMocks zera calls mas não implementações).
        mockSession.getWhatsAppSessions.mockReset();
        mockSession.getWhatsAppSessions.mockImplementation(() => []);
        mockUiConfig.get.mockReset();
        mockUiConfig.get.mockImplementation(() => ({
            whatsappPrimarySessionId: '',
            whatsappFallbackPolicy: 'fail' as 'fail' | 'first-working',
        }));
        channelRouter.setWhatsAppProvider('legacy');
        channelRouter.setDefaultSessionId('default');
    });

    // ============================================================
    // CENÁRIO 1 — policy 'fail' (default seguro)
    // ============================================================
    describe('Cenário 1 — policy \'fail\' (default seguro)', () => {
        it('lança WhatsAppPrimaryUnavailableError quando a primária está OFFLINE e NÃO envia de \'default\'', async () => {
            // Config: primary='v4_1747', policy='fail'. v4_1747 OFFLINE, 'default' WORKING.
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'fail',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'WORKING' },
                { id: 'v4_1747', status: 'STOPPED' },     // primária forçada OFFLINE
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg' } as any);

            // Chamar roteamento de cobrança/notification (o que #1441 chama é "sendWhatsApp",
            // que é exatamente o que notificationService.ts:224 / agentActionConfirm.ts:102
            // / agentTools.ts:1686 chamam).
            await expect(
                channelRouter.sendWhatsApp('5511999999999@c.us', 'Cobrança fatura #123')
            ).rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);

            // A mensagem do erro DEVE mencionar tanto a primária quanto a policy — para que o
            // operador saiba O QUE configurar (não um "Session not found" genérico).
            await expect(
                channelRouter.sendWhatsApp('5511999999999@c.us', 'Cobrança fatura #456')
            ).rejects.toThrow(/v4_1747/);

            await expect(
                channelRouter.sendWhatsApp('5511999999999@c.us', 'Cobrança fatura #789')
            ).rejects.toThrow(/fail/);

            // CRÍTICO: o transportador NÃO pode ter sido chamado com 'default' (o que seria
            // o "fallback silencioso" que o issue quer banir). Se alguém reintroduzir o
            // `return 'default'` hardcoded no resolveSession, este assert quebra.
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });

        it('inclui o status real da primária (STOPPED/ausente) na mensagem do erro', async () => {
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'fail',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'WORKING' },
                { id: 'v4_1747', status: 'STOPPED' },
            ]);

            try {
                await channelRouter.sendWhatsApp('5511@c.us', 'oi');
                expect.fail('esperava WhatsAppPrimaryUnavailableError');
            } catch (err: any) {
                expect(err).toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                // Para o operador entender: "primária X está Y, política Z = fail, não desvio".
                expect(err.message).toContain('v4_1747');
                expect(err.message).toContain('STOPPED');
                expect(err.message).toContain('fail');
                // Campos estruturados para o caller tratar programaticamente.
                expect(err.primarySessionId).toBe('v4_1747');
                expect(err.policy).toBe('fail');
                expect(err.primaryStatus).toBe('STOPPED');
            }
        });

        it('lança mesmo quando a primária é totalmente AUSENTE do sessionService (não está nem STOPPED)', async () => {
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'fail',
            }));
            // Só 'default' existe — v4_1747 nem aparece na lista.
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'WORKING' },
            ]);

            await expect(
                channelRouter.sendWhatsApp('5511@c.us', 'oi')
            ).rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);

            // Mensagem indica "ausente" (não "STOPPED") quando a sessão nem existe.
            try {
                await channelRouter.sendWhatsApp('5511@c.us', 'oi');
            } catch (err: any) {
                expect(err.primaryStatus).toBe('ausente');
            }
        });

        // ============================================================
        // GUARD: regressão — fallback silencioso p/ qualquer policy
        // ============================================================
        it('GUARD: NUNCA desvia silenciosamente para outra sessão sob policy \'fail\'', async () => {
            // Mesmo cenário do cenário 1, mas com mais sessões WORKING candidatas a fallback.
            // Se alguém reverter o resolveSession para "tenta primary, depois qualquer WORKING,
            // ignora policy", este assert pega.
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'fail',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'WORKING' },
                { id: 'v4_9999', status: 'WORKING' },     // isca: também WORKING
                { id: 'v4_1747', status: 'STOPPED' },
            ]);

            await expect(
                channelRouter.sendWhatsApp('5511@c.us', 'oi')
            ).rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);

            // Confirma que nenhum envio aconteceu, pra nenhuma das WORKING.
            expect(legacyMessageService.sendText).not.toHaveBeenCalledWith('default', expect.anything(), expect.anything());
            expect(legacyMessageService.sendText).not.toHaveBeenCalledWith('v4_9999', expect.anything(), expect.anything());
        });
    });

    // ============================================================
    // CENÁRIO 2 — policy 'first-working'
    // ============================================================
    describe('Cenário 2 — policy \'first-working\'', () => {
        it('roteia para \'default\' (primeira WORKING) com log.warn registrado', async () => {
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'first-working',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'WORKING' },
                { id: 'v4_1747', status: 'STOPPED' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            // Espiar o logger — o log.warn é a ÚNICA evidência observável de que o roteamento
            // caiu no fallback (além do sessionId errado no sendText). Se alguém remover o
            // log, o teste fica cego sobre a violação da policy.
            mockLog.warn.mockClear();

            const result = await channelRouter.sendWhatsApp('5511999999999@c.us', 'Cobrança fatura #001');

            // O envio aconteceu — mas PARA 'default', não para a primária (que está OFFLINE).
            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledTimes(1);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511999999999@c.us', 'Cobrança fatura #001');

            // O log.warn DEVE registrar o desvio (a primária configurada E a sessão usada).
            // Sem o warn, o operador não sabe que um envio institucional saiu de outro número.
            expect(mockLog.warn).toHaveBeenCalled();
            const warnArgs = mockLog.warn.mock.calls.flat().map(String).join(' ');
            expect(warnArgs).toContain('v4_1747');
            expect(warnArgs).toContain('default');
            expect(warnArgs).toMatch(/first-working/i);
        });

        it('NÃO chama o transportador se a primária OFFLINE for a ÚNICA sessão existente (sem fallback possível)', async () => {
            // Cenário degenerado: policy='first-working' mas SÓ existe a primária, e ela está
            // OFFLINE. Sem outra WORKING, o resolveSession DEVE lançar (não devolver a primária
            // em silêncio nem cair em fallback mágico). O caller é quem decide reagendar.
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'first-working',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'v4_1747', status: 'STOPPED' },
            ]);

            await expect(
                channelRouter.sendWhatsApp('5511@c.us', 'oi')
            ).rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });
    });

    // ============================================================
    // CENÁRIO 3 — sem config (legado)
    // ============================================================
    describe('Cenário 3 — sem config (legado)', () => {
        it('usa \'default\' quando whatsappPrimarySessionId é null/empty (retrocompat)', async () => {
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: '',
                whatsappFallbackPolicy: 'fail',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'Cobrança');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Cobrança');
        });

        it('cai na primeira WORKING (legado) quando whatsappPrimarySessionId é null e \'default\' OFFLINE', async () => {
            // Comportamento herdado de antes do #1438: sem primária, se 'default' está fora,
            // usa a primeira WORKING. Preservado para retrocompat com clientes que não setaram
            // whatsappPrimarySessionId mas já tinham outra sessão WORKING (caso 'v4').
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: '',
                whatsappFallbackPolicy: 'fail',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'STOPPED' },
                { id: 'v4_1747', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'oi');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('v4_1747', '5511@c.us', 'oi');
        });
    });

    // ============================================================
    // GUARD: regressão — 'default' hardcoded na hot path
    // ============================================================
    describe('GUARD: literal \'default\' NUNCA pode voltar hardcoded na hot path do resolveSession', () => {
        it('com primária WORKING diferente de \'default\', usa a primária (NÃO \'default\')', async () => {
            // Este é o teste que pega a regressão: se alguém tirar o `resolveSession` da
            // config-based e voltar para `return this.defaultSessionId ?? 'default'`, este
            // assert quebra — o sendText seria chamado com 'default' em vez de 'primary-x'.
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: 'primary-x',
                whatsappFallbackPolicy: 'fail',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'WORKING' },     // isca: também WORKING
                { id: 'primary-x', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'oi');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('primary-x', '5511@c.us', 'oi');
            expect(legacyMessageService.sendText).not.toHaveBeenCalledWith('default', expect.anything(), expect.anything());
        });

        it('com primária OFFLINE + policy \'first-working\', usa a OUTRA WORKING (não a primária, não hardcoded \'default\')', async () => {
            // Pega uma regressão diferente: se alguém fixar o fallback em 'default' (em vez de
            // "primeira WORKING diferente da primária"), este assert quebra quando há uma
            // terceira sessão WORKING — a terceira seria ignorada.
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'first-working',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'STOPPED' },     // default OFFLINE — não pode ser a "primeira WORKING"
                { id: 'v4_1747', status: 'STOPPED' },     // primária OFFLINE
                { id: 'v4_9999', status: 'WORKING' },     // esta é a candidata correta
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await channelRouter.sendWhatsApp('5511@c.us', 'oi');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('v4_9999', '5511@c.us', 'oi');
        });
    });

    // ============================================================
    // GUARD: isolamento — o transportador é o ponto de verificação, resolveSession é privado
    // ============================================================
    describe('isolamento do resolveSession', () => {
        it('cada chamada de sendWhatsApp faz uma leitura FRESCA do uiConfig (não cacheia)', async () => {
            // Importante p/ hot-reload de config sem restart: o operador troca a policy no admin
            // e o PRÓXIMO envio já usa a nova policy. Se cachear, este teste pega.
            const sequence: Array<{ whatsappPrimarySessionId: string; whatsappFallbackPolicy: 'fail' | 'first-working' }> = [
                { whatsappPrimarySessionId: 'v4_1747', whatsappFallbackPolicy: 'fail' },
                { whatsappPrimarySessionId: 'v4_1747', whatsappFallbackPolicy: 'first-working' },
            ];
            let call = 0;
            mockUiConfig.get.mockImplementation(() => sequence[call] ?? sequence[sequence.length - 1]);
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'WORKING' },
                { id: 'v4_1747', status: 'STOPPED' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg' } as any);

            // 1ª chamada — fail: deve lançar
            await expect(channelRouter.sendWhatsApp('5511@c.us', '1ª')).rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
            call++;

            // 2ª chamada — first-working: mesma config de sessão, MESMO channelRouter, mas
            // policy mudou em runtime. Deve enviar para 'default' com log.warn.
            const result = await channelRouter.sendWhatsApp('5511@c.us', '2ª');
            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenLastCalledWith('default', '5511@c.us', '2ª');
        });

        it('sessionId explícito sempre é respeitado (mesmo com política = fail e primária OFFLINE)', async () => {
            // Pega regressão: alguém pode tentar "endurecer" o router e quebrar o override explícito.
            // O sessionId explícito é um contrato: caller sabe o que está fazendo.
            mockUiConfig.get.mockImplementation(() => ({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'fail',
            }));
            mockSession.getWhatsAppSessions.mockImplementation(() => [
                { id: 'default', status: 'WORKING' },
                { id: 'v4_1747', status: 'STOPPED' },
                { id: 'sessao-explicita', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg' } as any);

            // O caller sabe que 'sessao-explicita' é o que ele quer, e está WORKING. Policy é
            // ignorada para sessionIds explícitos.
            const result = await channelRouter.sendWhatsApp('5511@c.us', 'oi', 'sessao-explicita');
            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('sessao-explicita', '5511@c.us', 'oi');
        });
    });
});
