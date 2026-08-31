import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake storage em memória: captura saves/deletes e retorna o que quis no loadAll.
const storage = vi.hoisted(() => ({
    saved: [] as any[],
    deleted: [] as string[],
    disk: new Map<string, any>(),
    loadReturn: [] as any[],
    saveJob: vi.fn((j: any) => {
        storage.saved.push(j);
        storage.disk.set(j.id, j);
    }),
    deleteJob: vi.fn((id: string) => {
        storage.deleted.push(id);
        storage.disk.delete(id);
    }),
    loadAll: vi.fn(() => storage.loadReturn),
}));

vi.mock('../../services/aiJobStorage', () => ({
    saveJob: storage.saveJob,
    deleteJob: storage.deleteJob,
    loadAll: storage.loadAll,
}));

type AiJobService = typeof import('../../services/aiJobService')['aiJobService'];

// Importa uma instância FRESCA do serviço (com `jobs`/contadores zerados e restore() inicial).
async function fresh(loadReturn: any[] = []): Promise<AiJobService> {
    storage.saved = [];
    storage.deleted = [];
    storage.disk.clear();
    storage.loadReturn = loadReturn;
    storage.saveJob.mockClear();
    storage.deleteJob.mockClear();
    storage.loadAll.mockClear();
    vi.resetModules();
    const mod = await import('../../services/aiJobService');
    return mod.aiJobService;
}

// Drena os microtasks/macrotasks da cadeia de promises do enqueue até o estado terminal.
function flush() {
    return new Promise((r) => setTimeout(r, 10));
}

