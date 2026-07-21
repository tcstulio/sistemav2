/**
 * #1574 — Testes unitários do runAgentLoop (loop do agente instrumentado).
 *
 * Cobre os critérios de aceite da issue que tocam o LOOP:
 *   - Loop emite 'tool_call' {name, args} ANTES de cada tool e 'tool_result' {name, summary} DEPOIS.
 *   - Emite 'thinking' ao iniciar e a cada iteração; 'text_delta'/'done' no fim.
 *   - Integra com o ProgressStream (subscribe recebe a sequência completa).
 *   - Cancelamento cooperativo via AbortSignal (antes do início e DURANTE uma tool longa).
 *   - Tetos de iteração e de tool-calls; propagação de erro; interrupção do usuário.
 *
 * Estratégia: o agentLoop recebe TODAS as dependências externas por injeção
 * (`stream`, `llmCall`, `executeToolFn`, `parseToolCalls`, `toolsPrompt`), então os
 * testes são determinísticos e NÃO tocam rede, DB, LLM real nem o parser real. Os
 * módulos pesados (`agentTools`, `aiService`, `config/env`) são stubados só para o
 * grafo de import carregar — o comportamento vem 100% das deps injetadas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// config/env — o agentLoop lê algumas chaves no boot do turno (baseUrl/model).
vi.mock('../../config/env', () => ({
    config: {
        localLlmUrl: 'http://localhost:11434/v1',
        localModelName: 'test-model',
        llmPrimaryTimeoutMs: 5000,
    },
}));

// agentTools é pesado (Dolibarr/scrapers). O loop usa `executeToolFn`/`toolsPrompt`
// injetados nos testes — estes stubs só satisfazem o import.
vi.mock('../../services/agentTools', () => ({
    executeTool: vi.fn(async () => 'default-tool-result'),
    getToolsPrompt: vi.fn(() => 'STUB_TOOLS_PROMPT'),
    getToolContext: vi.fn(() => ({ isAdmin: false })),
}));

// aiService só é usado pelo loop para `extractToolCalls`. Injetamos `parseToolCalls`
// nos testes, então este stub é apenas para o import resolver.
vi.mock('../../services/aiService', () => ({
    extractToolCalls: vi.fn(() => []),
}));

import {
    runAgentLoop,
    type AgentLoopOptions,
    type AgentLoopDeps,
    type LlmCaller,
} from '../../agent/agentLoop';
import { ProgressStream, type ProgressEvent } from '../../agent/progressStream';

// === Helpers determinísticos ===

/** Instância isolada, sem timer de auto-cleanup (determinismo). */
function makeStream(): ProgressStream {
    return new ProgressStream({ ttlMs: 60_000, maxBufferSize: 500, autoCleanupIntervalMs: 0 });
}

/**
 * LLM roteirizado: devolve `contents[i]` na i-ésima chamada (repete o último quando
 * a lista acaba). Cada resposta carrega um usage fixo para exercer a acumulação.
 */
function scriptedLlm(contents: string[]): LlmCaller {
    let i = 0;
    return vi.fn(async () => {
        const content = i < contents.length ? contents[i] : contents[contents.length - 1];
        i++;
        return { content, usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } };
    });
}

/**
 * Parser de teste: cada linha `CALL <tool> <jsonArgs>` vira uma tool-call; qualquer
 * outro conteúdo = resposta final (nenhuma tool). Mantém o teste legível e explícito.
 */
function lineParser(text: string): Array<{ tool: string; args: any }> {
    const calls: Array<{ tool: string; args: any }> = [];
    for (const raw of text.split('\n')) {
        const m = /^CALL (\S+)(?: (.*))?$/.exec(raw.trim());
        if (m) calls.push({ tool: m[1], args: m[2] ? JSON.parse(m[2]) : {} });
    }
    return calls;
}

function baseOpts(over: Partial<AgentLoopOptions> = {}): AgentLoopOptions {
    return {
        jobId: 'job-1',
        conversationHistory: [{ role: 'user', parts: 'oi' } as any],
        context: 'ctx',
        isAdmin: false,
        ...over,
    };
}

/** Deps mínimas comuns (stream + prompt), sobrescritas por teste. */
function baseDeps(stream: ProgressStream, over: Partial<AgentLoopDeps> = {}): AgentLoopDeps {
    return {
        stream,
        toolsPrompt: 'TOOLS',
        parseToolCalls: lineParser,
        ...over,
    };
}

