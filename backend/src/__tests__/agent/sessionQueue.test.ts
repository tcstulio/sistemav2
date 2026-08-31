/**
 * #1371 — Testes unitários do `SessionQueue`.
 *
 * Cobre os 6 critérios de aceite da issue:
 *   1. 3 jobs na mesma `sessao_id` rodam em série (não paralelo).
 *   2. Jobs em sessões diferentes rodam em paralelo.
 *   3. Transição de status correta: queued → running → done | error | cancelled.
 *   4. `cancel()` interrompe job em andamento SEM afetar jobs já na fila.
 *   5. Sem memory leak: Map limpa sessões ociosas após TTL configurável.
 *   6. EventEmitter interno emite `job:start`, `job:done`, `job:error`.
 *
 * Estratégia: todos os testes determinísticos — executor via stub com `vi.fn`,
 * relógio injetável (`now` no `cleanupIdleSessions`), `autoCleanupIntervalMs: 0`
 * para não pendurar timer entre testes. Cada `describe` cria um queue novo no
 * `beforeEach` (via `resetSessionQueue()`) para isolamento.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    SessionQueue,
    getSessionQueue,
    resetSessionQueue,
    type JobExecutor,
} from '../../agent/sessionQueue';

// === Helpers ===

/** Executor que resolve depois de `delayMs` com `payload` como resultado. */
function delayedExecutor(delayMs: number = 30): JobExecutor {
    return (_payload, signal) =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(_payload), delayMs);
            signal.addEventListener(
                'abort',
                () => {
                    clearTimeout(timer);
                    reject(new Error('aborted'));
                },
                { once: true },
            );
        });
}

/** Executor que respeita o AbortSignal e lança erro ao ser abortado. */
function abortableExecutor(payload: unknown, signal: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error('aborted'));
            return;
        }
        const timer = setTimeout(() => resolve(payload), 1000);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
            },
            { once: true },
        );
    });
}