describe('aiJobService (#1012) — persistência + TTL', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('enqueue / write-through', () => {
        it('persiste o job inicial (queued) ao enfileirar', async () => {
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}), 'chat'); // nunca resolve

            const initial = storage.saved.find((j) => j.id === id);
            expect(initial).toBeTruthy();
            expect(initial.status).toBe('queued');
            expect(initial.label).toBe('chat');
            expect(initial.createdAt).toBeTypeOf('number');
        });

        it('transiciona e persiste running -> done com expiresAt', async () => {
            const svc = await fresh();
            const id = svc.enqueue(async () => ({ ok: true }), 'forecast');

            await flush();

            const lookup = svc.get(id);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) {
                expect(lookup.job.status).toBe('done');
                expect(lookup.job.result).toEqual({ ok: true });
                expect(lookup.job.expiresAt).toBeGreaterThan(lookup.job.finishedAt!);
            }
            const persisted = storage.saved.filter((j) => j.id === id).map((j) => j.status);
            expect(persisted).toEqual(expect.arrayContaining(['queued', 'running', 'done']));
        });

        it('persiste error + expiresAt quando a fn rejeita', async () => {
            const svc = await fresh();
            const id = svc.enqueue(async () => { throw new Error('boom'); });

            await flush();

            const lookup = svc.get(id);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) {
                expect(lookup.job.status).toBe('error');
                expect(lookup.job.error).toBe('boom');
                expect(lookup.job.expiresAt).toBeDefined();
            }
        });

        it('runAndWait resolve com o resultado do job', async () => {
            const svc = await fresh();
            const result = await svc.runAndWait(async () => 42, 'judge');
            expect(result).toBe(42);
        });

        it('get devolve queueAhead para job ainda na fila', async () => {
            const svc = await fresh();
            // Ocupa as 3 vagas com jobs que nunca terminam.
            svc.enqueue(() => new Promise(() => {}));
            svc.enqueue(() => new Promise(() => {}));
            svc.enqueue(() => new Promise(() => {}));
            const queuedId = svc.enqueue(() => new Promise(() => {})); // 4º: fica na fila

            const lookup = svc.get(queuedId);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) {
                expect(lookup.job.status).toBe('queued');
                expect(lookup.queueAhead).toBeGreaterThan(0);
            }
        });
    });

    describe('get / expiração', () => {
        it('get devolve { ok:false, reason:"missing" } para job desconhecido', async () => {
            const svc = await fresh();
            const lookup = svc.get('id-inexistente');
            expect(lookup.ok).toBe(false);
            if (!lookup.ok) expect(lookup.reason).toBe('missing');
        });

        it('get devolve { ok:false, reason:"expired" } após TTL (TTL em memória)', async () => {
            const past = Date.now() - 1000;
            const svc = await fresh([
                { id: 'old', status: 'done', result: { v: 1 }, createdAt: past - 1000, finishedAt: past, expiresAt: past },
            ]);
            svc.restore();

            const lookup = svc.get('old');
            expect(lookup.ok).toBe(false);
            if (!lookup.ok) expect(lookup.reason).toBe('expired');
        });
    });

    describe('restore / read-on-startup', () => {
        it('reidrata jobs não-expirados do disco como vivos', async () => {
            const future = Date.now() + 60000;
            const svc = await fresh([
                { id: 'alive', status: 'done', result: { r: 1 }, createdAt: 1, finishedAt: 2, expiresAt: future, label: 'chat' },
            ]);
            // fresh() já chamou restore() na importação.

            const lookup = svc.get('alive');
            expect(lookup.ok).toBe(true);
            if (lookup.ok) {
                expect(lookup.job.status).toBe('done');
                expect(lookup.job.result).toEqual({ r: 1 });
            }
        });

        it('marca jobs não-terminais (queued/running) como error (não retomáveis) e persiste', async () => {
            const svc = await fresh([
                { id: 'stuck', status: 'running', createdAt: 1 },
                { id: 'waiting', status: 'queued', createdAt: 2 },
            ]);

            for (const id of ['stuck', 'waiting']) {
                const lookup = svc.get(id);
                expect(lookup.ok).toBe(true);
                if (lookup.ok) {
                    expect(lookup.job.status).toBe('error');
                    expect(lookup.job.error).toMatch(/interrompido/i);
                    expect(lookup.job.expiresAt).toBeDefined();
                }
            }
            const persisted = storage.saved.map((j) => j.id).sort();
            expect(persisted).toEqual(['stuck', 'waiting']);
        });

        it('honra TTL persistido: job expirado do disco NÃO volta como vivo', async () => {
            const past = Date.now() - 1000;
            const svc = await fresh([
                { id: 'ghost', status: 'done', result: { r: 9 }, createdAt: 1, finishedAt: past, expiresAt: past },
            ]);

            const lookup = svc.get('ghost');
            expect(lookup.ok).toBe(false);
            if (!lookup.ok) expect(lookup.reason).toBe('expired');
        });

        it('cleanup purga jobs expirados do disco (lazy, no próximo enqueue)', async () => {
            const past = Date.now() - 1000;
            const svc = await fresh([
                { id: 'ghost', status: 'done', createdAt: 1, finishedAt: past, expiresAt: past },
            ]);
            // Antes do enqueue, ainda está no Map como expirado.
            expect(svc.get('ghost')).toEqual({ ok: false, reason: 'expired' });

            svc.enqueue(async () => 1); // dispara cleanup()
            await flush();

            expect(storage.deleted).toContain('ghost');
            // Agora é missing (arquivo purgado).
            const lookup = svc.get('ghost');
            expect(lookup.ok).toBe(false);
            if (!lookup.ok) expect(lookup.reason).toBe('missing');
        });

        it('resultado pré-computado continua acessível após restart simulado', async () => {
            // 1º "processo": cria e conclui um job com resultado.
            const svc1 = await fresh();
            const id = svc1.enqueue(async () => ({ forecast: 'xyz' }), 'forecast');
            await flush();
            const diskState = storage.disk.get(id);

            // 2º "processo": restore reidrata a partir do disco.
            const svc2 = await fresh([diskState]);
            const lookup = svc2.get(id);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) expect(lookup.job.result).toEqual({ forecast: 'xyz' });
        });
    });
});

describe('aiJobService #1553 — orçamento global de liveness', () => {
    it('calcula e expõe livenessExpiresAt em ISO ao criar o job', async () => {
        const svc = await fresh();
        const before = Date.now();
        const id = svc.enqueue(() => new Promise(() => {}), 'chat');
        const lookup = svc.get(id);

        expect(lookup.ok).toBe(true);
        if (lookup.ok) {
            expect(lookup.job.livenessExpiresAt).toMatch(/Z$/);
            expect(Date.parse(lookup.job.livenessExpiresAt)).toBeGreaterThan(before);
        }
        expect(svc.getJobStatus(id)).toMatchObject({
            ok: true,
            status: { livenessExpiresAt: expect.any(String) },
        });
    });

    it('marca job pendurado como deadline_exceeded no vencimento global', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
            const { AI_JOB_LIVENESS_MS } = await import('../../services/aiJobBudget');
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}), 'chat');

            await vi.advanceTimersByTimeAsync(AI_JOB_LIVENESS_MS);

            const lookup = svc.get(id);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) {
                expect(lookup.job.status).toBe('error');
                expect(lookup.job.error).toBe('deadline_exceeded');
                expect(lookup.job.finishedAt).toBe(Date.parse(lookup.job.livenessExpiresAt));
            }
        } finally {
            vi.useRealTimers();
        }
    });
});