const types = (buf: ProgressEvent[]) => buf.map((e) => e.type);

describe('#1575 — cancelamento via flag no JobState (requestCancel / isCancelled)', () => {
        // Cobertura: o loop checa `stream.isCancelled()` no topo de cada iteração E
        // entre tool_calls. Quando setada, fecha o job com payload {summary} e aborta.

        it('requestCancel ANTES do loop: emite cancelled com summary vazio', async () => {
            const stream = makeStream();
            // Marca o cancel ANTES de iniciar o loop — cobre "cancel chega antes do
            // primeiro emit do agente".
            stream.requestCancel('job-cancel');
            expect(stream.isCancelled('job-cancel')).toBe(true);

            const res = await runAgentLoop(
                baseOpts({ jobId: 'job-cancel' }),
                baseDeps(stream, {
                    llmCall: scriptedLlm(['CALL any {}', 'fim']),
                    executeToolFn: vi.fn(async () => 'ok'),
                }),
            );

            const buf = stream.getBuffer('job-cancel');
            const cancelledEv = buf.find((e) => e.type === 'cancelled');
            expect(cancelledEv).toBeTruthy();
            // Summary do caso vazio: frase padrão.
            const summary = (cancelledEv!.payload as any).summary as string;
            expect(summary).toMatch(/Cancelado por você/);
            expect(summary).toMatch(/Nada foi concluído/);
            // Sem 'done' contraditório por cima.
            expect(buf.filter((e) => e.type === 'done')).toHaveLength(0);
            expect(stream.isClosed('job-cancel')).toBe(true);
            expect(res).toBeTruthy();
            expect(res.text).toMatch(/Cancelado por você/);
        });

        it('requestCancel APÓS tool_call completada: cancelled inclui tool_calls no summary', async () => {
            const stream = makeStream();
            let callsSeen = 0;
            const executeToolFn = vi.fn(async () => {
                callsSeen++;
                // Na segunda chamada, marca o cancel — o loop vê a flag no topo da
                // PRÓXIMA iteração (após tool_result emitir) e fecha.
                if (callsSeen === 1) {
                    stream.requestCancel('job-cancel');
                }
                return `r${callsSeen}`;
            });

            await runAgentLoop(
                baseOpts({ jobId: 'job-cancel' }),
                baseDeps(stream, {
                    // LLM sempre pede tool → loop só sai via flag.
                    parseToolCalls: () => [{ tool: 'buscar', args: { q: 'x' } }],
                    llmCall: scriptedLlm(['CALL buscar {}']),
                    executeToolFn,
                }),
            );

            const buf = stream.getBuffer('job-cancel');
            const cancelledEv = buf.find((e) => e.type === 'cancelled');
            expect(cancelledEv).toBeTruthy();
            // O summary lista a tool_call que completou antes do cancel.
            const summary = (cancelledEv!.payload as any).summary as string;
            expect(summary).toMatch(/Cancelado por você/);
            expect(summary).toContain('buscar');
            expect(summary).toContain('{"q":"x"}');
            // Ao menos 1 tool_call foi completada e está no buffer.
            expect(buf.filter((e) => e.type === 'tool_call').length).toBeGreaterThanOrEqual(1);
            expect(buf.filter((e) => e.type === 'tool_result').length).toBeGreaterThanOrEqual(1);
            // Sem 'done' por cima do cancelled.
            expect(buf.filter((e) => e.type === 'done')).toHaveLength(0);
            expect(stream.isClosed('job-cancel')).toBe(true);
        });

        it('E2E: cancela job de 30s com 8 tool_calls no t=10s e retorna summary em até 3s', async () => {
            const stream = makeStream();
            let callsSeen = 0;
            const executeToolFn = vi.fn(async () => {
                callsSeen++;
                await new Promise((resolve) => setTimeout(resolve, 3_750));
                return `ação ${callsSeen}`;
            });
            const cancelAt = 10_000;
            const startedAt = Date.now();
            const cancelTimer = setTimeout(() => stream.requestCancel('job-e2e-cancel'), cancelAt);

            try {
                const result = await runAgentLoop(
                    baseOpts({ jobId: 'job-e2e-cancel', maxIterations: 8, maxToolCalls: 8 }),
                    baseDeps(stream, {
                        llmCall: scriptedLlm(['CALL ação {}']),
                        parseToolCalls: () => [{ tool: 'ação', args: { etapa: callsSeen + 1 } }],
                        executeToolFn,
                    }),
                );
                const elapsedAfterCancel = Date.now() - (startedAt + cancelAt);
                const cancelled = stream.getBuffer('job-e2e-cancel').find((event) => event.type === 'cancelled');
                expect(cancelled).toBeTruthy();
                expect((cancelled!.payload as { summary: string }).summary).toContain('Cancelado por você');
                expect(result.text).toContain('Cancelado por você');
                expect(elapsedAfterCancel).toBeLessThan(3_000);
                expect(callsSeen).toBeLessThanOrEqual(3);
            } finally {
                clearTimeout(cancelTimer);
            }
        }, 15_000);

        it('requestCancel dispara DURANTE tool: loop checa no topo da próxima iteração', async () => {
            const stream = makeStream();
            const executeToolFn = vi.fn(async () => {
                await new Promise((r) => setTimeout(r, 150));
                return 'ok';
            });

            setTimeout(() => stream.requestCancel('job-cancel'), 100);

            const start = Date.now();
            await runAgentLoop(
                baseOpts({ jobId: 'job-cancel', maxIterations: 10 }),
                baseDeps(stream, {
                    parseToolCalls: () => [{ tool: 'spin', args: {} }],
                    llmCall: scriptedLlm(['CALL spin {}']),
                    executeToolFn,
                }),
            );
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(2000);

            const buf = stream.getBuffer('job-cancel');
            const cancelledEv = buf.find((e) => e.type === 'cancelled');
            expect(cancelledEv).toBeTruthy();
            expect(stream.isClosed('job-cancel')).toBe(true);
        });



        it('AbortSignal tem precedência sobre a flag (síncrono > assíncrono)', async () => {
            const stream = makeStream();
            const ac = new AbortController();
            stream.requestCancel('job-cancel');
            ac.abort('signal-wins');

            await expect(
                runAgentLoop(
                    baseOpts({ jobId: 'job-cancel', signal: ac.signal }),
                    baseDeps(stream, { llmCall: scriptedLlm(['CALL x {}']), executeToolFn: vi.fn(async () => 'ok') }),
                ),
            ).rejects.toThrow(/aborted before start/);

            const buf = stream.getBuffer('job-cancel');
            // O cancelled emitido pelo path do AbortSignal está presente (rejeição
            // antes do nosso early-return do requestCancel).
            expect(buf.some((e) => e.type === 'cancelled')).toBe(true);
        });

        it('cancel é idempotente — múltiplas chamadas não quebram o summary', async () => {
            const stream = makeStream();
            stream.requestCancel('job-cancel');
            stream.requestCancel('job-cancel');
            stream.requestCancel('job-cancel');

            await runAgentLoop(
                baseOpts({ jobId: 'job-cancel' }),
                baseDeps(stream, { llmCall: scriptedLlm(['CALL x {}']), executeToolFn: vi.fn(async () => 'ok') }),
            );

            const buf = stream.getBuffer('job-cancel');
            // Apenas UM cancelled (a idempotência do close() cobre o caso).
            expect(buf.filter((e) => e.type === 'cancelled')).toHaveLength(1);
        });

        it('buildCancelSummary: lista tool_calls completadas com args e summary', async () => {
            const { buildCancelSummary } = await import('../../agent/agentLoop');
            const result = buildCancelSummary([
                { name: 'buscar', args: { q: 'x' }, summary: 'encontrou 3' },
                { name: 'enviar_email', args: { to: 'a@b.c' }, summary: 'enviado' },
            ]);
            expect(result).toMatch(/Cancelado por você/);
            expect(result).toMatch(/O que já fiz/);
            expect(result).toContain('buscar');
            expect(result).toContain('enviar_email');
            expect(result).toContain('encontrou 3');
            expect(result).toContain('enviado');
        });

        it('buildCancelSummary: lista vazia produz frase "Nada foi concluído"', async () => {
            const { buildCancelSummary } = await import('../../agent/agentLoop');
            const result = buildCancelSummary([]);
            expect(result).toMatch(/Cancelado por você/);
            expect(result).toMatch(/Nada foi concluído/);
        });

        it('buildCancelSummary: pula tool_calls pendentes (summary vazio)', async () => {
            const { buildCancelSummary } = await import('../../agent/agentLoop');
            const result = buildCancelSummary([
                { name: 'buscar', args: { q: 'x' }, summary: 'encontrou 3' },
                { name: 'pendente', args: {}, summary: '' }, // tool_call emitido mas sem tool_result
                { name: 'outra', args: {}, summary: 'concluiu' },
            ]);
            expect(result).toContain('buscar');
            expect(result).toContain('outra');
            expect(result).not.toContain('pendente');
        });
    });

