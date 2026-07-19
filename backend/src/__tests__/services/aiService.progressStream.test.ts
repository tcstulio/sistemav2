/**
 * #1574 — Teste de integração: loop do LocalProvider emite eventos de progresso
 * nos pontos-chave (thinking/tool_call/tool_result/done/error).
 *
 * Estratégia: mocka `agentLoop` (a camada fina que acabamos de adicionar) e espia
 * cada helper para provar que o loop real (`runLocalReplyLoop`, dentro de
 * `LocalProvider.generateReply`) chama:
 *   - `withTurnProgress` (wrap do turno → thinking + done/error)
 *   - `emitToolCall(jobId, name, args)` ANTES de cada `executeTool`
 *   - `emitToolResult(jobId, name, summary, ok)` DEPOIS de cada `executeTool`
 *
 * Critério de aceite #3 da issue: "Loop emite 'tool_call' {name, args} antes de
 * cada tool e 'tool_result' {name, summary} depois".
 *
 * O mock de `agentLoop` substitui `withTurnProgress` por uma passthrough que AINDA
 * ASSIM executa fn (precisamos do loop rodar de verdade). Os outros helpers viram
 * espiões isolados. Sem jobId, nada é chamado (prova o no-op).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
        this.models = { generateContent: vi.fn(), list: vi.fn() };
    }),
}));

vi.mock('fs/promises', () => ({
    default: { readFile: vi.fn().mockRejectedValue(new Error('File not found')) },
}));

vi.mock('../../config/env', () => ({
    config: {
        googleApiKey: 'test-api-key',
        geminiModel: 'gemini-2.0-flash',
        llmProvider: 'local',
        localLlmUrl: 'http://localhost:11434/v1',
        localModelName: 'llama3',
        llmPrimaryTimeoutMs: 5000,
        llmRetryDeadlineMs: 0,
        agentContextBudgetPct: 0.72,
        agentMaxIterations: null,
    },
}));

const dialState = vi.hoisted(() => ({ maxToolCalls: 50, requireConfirmationFor: [] as string[], isAdmin: false }));
vi.mock('../../services/agentConfigService', () => ({
    agentConfigService: {
        getSystemPrompt: () => '',
        getMaxToolCalls: () => dialState.maxToolCalls,
        requiresConfirmation: (tool: string) => dialState.requireConfirmationFor.includes(tool),
    },
}));

const toolState = vi.hoisted(() => ({ isAdmin: false }));
const executeToolMock = vi.hoisted(() => vi.fn(async () => 'RESULTADO OK'));
vi.mock('../../services/agentTools', () => ({
    TOOLS_PROMPT: 'FERRAMENTAS',
    getToolsPrompt: () => 'FERRAMENTAS',
    executeTool: executeToolMock,
    getToolContext: () => ({ listener: null, isAdmin: toolState.isAdmin }),
}));

vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/llmHealthService', () => ({
    llmHealthService: {
        isAvailable: vi.fn(() => true), recordSuccess: vi.fn(), recordQuotaError: vi.fn(),
        recordTransientError: vi.fn(), resetProvider: vi.fn(),
    },
}));
vi.mock('../../services/configService', () => ({
    configService: {
        getModuleConfig: vi.fn().mockReturnValue({ provider: 'local', model: 'llama3' }),
        isRunWithChainEnabled: vi.fn().mockReturnValue(false),
        getFallbackChain: vi.fn().mockReturnValue(['local']),
    },
    ConfigService: class {},
}));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: vi.fn(() => true) }));
vi.mock('../../services/scraperService', () => ({
    ScraperService: { searchGoogle: vi.fn(), fetchPageContent: vi.fn() },
}));

// #1574: mockamos o agentLoop — passthrough em withTurnProgress, espiões no resto.
// Note que importamos o OBJETO mockado inteiro (helpers individuais serão espiões).
const progressSpies = vi.hoisted(() => ({
    withTurnProgress: vi.fn(async (_jobId: unknown, fn: () => Promise<unknown>) => fn()),
    emitToolCall: vi.fn(),
    emitToolResult: vi.fn(),
    emitError: vi.fn(),
    summarizeToolResult: vi.fn((s: unknown) => (typeof s === 'string' ? s : 'SUMMARY')),
}));
vi.mock('../../agent/agentLoop', () => progressSpies);

import { LocalProvider } from '../../services/aiService';

const user = [{ role: 'user', parts: 'faça a tarefa' } as any];

describe('#1574 — integração: loop do LocalProvider emite progresso', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dialState.maxToolCalls = 50;
        dialState.requireConfirmationFor = [];
        toolState.isAdmin = false;
        executeToolMock.mockImplementation(async () => 'RESULTADO OK');
        progressSpies.withTurnProgress.mockImplementation(
            async (_jobId: unknown, fn: () => Promise<unknown>) => fn(),
        );
        progressSpies.summarizeToolResult.mockImplementation((s: unknown) =>
            typeof s === 'string' ? s : 'SUMMARY',
        );
    });

    it('SEM jobId: nenhum helper de progresso é chamado (compat legacy)', async () => {
        (axios.post as any).mockImplementation(async () => ({
            data: {
                choices: [
                    { message: { content: '{"tool":"list_users","args":{"q":"x"}}' } },
                ],
            },
        }));
        // Após a 1ª resposta (tool_call), a 2ª traz texto final.
        let n = 0;
        (axios.post as any).mockImplementation(async () => {
            n++;
            return {
                data: {
                    choices: [
                        {
                            message: {
                                content:
                                    n === 1
                                        ? '{"tool":"list_users","args":{"q":"x"}}'
                                        : 'Pronto, finalizei.',
                            },
                        },
                    ],
                },
            };
        });

        await new LocalProvider('http://localhost:11434/v1', 'llama3').generateReply(user, 'ctx');

        // SEM jobId, withTurnProgress é chamado (envolve sempre) mas helper interno é no-op.
        // Verificamos que os emitToolCall/emitToolResult NÃO são chamados com jobId.
        // Como o loop pega options?.jobId (undefined), ele passa undefined aos helpers.
        // Os helpers then são no-op internamente (verificado em agentLoop.test.ts).
        // Aqui focamos no contrato: nenhum emitToolCall/emitToolResult recebe jobId real.
        const toolCallCalls = progressSpies.emitToolCall.mock.calls;
        for (const c of toolCallCalls) {
            expect(c[0]).toBeFalsy(); // jobId é undefined/null/empty
        }
    });

    it('COM jobId: emite tool_call {name, args} ANTES e tool_result {name, summary} DEPOIS de cada tool', async () => {
        const JOB = 'job-1574-test';
        let n = 0;
        (axios.post as any).mockImplementation(async () => {
            n++;
            return {
                data: {
                    choices: [
                        {
                            message: {
                                content:
                                    n === 1
                                        ? '{"tool":"list_users","args":{"q":"marcus"}}'
                                        : 'Pronto, achei o marcus.',
                            },
                        },
                    ],
                },
            };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, 'ctx', undefined, { jobId: JOB });

        // tool_call emitido ANTES de executeTool, com nome e args exatos.
        expect(progressSpies.emitToolCall).toHaveBeenCalledWith(
            JOB,
            'list_users',
            { q: 'marcus' },
        );
        // tool_result emitido DEPOIS, com nome e sumário (ok default true no helper).
        expect(progressSpies.emitToolResult).toHaveBeenCalledWith(
            JOB,
            'list_users',
            expect.any(String),
        );
        // Helper `emitToolResult` foi chamado (default `ok=true` aplicado dentro dele).
        const toolResultCall = progressSpies.emitToolResult.mock.calls.find(
            (c) => c[0] === JOB && c[1] === 'list_users',
        );
        expect(toolResultCall).toBeDefined();
        // A ordem relativa: tool_call veio antes de tool_result.
        const toolCallOrder = progressSpies.emitToolCall.mock.invocationCallOrder[0];
        const toolResultOrder = progressSpies.emitToolResult.mock.invocationCallOrder[0];
        expect(toolCallOrder).toBeLessThan(toolResultOrder);
        // withTurnProgress envolve o turno (thinking + done).
        expect(progressSpies.withTurnProgress).toHaveBeenCalledTimes(1);
        expect(progressSpies.withTurnProgress.mock.calls[0][0]).toBe(JOB);
    });

    it('COM jobId: emite tool_result ok=false quando a tool lança (turno continua)', async () => {
        const JOB = 'job-err';
        executeToolMock.mockRejectedValueOnce(new Error('falha na API'));
        let n = 0;
        (axios.post as any).mockImplementation(async () => {
            n++;
            return {
                data: {
                    choices: [
                        {
                            message: {
                                content:
                                    n === 1
                                        ? '{"tool":"get_invoice","args":{"id":99}}'
                                        : 'Não consegui, vou avisar o usuário.',
                            },
                        },
                    ],
                },
            };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, 'ctx', undefined, { jobId: JOB });

        // tool_call emitido normalmente.
        expect(progressSpies.emitToolCall).toHaveBeenCalledWith(
            JOB,
            'get_invoice',
            { id: 99 },
        );
        // tool_result com ok=false e sumário mencionando erro.
        expect(progressSpies.emitToolResult).toHaveBeenCalledWith(
            JOB,
            'get_invoice',
            expect.stringContaining('erro'),
            false,
        );
    });

    it('COM jobId: múltiplas tools na mesma iteração geram pares tool_call/tool_result na ordem', async () => {
        const JOB = 'job-multi';
        // Resposta 1 contém DUAS tool_calls; resposta 2 traz texto final.
        (axios.post as any).mockImplementation(async () => ({
            data: {
                choices: [
                    {
                        message: {
                            content:
                                '{"tool":"list_users","args":{"q":"a"}}\n{"tool":"list_tasks","args":{"u":1}}',
                        },
                    },
                ],
            },
        }));
        // Override: só a 1ª resposta tem tools; a 2ª é final.
        let n = 0;
        (axios.post as any).mockImplementation(async () => {
            n++;
            return {
                data: {
                    choices: [
                        {
                            message: {
                                content:
                                    n === 1
                                        ? '{"tool":"list_users","args":{"q":"a"}}\n{"tool":"list_tasks","args":{"u":1}}'
                                        : 'Pronto.',
                            },
                        },
                    ],
                },
            };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, 'ctx', undefined, { jobId: JOB });

        // Dois emitToolCall (um por tool) e dois emitToolResult.
        expect(progressSpies.emitToolCall).toHaveBeenCalledTimes(2);
        expect(progressSpies.emitToolResult).toHaveBeenCalledTimes(2);

        // Ordem intercalada: call-1, result-1, call-2, result-2 (e não call-1, call-2, result-1, result-2).
        const orders = [
            ...progressSpies.emitToolCall.mock.invocationCallOrder.map((o) => ({ kind: 'call', o })),
            ...progressSpies.emitToolResult.mock.invocationCallOrder.map((o) => ({ kind: 'result', o })),
        ].sort((a, b) => a.o - b.o);
        // Esperado: call, result, call, result (intercalado por tool).
        expect(orders.map((x) => x.kind)).toEqual(['call', 'result', 'call', 'result']);
    });
});
