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

import {
    runSubAgent,
    DelegationDepthExceededError,
    ConcurrentSubAgentsExceededError,
} from '../../agent/runSubAgent';
import { getSubAgentManager, resetSubAgentManager } from '../../agent/subAgentManager';
import {
    MAX_DELEGATION_DEPTH,
    MAX_DELEGATION_SUMMARY_LENGTH,
    DELEGATION_DEPTH_EXCEEDED_MSG,
} from '../../agent/config';

describe('#1037 runSubAgent — guard rails', () => {
    beforeEach(() => {
        resetSubAgentManager();
        loggerMock.warn.mockClear();
    });

    describe('profundidade máxima', () => {
        it('roda em depth 1 quando parentDepth=0', async () => {
            const res = await runSubAgent({
                sessionId: 's',
                task: 'fazer algo',
                parentDepth: 0,
                run: async () => 'ok',
            });
            expect(res.depth).toBe(1);
            expect(res.summary).toBe('ok');
        });

        it('aceita parentDepth=1 (sub-agente em depth 2)', async () => {
            const res = await runSubAgent({
                sessionId: 's',
                task: 'fazer algo',
                parentDepth: 1,
                run: async () => 'ok',
            });
            expect(res.depth).toBe(2);
        });

        it('REJEITA parentDepth=2 (profundidade 3) com erro explícito', async () => {
            await expect(
                runSubAgent({ sessionId: 's', task: 'x', parentDepth: 2, run: async () => 'ok' }),
            ).rejects.toBeInstanceOf(DelegationDepthExceededError);
        });

        it('mensagem do erro de profundidade cita o limite', async () => {
            await expect(
                runSubAgent({ sessionId: 's', task: 'x', parentDepth: MAX_DELEGATION_DEPTH, run: async () => 'ok' }),
            ).rejects.toThrow(DELEGATION_DEPTH_EXCEEDED_MSG);
        });

        it('NÃO incrementa a métrica quando rejeitado por profundidade', async () => {
            const mgr = getSubAgentManager();
            await expect(
                runSubAgent({ sessionId: 's', task: 'x', parentDepth: MAX_DELEGATION_DEPTH, run: async () => 'ok' }),
            ).rejects.toThrow();
            expect(mgr.delegationCount('s')).toBe(0);
        });
    });

    describe('resumo truncado', () => {
        it('preserva resumos <= 500 chars sem truncar', async () => {
            const short = 'x'.repeat(MAX_DELEGATION_SUMMARY_LENGTH);
            const res = await runSubAgent({
                sessionId: 's',
                task: 't',
                run: async () => short,
            });
            expect(res.truncated).toBe(false);
            expect(res.summary).toBe(short);
            expect(res.summary.length).toBe(MAX_DELEGATION_SUMMARY_LENGTH);
        });

        it('trunca resumos > 500 chars e loga warning', async () => {
            const long = 'y'.repeat(MAX_DELEGATION_SUMMARY_LENGTH + 250);
            const res = await runSubAgent({
                sessionId: 's',
                task: 't',
                run: async () => long,
            });
            expect(res.truncated).toBe(true);
            expect(res.summary.length).toBeLessThanOrEqual(MAX_DELEGATION_SUMMARY_LENGTH);
            expect(loggerMock.warn).toHaveBeenCalledWith(
                expect.stringContaining('truncado'),
            );
        });

        it('mantém o início do conteúdo original após truncar', async () => {
            const long = 'INICIO-MARCADOR' + 'z'.repeat(MAX_DELEGATION_SUMMARY_LENGTH + 100);
            const res = await runSubAgent({
                sessionId: 's',
                task: 't',
                run: async () => long,
            });
            expect(res.summary.startsWith('INICIO-MARCADOR')).toBe(true);
        });
    });

    describe('concorrência (defesa em profundidade)', () => {
        it('lança ConcurrentSubAgentsExceededError quando o limite está cheio', async () => {
            const mgr = getSubAgentManager();
            // Esgota os slots manualmente.
            mgr.acquire('s', 'a');
            mgr.acquire('s', 'b');
            mgr.acquire('s', 'c');
            await expect(
                runSubAgent({ sessionId: 's', task: 't', subAgentId: 'd', run: async () => 'ok' }),
            ).rejects.toBeInstanceOf(ConcurrentSubAgentsExceededError);
        });
    });

    describe('ciclo de vida do slot (acquire/release)', () => {
        it('libera o slot ao terminar (com sucesso)', async () => {
            const mgr = getSubAgentManager();
            await runSubAgent({
                sessionId: 's',
                task: 't',
                subAgentId: 'sa',
                run: async () => 'ok',
            });
            expect(mgr.activeCount('s')).toBe(0);
        });

        it('libera o slot mesmo quando run() lança', async () => {
            const mgr = getSubAgentManager();
            await expect(
                runSubAgent({
                    sessionId: 's',
                    task: 't',
                    subAgentId: 'sa',
                    run: async () => { throw new Error('boom'); },
                }),
            ).rejects.toThrow('boom');
            expect(mgr.activeCount('s')).toBe(0);
        });
    });

    describe('métrica delegation_total', () => {
        it('incrementa o contador a cada execução bem-sucedida', async () => {
            const mgr = getSubAgentManager();
            await runSubAgent({ sessionId: 's', task: 't', run: async () => '1' });
            await runSubAgent({ sessionId: 's', task: 't', run: async () => '2' });
            expect(mgr.delegationCount('s')).toBe(2);
        });
    });

    describe('delegação recursiva — para no nível 2 (critério de aceite)', () => {
        it('simula recursão e prova que a profundidade 3 é barrada', async () => {
            let maxDepthReached = 0;
            const depthsVisited: number[] = [];
            const rejections: unknown[] = [];

            // Cada sub-agente tenta delegar recursivamente. Como MAX_DELEGATION_DEPTH=2,
            // a recursão chega a depth 2 e a próxima tentativa (depth 3) é rejeitada.
            const recursiveRun = async (_task: string, currentDepth: number): Promise<string> => {
                maxDepthReached = Math.max(maxDepthReached, currentDepth);
                depthsVisited.push(currentDepth);
                try {
                    const child = await runSubAgent({
                        sessionId: 'rec',
                        task: `sub-${currentDepth}`,
                        parentDepth: currentDepth,
                        run: recursiveRun,
                    });
                    return `child@${child.depth}`;
                } catch (e) {
                    rejections.push(e);
                    return `leaf@${currentDepth}`;
                }
            };

            // Dispara a partir da raiz (parentDepth 0 → depth 1).
            await runSubAgent({
                sessionId: 'rec',
                task: 'root',
                parentDepth: 0,
                run: recursiveRun,
            });

            // A recursão efetivamente alcançou depth 2, mas NÃO depth 3.
            expect(maxDepthReached).toBe(2);
            expect(depthsVisited).toContain(1);
            expect(depthsVisited).toContain(2);
            expect(depthsVisited).not.toContain(3);

            // A tentativa de ir além do nível 2 foi barrada com o erro tipado.
            expect(rejections.length).toBeGreaterThanOrEqual(1);
            expect(rejections[0]).toBeInstanceOf(DelegationDepthExceededError);
        });
    });
});
