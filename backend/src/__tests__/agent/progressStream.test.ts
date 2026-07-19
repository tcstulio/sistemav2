/**
 * #1574 — Testes do core de streaming (`agent/progressStream.ts`).
 *
 * Cobre os critérios de aceite da issue:
 *   - subscribe(jobId) emite eventos em ordem;
 *   - buffer armazena últimos N eventos por job com IDs monotônicos;
 *   - TTL remove jobs inativos; job com subscriber ativo é preservado;
 *   - retomada via lastEventId (Last-Event-ID) replay apenas o posterior;
 *   - evento terminal fecha o iterator após entrega;
 *   - múltiplos subscribers recebem os mesmos eventos;
 *   - backpressure de slow consumer (descarta mais antigos).
 */
import { describe, it, expect, vi } from 'vitest';

import { ProgressStream } from '../../agent/progressStream';

const text = (e: { payload: unknown }): string => (e.payload as { text: string }).text;

describe('#1574 — ProgressStream core', () => {
    it('subscribe(jobId) entrega eventos em ordem com IDs monotônicos', async () => {
        const stream = new ProgressStream();
        const iter = stream.subscribe('order')[Symbol.asyncIterator]();
        stream.emit('order', 'thinking', { text: 'a' });
        stream.emit('order', 'thinking', { text: 'b' });
        stream.emit('order', 'thinking', { text: 'c' });

        const e1 = await iter.next();
        const e2 = await iter.next();
        const e3 = await iter.next();

        expect(e1.value.id).toBe(1);
        expect(e2.value.id).toBe(2);
        expect(e3.value.id).toBe(3);
        expect(text(e1.value)).toBe('a');
        expect(text(e2.value)).toBe('b');
        expect(text(e3.value)).toBe('c');

        await iter.return?.();
        stream.close();
    });

    it('buffer armazena apenas os últimos N eventos (IDs monotônicos preservados)', () => {
        const stream = new ProgressStream({ maxBufferSize: 3 });
        for (let i = 0; i < 5; i++) stream.emit('cap', 'thinking', { text: `e${i}` });

        const events = stream.getEvents('cap');
        // IDs 1..5 foram emitidos; o buffer mantém só os 3 mais recentes (3,4,5).
        expect(events.map((e) => e.id)).toEqual([3, 4, 5]);
        expect(events.map((e) => text(e))).toEqual(['e2', 'e3', 'e4']);
        stream.close();
    });

    it('resume via lastEventId replay apenas eventos com id > lastEventId', async () => {
        const stream = new ProgressStream();
        stream.emit('resume', 'thinking', { text: 'a' }); // id 1
        stream.emit('resume', 'thinking', { text: 'b' }); // id 2
        stream.emit('resume', 'thinking', { text: 'c' }); // id 3

        const iter = stream.subscribe('resume', 1)[Symbol.asyncIterator]();
        const e1 = await iter.next();
        const e2 = await iter.next();
        expect(e1.value.id).toBe(2);
        expect(e2.value.id).toBe(3);
        expect(text(e1.value)).toBe('b');
        expect(text(e2.value)).toBe('c');
        await iter.return?.();
        stream.close();
    });

    it('evento terminal (done) fecha o iterator APÓS entregar o terminal', async () => {
        const stream = new ProgressStream();
        const collected: string[] = [];
        const consume = async (): Promise<void> => {
            for await (const ev of stream.subscribe('term')) {
                collected.push(ev.type);
            }
        };
        const done = consume();
        stream.emit('term', 'thinking', { text: 'x' });
        stream.emit('term', 'done', { text: 'fim' });
        await done;
        expect(collected).toEqual(['thinking', 'done']);
        stream.close();
    });

    it('evento terminal (error) também fecha o iterator', async () => {
        const stream = new ProgressStream();
        const collected: string[] = [];
        const consume = async (): Promise<void> => {
            for await (const ev of stream.subscribe('term-err')) {
                collected.push(ev.type);
            }
        };
        const done = consume();
        stream.emit('term-err', 'error', { message: 'boom' });
        await done;
        expect(collected).toEqual(['error']);
        stream.close();
    });

    it('subscriber novo de job já terminado recebe o replay do terminal e fecha', async () => {
        const stream = new ProgressStream();
        stream.emit('finished', 'thinking', { text: 'a' });
        stream.emit('finished', 'done', {});

        const collected: string[] = [];
        for await (const ev of stream.subscribe('finished')) {
            collected.push(ev.type);
        }
        expect(collected).toEqual(['thinking', 'done']);
        stream.close();
    });

    it('múltiplos subscribers recebem os mesmos eventos ao vivo', async () => {
        const stream = new ProgressStream();
        const i1 = stream.subscribe('multi')[Symbol.asyncIterator]();
        const i2 = stream.subscribe('multi')[Symbol.asyncIterator]();
        stream.emit('multi', 'thinking', { text: 'hi' });

        const [a, b] = await Promise.all([i1.next(), i2.next()]);
        expect(text(a.value)).toBe('hi');
        expect(text(b.value)).toBe('hi');
        expect(stream.subscriberCount('multi')).toBe(2);
        await i1.return?.();
        await i2.return?.();
        stream.close();
    });

    it('slow consumer: fila do subscriber descarta os eventos mais antigos', async () => {
        const stream = new ProgressStream({ maxSubscriberQueue: 2 });
        const iter = stream.subscribe('slow')[Symbol.asyncIterator]();
        for (let i = 0; i < 5; i++) stream.emit('slow', 'thinking', { text: `n${i}` });

        const e1 = await iter.next();
        const e2 = await iter.next();
        // Cap=2 → só os 2 mais recentes (n3, n4) sobrevivem na fila.
        expect(text(e1.value)).toBe('n3');
        expect(text(e2.value)).toBe('n4');
        await iter.return?.();
        stream.close();
    });

    it('dispose(jobId) remove o job do store', () => {
        const stream = new ProgressStream();
        stream.emit('d', 'thinking', { text: 'a' });
        expect(stream.getEvents('d').length).toBe(1);
        stream.dispose('d');
        expect(stream.getEvents('d').length).toBe(0);
        expect(stream.lastEventIsTerminal('d')).toBe(false);
        stream.close();
    });

    it('lastEventIsTerminal reflete o último evento bufferizado', () => {
        const stream = new ProgressStream();
        stream.emit('t', 'thinking', { text: 'a' });
        expect(stream.lastEventIsTerminal('t')).toBe(false);
        stream.emit('t', 'cancelled', { reason: 'x' });
        expect(stream.lastEventIsTerminal('t')).toBe(true);
        stream.close();
    });

    it('GC remove jobs inativos após TTL (sem subscribers ativos)', async () => {
        vi.useFakeTimers();
        try {
            const stream = new ProgressStream({ ttlMs: 1000, gcIntervalMs: 100 });
            stream.emit('g1', 'thinking', { text: 'a' });
            stream.emit('g2', 'thinking', { text: 'b' });
            expect(stream.getEvents('g1').length).toBe(1);

            // Avança passado TTL + pelo menos 1 ciclo de GC.
            await vi.advanceTimersByTimeAsync(1500);

            expect(stream.getEvents('g1').length).toBe(0);
            expect(stream.getEvents('g2').length).toBe(0);
            stream.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it('GC preserva job com subscriber ativo mesmo após TTL', async () => {
        vi.useFakeTimers();
        try {
            const stream = new ProgressStream({ ttlMs: 100, gcIntervalMs: 50 });
            const iter = stream.subscribe('active')[Symbol.asyncIterator]();
            stream.emit('active', 'thinking', { text: 'a' });

            // Muito além do TTL — mas há subscriber ativo: não coleta.
            await vi.advanceTimersByTimeAsync(500);
            expect(stream.getEvents('active').length).toBe(1);
            expect(stream.subscriberCount('active')).toBe(1);

            // Liberou o subscriber → próximo ciclo de GC pode coletar.
            await iter.return?.();
            await vi.advanceTimersByTimeAsync(300);
            expect(stream.getEvents('active').length).toBe(0);
            stream.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it('close() para o GC e torna emit() no-op', () => {
        const stream = new ProgressStream();
        stream.emit('c', 'thinking', { text: 'a' });
        expect(stream.getEvents('c').length).toBe(1);
        stream.close();
        const ev = stream.emit('c', 'thinking', { text: 'b' });
        // Após close(), emit não bufferiza (id -1 sinaliza descarte).
        expect(ev.id).toBe(-1);
        expect(stream.getEvents('c').length).toBe(0);
    });
});