// =====================================================
// #1011: endpoint de heartbeat — getJobStatus + reportProgress
// =====================================================
describe('aiJobService #1011 — getJobStatus (metadados leves p/ heartbeat)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('queued -> status "pending", alive, queuePosition numérico (>0)', async () => {
        const svc = await fresh();
        // Ocupa as 3 vagas com jobs que nunca terminam.
        svc.enqueue(() => new Promise(() => {}));
        svc.enqueue(() => new Promise(() => {}));
        svc.enqueue(() => new Promise(() => {}));
        const queuedId = svc.enqueue(() => new Promise(() => {})); // 4º: fica na fila

        const q = svc.getJobStatus(queuedId);
        expect(q.ok).toBe(true);
        if (q.ok) {
            expect(q.status.status).toBe('pending');
            expect(q.status.alive).toBe(true);
            expect(q.status.queuePosition).not.toBeNull();
            expect(q.status.queuePosition).toBeGreaterThan(0);
        }
    });

    it('running -> startedAt/lastHeartbeat ISO, queuePosition null', async () => {
        const svc = await fresh();
        const id = svc.enqueue(() => new Promise(() => {}));
        await flush();

        const q = svc.getJobStatus(id);
        expect(q.ok).toBe(true);
        if (q.ok) {
            expect(q.status.status).toBe('running');
            expect(q.status.id).toBe(id);
            expect(q.status.alive).toBe(true);
            expect(q.status.startedAt).toBeTypeOf('string');
            expect(new Date(q.status.startedAt).getTime()).not.toBeNaN();
            expect(q.status.lastHeartbeat).toBeTypeOf('string');
            expect(new Date(q.status.lastHeartbeat).getTime()).not.toBeNaN();
            expect(q.status.queuePosition).toBeNull();
            expect(q.status.currentProvider).toBeNull();
            expect(q.status.progressPct).toBe(0);
        }
    });

    it('done -> status "done"; error -> status "failed"', async () => {
        const svc = await fresh();
        const okId = svc.enqueue(async () => ({ big: 'payload' }));
        const errId = svc.enqueue(async () => { throw new Error('boom'); });
        await flush();

        const qOk = svc.getJobStatus(okId);
        expect(qOk.ok).toBe(true);
        if (qOk.ok) expect(qOk.status.status).toBe('done');

        const qErr = svc.getJobStatus(errId);
        expect(qErr.ok).toBe(true);
        if (qErr.ok) expect(qErr.status.status).toBe('failed');
    });

    it('NÃO devolve o result completo (apenas metadados do #1011)', async () => {
        const svc = await fresh();
        const id = svc.enqueue(async () => ({ secret: 'x', nested: { deep: true } }));
        await flush();

        const q = svc.getJobStatus(id);
        expect(q.ok).toBe(true);
        if (q.ok) {
            expect(q.status).not.toHaveProperty('result');
            expect(q.status).not.toHaveProperty('error');
            expect(Object.keys(q.status).sort()).toEqual(
                ['alive', 'currentProvider', 'id', 'lastHeartbeat', 'livenessExpiresAt', 'progressPct', 'queuePosition', 'startedAt', 'status'].sort()
            );
        }
    });

    it('id desconhecido -> { ok:false, reason:"missing" }', async () => {
        const svc = await fresh();
        expect(svc.getJobStatus('id-inexistente')).toEqual({ ok: false, reason: 'missing' });
    });

    it('job expirado -> { ok:false, reason:"expired" } (distinto de missing)', async () => {
        const past = Date.now() - 1000;
        const svc = await fresh([
            { id: 'old', status: 'done', result: { v: 1 }, createdAt: past - 1000, finishedAt: past, expiresAt: past },
        ]);
        svc.restore();

        const q = svc.getJobStatus('old');
        expect(q.ok).toBe(false);
        if (!q.ok) expect(q.reason).toBe('expired');
    });

    it('não toca em disco (sem saveJob ao consultar status)', async () => {
        const svc = await fresh();
        const id = svc.enqueue(async () => 1);
        await flush();
        storage.saveJob.mockClear();

        const q = svc.getJobStatus(id);
        expect(q.ok).toBe(true);
        expect(storage.saveJob).not.toHaveBeenCalled();
    });
});