/** Espera X ms — usado em testes que dependem do event loop avançar. */
function tick(ms: number = 10): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('#1371 SessionQueue', () => {
    afterEach(() => {
        resetSessionQueue();
    });

    describe('singleton', () => {
        it('getSessionQueue retorna a mesma instância', () => {
            expect(getSessionQueue()).toBe(getSessionQueue());
        });

        it('resetSessionQueue descarta o singleton e cria nova instância zerada', () => {
            const a = getSessionQueue();
            a.enqueue('s1', 'p', delayedExecutor());
            expect(a.size()).toBe(1);
            resetSessionQueue();
            const b = getSessionQueue();
            expect(b).not.toBe(a);
            expect(b.size()).toBe(0);
        });
    });

    describe('critério 1: jobs na MESMA sessao_id rodam em série', () => {
        it('3 jobs enfileirados em s1 executam um por vez (FIFO) — não paralelo', async () => {
            const queue = new SessionQueue({
                autoCleanupIntervalMs: 0,
                idFactory: (() => {
                    let i = 0;
                    return () => `job-${++i}`;
                })(),
            });
            const startOrder: number[] = [];
            const endOrder: number[] = [];
            const trackExecutor: JobExecutor = (payload, signal) => {
                const n = (payload as { n: number }).n;
                startOrder.push(n);
                return new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        endOrder.push(n);
                        resolve(n);
                    }, 30);
                    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
                });
            };

            const id1 = queue.enqueue('s1', { n: 1 }, trackExecutor);
            const id2 = queue.enqueue('s1', { n: 2 }, trackExecutor);
            const id3 = queue.enqueue('s1', { n: 3 }, trackExecutor);

            // Todos enfileirados: primeiro vira running imediatamente, demais ficam queued.
            expect(queue.getStatus('s1', id1)).toBe('running');
            expect(queue.getStatus('s1', id2)).toBe('queued');
            expect(queue.getStatus('s1', id3)).toBe('queued');

            await queue.waitForJob('s1', id1);
            await queue.waitForJob('s1', id2);
            await queue.waitForJob('s1', id3);

            // Nunca houve sobreposição: starts e ends caem em ordem FIFO.
            expect(startOrder).toEqual([1, 2, 3]);
            expect(endOrder).toEqual([1, 2, 3]);

            // Status terminal de todos.
            expect(queue.getStatus('s1', id1)).toBe('done');
            expect(queue.getStatus('s1', id2)).toBe('done');
            expect(queue.getStatus('s1', id3)).toBe('done');
        });

        it('jobs em série: a sobreposição nunca excede 1 (count de "running" simultâneos)', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            let concurrentRunning = 0;
            let peakConcurrent = 0;
            const exec: JobExecutor = async (_payload, signal) => {
                concurrentRunning++;
                if (concurrentRunning > peakConcurrent) peakConcurrent = concurrentRunning;
                await new Promise<void>((resolve) => {
                    const t = setTimeout(resolve, 20);
                    signal.addEventListener('abort', () => {
                        clearTimeout(t);
                        resolve();
                    }, { once: true });
                });
                concurrentRunning--;
            };

            const ids = [];
            for (let i = 0; i < 5; i++) {
                ids.push(queue.enqueue('s1', i, exec));
            }
            await Promise.all(ids.map((id) => queue.waitForJob('s1', id)));

            expect(peakConcurrent).toBe(1);
        });
    });

    describe('critério 2: jobs em sessões DIFERENTES rodam em paralelo', () => {
        it('sessaoA e sessaoB têm workers independentes — rodam em paralelo', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const activeInA: number[] = [];
            const activeInB: number[] = [];

            const execA: JobExecutor = async (payload, signal) => {
                const n = (payload as { n: number }).n;
                activeInA.push(n);
                await new Promise<void>((resolve) => {
                    const t = setTimeout(resolve, 50);
                    signal.addEventListener('abort', () => {
                        clearTimeout(t);
                        resolve();
                    }, { once: true });
                });
                return n;
            };
            const execB: JobExecutor = async (payload, signal) => {
                const n = (payload as { n: number }).n;
                activeInB.push(n);
                await new Promise<void>((resolve) => {
                    const t = setTimeout(resolve, 50);
                    signal.addEventListener('abort', () => {
                        clearTimeout(t);
                        resolve();
                    }, { once: true });
                });
                return n;
            };

            const idsA = [queue.enqueue('sessaoA', { n: 1 }, execA), queue.enqueue('sessaoA', { n: 2 }, execA)];
            const idsB = [queue.enqueue('sessaoB', { n: 1 }, execB), queue.enqueue('sessaoB', { n: 2 }, execB)];

            // Em paralelo, ambos os primeiros jobs rodam simultaneamente.
            await tick(20);
            expect(activeInA).toEqual([1]);
            expect(activeInB).toEqual([1]);

            await Promise.all([
                ...idsA.map((id) => queue.waitForJob('sessaoA', id)),
                ...idsB.map((id) => queue.waitForJob('sessaoB', id)),
            ]);

            // Total de 4 starts: 2 em cada sessão, mas em paralelo entre sessões.
            expect(activeInA).toEqual([1, 2]);
            expect(activeInB).toEqual([1, 2]);
        });

        it('cancel em sessão A não afeta fila de sessão B', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const idA = queue.enqueue('sessaoA', 'a', abortableExecutor);
            const idA2 = queue.enqueue('sessaoA', 'a2', delayedExecutor(20));
            const idB = queue.enqueue('sessaoB', 'b', delayedExecutor(20));

            // Cancela o job em andamento em sessaoA.
            queue.cancel('sessaoA', idA);
            await queue.waitForJob('sessaoA', idA);
            await queue.waitForJob('sessaoA', idA2);
            await queue.waitForJob('sessaoB', idB);

            expect(queue.getStatus('sessaoA', idA)).toBe('cancelled');
            expect(queue.getStatus('sessaoA', idA2)).toBe('done');
            expect(queue.getStatus('sessaoB', idB)).toBe('done');
        });
    });

    describe('critério 3: transições de status (queued → running → done | error | cancelled)', () => {
        it('caminho feliz: novo job vai queued → running → done', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const events: string[] = [];
            queue.on('job:start', () => events.push('start'));
            queue.on('job:done', () => events.push('done'));
            queue.on('job:error', () => events.push('error'));

            const id = queue.enqueue('s1', 'p', async (_payload, signal) => {
                await new Promise<void>((resolve) => {
                    const t = setTimeout(resolve, 10);
                    signal.addEventListener('abort', () => {
                        clearTimeout(t);
                        resolve();
                    }, { once: true });
                });
                return 'ok';
            });
            // Enfileirado com worker livre → entra direto em running.
            expect(queue.getStatus('s1', id)).toBe('running');

            await queue.waitForJob('s1', id);
            expect(queue.getStatus('s1', id)).toBe('done');
            expect(events).toEqual(['start', 'done']);
        });

        it('caminho de erro: executor lança → status vira error', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const errorEvents: Array<{ status?: string }> = [];
            queue.on('job:error', (e) => errorEvents.push({ status: e.status }));

            const id = queue.enqueue('s1', 'p', async () => {
                throw new Error('boom');
            });
            await queue.waitForJob('s1', id);

            expect(queue.getStatus('s1', id)).toBe('error');
            expect(errorEvents).toHaveLength(1);
            expect(errorEvents[0]!.status).toBe('error');
        });

        it('caminho de cancelamento: executor respeita signal → status vira cancelled', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const statusSeen: string[] = [];
            queue.on('job:start', () => statusSeen.push('start'));
            queue.on('job:done', () => statusSeen.push('done'));
            queue.on('job:error', (e) => statusSeen.push(`error:${e.status ?? 'unknown'}`));

            const id = queue.enqueue('s1', 'p', abortableExecutor);
            queue.cancel('s1', id);
            await queue.waitForJob('s1', id);

            expect(queue.getStatus('s1', id)).toBe('cancelled');
            expect(statusSeen).toEqual(['start', 'error:cancelled']);
        });

        it('getStatus retorna null para sessão ou job desconhecido', () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            expect(queue.getStatus('nope', 'any')).toBeNull();
            queue.enqueue('s1', 'p', delayedExecutor());
            expect(queue.getStatus('s1', 'wrong-id')).toBeNull();
        });
    });

    describe('critério 4: cancel() interrompe job em andamento sem afetar jobs já na fila', () => {
        it('cancel do job em running termina com cancelled; queued jobs permanecem e rodam depois', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const id1 = queue.enqueue('s1', 'first', abortableExecutor);
            const id2 = queue.enqueue('s1', 'second', delayedExecutor(20));
            const id3 = queue.enqueue('s1', 'third', delayedExecutor(20));

            expect(queue.getStatus('s1', id1)).toBe('running');
            expect(queue.getStatus('s1', id2)).toBe('queued');
            expect(queue.getStatus('s1', id3)).toBe('queued');

            // Cancela apenas o job em running.
            expect(queue.cancel('s1', id1)).toBe(true);

            // Após cancel, queued e runner devem ser preservados.
            expect(queue.getStatus('s1', id2)).toBe('queued');
            expect(queue.getStatus('s1', id3)).toBe('queued');

            await queue.waitForJob('s1', id1);
            await queue.waitForJob('s1', id2);
            await queue.waitForJob('s1', id3);

            expect(queue.getStatus('s1', id1)).toBe('cancelled');
            expect(queue.getStatus('s1', id2)).toBe('done');
            expect(queue.getStatus('s1', id3)).toBe('done');
        });

        it('cancel de um job QUEUED remove-o IMEDIATAMENTE e NÃO afeta o job em running', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const idRunning = queue.enqueue('s1', 'running', abortableExecutor);
            const idQueued = queue.enqueue('s1', 'queued', delayedExecutor(20));

            // Cancela o queued.
            expect(queue.cancel('s1', idQueued)).toBe(true);
            await queue.waitForJob('s1', idQueued);

            // O queued vai direto para cancelled.
            expect(queue.getStatus('s1', idQueued)).toBe('cancelled');
            // O running continua intacto.
            expect(queue.getStatus('s1', idRunning)).toBe('running');

            // Finaliza o running normalmente.
            queue.cancel('s1', idRunning);
            await queue.waitForJob('s1', idRunning);
            expect(queue.getStatus('s1', idRunning)).toBe('cancelled');
        });

        it('cancel de job inexistente retorna false (no-op)', () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            queue.enqueue('s1', 'p', delayedExecutor());
            expect(queue.cancel('s1', 'wrong-id')).toBe(false);
            expect(queue.cancel('inexistente', 'qualquer')).toBe(false);
        });

        it('cancel é idempotente — chamar 2x não quebra o estado', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const id = queue.enqueue('s1', 'p', abortableExecutor);
            expect(queue.cancel('s1', id)).toBe(true);
            // Segundo cancel: ainda encontra o job (running) e é no-op no signal.
            expect(queue.cancel('s1', id)).toBe(true);
            await queue.waitForJob('s1', id);
            expect(queue.getStatus('s1', id)).toBe('cancelled');
        });

        it('executor recebe o AbortSignal e pode ouvir `abort` para cooperar', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const abortHandler = vi.fn();
            const id = queue.enqueue('s1', 'p', (_payload, signal) => {
                return new Promise((resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        abortHandler();
                        reject(new Error('aborted-cooperatively'));
                    });
                });
            });

            await tick(5);
            queue.cancel('s1', id);
            await queue.waitForJob('s1', id);

            expect(abortHandler).toHaveBeenCalledTimes(1);
            expect(queue.getStatus('s1', id)).toBe('cancelled');
        });
    });

    describe('critério 5: TTL — sem memory leak, sessões ociosas são purgadas', () => {
        it('cleanupIdleSessions remove sessões ociosas após TTL e mantém as ativas', async () => {
            const queue = new SessionQueue({
                autoCleanupIntervalMs: 0,
                ttlMs: 1000,
            });
            // Sessão com job já finalizado e idle.
            const idS1 = queue.enqueue('s1', { p: 1 }, delayedExecutor(5));
            // Sessão com job em andamento.
            const idS2 = queue.enqueue('s2', { p: 2 }, abortableExecutor);

            await queue.waitForJob('s1', idS1);
            // s1 deve estar no map ainda (TTL não estourou).
            expect(queue.size()).toBe(2);

            // TTL estourado: s1 deve ser purgada, s2 (com job running) NÃO.
            const purged = queue.cleanupIdleSessions(Date.now() + 2000);
            expect(purged).toBe(1);
            expect(queue.size()).toBe(1);
            expect(queue.describeSession('s1')).toBeNull();
            expect(queue.describeSession('s2')).not.toBeNull();

            // Limpa s2 com o jobId REAL — antes passava uma string inválida,
            // deixando o `abortableExecutor` (1000ms) pendurado até o afterEach.
            queue.cancel('s2', idS2);
            await queue.waitForJob('s2', idS2);
            expect(queue.getStatus('s2', idS2)).toBe('cancelled');
        });

        it('cleanupIdleSessions NÃO purga sessão com job em fila (queued)', () => {
            const queue = new SessionQueue({
                autoCleanupIntervalMs: 0,
                ttlMs: 100,
            });
            const id1 = queue.enqueue('s1', 'a', abortableExecutor);
            const id2 = queue.enqueue('s1', 'b', delayedExecutor(20));

            // Agora + 500ms → TTL estourado, mas s1 ainda tem queued.
            const purged = queue.cleanupIdleSessions(Date.now() + 500);
            expect(purged).toBe(0);
            expect(queue.size()).toBe(1);

            // Limpa antes de acabar o teste.
            queue.cancel('s1', id1);
            queue.cancel('s1', id2);
        });

        it('cleanupIdleSessions NÃO purga sessão com job em running', () => {
            const queue = new SessionQueue({
                autoCleanupIntervalMs: 0,
                ttlMs: 100,
            });
            queue.enqueue('s1', 'p', abortableExecutor); // long-running

            const purged = queue.cleanupIdleSessions(Date.now() + 500);
            expect(purged).toBe(0);
            expect(queue.size()).toBe(1);
        });

        it('sessão reativada por enqueue reseta o lastActivityAt', async () => {
            const queue = new SessionQueue({
                autoCleanupIntervalMs: 0,
                ttlMs: 1000,
            });
            // Sessão termina em t=0.
            const id = queue.enqueue('s1', 'p', delayedExecutor(5));
            await queue.waitForJob('s1', id);
            // Em t=500, ainda dentro do TTL.
            expect(queue.cleanupIdleSessions(Date.now() + 500)).toBe(0);
            // Em t=1100, fora do TTL — purga.
            expect(queue.cleanupIdleSessions(Date.now() + 1100)).toBe(1);
        });

        it('cleanupIdleSessions resolve waitForIdle pendentes (sem leak de promises)', async () => {
            const queue = new SessionQueue({
                autoCleanupIntervalMs: 0,
                ttlMs: 100,
            });
            const id = queue.enqueue('s1', 'p', delayedExecutor(5));
            await queue.waitForJob('s1', id);
            // Sessão ociosa. Aguarda uma promise de `waitForIdle` que normalmente
            // só resolveria quando a sessão esvaziasse — mas ela já está vazia.
            const idlePromise = queue.waitForIdle('s1');
            // Avança o relógio além do TTL e dispara cleanup.
            const purged = queue.cleanupIdleSessions(Date.now() + 500);
            expect(purged).toBe(1);
            // A promise tem que resolver em vez de pendurar para sempre —
            // este await é o que detecta o leak que existia antes da correção.
            await Promise.race([
                idlePromise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('waitForIdle pendurou após cleanup')), 100),
                ),
            ]);
            expect(queue.size()).toBe(0);
        });

        it('validação fail-fast: ttlMs <= 0 lança erro no construtor', () => {
            expect(() => new SessionQueue({ ttlMs: 0 })).toThrow(/ttlMs/);
            expect(() => new SessionQueue({ ttlMs: -1 })).toThrow(/ttlMs/);
        });

        it('validação fail-fast: maxQueueSize <= 0 lança erro no construtor', () => {
            expect(() => new SessionQueue({ maxQueueSize: 0 })).toThrow(/maxQueueSize/);
            expect(() => new SessionQueue({ maxQueueSize: -5 })).toThrow(/maxQueueSize/);
        });
    });

    describe('critério 6: EventEmitter emite job:start, job:done, job:error', () => {
        it('emite job:start ao passar de queued para running', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const starts: Array<{ sessao_id: string; jobId: string }> = [];
            queue.on('job:start', (e) => starts.push({ sessao_id: e.sessao_id, jobId: e.jobId }));

            const id1 = queue.enqueue('s1', 'p', abortableExecutor);
            await tick(5);
            const id2 = queue.enqueue('s1', 'p2', delayedExecutor(10));

            // O segundo job precisa esperar o primeiro terminar antes de virar running.
            await queue.waitForJob('s1', id1);
            await queue.waitForJob('s1', id2);

            expect(starts).toHaveLength(2);
            expect(starts[0]!.jobId).toBe(id1);
            expect(starts[1]!.jobId).toBe(id2);
        });

        it('emite job:done quando job termina com sucesso, com result e status', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const dones: Array<{ result?: unknown; status?: string }> = [];
            queue.on('job:done', (e) => {
                dones.push({ result: e.result, status: e.status });
            });

            const id = queue.enqueue('s1', { saida: 42 }, async (payload) => payload);
            await queue.waitForJob('s1', id);

            expect(dones).toHaveLength(1);
            expect(dones[0]!.status).toBe('done');
            expect(dones[0]!.result).toEqual({ saida: 42 });
        });

        it('emite job:error com status=error quando executor lança', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const errors: Array<{ status?: string; error?: unknown }> = [];
            queue.on('job:error', (e) => {
                errors.push({ status: e.status, error: e.error });
            });

            const id = queue.enqueue('s1', 'p', async () => {
                throw new Error('boom');
            });
            await queue.waitForJob('s1', id);

            expect(errors).toHaveLength(1);
            expect(errors[0]!.status).toBe('error');
            expect((errors[0]!.error as Error).message).toBe('boom');
        });

        it('emite job:error com status=cancelled quando job em running é cancelado', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const errors: Array<{ status?: string }> = [];
            queue.on('job:error', (e) => {
                errors.push({ status: e.status });
            });

            const id = queue.enqueue('s1', 'p', abortableExecutor);
            queue.cancel('s1', id);
            await queue.waitForJob('s1', id);

            expect(errors).toHaveLength(1);
            expect(errors[0]!.status).toBe('cancelled');
        });

        it('emite job:error com status=cancelled quando job QUEUED é cancelado', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const errors: Array<{ status?: string }> = [];
            queue.on('job:error', (e) => {
                errors.push({ status: e.status });
            });

            const id1 = queue.enqueue('s1', 'p', abortableExecutor);
            const id2 = queue.enqueue('s1', 'q', delayedExecutor(20));

            // Cancela o queued (não o running).
            queue.cancel('s1', id2);
            await queue.waitForJob('s1', id2);

            expect(errors).toHaveLength(1);
            expect(errors[0]!.status).toBe('cancelled');

            // Não deixa o teste pendurar.
            queue.cancel('s1', id1);
        });

        it('off() remove o listener (sem novos eventos)', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const handler = vi.fn();
            queue.on('job:done', handler);
            queue.off('job:done', handler);

            const id = queue.enqueue('s1', 'p', async (p) => p);
            await queue.waitForJob('s1', id);

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('extras / robustez', () => {
        it('enqueue sem executor e sem defaultExecutor lança erro', () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            expect(() => queue.enqueue('s1', 'p')).toThrow(/executor/);
        });

        it('executor passado por enqueue sobrescreve o defaultExecutor', async () => {
            const defaultExec: JobExecutor = async () => 'default';
            const customExec: JobExecutor = async () => 'custom';
            const queue = new SessionQueue({
                autoCleanupIntervalMs: 0,
                defaultExecutor: defaultExec,
            });
            const id = queue.enqueue('s1', 'p', customExec);
            await queue.waitForJob('s1', id);
            const job = queue.getJob('s1', id);
            expect(job?.result).toBe('custom');
        });

        it('waitForJob resolve imediatamente para job já terminado', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const id = queue.enqueue('s1', 'p', async (p) => p);
            await queue.waitForJob('s1', id);
            const status = await queue.waitForJob('s1', id);
            expect(status).toBe('done');
        });

        it('waitForJob resolve null para job desconhecido (não bloqueia)', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const status = await queue.waitForJob('s1', 'inexistente');
            expect(status).toBeNull();
        });

        it('waitForIdle resolve quando a sessão fica vazia', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            queue.enqueue('s1', 'a', delayedExecutor(20));
            queue.enqueue('s1', 'b', delayedExecutor(20));

            let resolved = false;
            const idle = queue.waitForIdle('s1').then(() => {
                resolved = true;
            });
            await tick(5);
            expect(resolved).toBe(false);
            await idle;
            expect(resolved).toBe(true);
        });

        it('enqueue lança se a fila ultrapassar maxQueueSize', () => {
            const queue = new SessionQueue({
                autoCleanupIntervalMs: 0,
                maxQueueSize: 2,
            });
            queue.enqueue('s1', 'a', abortableExecutor); // running
            queue.enqueue('s1', 'b', delayedExecutor(20)); // queued (1)
            queue.enqueue('s1', 'c', delayedExecutor(20)); // queued (2)
            expect(() => queue.enqueue('s1', 'd', delayedExecutor(20))).toThrow(/fila cheia/);
        });

        it('sessao_id vazio ou não-string em enqueue lança', () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            expect(() => queue.enqueue('', 'p', delayedExecutor())).toThrow(/sessao_id/);
            // @ts-expect-error — teste defensivo: rejeita não-string.
            expect(() => queue.enqueue(undefined, 'p', delayedExecutor())).toThrow(/sessao_id/);
        });

        it('getJob devolve snapshot com timestamps corretos', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const id = queue.enqueue('s1', { x: 1 }, async (_p) => {
                await tick(20);
                return { out: 'ok' };
            });
            const before = queue.getJob('s1', id);
            expect(before).not.toBeNull();
            expect(before?.status).toBe('running');
            expect(before?.startedAt).not.toBeNull();
            expect(before?.finishedAt).toBeNull();

            await queue.waitForJob('s1', id);
            const after = queue.getJob('s1', id);
            expect(after?.status).toBe('done');
            expect(after?.finishedAt).not.toBeNull();
            expect(after?.result).toEqual({ out: 'ok' });
        });

        it('stopAutoCleanup é idempotente', () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 50 });
            queue.stopAutoCleanup();
            queue.stopAutoCleanup(); // não deve lançar
        });

        it('reset() descarta tudo e aborta jobs em andamento', async () => {
            const queue = new SessionQueue({ autoCleanupIntervalMs: 0 });
            const id = queue.enqueue('s1', 'p', abortableExecutor);
            queue.enqueue('s1', 'q', delayedExecutor(50));
            expect(queue.size()).toBe(1);

            queue.reset();
            expect(queue.size()).toBe(0);

            // Após o reset, a sessão não existe mais — getStatus null.
            expect(queue.getStatus('s1', id)).toBeNull();
        });
    });
});
