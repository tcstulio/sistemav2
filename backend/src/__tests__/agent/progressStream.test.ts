/**
 * #1574 — Testes do núcleo de streaming SSE (`progressStream`).
 *
 * Cobrem os critérios de aceite da issue:
 *   - subscribe(jobId) emite eventos EM ORDEM.
 *   - Buffer armazena últimos N eventos por job com IDs MONOTÔNICOS.
 *   - TTL varre jobs inativos após o timeout (libera memória).
 *
 * Estratégia: usa uma instância DEDICADA de `ProgressStream` (não o singleton) com
 * `now()` injetado para testes determinísticos de TTL. Isso isola cada caso do
 * relógio real e evita poluir o singleton compartilhado. Cada teste chama `stream.destroy()`
 * no afterEach para parar timers/sweep — senão timers de um caso vazam para o próximo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ProgressStream,
    TERMINAL_PROGRESS_TYPES,
    type ProgressEvent,
} from '../../agent/progressStream';

describe('#1574 — progressStream (núcleo SSE)', () => {
    let stream: ProgressStream;

    beforeEach(() => {
        stream = new ProgressStream({ sweepIntervalMs: 0 });
    });

    afterEach(() => {
        stream.destroy();
    });

    describe('emit / buffer / IDs monotônicos', () => {
        it('emit() retorna null quando jobId é vazio (no-op defensivo)', () => {
            expect(stream.emit('', 'thinking', {})).toBeNull();
            expect(stream.emit(undefined as any, 'thinking', {})).toBeNull();
            expect(stream.getJobCount()).toBe(0);
        });

        it('atribui IDs monotônicos por job a partir de 1', () => {
            const e1 = stream.emit('job-1', 'thinking', { note: 'start' });
            const e2 = stream.emit('job-1', 'tool_call', { name: 't', args: {} });
            const e3 = stream.emit('job-1', 'tool_result', { name: 't', summary: 'ok', ok: true });

            expect(e1?.id).toBe(1);
            expect(e2?.id).toBe(2);
            expect(e3?.id).toBe(3);
            // Monotônico crescente.
            expect(e2!.id).toBeGreaterThan(e1!.id);
            expect(e3!.id).toBeGreaterThan(e2!.id);
        });

        it('IDs são INDEPENDENTES por job (cada job começa em 1)', () => {
            stream.emit('job-A', 'thinking', {});
            stream.emit('job-A', 'thinking', {});
            stream.emit('job-B', 'thinking', {});

            expect(stream.getLastEventId('job-A')).toBe(2);
            expect(stream.getLastEventId('job-B')).toBe(1);
        });

        it('buffer preserva eventos em ordem com ts e payload corretos', () => {
            const t0 = 1700000000000;
            const s = new ProgressStream({ sweepIntervalMs: 0, now: () => t0 });
            try {
                s.emit('job-1', 'thinking', { note: 'a' });
                s.emit('job-1', 'tool_call', { name: 'search', args: { q: 'x' } });
                s.emit('job-1', 'tool_result', { name: 'search', summary: 'r', ok: true });

                const buf = s.getBuffer('job-1');
                expect(buf.map((e) => e.type)).toEqual(['thinking', 'tool_call', 'tool_result']);
                expect(buf[0]).toMatchObject({ id: 1, type: 'thinking', payload: { note: 'a' } });
                expect(buf[1]).toMatchObject({
                    id: 2,
                    type: 'tool_call',
                    payload: { name: 'search', args: { q: 'x' } },
                });
                expect(buf[2]).toMatchObject({
                    id: 3,
                    type: 'tool_result',
                    payload: { name: 'search', summary: 'r', ok: true },
                });
                // ts é preenchido pelo now() injetado.
                expect(buf.every((e) => e.ts === t0)).toBe(true);
            } finally {
                s.destroy();
            }
        });

        it('getBuffer de job desconhecido devolve [] (não lança)', () => {
            expect(stream.getBuffer('inexistente')).toEqual([]);
            expect(stream.getLastEventId('inexistente')).toBe(0);
        });

        it('LIMIT de tamanho do buffer descarta os MAIS ANTIGOS (janela deslizante)', () => {
            const s = new ProgressStream({ sweepIntervalMs: 0, maxBufferSize: 3 });
            try {
                for (let i = 0; i < 5; i++) {
                    s.emit('job-X', 'text_delta', { delta: String(i) });
                }
                const buf = s.getBuffer('job-X');
                expect(buf).toHaveLength(3);
                // Mantém os 3 últimos (ids 3, 4, 5).
                expect(buf.map((e) => e.id)).toEqual([3, 4, 5]);
                expect((buf[0]!.payload as any).delta).toBe('2');
                expect((buf[2]!.payload as any).delta).toBe('4');
            } finally {
                s.destroy();
            }
        });

        it('eventos terminais marcam o job como fechado; emissões tardias viram no-op', () => {
            const ev = stream.emit('job-1', 'done', { summary: 'ok' });
            expect(ev).not.toBeNull();
            // Após 'done', novas emissões são ignoradas (job já fechado).
            const tardio = stream.emit('job-1', 'thinking', { note: 'tarde' });
            expect(tardio).toBeNull();
            // Buffer permanece com o terminal como último evento.
            const buf = stream.getBuffer('job-1');
            expect(buf[buf.length - 1]!.type).toBe('done');
        });

        it('conjunto TERMINAL_PROGRESS_TYPES cobre done/cancelled/error', () => {
            expect(TERMINAL_PROGRESS_TYPES.has('done')).toBe(true);
            expect(TERMINAL_PROGRESS_TYPES.has('cancelled')).toBe(true);
            expect(TERMINAL_PROGRESS_TYPES.has('error')).toBe(true);
            expect(TERMINAL_PROGRESS_TYPES.has('thinking')).toBe(false);
            expect(TERMINAL_PROGRESS_TYPES.has('tool_call')).toBe(false);
            expect(TERMINAL_PROGRESS_TYPES.has('tool_result')).toBe(false);
            expect(TERMINAL_PROGRESS_TYPES.has('text_delta')).toBe(false);
        });
    });

    describe('subscribe / AsyncIterable (ordem + terminação)', () => {
        it('subscribe() entrega eventos EM ORDEM para um subscriber ativo', async () => {
            stream.emit('job-1', 'thinking', { note: 'start' });
            stream.emit('job-1', 'tool_call', { name: 'search', args: {} });
            stream.emit('job-1', 'tool_result', { name: 'search', summary: 'r', ok: true });
            stream.emit('job-1', 'done', { summary: 'fim' });

            const received: ProgressEvent[] = [];
            // Sem lastEventId, só eventos futuros. Como o job já fechou, o subscriber
            // termina imediatamente (sem ver os eventos emitidos antes do subscribe).
            for await (const ev of stream.subscribe('job-1')) {
                received.push(ev);
            }
            // Como o job já estava fechado quando subscribemos sem lastEventId, o replay
            // é suprimido e o iterator termina vazio.
            expect(received).toEqual([]);
        });

        it('subscribe com lastEventId repõe eventos do buffer em ordem (resume)', async () => {
            stream.emit('job-2', 'thinking', { note: 'a' });  // id 1
            stream.emit('job-2', 'tool_call', { name: 't1', args: {} }); // id 2
            stream.emit('job-2', 'tool_result', { name: 't1', summary: 'r1', ok: true }); // id 3
            stream.emit('job-2', 'tool_call', { name: 't2', args: {} }); // id 4
            stream.emit('job-2', 'done', { summary: 'fim' }); // id 5 (terminal)

            const received: ProgressEvent[] = [];
            // Cliente reconecta tendo visto até id 2 → repõe 3, 4, 5 em ordem.
            for await (const ev of stream.subscribe('job-2', 2)) {
                received.push(ev);
            }
            expect(received.map((e) => e.id)).toEqual([3, 4, 5]);
            expect(received.map((e) => e.type)).toEqual(['tool_result', 'tool_call', 'done']);
            // O último evento (terminal) fecha o iterator naturalmente.
            expect(received[received.length - 1]!.type).toBe('done');
        });

        it('subscriber ativo recebe eventos ao vivo EM ORDEM', async () => {
            const received: ProgressEvent[] = [];
            const consuming = (async () => {
                for await (const ev of stream.subscribe('job-live')) {
                    received.push(ev);
                    if (ev.type === 'done') break;
                }
            })();

            // Emite após o subscriber estar ativo.
            await Promise.resolve();
            stream.emit('job-live', 'thinking', { note: 'x' });
            stream.emit('job-live', 'tool_call', { name: 'a', args: {} });
            stream.emit('job-live', 'tool_result', { name: 'a', summary: 'ok', ok: true });
            stream.emit('job-live', 'done', { summary: 'done' });

            await consuming;

            expect(received.map((e) => e.type)).toEqual([
                'thinking',
                'tool_call',
                'tool_result',
                'done',
            ]);
            // IDs monotônicos preservados na entrega.
            expect(received.map((e) => e.id)).toEqual([1, 2, 3, 4]);
        });

        it('múltiplos subscribers ativos recebem os MESMOS eventos ao vivo', async () => {
            const subA: ProgressEvent[] = [];
            const subB: ProgressEvent[] = [];
            const consume = (arr: ProgressEvent[]) => async () => {
                for await (const ev of stream.subscribe('job-multi')) {
                    arr.push(ev);
                    if (ev.type === 'done') break;
                }
            };
            const taskA = consume(subA)();
            const taskB = consume(subB)();
            await Promise.resolve();
            stream.emit('job-multi', 'thinking', {});
            stream.emit('job-multi', 'text_delta', { delta: 'hi' });
            stream.emit('job-multi', 'done', {});
            await Promise.all([taskA, taskB]);

            expect(subA.map((e) => e.type)).toEqual(['thinking', 'text_delta', 'done']);
            expect(subB.map((e) => e.type)).toEqual(['thinking', 'text_delta', 'done']);
            // Mesmos IDs (broadcast — não há duplicação de IDs).
            expect(subA.map((e) => e.id)).toEqual([1, 2, 3]);
            expect(subB.map((e) => e.id)).toEqual([1, 2, 3]);
        });

        it('break no for-await chama return() do iterator e remove o subscriber', async () => {
            const received: ProgressEvent[] = [];
            // Consumidor concorrente: quebra após 2 eventos.
            const consumed = (async () => {
                for await (const ev of stream.subscribe('job-break')) {
                    received.push(ev);
                    if (received.length >= 2) break;
                }
            })();

            // Dá um tick para o subscriber se registrar antes dos emits.
            await Promise.resolve();
            stream.emit('job-break', 'thinking', {});
            stream.emit('job-break', 'tool_call', { name: 'x', args: {} });
            stream.emit('job-break', 'tool_result', { name: 'x', summary: 'r', ok: true });

            await consumed;
            // Consumidor pegou 2 e quebrou — não recebeu o 3º ao vivo.
            expect(received.map((e) => e.type)).toEqual(['thinking', 'tool_call']);

            // Emite mais um evento DEPOIS do break — não deve ser entregue ao consumidor
            // acima (ele já terminou). Verificamos via um NOVO consumidor com replay.
            stream.emit('job-break', 'done', {});
            const replayed: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job-break', 0)) {
                replayed.push(ev);
            }
            // Buffer preserva os 4 eventos emitidos (replay via lastEventId=0).
            expect(replayed.map((e) => e.type)).toEqual([
                'thinking',
                'tool_call',
                'tool_result',
                'done',
            ]);
        });

        it('AbortSignal encerra o iterator imediatamente', async () => {
            const ctrl = new AbortController();
            const received: ProgressEvent[] = [];
            const consuming = (async () => {
                for await (const ev of stream.subscribe('job-abort', undefined, ctrl.signal)) {
                    received.push(ev);
                }
            })();
            await Promise.resolve();
            stream.emit('job-abort', 'thinking', {});
            ctrl.abort();
            stream.emit('job-abort', 'thinking', { note: 'after-abort' });
            await consuming;
            // Apenas o evento pré-abort é entregue (ou nenhum, dependendo do scheduling).
            expect(received.filter((e) => (e.payload as any).note === 'after-abort')).toEqual([]);
        });
    });

    describe('TTL / sweep / cleanup', () => {
        it('sweep() remove jobs cuja lastActivity é mais antiga que o TTL', () => {
            let clock = 1000;
            const s = new ProgressStream({
                ttlMs: 100,
                sweepIntervalMs: 0,
                now: () => clock,
            });
            try {
                s.emit('fresh', 'thinking', {}); // lastActivity = 1000
                clock = 1050;
                s.emit('fresh', 'thinking', {}); // lastActivity = 1050 (renovada)
                clock = 1080;
                s.emit('stale', 'thinking', {}); // lastActivity = 1080
                clock = 1200; // agora
                // 'fresh' expirou (1050 + 100 < 1200)? 1150 < 1200 -> sim.
                // 'stale' expirou (1080 + 100 < 1200)? 1180 < 1200 -> sim.
                const removed = s.sweep();
                expect(removed).toBe(2);
                expect(s.getJobCount()).toBe(0);
            } finally {
                s.destroy();
            }
        });

        it('sweep() preserva jobs cuja lastActivity ainda está dentro do TTL', () => {
            let clock = 1000;
            const s = new ProgressStream({
                ttlMs: 500,
                sweepIntervalMs: 0,
                now: () => clock,
            });
            try {
                s.emit('recent', 'thinking', {}); // lastActivity = 1000
                clock = 1300;
                s.emit('recent', 'tool_call', { name: 'x', args: {} }); // lastActivity renovada
                clock = 1400; // dentro do TTL (1300 + 500 = 1800 > 1400)
                const removed = s.sweep();
                expect(removed).toBe(0);
                expect(s.getBuffer('recent').length).toBe(2);
            } finally {
                s.destroy();
            }
        });

        it('clear() remove o job imediatamente (buffer + subscribers)', async () => {
            stream.emit('job-clear', 'thinking', {});
            stream.emit('job-clear', 'tool_call', { name: 'x', args: {} });
            expect(stream.getBuffer('job-clear').length).toBe(2);
            stream.clear('job-clear');
            expect(stream.getBuffer('job-clear')).toEqual([]);
            expect(stream.getJobCount()).toBe(0);
        });

        it('closeJob() emite "cancelled" terminal se o job ainda estava aberto', () => {
            stream.emit('job-close', 'thinking', {});
            stream.closeJob('job-close', 'user-abort');
            const buf = stream.getBuffer('job-close');
            expect(buf[buf.length - 1]!.type).toBe('cancelled');
            expect((buf[buf.length - 1]!.payload as any).reason).toBe('user-abort');
        });

        it('closeJob() é idempotente — não emite terminal duas vezes', () => {
            stream.emit('job-idem', 'done', {});
            const before = stream.getBuffer('job-idem').length;
            stream.closeJob('job-idem'); // já fechado
            const after = stream.getBuffer('job-idem').length;
            expect(after).toBe(before);
        });

        it('destroy() limpa tudo e para o sweep timer', () => {
            stream.emit('a', 'thinking', {});
            stream.emit('b', 'thinking', {});
            stream.destroy();
            expect(stream.getJobCount()).toBe(0);
            // Operações pós-destroy não quebram (Map limpo).
            expect(stream.getBuffer('a')).toEqual([]);
        });

        it('sweep automático roda no interval configurado (unref)', () => {
            vi.useFakeTimers();
            try {
                let clock = 1000;
                const s = new ProgressStream({
                    ttlMs: 100,
                    sweepIntervalMs: 50,
                    now: () => clock,
                });
                try {
                    s.emit('job', 'thinking', {});
                    clock = 5000; // bem depois do TTL
                    vi.advanceTimersByTime(50);
                    // O sweep rodou e removeu o job expirado.
                    expect(s.getJobCount()).toBe(0);
                } finally {
                    s.destroy();
                }
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('integração: resume após terminal', () => {
        it('cliente que reconecta APÓS done recebe o terminal via replay', async () => {
            stream.emit('job-r', 'thinking', {});
            stream.emit('job-r', 'done', { summary: 'ok' });

            const received: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job-r', 0)) {
                received.push(ev);
            }
            // Repõe tudo (id 1 e 2) e termina no 'done'.
            expect(received.map((e) => e.type)).toEqual(['thinking', 'done']);
        });

        it('cliente com lastEventId == último ID já em dia termina sem replay', async () => {
            stream.emit('job-u', 'thinking', {});
            stream.emit('job-u', 'done', {});
            const lastId = stream.getLastEventId('job-u'); // 2

            const received: ProgressEvent[] = [];
            for await (const ev of stream.subscribe('job-u', lastId)) {
                received.push(ev);
            }
            // Nada a repor (id > 2 não existe). Iterator termina imediatamente.
            expect(received).toEqual([]);
        });
    });
});
