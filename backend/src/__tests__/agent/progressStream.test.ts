/**
 * #1574 — Testes unitários do ProgressStream.
 *
 * Cobre os critérios de aceite da issue:
 *   - subscribe(jobId) emite eventos em ordem
 *   - Buffer armazena últimos N eventos com IDs monotônicos
 *   - Testes unitários cobrem emit/subscribe/buffer/TTL
 *
 * Semântica SSE adotada (matches a spec Server-Sent Events):
 *   - subscribe() devolve AsyncIterable que entrega o buffer inteiro (filtrado por
 *     `lastEventId`) E DEPOIS bloqueia até o próximo evento live.
 *   - A iteração termina APENAS com: close() do job, AbortSignal, ou iterator.return().
 *   - Se o job já estava fechado no momento do subscribe, o iterator entrega o
 *     buffer (incluindo o evento terminal) e em seguida devolve done.
 *
 * Estes testes NÃO tocam em rede, DB ou no agentLoop real — operam apenas no
 * `ProgressStream` (infraestrutura de streaming). O agentLoop tem teste separado.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    ProgressStream,
    getProgressStream,
    __resetProgressStreamForTesting,
    type ProgressEvent,
} from '../../agent/progressStream';

describe('#1574 — ProgressStream (núcleo de streaming SSE)', () => {
    let stream: ProgressStream;

    beforeEach(() => {
        // Cada teste usa uma instância nova (evita interferência entre suites).
        // autoCleanupIntervalMs: 0 desliga o timer interno — a purga de TTL é exercida
        // deterministicamente via cleanup(now) manual nos testes de TTL abaixo.
        stream = new ProgressStream({ ttlMs: 60_000, maxBufferSize: 100, autoCleanupIntervalMs: 0 });
    });

    afterEach(() => {
        stream.stopAutoCleanup();
    });

    describe('emit + getBuffer', () => {
        it('emite evento com id monotônico (seq 1, 2, 3...) por job', () => {
            const a = stream.emit('job-A', 'thinking', { phase: 'start' });
            const b = stream.emit('job-A', 'tool_call', { name: 'foo', args: {} });
            const c = stream.emit('job-A', 'done', { result: 'fim' });

            expect(a.seq).toBe(1);
            expect(b.seq).toBe(2);
            expect(c.seq).toBe(3);

            expect(a.id).toBe('job-A:1');
            expect(b.id).toBe('job-A:2');
            expect(c.id).toBe('job-A:3');

            expect(a.type).toBe('thinking');
            expect(b.type).toBe('tool_call');
            expect(c.type).toBe('done');
            expect(a.ts).toBeTypeOf('number');
        });

        it('seq é monotônico POR JOB (não global) — job-B começa em 1 mesmo após job-A', () => {
            stream.emit('job-A', 'thinking', { phase: 'start' });
            stream.emit('job-A', 'thinking', { phase: 'iteration' });
            const b1 = stream.emit('job-B', 'thinking', { phase: 'start' });
            expect(b1.seq).toBe(1);
            expect(b1.id).toBe('job-B:1');
        });

        it('getBuffer devolve snapshot na ordem em que foram emitidos', () => {
            stream.emit('job-X', 'thinking', { phase: 'start' });
            stream.emit('job-X', 'tool_call', { name: 't1', args: { q: 1 } });
            stream.emit('job-X', 'tool_result', { name: 't1', summary: 'ok' });
            stream.emit('job-X', 'done', { result: 'final' });

            const buf = stream.getBuffer('job-X');
            expect(buf.map((e) => e.type)).toEqual([
                'thinking',
                'tool_call',
                'tool_result',
                'done',
            ]);
            expect(buf.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
        });

        it('getBuffer devolve [] para jobId inexistente (não joga)', () => {
            expect(stream.getBuffer('fantasma')).toEqual([]);
        });

        it('buffer respeita maxBufferSize (FIFO sobre N)', () => {
            const small = new ProgressStream({ ttlMs: 60_000, maxBufferSize: 3 });
            small.emit('job', 'thinking', { n: 1 });
            small.emit('job', 'thinking', { n: 2 });
            small.emit('job', 'thinking', { n: 3 });
            small.emit('job', 'thinking', { n: 4 });
            small.emit('job', 'thinking', { n: 5 });

            const buf = small.getBuffer('job');
            expect(buf.map((e) => e.seq)).toEqual([3, 4, 5]);
            expect(buf.map((e) => (e.payload as any).n)).toEqual([3, 4, 5]);
        });

        it('emit em job já fechado é no-op (não duplica eventos terminais)', () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.close('job', 'done', { result: 'x' });
            const beforeLen = stream.getBuffer('job').length;
            const ghost = stream.emit('job', 'thinking', { phase: 'after-close' });
            // Não persiste, não incrementa seq — devolve evento fantasma (seq=0).
            expect(ghost.seq).toBe(0);
            expect(stream.getBuffer('job').length).toBe(beforeLen);
        });

        it('timestamps são monotônicos crescentes (ou iguais) por job', async () => {
            const e1 = stream.emit('job', 'thinking', { phase: 'start' });
            await new Promise((r) => setTimeout(r, 2));
            const e2 = stream.emit('job', 'tool_call', { name: 't', args: {} });
            expect(e2.ts).toBeGreaterThanOrEqual(e1.ts);
        });
    });

    describe('close / cancel', () => {
        it('close() emite o evento terminal e fecha o job (idempotente)', () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.close('job', 'done', { result: 'fim' });
            expect(stream.isClosed('job')).toBe(true);
            const buf = stream.getBuffer('job');
            expect(buf[buf.length - 1].type).toBe('done');

            // Segunda chamada não duplica o terminal.
            stream.close('job', 'done', { result: 'fim-2' });
            const buf2 = stream.getBuffer('job');
            expect(buf2.filter((e) => e.type === 'done')).toHaveLength(1);
        });

        it('cancel() emite "cancelled" com reason', () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.cancel('job', 'user-disconnect');
            const buf = stream.getBuffer('job');
            const last = buf[buf.length - 1];
            expect(last.type).toBe('cancelled');
            expect((last.payload as any).reason).toBe('user-disconnect');
            expect(stream.isClosed('job')).toBe(true);
        });

        it('close() em job inexistente é no-op (não joga)', () => {
            expect(() => stream.close('fantasma', 'done')).not.toThrow();
        });
    });

    describe('subscribe (AsyncIterable)', () => {
        it('subscribe(jobId) em job VAZIO e FECHADO: iterator entrega o terminal e done', async () => {
            stream.close('job', 'done', { result: 'x' });
            const collected: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job')) {
                collected.push(ev);
            }
            expect(collected).toHaveLength(1);
            expect(collected[0].type).toBe('done');
        });

        it('subscribe(jobId) entrega histórico (drain) na ordem em que foram emitidos', async () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.emit('job', 'tool_call', { name: 'foo', args: {} });
            stream.emit('job', 'tool_result', { name: 'foo', summary: 'r' });
            stream.close('job', 'done'); // fecha o job para encerrar a iteração

            const collected: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job')) collected.push(ev);

            expect(collected.map((e) => e.type)).toEqual([
                'thinking',
                'tool_call',
                'tool_result',
                'done',
            ]);
        });

        it('subscribe(jobId) recebe eventos LIVE (emit após subscribe) em ordem', async () => {
            const collected: ProgressEvent[] = [];
            const consumer = (async () => {
                for await (const ev of stream.subscribe('job')) collected.push(ev);
            })();

            // Aguarda o subscribe registrar o listener.
            await new Promise((r) => setTimeout(r, 5));
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.emit('job', 'tool_call', { name: 't', args: {} });
            stream.close('job', 'done', { result: 'fim' });

            await consumer;
            expect(collected.map((e) => e.type)).toEqual([
                'thinking',
                'tool_call',
                'done',
            ]);
        });

        it('subscribe(lastEventId) pula eventos com seq <= lastSeq (retomada)', async () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.emit('job', 'tool_call', { name: 'foo', args: {} });
            stream.emit('job', 'tool_result', { name: 'foo', summary: 'r' });
            stream.close('job', 'done');

            // Retoma do evento 3 (já viu até seq=2).
            const collected: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job', { lastEventId: 'job:2' })) {
                collected.push(ev);
            }
            expect(collected.map((e) => e.seq)).toEqual([3, 4]);
        });

        it('subscribe(lastEventId) aceita só o número (sem prefixo do jobId)', async () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.emit('job', 'tool_call', { name: 'foo', args: {} });
            stream.emit('job', 'tool_result', { name: 'foo', summary: 'r' });
            stream.close('job', 'done');

            const collected: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job', { lastEventId: 1 })) {
                collected.push(ev);
            }
            expect(collected.map((e) => e.seq)).toEqual([2, 3, 4]);
        });

        it('subscribe(lastEventId) inválido cai pra 0 (entrega desde o início)', async () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.emit('job', 'tool_call', { name: 'foo', args: {} });
            stream.close('job', 'done');

            const collected: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job', { lastEventId: 'lixo' })) {
                collected.push(ev);
            }
            expect(collected.map((e) => e.seq)).toEqual([1, 2, 3]);
        });

        it('AbortSignal cancela a iteração sem fechar o job (buffer permanece p/ outros subscribers)', async () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.emit('job', 'tool_call', { name: 'foo', args: {} });

            const ac = new AbortController();
            const collected: ProgressEvent[] = [];
            const consumer = (async () => {
                try {
                    for await (const ev of stream.subscribe('job', { signal: ac.signal })) {
                        collected.push(ev);
                        if (collected.length === 2) ac.abort('test-stop');
                    }
                } catch {
                    // abort joga na próxima next() — esperamos isso aqui
                }
            })();

            await consumer;
            // Coletou o histórico (2 eventos), depois abortou.
            expect(collected).toHaveLength(2);

            // O job NÃO está fechado (AbortSignal só cancela a iteração).
            expect(stream.isClosed('job')).toBe(false);

            // Outro subscribe ainda recebe tudo (buffer intacto, sem AbortSignal).
            stream.close('job', 'done', { result: 'fim' });
            const collected2: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job')) collected2.push(ev);
            expect(collected2.map((e) => e.seq)).toEqual([1, 2, 3]);
        });

        it('subscribe em jobId inexistente: iterator bloqueia até evento chegar (sem erro)', async () => {
            // Sem close prévio, o iterator espera eventos live.
            const collected: ProgressEvent[] = [];
            const consumer = (async () => {
                for await (const ev of stream.subscribe('nunca-existe')) collected.push(ev);
            })();

            await new Promise((r) => setTimeout(r, 5));
            // Confirma que está esperando (não terminou ainda).
            expect(collected).toHaveLength(0);

            // Agora emite + fecha — desbloqueia a iteração.
            stream.emit('nunca-existe', 'thinking', { phase: 'start' });
            stream.close('nunca-existe', 'done');

            await consumer;
            expect(collected.map((e) => e.type)).toEqual(['thinking', 'done']);
        });

        it('fan-out: dois subscribers recebem os mesmos eventos live', async () => {
            const a: ProgressEvent[] = [];
            const b: ProgressEvent[] = [];
            const ca = (async () => {
                for await (const ev of stream.subscribe('job')) a.push(ev);
            })();
            const cb = (async () => {
                for await (const ev of stream.subscribe('job')) b.push(ev);
            })();
            await new Promise((r) => setTimeout(r, 5));
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.emit('job', 'tool_call', { name: 't', args: {} });
            stream.close('job', 'done', { result: 'fim' });

            await Promise.all([ca, cb]);
            expect(a.map((e) => e.type)).toEqual(['thinking', 'tool_call', 'done']);
            expect(b.map((e) => e.type)).toEqual(['thinking', 'tool_call', 'done']);
        });

        it('iterator.return() encerra a iteração sem fechar o job', async () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            const collected: ProgressEvent[] = [];
            const it = stream.subscribe('job')[Symbol.asyncIterator]();
            const r1 = await it.next();
            collected.push(r1.value!);
            // Return encerra a iteração.
            const r2 = await it.return?.();
            expect(r2?.done).toBe(true);
            expect(collected).toHaveLength(1);

            // Job NÃO está fechado.
            expect(stream.isClosed('job')).toBe(false);

            // Outro subscribe pode continuar de onde parou.
            stream.close('job', 'done');
            const collected2: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job')) collected2.push(ev);
            expect(collected2.map((e) => e.seq)).toEqual([1, 2]);
        });
    });

    describe('cleanup (TTL)', () => {
        it('cleanup() remove jobs com expireAt <= now', () => {
            const shortTtl = new ProgressStream({ ttlMs: 10 });
            shortTtl.emit('job-A', 'thinking', { phase: 'start' });
            shortTtl.emit('job-B', 'thinking', { phase: 'start' });

            // Sem tempo decorreu — nada expira.
            expect(shortTtl.cleanup(Date.now())).toBe(0);

            // Avança o relógio além do TTL — ambos expiram.
            const purged = shortTtl.cleanup(Date.now() + 100);
            expect(purged).toBe(2);
            expect(shortTtl.size()).toBe(0);
        });

        it('emit renova o TTL (atividade recente não expira)', () => {
            const ttl = new ProgressStream({ ttlMs: 1000 });
            ttl.emit('job', 'thinking', { phase: 'start' });
            // Avança 500ms — ainda dentro do TTL.
            const purged = ttl.cleanup(Date.now() + 500);
            expect(purged).toBe(0);
            expect(ttl.size()).toBe(1);

            // Renova via novo emit.
            ttl.emit('job', 'tool_call', { name: 't', args: {} });

            // Agora +1500ms (sem renovar) expira.
            const purged2 = ttl.cleanup(Date.now() + 1500);
            expect(purged2).toBe(1);
        });
    });

    describe('auto-cleanup timer (setInterval interno)', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('varre jobs expirados automaticamente (sem cleanup() manual)', () => {
            vi.useFakeTimers();
            const s = new ProgressStream({ ttlMs: 10, autoCleanupIntervalMs: 50 });
            s.emit('job', 'thinking', { phase: 'start' });
            expect(s.size()).toBe(1);

            // Avança além do TTL E além do intervalo de varredura — o timer purga sozinho,
            // sem nenhuma chamada manual a cleanup().
            vi.advanceTimersByTime(120);
            expect(s.size()).toBe(0);
            s.stopAutoCleanup();
        });

        it('autoCleanupIntervalMs: 0 desliga o timer (nada é purgado sozinho)', () => {
            vi.useFakeTimers();
            const s = new ProgressStream({ ttlMs: 10, autoCleanupIntervalMs: 0 });
            s.emit('job', 'thinking', { phase: 'start' });
            vi.advanceTimersByTime(1000);
            // Sem timer, o job expirado permanece até um cleanup() manual.
            expect(s.size()).toBe(1);
            expect(s.cleanup(Date.now() + 100)).toBe(1);
            s.stopAutoCleanup();
        });

        it('stopAutoCleanup() interrompe a varredura e é idempotente', () => {
            vi.useFakeTimers();
            const s = new ProgressStream({ ttlMs: 10, autoCleanupIntervalMs: 50 });
            s.emit('job', 'thinking', { phase: 'start' });
            s.stopAutoCleanup();
            vi.advanceTimersByTime(200);
            // Timer parado → job expirado NÃO foi purgado automaticamente.
            expect(s.size()).toBe(1);
            expect(() => s.stopAutoCleanup()).not.toThrow();
        });
    });

    describe('dispose', () => {
        it('dispose() remove o job do Map (sem fechar via close)', () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.dispose('job');
            expect(stream.has('job')).toBe(false);
            expect(stream.size()).toBe(0);
        });

        it('dispose() é idempotente', () => {
            stream.emit('job', 'thinking', { phase: 'start' });
            stream.dispose('job');
            expect(() => stream.dispose('job')).not.toThrow();
        });
    });

    describe('validação do construtor', () => {
        it('rejeita ttlMs <= 0', () => {
            expect(() => new ProgressStream({ ttlMs: 0 })).toThrow(/ttlMs/);
            expect(() => new ProgressStream({ ttlMs: -1 })).toThrow(/ttlMs/);
        });
        it('rejeita maxBufferSize <= 0', () => {
            expect(() => new ProgressStream({ maxBufferSize: 0 })).toThrow(/maxBufferSize/);
            expect(() => new ProgressStream({ maxBufferSize: -10 })).toThrow(/maxBufferSize/);
        });
        it('rejeita maxListeners <= 0', () => {
            expect(() => new ProgressStream({ maxListeners: 0 })).toThrow(/maxListeners/);
            expect(() => new ProgressStream({ maxListeners: -1 })).toThrow(/maxListeners/);
        });
        it('rejeita autoCleanupIntervalMs negativo (0 é permitido = desligado)', () => {
            expect(() => new ProgressStream({ autoCleanupIntervalMs: -1 })).toThrow(/autoCleanupIntervalMs/);
            // 0 é válido (desliga o timer) — não deve jogar.
            const s = new ProgressStream({ autoCleanupIntervalMs: 0 });
            expect(s.size()).toBe(0);
            s.stopAutoCleanup();
        });
    });

    describe('singleton de getProgressStream', () => {
        it('devolve a mesma instância entre chamadas', () => {
            __resetProgressStreamForTesting();
            const a = getProgressStream();
            const b = getProgressStream();
            expect(a).toBe(b);
            __resetProgressStreamForTesting();
        });
    });
});
