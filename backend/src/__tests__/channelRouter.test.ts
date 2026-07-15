/**
 * #1441 — Testes de ENFORCEMENT do roteamento de sessão WhatsApp.
 *
 * Cobre os 3 cenários críticos descritos na issue (#1441) — config muda a sessão usada e a
 * `whatsappFallbackPolicy` é respeitada — mais GUARD tests que falham se alguém reintroduzir:
 *   - fallback silencioso para qualquer policy quando a primária está OFFLINE
 *   - literal `'default'` hardcoded na hot path de `resolveSession`
 *
 * Isolamento: `getWhatsAppSessions()` e o transportador real (`messageService.sendText`) são
 * mockados por teste, e cada teste usa uma instância fresca de `ChannelRouter` (new ChannelRouter())
 * para que o estado de `defaultSessionId` (hidratação do boot) não vaze entre testes.
 *
 * @see backend/src/services/channelRouter.ts (resolveSession + WhatsAppPrimaryUnavailableError)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// #1441 — G4 lê o source de channelRouter.ts para inspecionar a hot path. O `fs` global está
// mockado em setup.ts (devolve 'test'); usamos child_process.execSync que bypassa os mocks
// de módulo do vitest.
import { execSync } from 'child_process';
import * as path from 'path';

vi.mock('../config/features', () => ({
    FEATURES: {
        WHATSAPP_PROVIDER: 'legacy' as const,
        MOLTBOT_ENABLED: false,
        DRY_RUN_MODE: false,
    },
    isUsingMoltbot: vi.fn(() => false),
}));

vi.mock('../services/moltbotGateway', () => ({
    moltbotGateway: {
        sendMessage: vi.fn(),
        sendFile: vi.fn(),
        sendVoice: vi.fn(),
        getWhatsAppStatus: vi.fn(),
    },
}));

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

// #1441 — resolveSession consulta `getWhatsAppSessions()` como FONTE ÚNICA DA VERDADE
// quando há whatsappPrimarySessionId configurada. `getStatus` e `getFirstWorkingSessionId`
// ficam no mock só p/ preservar o caminho LEGADO (sem primary) — o routing sob policy
// configurada NÃO os consulta.
const mockSession = vi.hoisted(() => ({
    getStatus: vi.fn(() => 'STOPPED'),
    getFirstWorkingSessionId: vi.fn(() => undefined as string | undefined),
    getWhatsAppSessions: vi.fn(() => [] as Array<{ id: string; status: string }>),
}));
vi.mock('../services/legacy/sessionService', () => ({ sessionService: mockSession }));

// uiConfig é lido a CADA chamada de resolveSession (hot-reload). `get` é mockado em beforeEach
// para evitar carregar config real do disco e para que cada teste controle exatamente o que
// resolveSession enxerga.
const mockUiConfig = vi.hoisted(() => ({
    update: vi.fn((partial: any) => ({ whatsappProvider: partial?.whatsappProvider })),
    get: vi.fn(() => ({} as any)),
}));
vi.mock('../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));

import {
    ChannelRouter,
    WhatsAppPrimaryUnavailableError,
} from '../services/channelRouter';
import { messageService as legacyMessageService } from '../services/legacy/messageService';
import { FEATURES } from '../config/features';

describe('ChannelRouter — #1441 policy enforcement', () => {
    let router: ChannelRouter;

    beforeEach(() => {
        vi.clearAllMocks();
        // Defaults seguros: uiConfig vazio (= sem primária) + nenhuma sessão WORKING.
        // Cada teste sobrescreve o que precisar (mockReturnValue / mockImplementationOnce).
        mockUiConfig.get.mockReturnValue({});
        mockSession.getWhatsAppSessions.mockReturnValue([]);
        mockSession.getStatus.mockReturnValue('STOPPED');
        mockSession.getFirstWorkingSessionId.mockReturnValue(undefined);
        (FEATURES as any).DRY_RUN_MODE = false;
        (FEATURES as any).MOLTBOT_ENABLED = false;
        router = new ChannelRouter();
    });

    // ========================================================================
    // OS 3 CENÁRIOS CRÍTICOS DA ISSUE
    // ========================================================================

    describe('Cenário 1 — policy \'fail\' (default seguro)', () => {
        it('primary OFFLINE + policy=fail + \'default\' WORKING: THROW + NÃO envia de \'default\'', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'fail',
            } as any);
            // Cenário típico: admin migrou a primária para 'v4_1747' (ainda não está WORKING),
            // mas a sessão legacy 'default' está WORKING — sem fallback silencioso permitido.
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'v4_1747', status: 'STOPPED' },     // primária OFFLINE
                { id: 'default', status: 'WORKING' },    // default está WORKING (mas NÃO pode ser usada)
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            await expect(router.sendWhatsApp('5511@c.us', 'Oi'))
                .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);

            // Mensagem menciona a primária E a policy (diagnóstico sem precisar de instanceof).
            try {
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect.fail('esperava throw');
            } catch (err: any) {
                expect(err).toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                expect(err.primary).toBe('v4_1747');
                expect(err.policy).toBe('fail');
                expect(err.status).toBe('STOPPED');
                expect(err.message).toMatch(/v4_1747/);
                expect(err.message).toMatch(/fail/);
            }

            // NUNCA chama o transportador com 'default' (silencioso). Confirma que nem
            // houve 1ª tentativa antes do throw.
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });

        it('primary OFFLINE + status "INITIALIZING" (não só STOPPED) também dispara o fail', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'fail',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'v4_1747', status: 'INITIALIZING' },
                { id: 'default', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            await expect(router.sendWhatsApp('5511@c.us', 'Oi'))
                .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });

        it('primary configurada mas AUSENTE de getWhatsAppSessions (STOPPED implícito): também THROW', async () => {
            // Caso real: a sessão primária nunca foi iniciada / foi removida do disco.
            // `getWhatsAppSessions` não devolve ela, e mesmo assim a policy=fail proíbe fallback.
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'sessao-fantasma',
                whatsappFallbackPolicy: 'fail',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'default', status: 'WORKING' },
                // 'sessao-fantasma' NÃO está na lista (= STOPPED implícito em resolveSession)
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            await expect(router.sendWhatsApp('5511@c.us', 'Oi'))
                .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });
    });

    describe('Cenário 2 — policy \'first-working\'', () => {
        it('primary OFFLINE + policy=first-working + \'default\' WORKING: roteia para \'default\'', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'first-working',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'v4_1747', status: 'STOPPED' },
                { id: 'default', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await router.sendWhatsApp('5511@c.us', 'Oi');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
        });

        it('primary OFFLINE + policy=first-working + NENHUMA WORKING: THROW (não inventa sessão)', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'first-working',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'v4_1747', status: 'STOPPED' },
                { id: 'default', status: 'STOPPED' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            await expect(router.sendWhatsApp('5511@c.us', 'Oi'))
                .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });

        it('primary WORKING + policy=first-working: USA a primária (nunca cai na primeira working)', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'v4_1747',
                whatsappFallbackPolicy: 'first-working',
            } as any);
            // Primária está WORKING — `first-working` NUNCA deve disparar o caminho de fallback
            // enquanto ela estiver saudável.
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'v4_1747', status: 'WORKING' },
                { id: 'default', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await router.sendWhatsApp('5511@c.us', 'Oi');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('v4_1747', '5511@c.us', 'Oi');
            expect(legacyMessageService.sendText).not.toHaveBeenCalledWith('default', expect.anything(), expect.anything());
        });
    });

    describe('Cenário 3 — sem config (legado)', () => {
        it('whatsappPrimarySessionId=null + policy=fail + \'default\' WORKING: usa \'default\' (compat)', async () => {
            // Cenário de "instalação que nunca tocou em /ui-config" — o caminho legado precisa
            // continuar funcionando exatamente como antes.
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: null as any,
                whatsappFallbackPolicy: 'fail',
            } as any);
            // No caminho LEGADO resolveSession consulta getStatus/defaultSessionId; aqui forçamos
            // o caminho LEGADO via primary vazio + status WORKING.
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'default', status: 'WORKING' },
            ]);
            mockSession.getStatus.mockReturnValue('WORKING');
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await router.sendWhatsApp('5511@c.us', 'Oi');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
        });

        it('whatsappPrimarySessionId ausente (campo inexistente) + policy=fail: usa \'default\'', async () => {
            // Mesmo comportamento de null — ausência do campo = string vazia = caminho legado.
            mockUiConfig.get.mockReturnValue({
                whatsappFallbackPolicy: 'fail',
            } as any);
            mockSession.getStatus.mockReturnValue('WORKING');
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await router.sendWhatsApp('5511@c.us', 'Oi');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
        });

        it('whatsappPrimarySessionId só whitespace + policy=fail: usa \'default\' (trim → vazio)', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: '   \t\n',
                whatsappFallbackPolicy: 'fail',
            } as any);
            mockSession.getStatus.mockReturnValue('WORKING');
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await router.sendWhatsApp('5511@c.us', 'Oi');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('default', '5511@c.us', 'Oi');
        });
    });

    // ========================================================================
    // GUARD TESTS — regressões
    // ========================================================================

    describe('GUARD — NUNCA reintroduzir fallback silencioso para qualquer policy', () => {
        // G1: policy='fail' + primary OFFLINE + múltiplas WORKING disponíveis → THROW.
        // Se alguém reintroduzir `if (!isWorking) return 'default'`, este teste pega.
        it('G1: policy=fail + primary em qualquer status ≠ WORKING + várias WORKING → THROW', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'primary-x',
                whatsappFallbackPolicy: 'fail',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'primary-x', status: 'INITIALIZING' },
                { id: 'default', status: 'WORKING' },
                { id: 'v4_1747', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            await expect(router.sendWhatsApp('5511@c.us', 'Oi'))
                .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });

        // G2: sessionId explícito NUNCA passa pelo policy. Mesmo com policy='fail' e primary
        // WORKING, o sessionId explícito vence — isso é invariante (#1437/#1441).
        it('G2: sessionId explícito sempre vence, mesmo com policy=fail + primária WORKING', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'primary-x',
                whatsappFallbackPolicy: 'fail',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'primary-x', status: 'WORKING' },
                { id: 'default', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await router.sendWhatsApp('5511@c.us', 'Oi', 'sessao-explicita');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('sessao-explicita', '5511@c.us', 'Oi');
        });

        // G3: Garante que a policy DEFAULT é 'fail' quando não especificada (= secure default).
        it('G3: policy omitida → default \'fail\' (seguro), não silenciosamente \'first-working\'', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'primary-x',
                // whatsappFallbackPolicy omitido de propósito
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'primary-x', status: 'STOPPED' },
                { id: 'default', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            await expect(router.sendWhatsApp('5511@c.us', 'Oi'))
                .rejects.toBeInstanceOf(WhatsAppPrimaryUnavailableError);
            expect(legacyMessageService.sendText).not.toHaveBeenCalled();
        });
    });

    describe('GUARD — NUNCA hardcodar \'default\' no hot path de resolveSession', () => {
        // G4: Inspeção ESTÁTICA do source. Lê `channelRouter.ts`, isola o corpo de
        // `resolveSession` + `resolveLegacyDefault`, e falha se encontrar a string literal
        // `'default'` (em qualquer posição que não seja comentário). Pega o caso de alguém
        // reintroduzir `return 'default'` ou `if (x) return 'default'` na hot path.
        it('G4: source de channelRouter.ts não contém literal \'default\' em resolveSession/resolveLegacyDefault', () => {
            // Bypassa os mocks de `fs` (vitest/setup.ts) lendo o source via shell. Garante
            // que o teste verifica o source REAL em disco, não o mock devolvido por fs mock.
            const srcPath = path.join(__dirname, '..', 'services', 'channelRouter.ts');
            const src = execSync(`type "${srcPath}"`, { encoding: 'utf-8', shell: 'cmd.exe' });

            // Encontra os métodos `private resolveSession` e `private resolveLegacyDefault`.
            const extractMethodBody = (name: string): string => {
                // Localiza `name(...): string {` e captura até o próximo `}` de fechamento
                // no mesmo nível. Aceita espaços/saltos entre a chave.
                const startRe = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*:\\s*string\\s*\\{`);
                const m = src.match(startRe);
                if (!m || m.index === undefined) {
                    throw new Error(`método ${name} não encontrado em channelRouter.ts (size=${src.length})`);
                }
                let i = src.indexOf('{', m.index);
                let depth = 0;
                const start = i;
                for (; i < src.length; i++) {
                    const ch = src[i];
                    if (ch === '{') depth++;
                    else if (ch === '}') {
                        depth--;
                        if (depth === 0) {
                            return src.substring(start, i + 1);
                        }
                    }
                }
                throw new Error(`chave de fechamento de ${name} não encontrada`);
            };

            const hotPath = [
                extractMethodBody('resolveSession'),
                extractMethodBody('resolveLegacyDefault'),
            ].join('\n');

            // Strip comentários de linha para não dar falso positivo.
            const codeOnly = hotPath
                .split('\n')
                .map((line) => line.replace(/\/\/.*$/, ''))
                .join('\n');

            // 'default' como literal de string (não-comentário) no hot path = regressão.
            // Se alguém reintroduzir `return 'default'` na hot path, este teste falha.
            const matches = codeOnly.match(/['"`]default['"`]/g);
            expect(matches, `hot path contém literal 'default' — regressão de #1441:\n${hotPath}`).toBeNull();
        });
    });

    // ========================================================================
    // Cobertura adicional de resolveSession
    // ========================================================================

    describe('resolveSession — cobertura adicional', () => {
        it('primary WORKING + policy=first-working: usa primária sem warning', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'primary-x',
                whatsappFallbackPolicy: 'first-working',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'primary-x', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await router.sendWhatsApp('5511@c.us', 'Oi');
            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('primary-x', '5511@c.us', 'Oi');
        });

        it('primary configurada + bordas whitespace → trim é aplicado antes da lookup', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: '  primary-x  ',
                whatsappFallbackPolicy: 'fail',
            } as any);
            // 'primary-x' (já trimado) está WORKING; se a lookup não fizer trim,
            // ela não acha e dispara THROW.
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'primary-x', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await router.sendWhatsApp('5511@c.us', 'Oi');
            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('primary-x', '5511@c.us', 'Oi');
        });

        it('hot-reload: mudança de uiConfig ENTRE chamadas é refletida sem reinicializar router', async () => {
            // 1ª chamada: uiConfig vazio → caminho legado → 'default'
            mockUiConfig.get.mockReturnValueOnce({} as any);
            mockSession.getStatus.mockReturnValueOnce('WORKING');
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const r1 = await router.sendWhatsApp('5511@c.us', 'Oi 1');
            expect(r1.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenLastCalledWith('default', '5511@c.us', 'Oi 1');

            // 2ª chamada: admin trocou a primária em runtime via PUT /api/ui-config
            // → próxima chamada já enxerga o novo valor (sem reinicializar).
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'nova-primaria',
                whatsappFallbackPolicy: 'fail',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'nova-primaria', status: 'WORKING' },
            ]);

            const r2 = await router.sendWhatsApp('5511@c.us', 'Oi 2');
            expect(r2.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenLastCalledWith('nova-primaria', '5511@c.us', 'Oi 2');
            expect(legacyMessageService.sendText).toHaveBeenCalledTimes(2);
        });

        it('policy=first-working: pega a PRIMEIRA sessão WORKING encontrada (ordem da lista)', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'primary-x',
                whatsappFallbackPolicy: 'first-working',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'primary-x', status: 'STOPPED' },
                { id: 'a', status: 'WORKING' },
                { id: 'b', status: 'WORKING' },
                { id: 'c', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            await router.sendWhatsApp('5511@c.us', 'Oi');

            // Primeira WORKING na ordem é 'a' (não 'default', não 'b' nem 'c').
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('a', '5511@c.us', 'Oi');
        });

        it('WhatsAppPrimaryUnavailableError carrega primary/policy/status como campos tipados', async () => {
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'minha-primaria',
                whatsappFallbackPolicy: 'fail',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'minha-primaria', status: 'SCAN_QR_CODE' },
                { id: 'default', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            try {
                await router.sendWhatsApp('5511@c.us', 'Oi');
                expect.fail('esperava throw');
            } catch (err: any) {
                expect(err).toBeInstanceOf(WhatsAppPrimaryUnavailableError);
                expect(err.name).toBe('WhatsAppPrimaryUnavailableError');
                expect(err.primary).toBe('minha-primaria');
                expect(err.policy).toBe('fail');
                expect(err.status).toBe('SCAN_QR_CODE');
            }
        });

        it('sessionId EXPLÍCITO + policy=fail + primary OFFLINE: usa o sessionId explícito (NÃO consulta policy)', async () => {
            // sessionId explícito tem prioridade ABSOLUTA sobre o roteamento configurado.
            // Mesmo com primary OFFLINE, o caller sabe o que está fazendo.
            mockUiConfig.get.mockReturnValue({
                whatsappPrimarySessionId: 'primary-x',
                whatsappFallbackPolicy: 'fail',
            } as any);
            mockSession.getWhatsAppSessions.mockReturnValue([
                { id: 'primary-x', status: 'STOPPED' },
                { id: 'default', status: 'WORKING' },
            ]);
            (legacyMessageService.sendText as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await router.sendWhatsApp('5511@c.us', 'Oi', 'sessao-do-caller');

            expect(result.success).toBe(true);
            expect(legacyMessageService.sendText).toHaveBeenCalledWith('sessao-do-caller', '5511@c.us', 'Oi');
        });
    });
});