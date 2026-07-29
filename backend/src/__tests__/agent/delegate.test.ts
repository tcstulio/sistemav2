import { describe, it, expect, beforeEach, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => loggerMock,
}));

import { delegateTool } from '../../agent/tools/delegate';
import { getSubAgentManager, resetSubAgentManager } from '../../agent/subAgentManager';
import {
    MAX_CONCURRENT_SUBAGENTS,
    CONCURRENT_SUBAGENTS_EXCEEDED_MSG,
    DELEGATION_DEPTH_EXCEEDED_MSG,
} from '../../agent/config';

describe('#1037 delegate tool — guard rails de concorrência/depth', () => {
    beforeEach(() => {
        resetSubAgentManager();
        loggerMock.warn.mockClear();
    });

    it('devolve o resumo do sub-agente em caso de sucesso', async () => {
        const out = await delegateTool({
            sessionId: 's',
            task: 'resumir X',
            run: async () => 'resumo de X',
        });
        expect(out).toBe('resumo de X');
    });

    it('devolve o resumo já truncado quando o sub-agente excede 500 chars', async () => {
        const long = 'r'.repeat(800);
        const out = await delegateTool({
            sessionId: 's',
            task: 't',
            run: async () => long,
        });
        expect(out.length).toBeLessThanOrEqual(500);
        expect(out.startsWith('r')).toBe(true);
    });

    it('mapeia erro de profundidade para a mensagem explícita', async () => {
        const out = await delegateTool({
            sessionId: 's',
            task: 't',
            parentDepth: 2,
            run: async () => 'nunca rodado',
        });
        expect(out).toBe(DELEGATION_DEPTH_EXCEEDED_MSG);
    });

    describe('concorrência — 3 delegações paralelas e a 4ª falha (critério de aceite)', () => {
        it('rejeita o 4º sub-agente simultâneo com mensagem amigável', async () => {
            const sessionId = 'conc';

            // Sub-agente que BLOCKING até o hold resolver — mantém os 3 slots ativos.
            let resolveHold!: () => void;
            const hold = new Promise<void>((r) => { resolveHold = r; });
            const blockingRun = async (): Promise<string> => {
                await hold;
                return 'done';
            };

            // Lança 3 delegações em paralelo (cada uma adquire um slot).
            const inFlight = [
                delegateTool({ sessionId, task: 't0', subAgentId: 'sa0', run: blockingRun }),
                delegateTool({ sessionId, task: 't1', subAgentId: 'sa1', run: blockingRun }),
                delegateTool({ sessionId, task: 't2', subAgentId: 'sa2', run: blockingRun }),
            ];

            // Cede o controle para que cada delegateTool adquira seu slot antes do teste.
            await Promise.resolve();
            await Promise.resolve();

            expect(getSubAgentManager().activeCount(sessionId)).toBe(MAX_CONCURRENT_SUBAGENTS);

            // 4ª delegação simultânea → rejeitada com a mensagem explícita.
            const fourth = await delegateTool({
                sessionId,
                task: 't3',
                subAgentId: 'sa3',
                run: async () => 'nunca',
            });
            expect(fourth).toBe(CONCURRENT_SUBAGENTS_EXCEEDED_MSG);

            // Libera os 3 em andamento e confirma que todos concluem com sucesso.
            resolveHold();
            const results = await Promise.all(inFlight);
            expect(results).toEqual(['done', 'done', 'done']);
            expect(getSubAgentManager().activeCount(sessionId)).toBe(0);
        });

        it('permite nova delegação após uma anterior ser liberada', async () => {
            const sessionId = 'conc2';
            const first = await delegateTool({
                sessionId,
                task: 't',
                subAgentId: 'sa0',
                run: async () => 'ok',
            });
            expect(first).toBe('ok');
            // Slot liberado; novas delegações devem passar normalmente.
            const second = await delegateTool({
                sessionId,
                task: 't',
                subAgentId: 'sa1',
                run: async () => 'ok2',
            });
            expect(second).toBe('ok2');
        });
    });

    it('pré-checa a concorrência mesmo quando o limite foi preenchido externamente', async () => {
        const mgr = getSubAgentManager();
        mgr.acquire('ext', 'a');
        mgr.acquire('ext', 'b');
        mgr.acquire('ext', 'c');
        const out = await delegateTool({
            sessionId: 'ext',
            task: 't',
            subAgentId: 'd',
            run: async () => 'x',
        });
        expect(out).toBe(CONCURRENT_SUBAGENTS_EXCEEDED_MSG);
    });
});