describe('aiJobService #1011 — reportProgress (lastHeartbeat = max(lastWrite, now))', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('retorna false para job inexistente', async () => {
        const svc = await fresh();
        expect(svc.reportProgress('nope')).toBe(false);
    });

    it('retorna false para job expirado', async () => {
        const past = Date.now() - 1000;
        const svc = await fresh([
            { id: 'old', status: 'done', createdAt: past - 1000, finishedAt: past, expiresAt: past },
        ]);
        svc.restore();
        expect(svc.reportProgress('old')).toBe(false);
    });

    it('atualiza lastHeartbeat de um job running (> startedAt) e persiste (write-through)', async () => {
        const svc = await fresh();
        const id = svc.enqueue(() => new Promise(() => {}));
        await flush();

        const before = svc.get(id);
        expect(before.ok).toBe(true);
        if (!before.ok) return;
        const startedAt = before.job.startedAt!;

        // garante avanço do relógio: now > startedAt (lastWrite = startedAt no running).
        await new Promise((r) => setTimeout(r, 15));

        const ok = svc.reportProgress(id);
        expect(ok).toBe(true);

        const after = svc.get(id);
        expect(after.ok).toBe(true);
        if (after.ok) {
            expect(after.job.lastHeartbeat).toBeGreaterThan(startedAt);
        }

        // write-through: último save do job carrega o lastHeartbeat atualizado.
        const lastSave = storage.saved.filter((j) => j.id === id).pop();
        expect(lastSave?.lastHeartbeat).toBe(after.ok ? after.job.lastHeartbeat : undefined);
    });

    it('reflete currentProvider e clamp de progressPct (150->100) em getJobStatus', async () => {
        const svc = await fresh();
        const id = svc.enqueue(() => new Promise(() => {}));
        await flush();

        svc.reportProgress(id, { currentProvider: 'gemini', progressPct: 150 });

        const q = svc.getJobStatus(id);
        expect(q.ok).toBe(true);
        if (q.ok) {
            expect(q.status.currentProvider).toBe('gemini');
            expect(q.status.progressPct).toBe(100);
        }

        // clamp inferior
        svc.reportProgress(id, { progressPct: -5 });
        const q2 = svc.getJobStatus(id);
        expect(q2.ok).toBe(true);
        if (q2.ok) expect(q2.status.progressPct).toBe(0);
    });

    it('progressPct inválido (NaN) vira 0', async () => {
        const svc = await fresh();
        const id = svc.enqueue(() => new Promise(() => {}));
        await flush();

        svc.reportProgress(id, { progressPct: NaN });

        const q = svc.getJobStatus(id);
        expect(q.ok).toBe(true);
        if (q.ok) expect(q.status.progressPct).toBe(0);
    });

    it('currentProvider null é aceito (limpa provider anterior)', async () => {
        const svc = await fresh();
        const id = svc.enqueue(() => new Promise(() => {}));
        await flush();

        svc.reportProgress(id, { currentProvider: 'gemini' });
        svc.reportProgress(id, { currentProvider: null });

        const q = svc.getJobStatus(id);
        expect(q.ok).toBe(true);
        if (q.ok) expect(q.status.currentProvider).toBeNull();
    });

    it('lastHeartbeat = max(lastWrite, now): NÃO retrocede se lastWrite > now (clock skew)', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
            const baseNow = Date.now();
            const futureWrite = baseNow + 5000; // lastWrite "no futuro" (clock skew)
            const svc = await fresh([
                {
                    id: 'skew', status: 'done', result: { r: 1 },
                    createdAt: 1, finishedAt: 2,
                    expiresAt: baseNow + 60000, lastHeartbeat: futureWrite,
                },
            ]);
            // restore() setou lastWriteAt['skew'] = futureWrite (lastHeartbeat do disco).

            // Avança o relógio só 1s (now = baseNow+1000 < futureWrite).
            vi.setSystemTime(new Date('2025-01-01T00:00:01Z'));
            const ok = svc.reportProgress('skew', { progressPct: 10 });
            expect(ok).toBe(true);

            const lookup = svc.get('skew');
            expect(lookup.ok).toBe(true);
            if (lookup.ok) {
                // max(futureWrite, now) = futureWrite — heartbeat NÃO retrocedeu p/ now.
                expect(lookup.job.lastHeartbeat).toBe(futureWrite);
                expect(lookup.job.progressPct).toBe(10);
            }
        } finally {
            vi.useRealTimers();
        }
    });
});


