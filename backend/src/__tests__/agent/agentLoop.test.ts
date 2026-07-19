/**
 * #1574 — Testes da instrumentação do loop do agente (`agent/agentLoop.ts`).
 *
 * Cobre o critério de aceite #3 (loop emite `tool_call` antes e `tool_result` depois
 * de cada tool) e o envelope `runAgentLoop` (done/error/cancelled), além dos helpers
 * de emissão. Usa o singleton `progressStream` com jobIds únicos por teste (isolados
 * entre si) e faz dispose ao final para não vazar estado.
 */
import { describe, it, expect } from 'vitest';

import {
    runAgentLoop,
    wrapToolExecutor,
    emitThinking,
    emitTextDelta,
    emitToolCall,
    emitToolResult,
    progressStream,
} from '../../agent/agentLoop';
import type { ToolExecutor } from '../../agent/agentLoop';

const unique = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2)}`;
const types = (jobId: string): string[] => progressStream.getEvents(jobId).map((e) => e.type);

describe('#1574 — agentLoop.wrapToolExecutor (tool_call/tool_result)', () => {
    it('emite tool_call {name,args} ANTES e tool_result {name,summary} DEPOIS (sucesso)', async () => {
        const jobId = unique('wrap-ok');
        const fake: ToolExecutor = async (tool, _args) => `result of ${tool}`;
        const wrapped = wrapToolExecutor(fake, jobId);

        const out = await wrapped('get_customer', { id: 7 });

        expect(out).toBe('result of get_customer');
        const events = progressStream.getEvents(jobId);
        expect(events.map((e) => e.type)).toEqual(['tool_call', 'tool_result']);

        const call = events[0].payload as { name: string; args: unknown };
        expect(call.name).toBe('get_customer');
        expect(call.args).toEqual({ id: 7 });

        const result = events[1].payload as { name: string; summary: string };
        expect(result.name).toBe('get_customer');
        expect(result.summary).toContain('result of get_customer');
        progressStream.dispose(jobId);
    });

    it('emite tool_result {name,summary} mesmo em erro e rethrowa o erro original', async () => {
        const jobId = unique('wrap-err');
        const failing: ToolExecutor = async () => {
            throw new Error('tool boom');
        };
        const wrapped = wrapToolExecutor(failing, jobId);

        await expect(wrapped('bad_tool', { x: 1 })).rejects.toThrow('tool boom');

        const events = progressStream.getEvents(jobId);
        // Paridade 1:1 — sempre tool_call seguido de tool_result, mesmo em erro.
        expect(events.map((e) => e.type)).toEqual(['tool_call', 'tool_result']);
        const result = events[1].payload as { name: string; summary: string };
        expect(result.name).toBe('bad_tool');
        expect(result.summary).toContain('tool boom');
        progressStream.dispose(jobId);
    });

    it('trunca sumário de resultado muito longo para não inflar o stream', async () => {
        const jobId = unique('wrap-long');
        const long: ToolExecutor = async () => 'x'.repeat(2000);
        const wrapped = wrapToolExecutor(long, jobId);
        await wrapped('big', {});
        const result = progressStream.getEvents(jobId)[1].payload as { summary: string };
        expect(result.summary.length).toBeLessThanOrEqual(501); // 500 + reticências
        expect(result.summary.endsWith('…')).toBe(true);
        progressStream.dispose(jobId);
    });

    it('preserva o comportamento do executor (args repassados, retorno idêntico)', async () => {
        const jobId = unique('wrap-passthrough');
        let seen: { tool: string; args: unknown } | null = null;
        const inner: ToolExecutor = async (tool, args) => {
            seen = { tool, args };
            return 'ok';
        };
        const wrapped = wrapToolExecutor(inner, jobId);
        const out = await wrapped('t', { a: 1 });
        expect(out).toBe('ok');
        expect(seen).toEqual({ tool: 't', args: { a: 1 } });
        progressStream.dispose(jobId);
    });
});

describe('#1574 — agentLoop.runAgentLoop (envelope done/error/cancelled)', () => {
    it('emite "done" no sucesso e propaga o resultado', async () => {
        const jobId = unique('done');
        const result = await runAgentLoop(jobId, async () => 42);
        expect(result).toBe(42);
        expect(types(jobId).at(-1)).toBe('done');
        progressStream.dispose(jobId);
    });

    it('emite "error" e rethrowa quando a callback falha', async () => {
        const jobId = unique('err');
        await expect(
            runAgentLoop(jobId, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');

        const events = progressStream.getEvents(jobId);
        const last = events[events.length - 1];
        expect(last.type).toBe('error');
        expect((last.payload as { message: string }).message).toBe('boom');
        progressStream.dispose(jobId);
    });

    it('emite "cancelled" quando o AbortSignal dispara durante o turno', async () => {
        const jobId = unique('abort');
        const ctrl = new AbortController();
        const err = new Error('aborted');
        err.name = 'AbortError';
        await expect(
            runAgentLoop(
                jobId,
                async () => {
                    ctrl.abort();
                    throw err;
                },
                { signal: ctrl.signal },
            ),
        ).rejects.toThrow('aborted');

        const last = progressStream.getEvents(jobId).at(-1);
        expect(last?.type).toBe('cancelled');
        progressStream.dispose(jobId);
    });

    it('abort pré-início emite "cancelled" e rejeita imediatamente', async () => {
        const jobId = unique('abort-pre');
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(
            runAgentLoop(jobId, async () => 'never', { signal: ctrl.signal }),
        ).rejects.toThrow('cancelled before start');
        expect(types(jobId).at(-1)).toBe('cancelled');
        progressStream.dispose(jobId);
    });

    it('não duplica terminal se um já foi publicado antes do fim do turno', async () => {
        const jobId = unique('no-dup');
        await runAgentLoop(jobId, async () => {
            // Caller emitiu um terminal explícito durante o turno.
            progressStream.emit(jobId, 'done', { text: 'finalizado pelo caller' });
            return 'ok';
        });
        const events = progressStream.getEvents(jobId);
        // Apenas UM terminal (done) — o envelope não adiciona outro.
        const terminals = events.filter((e) => e.type === 'done');
        expect(terminals.length).toBe(1);
        progressStream.dispose(jobId);
    });
});

describe('#1574 — agentLoop helpers de emissão (tipos padronizados)', () => {
    it('emitThinking/emitTextDelta/emitToolCall/emitToolResult publicam eventos tipados', () => {
        const jobId = unique('helpers');
        emitThinking(jobId, 'hmm');
        emitTextDelta(jobId, 'abc');
        emitToolCall(jobId, 'search', { q: 'x' });
        emitToolResult(jobId, 'search', 'found 2');

        const events = progressStream.getEvents(jobId);
        expect(events.map((e) => e.type)).toEqual([
            'thinking',
            'text_delta',
            'tool_call',
            'tool_result',
        ]);
        expect(events[0].payload).toEqual({ text: 'hmm' });
        expect(events[1].payload).toEqual({ text: 'abc' });
        expect(events[2].payload).toEqual({ name: 'search', args: { q: 'x' } });
        expect(events[3].payload).toEqual({ name: 'search', summary: 'found 2' });
        progressStream.dispose(jobId);
    });
});
