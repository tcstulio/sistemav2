/**
 * #1574 — Testes dos helpers de emissão do loop (`agentLoop`).
 *
 * Valida que cada helper:
 *   - é no-op quando jobId é vazio (callers legacy não quebram nem vazam para o stream).
 *   - empacota o payload no shape esperado pelo protocolo SSE.
 *   - roteia para o `progressStream` correto (singleton).
 *
 * Não roda o loop do agente — isso é foco dos testes de integração (`aiService.*`).
 * Aqui isolamos a CAMADA FINA de helpers que o loop chama.
 *
 * Estratégia: usa `vi.spyOn(progressStream, 'emit')` no singleton REAL (sem mock de
 * módulo) — assim não há problema de hoisting de `vi.mock` e o spy é limpo a cada caso.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { progressStream } from '../../agent/progressStream';
import {
    emitThinking,
    emitToolCall,
    emitToolResult,
    emitTextDelta,
    emitDone,
    emitCancelled,
    emitError,
    summarizeToolResult,
    withTurnProgress,
    subscribeToJob,
    getJobBuffer,
} from '../../agent/agentLoop';

describe('#1574 — agentLoop (helpers de emissão)', () => {
    let emitSpy: ReturnType<typeof vi.spyOn>;
    let subscribeSpy: ReturnType<typeof vi.spyOn>;
    let getBufferSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        emitSpy = vi.spyOn(progressStream, 'emit').mockImplementation(() => null);
        subscribeSpy = vi.spyOn(progressStream, 'subscribe').mockImplementation(() => ({
            [Symbol.asyncIterator]: async function* () { /* noop */ },
        }));
        getBufferSpy = vi.spyOn(progressStream, 'getBuffer').mockImplementation(() => []);
    });

    afterEach(() => {
        emitSpy.mockRestore();
        subscribeSpy.mockRestore();
        getBufferSpy.mockRestore();
    });

    describe('no-op quando jobId vazio', () => {
        it('todos helpers retornam sem chamar emit quando jobId é undefined', () => {
            emitThinking(undefined);
            emitToolCall(undefined, 't', {});
            emitToolResult(undefined, 't', 's');
            emitTextDelta(undefined, 'd');
            emitDone(undefined);
            emitCancelled(undefined);
            emitError(undefined, new Error('x'));
            expect(emitSpy).not.toHaveBeenCalled();
        });

        it('todos helpers retornam sem chamar emit quando jobId é string vazia', () => {
            emitThinking('');
            emitToolCall('', 't', {});
            emitToolResult('', 't', 's');
            emitTextDelta('', 'd');
            emitDone('');
            emitCancelled('');
            emitError('', new Error('x'));
            expect(emitSpy).not.toHaveBeenCalled();
        });

        it('todos helpers retornam sem chamar emit quando jobId é null', () => {
            emitThinking(null);
            emitToolCall(null, 't', {});
            emitToolResult(null, 't', 's');
            emitTextDelta(null, 'd');
            emitDone(null);
            emitCancelled(null);
            emitError(null, new Error('x'));
            expect(emitSpy).not.toHaveBeenCalled();
        });
    });

    describe('shape de payload por tipo de evento', () => {
        it('emitThinking(jobId, note) → thinking com payload {note}', () => {
            emitThinking('job-1', 'iniciando');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'thinking', { note: 'iniciando' });
        });

        it('emitThinking(jobId) → thinking com payload vazio (sem note)', () => {
            emitThinking('job-1');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'thinking', {});
        });

        it('emitThinking aceita iteração opcional', () => {
            emitThinking('job-1', undefined, 3);
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'thinking', { iteration: 3 });
        });

        it('emitToolCall(jobId, name, args) → tool_call com {name, args}', () => {
            emitToolCall('job-1', 'searchCustomer', { q: 'marcus' });
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'tool_call', {
                name: 'searchCustomer',
                args: { q: 'marcus' },
            });
        });

        it('emitToolCall normaliza args null/undefined para {}', () => {
            emitToolCall('job-1', 'ping', null);
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'tool_call', {
                name: 'ping',
                args: {},
            });
        });

        it('emitToolResult(jobId, name, summary) → tool_result com ok=true default', () => {
            emitToolResult('job-1', 'searchCustomer', '1 resultado');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'tool_result', {
                name: 'searchCustomer',
                summary: '1 resultado',
                ok: true,
            });
        });

        it('emitToolResult aceita ok=false para sinalizar erro', () => {
            emitToolResult('job-1', 'createInvoice', 'falha', false);
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'tool_result', {
                name: 'createInvoice',
                summary: 'falha',
                ok: false,
            });
        });

        it('emitTextDelta(jobId, delta) → text_delta com {delta}', () => {
            emitTextDelta('job-1', 'Olá, ');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'text_delta', { delta: 'Olá, ' });
        });

        it('emitTextDelta ignora delta vazio (sem ruído no stream)', () => {
            emitTextDelta('job-1', '');
            expect(emitSpy).not.toHaveBeenCalled();
        });

        it('emitDone(jobId) → done com payload vazio', () => {
            emitDone('job-1');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'done', {});
        });

        it('emitDone(jobId, summary) → done com {summary}', () => {
            emitDone('job-1', 'finalizado');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'done', { summary: 'finalizado' });
        });

        it('emitCancelled(jobId) → cancelled com reason default', () => {
            emitCancelled('job-1');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'cancelled', { reason: 'cancelled' });
        });

        it('emitCancelled(jobId, reason) → cancelled com reason custom', () => {
            emitCancelled('job-1', 'user-abort');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'cancelled', { reason: 'user-abort' });
        });

        it('emitError extrai message de Error', () => {
            emitError('job-1', new Error('boom'));
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'error', { message: 'boom' });
        });

        it('emitError stringifica valor não-Error', () => {
            emitError('job-1', 'string error');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'error', { message: 'string error' });
        });

        it('emitError aceita code opcional', () => {
            emitError('job-1', new Error('quota'), 'QUOTA');
            expect(emitSpy).toHaveBeenCalledWith('job-1', 'error', {
                message: 'quota',
                code: 'QUOTA',
            });
        });
    });

    describe('summarizeToolResult', () => {
        it('string curta passa direta (apenas whitespace normalizado)', () => {
            expect(summarizeToolResult('  olá   mundo  ')).toBe('olá mundo');
        });

        it('string longa é truncada com elipsis', () => {
            const big = 'x'.repeat(500);
            const out = summarizeToolResult(big, 50);
            expect(out.length).toBe(51); // 50 + '…'
            expect(out.endsWith('…')).toBe(true);
        });

        it('respeita maxLen custom', () => {
            expect(summarizeToolResult('abcdef', 3)).toBe('abc…');
        });

        it('null vira string vazia', () => {
            expect(summarizeToolResult(null)).toBe('');
            expect(summarizeToolResult(undefined)).toBe('');
        });

        it('objeto vira JSON stringify compacto', () => {
            expect(summarizeToolResult({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
        });

        it('objeto circular não lança — cai em String()', () => {
            const circular: any = { name: 'x' };
            circular.self = circular;
            const out = summarizeToolResult(circular, 200);
            expect(typeof out).toBe('string');
            expect(out.length).toBeGreaterThan(0);
        });

        it('default maxLen = 240', () => {
            const big = 'y'.repeat(300);
            const out = summarizeToolResult(big);
            expect(out.length).toBe(241);
        });
    });

    describe('withTurnProgress', () => {
        it('emite thinking ANTES e done DEPOIS quando jobId está presente', async () => {
            const fn = vi.fn(async () => 'ok');
            const result = await withTurnProgress('job-1', fn);
            expect(result).toBe('ok');
            expect(fn).toHaveBeenCalledTimes(1);
            // thinking → fn → done
            expect(emitSpy).toHaveBeenNthCalledWith(1, 'job-1', 'thinking', {});
            expect(emitSpy).toHaveBeenNthCalledWith(2, 'job-1', 'done', {});
            expect(emitSpy).toHaveBeenCalledTimes(2);
        });

        it('emite error quando fn lança (e re-lança)', async () => {
            const fn = vi.fn(async () => { throw new Error('pau'); });
            await expect(withTurnProgress('job-1', fn)).rejects.toThrow('pau');
            // thinking → error
            expect(emitSpy).toHaveBeenNthCalledWith(1, 'job-1', 'thinking', {});
            expect(emitSpy).toHaveBeenNthCalledWith(2, 'job-1', 'error', { message: 'pau' });
            // NÃO emite done quando lança.
            const types = emitSpy.mock.calls.map((c) => c[1]);
            expect(types).not.toContain('done');
        });

        it('NÃO envolve (nem emite) quando jobId é vazio — só chama fn', async () => {
            const fn = vi.fn(async () => 42);
            const result = await withTurnProgress(undefined, fn);
            expect(result).toBe(42);
            expect(fn).toHaveBeenCalledTimes(1);
            expect(emitSpy).not.toHaveBeenCalled();
        });

        it('preserva o valor de retorno mesmo quando é undefined/null', async () => {
            const fn = vi.fn(async () => undefined);
            expect(await withTurnProgress('job-1', fn)).toBeUndefined();
            expect(emitSpy).toHaveBeenCalledTimes(2); // thinking + done
        });
    });

    describe('atalhos', () => {
        it('subscribeToJob delega para progressStream.subscribe', () => {
            const iterable = { [Symbol.asyncIterator]: async function* () {} };
            subscribeSpy.mockReturnValueOnce(iterable as any);
            const signal = new AbortController().signal;
            const out = subscribeToJob('job-1', 5, signal);
            expect(out).toBe(iterable);
            expect(subscribeSpy).toHaveBeenCalledWith('job-1', 5, signal);
        });

        it('getJobBuffer delega para progressStream.getBuffer', () => {
            getBufferSpy.mockReturnValueOnce([{ id: 1 } as any]);
            const out = getJobBuffer('job-1');
            expect(getBufferSpy).toHaveBeenCalledWith('job-1');
            expect(out).toEqual([{ id: 1 }]);
        });
    });
});