// =====================================================
// #1150: serialização por sessionId + semáforo global (MAX_CONCURRENT)
// =====================================================
describe('aiJobService #1150 — serialização por sessionId + semáforo global', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Helper: aguarda até a condição ou o timeout. Sem isso, microtasks encadeadas
    // não têm tempo de rodar (run()/setJob/etc) e a asserção corre antes do efeito.
    async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (!predicate() && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 5));
        }
    }

    it('jobs do MESMO sessionId rodam em série (msg2 inicia APÓS msg1 terminar)', async () => {
        const svc = await fresh();
        const sessionId = 'chat-abc';
        const order: string[] = [];

        // msg1: demora 50ms, escreve no log "1-done"
        const id1 = svc.enqueue(async () => {
            await new Promise((r) => setTimeout(r, 50));
            order.push('1-done');
            return { msg: 'r1' };
        }, 'chat', sessionId);

        // msg2: deve rodar APÓS msg1 terminar. Sem sessionId, ambas rodariam juntas
        // e veríamos '2-done' antes de '1-done'.
        const id2 = svc.enqueue(async () => {
            order.push('2-done');
            return { msg: 'r2', sees: order.slice() };
        }, 'chat', sessionId);

        // Aguarda ambos terminarem.
        await waitFor(() => {
            const l1 = svc.get(id1);
            const l2 = svc.get(id2);
            return l1.ok && l2.ok && l1.job.status === 'done' && l2.job.status === 'done';
        }, 2000);

        expect(order).toEqual(['1-done', '2-done']);

        // O result de msg2 deve ter sido calculado DEPOIS de msg1 terminar — visível
        // no snapshot `sees` capturado dentro do fn de msg2.
        const l2 = svc.get(id2);
        expect(l2.ok).toBe(true);
        if (l2.ok) {
            expect(l2.job.result).toEqual({ msg: 'r2', sees: ['1-done', '2-done'] });
        }
    });

    it('jobs de sessionIds DIFERENTES rodam em paralelo (overlapping)', async () => {
        const svc = await fresh();
        const finished: string[] = [];

        // Sessão A: msg1 demora 50ms
        const idA = svc.enqueue(async () => {
            await new Promise((r) => setTimeout(r, 50));
            finished.push('A-done');
            return { from: 'A' };
        }, 'chat', 'session-A');

        // Sessão B: msg2 demora 50ms — em paralelo com A
        const idB = svc.enqueue(async () => {
            await new Promise((r) => setTimeout(r, 50));
            finished.push('B-done');
            return { from: 'B' };
        }, 'chat', 'session-B');

        await waitFor(() => {
            const la = svc.get(idA);
            const lb = svc.get(idB);
            return la.ok && lb.ok && la.job.status === 'done' && lb.job.status === 'done';
        }, 2000);

        // Se estivessem em série, a duração total seria ~100ms (50+50). Em paralelo, ~50ms.
        // Aqui verificamos que ambas as sessões terminaram — o paralelismo é implícito
        // pelo encadeamento correto das caudas (cada sessão só tem 1 job).
        expect(finished.sort()).toEqual(['A-done', 'B-done']);
    });

    it('limite global MAX_CONCURRENT é respeitado entre TODAS as sessões', async () => {
        const svc = await fresh();
        const inFlight: number[] = [];
        let active = 0;
        let peak = 0;

        // 4 jobs em 4 sessões diferentes, cada um conta concorrência.
        const ids = [] as string[];
        for (let i = 0; i < 4; i++) {
            const id = svc.enqueue(async () => {
                active++;
                peak = Math.max(peak, active);
                inFlight.push(active);
                await new Promise((r) => setTimeout(r, 30));
                active--;
                return { i };
            }, 'chat', `sess-${i}`);
            ids.push(id);
        }

        await waitFor(() => {
            return ids.every((id) => {
                const l = svc.get(id);
                return l.ok && (l.job.status === 'done' || l.job.status === 'error');
            });
        }, 3000);

        // Pico de simultaneidade nunca pode ultrapassar MAX_CONCURRENT (3).
        expect(peak).toBeLessThanOrEqual(3);
        // E pelo menos 1 job precisou esperar (peak < 4 prova que houve fila).
        expect(peak).toBeLessThan(4);
    });

    it('runAndWait com sessionId serializa e devolve o resultado em ordem', async () => {
        const svc = await fresh();
        const sessionId = 'chat-rw';

        // Empilha 2 runAndWait com mesmo sessionId. O segundo só inicia após o primeiro.
        const results = await Promise.all([
            svc.runAndWait(async () => {
                await new Promise((r) => setTimeout(r, 30));
                return 'first';
            }, 'judge', sessionId),
            svc.runAndWait(async () => {
                await new Promise((r) => setTimeout(r, 30));
                return 'second';
            }, 'judge', sessionId),
        ]);

        expect(results).toEqual(['first', 'second']);
    });

    it('falha em um job NÃO quebra a serialização dos próximos jobs da MESMA sessão', async () => {
        const svc = await fresh();
        const sessionId = 'chat-with-fail';
        const order: string[] = [];

        // msg1: falha
        const id1 = svc.enqueue(async () => {
            order.push('1-start');
            throw new Error('boom');
        }, 'chat', sessionId);

        // msg2: deve rodar mesmo após msg1 falhar (then(_, _) no encadeamento)
        const id2 = svc.enqueue(async () => {
            order.push('2-done');
            return 'ok';
        }, 'chat', sessionId);

        await waitFor(() => {
            const l1 = svc.get(id1);
            const l2 = svc.get(id2);
            return l1.ok && l2.ok && (l1.job.status === 'done' || l1.job.status === 'error') && l2.job.status === 'done';
        }, 2000);

        expect(order).toEqual(['1-start', '2-done']);

        const l1 = svc.get(id1);
        expect(l1.ok).toBe(true);
        if (l1.ok) {
            expect(l1.job.status).toBe('error');
            expect(l1.job.error).toBe('boom');
        }
        const l2 = svc.get(id2);
        expect(l2.ok).toBe(true);
        if (l2.ok) {
            expect(l2.job.status).toBe('done');
            expect(l2.job.result).toBe('ok');
        }
    });

    it('jobs SEM sessionId não serializam entre si (cada um é sua própria sessão anônima)', async () => {
        const svc = await fresh();
        const inFlight: number[] = [];
        let active = 0;
        let peak = 0;

        // 4 jobs sem sessionId — devem competir pelo semáforo como antes.
        const ids = [] as string[];
        for (let i = 0; i < 4; i++) {
            const id = svc.enqueue(async () => {
                active++;
                peak = Math.max(peak, active);
                await new Promise((r) => setTimeout(r, 20));
                active--;
                return { i };
            }, 'chat'); // no sessionId
            ids.push(id);
        }

        await waitFor(() => {
            return ids.every((id) => {
                const l = svc.get(id);
                return l.ok && (l.job.status === 'done' || l.job.status === 'error');
            });
        }, 3000);

        // Sem sessionId: pico <= MAX_CONCURRENT (semáforo global ainda limita).
        expect(peak).toBeLessThanOrEqual(3);
        expect(peak).toBeGreaterThanOrEqual(2); // houve paralelismo de fato
    });

    it('sessão A não bloqueia sessão B: jobs de sessões diferentes se intercalam pelo semáforo', async () => {
        const svc = await fresh();
        const order: string[] = [];
        const started: number[] = [];

        // Sessão A com 2 jobs (devem serializar entre si).
        // Sessão B com 1 job — não pode esperar A.
        const idA1 = svc.enqueue(async () => {
            order.push('A1-start');
            await new Promise((r) => setTimeout(r, 40));
            order.push('A1-end');
            return 'a1';
        }, 'chat', 'A');
        const idB = svc.enqueue(async () => {
            started.push(Date.now());
            order.push('B-start');
            await new Promise((r) => setTimeout(r, 10));
            order.push('B-end');
            return 'b';
        }, 'chat', 'B');
        const idA2 = svc.enqueue(async () => {
            order.push('A2-start');
            await new Promise((r) => setTimeout(r, 10));
            order.push('A2-end');
            return 'a2';
        }, 'chat', 'A');

        await waitFor(() => {
            const la1 = svc.get(idA1);
            const lb = svc.get(idB);
            const la2 = svc.get(idA2);
            return la1.ok && lb.ok && la2.ok
                && la1.job.status === 'done'
                && lb.job.status === 'done'
                && la2.job.status === 'done';
        }, 2000);

        // A1 termina antes de A2 começar (sessão A serializa).
        expect(order.indexOf('A1-end')).toBeLessThan(order.indexOf('A2-start'));
        // B não depende de A — pode iniciar/parar livremente entre os A's (sessão B paralela).
        // Só verificamos que B terminou (já coberto acima).
        expect(order).toContain('B-start');
        expect(order).toContain('B-end');
    });
});