describe('#1574 — runAgentLoop (loop do agente com eventos de progresso)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('resposta simples (sem tools)', () => {
        it('emite thinking no início e a cada iteração, text_delta e done', async () => {
            const stream = makeStream();
            const res = await runAgentLoop(
                baseOpts(),
                baseDeps(stream, { llmCall: scriptedLlm(['resposta final']) }),
            );

            const buf = stream.getBuffer('job-1');
            // thinking(start), thinking(iteration), text_delta, done
            expect(types(buf)).toEqual(['thinking', 'thinking', 'text_delta', 'done']);
            expect((buf[0].payload as any).phase).toBe('start');
            expect((buf[1].payload as any).phase).toBe('iteration');
            expect((buf[2].payload as any).delta).toBe('resposta final');
            expect((buf[3].payload as any).result).toBe('resposta final');

            expect(res.text).toBe('resposta final');
            expect(stream.isClosed('job-1')).toBe(true);
            // seq monotônico por job.
            expect(buf.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
        });

        it('acumula usage de todas as chamadas ao LLM e devolve o buffer de eventos', async () => {
            const stream = makeStream();
            const res = await runAgentLoop(
                baseOpts(),
                baseDeps(stream, {
                    llmCall: scriptedLlm(['CALL search {"q":1}', 'fim']),
                    executeToolFn: vi.fn(async () => 'ok'),
                }),
            );
            // 2 chamadas ao LLM × total_tokens 3 = 6.
            expect(res.usage.totalTokens).toBe(6);
            expect(res.usage.promptTokens).toBe(2);
            expect(res.usage.completionTokens).toBe(4);
            // events é o snapshot final do buffer do job.
            expect(res.events.map((e) => e.type)).toEqual(types(stream.getBuffer('job-1')));
        });
    });

    describe("tool_call ANTES + tool_result DEPOIS (critério de aceite #3)", () => {
        it('emite tool_call {name,args} antes e tool_result {name,summary} depois, em ordem', async () => {
            const stream = makeStream();
            const executeToolFn = vi.fn(async () => 'RESULTADO_DA_TOOL');
            const res = await runAgentLoop(
                baseOpts(),
                baseDeps(stream, {
                    llmCall: scriptedLlm(['CALL search {"q":42}', 'texto final']),
                    executeToolFn,
                }),
            );

            const buf = stream.getBuffer('job-1');
            const idxCall = types(buf).indexOf('tool_call');
            const idxResult = types(buf).indexOf('tool_result');
            expect(idxCall).toBeGreaterThanOrEqual(0);
            // tool_result vem ESTRITAMENTE depois do tool_call correspondente.
            expect(idxResult).toBeGreaterThan(idxCall);

            expect(buf[idxCall].payload).toMatchObject({ name: 'search', args: { q: 42 } });
            expect(buf[idxResult].payload).toMatchObject({ name: 'search', summary: 'RESULTADO_DA_TOOL' });

            // A tool foi de fato executada com (nome, args).
            expect(executeToolFn).toHaveBeenCalledTimes(1);
            expect(executeToolFn.mock.calls[0][0]).toBe('search');
            expect(executeToolFn.mock.calls[0][1]).toEqual({ q: 42 });

            expect(res.text).toBe('texto final');
            expect(types(buf)[types(buf).length - 1]).toBe('done');
        });

        it('trunca o summary de resultados longos (> 200 chars) sem perder o tool_result', async () => {
            const stream = makeStream();
            const longResult = 'x'.repeat(500);
            await runAgentLoop(
                baseOpts(),
                baseDeps(stream, {
                    llmCall: scriptedLlm(['CALL big {}', 'fim']),
                    executeToolFn: vi.fn(async () => longResult),
                }),
            );
            const buf = stream.getBuffer('job-1');
            const resultEv = buf.find((e) => e.type === 'tool_result')!;
            const summary = (resultEv.payload as any).summary as string;
            expect(summary.length).toBeLessThan(longResult.length);
            expect(summary).toContain('… (+300 chars)');
        });

        it('erro na tool vira tool_result "error: ..." e o loop segue até o texto final', async () => {
            const stream = makeStream();
            const executeToolFn = vi.fn(async () => {
                throw new Error('boom');
            });
            const res = await runAgentLoop(
                baseOpts(),
                baseDeps(stream, {
                    llmCall: scriptedLlm(['CALL fail {}', 'recuperei']),
                    executeToolFn,
                }),
            );
            const buf = stream.getBuffer('job-1');
            const resultEv = buf.find((e) => e.type === 'tool_result')!;
            expect((resultEv.payload as any).summary).toBe('error: boom');
            // Não é terminal: o loop continua e conclui normalmente.
            expect(res.text).toBe('recuperei');
            expect(types(buf)[types(buf).length - 1]).toBe('done');
        });

        it('passa o AbortSignal para executeToolFn (habilita tools cooperativas)', async () => {
            const stream = makeStream();
            const ac = new AbortController();
            const executeToolFn = vi.fn(async () => 'ok');
            await runAgentLoop(
                baseOpts({ signal: ac.signal }),
                baseDeps(stream, {
                    llmCall: scriptedLlm(['CALL search {}', 'fim']),
                    executeToolFn,
                }),
            );
            // 3º argumento é o signal do turno.
            expect(executeToolFn.mock.calls[0][2]).toBe(ac.signal);
        });
    });

    describe('tetos do loop', () => {
        it('respeita maxToolCalls: para no teto e fecha com terminal "error" único', async () => {
            const stream = makeStream();
            const executeToolFn = vi.fn(async () => 'ok');
            const res = await runAgentLoop(
                baseOpts({ maxToolCalls: 2, maxIterations: 10 }),
                baseDeps(stream, {
                    // O LLM insiste em chamar 1 tool a cada iteração.
                    parseToolCalls: () => [{ tool: 'search', args: {} }],
                    llmCall: scriptedLlm(['CALL search {}']),
                    executeToolFn,
                }),
            );
            const buf = stream.getBuffer('job-1');
            expect(buf.filter((e) => e.type === 'tool_call')).toHaveLength(2);
            expect(executeToolFn).toHaveBeenCalledTimes(2);
            // Terminal ÚNICO: 'error' (sem 'done' contraditório por cima).
            expect(buf[buf.length - 1].type).toBe('error');
            expect(buf.filter((e) => e.type === 'done')).toHaveLength(0);
            expect(res.text).toMatch(/Limite de 2 tool/);
            expect(stream.isClosed('job-1')).toBe(true);
        });

        it('respeita maxIterations quando o LLM nunca conclui', async () => {
            const stream = makeStream();
            await runAgentLoop(
                baseOpts({ maxIterations: 3, maxToolCalls: 100 }),
                baseDeps(stream, {
                    // Sempre pede tool → nunca há resposta final.
                    parseToolCalls: () => [{ tool: 'loop', args: {} }],
                    llmCall: scriptedLlm(['CALL loop {}']),
                    executeToolFn: vi.fn(async () => 'ok'),
                }),
            );
            const buf = stream.getBuffer('job-1');
            // 3 iterações → 3 thinking(iteration) (+1 thinking start).
            const thinkingIterations = buf.filter(
                (e) => e.type === 'thinking' && (e.payload as any).phase === 'iteration',
            );
            expect(thinkingIterations).toHaveLength(3);
            // Encerra com 'done' (esgotou iterações sem erro nem abort).
            expect(buf[buf.length - 1].type).toBe('done');
        });
    });

    describe('cancelamento (AbortSignal)', () => {
        it('aborta ANTES de iniciar: emite cancelled e rejeita', async () => {
            const stream = makeStream();
            const ac = new AbortController();
            ac.abort('já-cancelado');
            await expect(
                runAgentLoop(baseOpts({ signal: ac.signal }), baseDeps(stream, { llmCall: scriptedLlm(['x']) })),
            ).rejects.toThrow(/aborted before start/);
            const buf = stream.getBuffer('job-1');
            expect(buf.some((e) => e.type === 'cancelled')).toBe(true);
            expect(stream.isClosed('job-1')).toBe(true);
        });

        it('aborta DURANTE uma tool longa: emite cancelled, NÃO emite tool_result, resolve', async () => {
            const stream = makeStream();
            const ac = new AbortController();
            let toolStarted = false;
            // Tool que nunca resolve sozinha — só o abort desbloqueia o loop.
            const executeToolFn = vi.fn(
                () =>
                    new Promise<string>(() => {
                        toolStarted = true;
                    }),
            );
            const p = runAgentLoop(
                baseOpts({ signal: ac.signal, maxIterations: 3 }),
                baseDeps(stream, {
                    llmCall: scriptedLlm(['CALL slow {}']),
                    executeToolFn,
                }),
            );

            await vi.waitFor(() => expect(toolStarted).toBe(true));
            ac.abort('user-cancel');
            const res = await p; // não trava: o race libera o loop

            const buf = stream.getBuffer('job-1');
            expect(buf.some((e) => e.type === 'cancelled')).toBe(true);
            // A tool abortada NÃO produz tool_result.
            expect(buf.some((e) => e.type === 'tool_result')).toBe(false);
            expect(stream.isClosed('job-1')).toBe(true);
            expect(res).toBeTruthy();
        });

        it('AskUserInterrupt na tool: terminal cancelled (user-interrupt) e texto = pergunta', async () => {
            const stream = makeStream();
            const executeToolFn = vi.fn(async () => {
                const e: any = new Error('need input');
                e.name = 'AskUserInterrupt';
                e.question = 'Qual o valor?';
                throw e;
            });
            const res = await runAgentLoop(
                baseOpts(),
                baseDeps(stream, {
                    llmCall: scriptedLlm(['CALL ask {}', 'não-usado']),
                    executeToolFn,
                }),
            );
            const buf = stream.getBuffer('job-1');
            const cancelled = buf.find((e) => e.type === 'cancelled');
            expect(cancelled).toBeTruthy();
            expect((cancelled!.payload as any).reason).toBe('user-interrupt');
            // Sem 'done' por cima do cancelamento.
            expect(buf.filter((e) => e.type === 'done')).toHaveLength(0);
            expect(res.text).toBe('Qual o valor?');
            expect(stream.isClosed('job-1')).toBe(true);
        });
    });

    describe('propagação de erro fatal', () => {
        it('erro na chamada ao LLM emite "error" terminal e re-lança', async () => {
            const stream = makeStream();
            const llmCall: LlmCaller = vi.fn(async () => {
                throw new Error('llm down');
            });
            await expect(
                runAgentLoop(baseOpts(), baseDeps(stream, { llmCall })),
            ).rejects.toThrow(/LLM call failed: llm down/);
            const buf = stream.getBuffer('job-1');
            expect(buf[buf.length - 1].type).toBe('error');
            expect(stream.isClosed('job-1')).toBe(true);
        });
    });

    describe('integração com o ProgressStream (subscribe)', () => {
        it('um subscriber recebe a sequência completa de eventos via AsyncIterable', async () => {
            const stream = makeStream();
            const collected: ProgressEvent[] = [];
            // Assina ANTES de rodar o loop (jobId ainda não existe — o iterator aguarda).
            const consumer = (async () => {
                for await (const ev of stream.subscribe('job-1')) collected.push(ev);
            })();

            // Deixa o subscribe registrar o listener antes de emitir.
            await new Promise((r) => setTimeout(r, 5));

            await runAgentLoop(
                baseOpts(),
                baseDeps(stream, {
                    llmCall: scriptedLlm(['CALL search {"q":1}', 'pronto']),
                    executeToolFn: vi.fn(async () => 'ok'),
                }),
            );

            await consumer; // o 'done' fecha o job e encerra a iteração
            const seen = collected.map((e) => e.type);
            expect(seen[0]).toBe('thinking');
            expect(seen).toContain('tool_call');
            expect(seen).toContain('tool_result');
            expect(seen[seen.length - 1]).toBe('done');
            // tool_call antes de tool_result também na visão do consumidor.
            expect(seen.indexOf('tool_result')).toBeGreaterThan(seen.indexOf('tool_call'));
        });
    });
});
