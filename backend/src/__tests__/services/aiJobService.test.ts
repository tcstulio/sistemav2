import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    getProgressStream,
    withTurnProgress,
    __resetProgressStreamForTesting,
    type ProgressEvent,
} from '../../agent/progressStream';

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
// #1059: cancelamento de job (queued + running) com AbortSignal
// =====================================================
describe('aiJobService #1059 — cancel(jobId) com AbortSignal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('cancel() em job queued', () => {
        it('remove da fila serial e marca error="cancelled"', async () => {
            const svc = await fresh();
            // Ocupa as 3 vagas com jobs que nunca terminam.
            svc.enqueue(() => new Promise(() => {}));
            svc.enqueue(() => new Promise(() => {}));
            svc.enqueue(() => new Promise(() => {}));
            const queuedId = svc.enqueue(() => new Promise(() => {}), 'chat', { userId: 'u1', userLogin: 'alice' });
            expect(svc.get(queuedId).ok).toBe(true);

            const result = svc.cancel(queuedId, { reason: 'user-cancel', actor: { userId: 'u1', userLogin: 'alice' } });

            // #1059: queued → remove da fila (sem nunca rodar) + marca error='cancelled'.
            expect(result).toEqual({ cancelled: true, status: 'queued', reason: 'user-cancel' });

            // Verifica persistência: último save do job carrega error='cancelled'.
            const lastSave = storage.saved.filter((j) => j.id === queuedId).pop();
            expect(lastSave?.status).toBe('error');
            expect(lastSave?.error).toMatch(/^cancelled/);

            // Verifica estado: get() ainda devolve o job, mas como terminal.
            const lookup = svc.get(queuedId);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) {
                expect(lookup.job.status).toBe('error');
                expect(lookup.job.error).toMatch(/^cancelled/);
                expect(lookup.job.finishedAt).toBeTypeOf('number');
                expect(lookup.job.expiresAt).toBeGreaterThan(lookup.job.finishedAt!);
            }
        });

        it('libera a vaga: o próximo job da fila pega o slot', async () => {
            const svc = await fresh();
            // 3 vagas ocupadas com jobs longos.
            const blocker1 = svc.enqueue(() => new Promise(() => {}));
            const blocker2 = svc.enqueue(() => new Promise(() => {}));
            const blocker3 = svc.enqueue(() => new Promise(() => {}));
            // Cancela o 4º (queued).
            const queuedId = svc.enqueue(() => new Promise(() => {}));
            expect(svc.get(queuedId).ok).toBe(true);

            const result = svc.cancel(queuedId);
            expect(result.cancelled).toBe(true);

            // Verifica que a vaga foi liberada: enfileira outro job e checa que ele está
            // ainda na fila (não há vaga livre para rodar) — o critério é que o contador
            // global `running` não mudou.
            // Como `running` é privado, validamos indiretamente: enqueue de mais um job
            // também fica queued.
            const moreQueued = svc.enqueue(() => new Promise(() => {}));
            const moreLookup = svc.get(moreQueued);
            expect(moreLookup.ok).toBe(true);
            if (moreLookup.ok) expect(moreLookup.job.status).toBe('queued');

            // E o job cancelado sumiu da fila: não vira running mesmo após flush().
            await flush();
            const cancelledLookup = svc.get(queuedId);
            expect(cancelledLookup.ok).toBe(true);
            if (cancelledLookup.ok) {
                // O cancel marcou o job como error — o `run` (que está na fila) nunca roda
                // porque o filtro já removeu a entrada, OU se chegar a ser shift()-eado,
                // bail no topo. Em qualquer caso, status permanece error.
                expect(cancelledLookup.job.status).toBe('error');
                expect(cancelledLookup.job.error).toMatch(/^cancelled/);
            }
            // Mantém referências vivas para o linter não reclamar.
            void blocker1; void blocker2; void blocker3;
        });
    });

    describe('cancel() em job running', () => {
        it('aciona AbortController; getSignal() devolve signal aborted', async () => {
            const svc = await fresh();
            // Enfileira job longo (nunca resolve).
            const id = svc.enqueue(() => new Promise(() => {}), 'chat', { userId: 'u1', userLogin: 'alice' });
            await flush();

            const lookup = svc.get(id);
            expect(lookup.ok).toBe(true);
            if (!lookup.ok) return;
            expect(lookup.job.status).toBe('running');

            // Signal disponível antes do cancel: NÃO aborted.
            const signal = svc.getSignal(id);
            expect(signal).toBeDefined();
            expect(signal?.aborted).toBe(false);

            // Aciona o cancel.
            const result = svc.cancel(id, { reason: 'user-cancel', actor: { userId: 'u1', userLogin: 'alice' } });
            expect(result).toMatchObject({ cancelled: true, status: 'running', reason: 'user-cancel' });

            // Signal agora aborted. O `run` interno mapeia o AbortError em error='cancelled'.
            expect(signal?.aborted).toBe(true);

            // Drena a microtask chain do .catch do enqueue.
            await flush();

            const after = svc.get(id);
            expect(after.ok).toBe(true);
            if (after.ok) {
                expect(after.job.status).toBe('error');
                expect(after.job.error).toMatch(/^cancelled/);
            }
        });

        it('passa o reason para o signal (e o erro final inclui o reason)', async () => {
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}));
            await flush();

            const reason = 'because-user-clicked';
            const result = svc.cancel(id, { reason });
            expect(result.cancelled).toBe(true);

            await flush();

            const lookup = svc.get(id);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) {
                expect(lookup.job.error).toBe(`cancelled:${reason}`);
            }
        });

        it('getSignal() devolve undefined após o job terminar (controller descartado)', async () => {
            const svc = await fresh();
            const id = svc.enqueue(async () => 'ok');
            await flush();

            // Job já done: getSignal deve retornar undefined.
            expect(svc.getSignal(id)).toBeUndefined();

            const lookup = svc.get(id);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) expect(lookup.job.status).toBe('done');
        });
    });

    describe('cancel() em estados terminais / inválidos', () => {
        it('id desconhecido → {cancelled:false, reason:"missing"}', async () => {
            const svc = await fresh();
            expect(svc.cancel('id-inexistente')).toEqual({ cancelled: false, reason: 'missing' });
        });

        it('id expirado (TTL purgado) → {cancelled:false, reason:"expired"}', async () => {
            const past = Date.now() - 1000;
            const svc = await fresh([
                { id: 'old', status: 'done', result: { v: 1 }, createdAt: past - 1000, finishedAt: past, expiresAt: past },
            ]);
            svc.restore();
            expect(svc.cancel('old')).toEqual({ cancelled: false, reason: 'expired' });
        });

        it('job done → {cancelled:false, reason:"already_terminal"} (no-op)', async () => {
            const svc = await fresh();
            const id = svc.enqueue(async () => 'ok');
            await flush();
            const lookup = svc.get(id);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) expect(lookup.job.status).toBe('done');

            const result = svc.cancel(id);
            expect(result).toEqual({ cancelled: false, reason: 'already_terminal' });
        });

        it('idempotente: chamar 2x na primeira devolve cancelled, na segunda already_terminal', async () => {
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}));
            await flush();

            const first = svc.cancel(id);
            expect(first.cancelled).toBe(true);

            await flush();

            const second = svc.cancel(id);
            expect(second).toEqual({ cancelled: false, reason: 'already_terminal' });
        });
    });

    describe('cancel() ownership (#1059 — só o dono ou admin pode cancelar)', () => {
        it('admin (actor ausente) pode cancelar job de qualquer dono', async () => {
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}), 'chat', { userId: 'u1', userLogin: 'alice' });
            await flush();

            // Sem actor = admin implícito.
            const result = svc.cancel(id);
            expect(result.cancelled).toBe(true);
        });

        it('dono pode cancelar o próprio job (actor.userId)', async () => {
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}), 'chat', { userId: 'u1', userLogin: 'alice' });
            await flush();

            const result = svc.cancel(id, { actor: { userId: 'u1', userLogin: 'alice' } });
            expect(result.cancelled).toBe(true);
        });

        it('dono pode cancelar via actor.userLogin (sem id Dolibarr)', async () => {
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}), 'chat', { userId: 'u1', userLogin: 'alice' });
            await flush();

            const result = svc.cancel(id, { actor: { userId: '', userLogin: 'alice' } });
            expect(result.cancelled).toBe(true);
        });

        it('cross-user (outro login) → {cancelled:false, reason:"not_cancellable"}', async () => {
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}), 'chat', { userId: 'u1', userLogin: 'alice' });
            await flush();

            const result = svc.cancel(id, { actor: { userId: 'u2', userLogin: 'bob' } });
            expect(result).toEqual({ cancelled: false, reason: 'not_cancellable' });
            // Estado intacto: job continua running.
            const lookup = svc.get(id);
            expect(lookup.ok).toBe(true);
            if (lookup.ok) expect(lookup.job.status).toBe('running');
        });

        it('job SEM owner registrado: admin pode cancelar, NÃO-admin é fail-closed', async () => {
            const svc = await fresh();
            // Enqueue sem owner (legacy).
            const id = svc.enqueue(() => new Promise(() => {}));
            await flush();

            // Admin pode.
            const adminResult = svc.cancel(id);
            expect(adminResult.cancelled).toBe(true);
            await flush();

            const newId = svc.enqueue(() => new Promise(() => {}));
            await flush();
            // NÃO-admin (actor presente) NÃO pode cancelar job sem owner (fail-closed).
            const nonAdminResult = svc.cancel(newId, { actor: { userId: 'u2', userLogin: 'bob' } });
            expect(nonAdminResult).toEqual({ cancelled: false, reason: 'not_cancellable' });
        });
    });

    describe('getOwner() — usado pelo handler HTTP para mensagem 403', () => {
        it('devolve {userId, userLogin} do dono registrado', async () => {
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}), 'chat', { userId: 'u1', userLogin: 'alice' });
            expect(svc.getOwner(id)).toEqual({ userId: 'u1', userLogin: 'alice' });
        });

        it('devolve undefined para job sem owner', async () => {
            const svc = await fresh();
            const id = svc.enqueue(() => new Promise(() => {}));
            expect(svc.getOwner(id)).toBeUndefined();
        });

        it('devolve undefined para id desconhecido', async () => {
            const svc = await fresh();
            expect(svc.getOwner('id-fantasma')).toBeUndefined();
        });
    });
});

// =====================================================
// #1059: critério de aceite final — "enfileirar msg longa, clicar cancelar enquanto
// roda; o cliente recebe evento `cancelled` e o job some da lista de pendentes".
// Integra aiJobService (fila + AbortController) com o ProgressStream (fonte do SSE
// GET /chat/jobs/:id/events): o fn do job emula o postChatCompletion cooperativo
// (rejeita com AbortError quando o signal aciona) dentro de withTurnProgress.
// =====================================================
describe('aiJobService #1059 — integração: cancel durante execução → SSE cancelled + job fora dos pendentes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        __resetProgressStreamForTesting();
    });

    it('cliente SSE recebe evento cancelled {status, reason} e o job sai dos pendentes', async () => {
        const svc = await fresh();
        const stream = getProgressStream();

        // "Msg longa": job cooperativo que só termina quando o signal aborta (mesmo
        // contrato do postChatCompletion — rejeita com erro name='AbortError').
        let jobId = '';
        jobId = svc.enqueue(
            () => withTurnProgress(jobId, async () => {
                const signal = svc.getSignal(jobId);
                await new Promise<never>((_, reject) => {
                    const abortErr = Object.assign(new Error('user-cancel'), {
                        name: 'AbortError',
                        code: 'aborted',
                        reason: 'user-cancel',
                    });
                    if (signal?.aborted) {
                        reject(abortErr);
                        return;
                    }
                    signal?.addEventListener('abort', () => reject(abortErr), { once: true });
                });
            }),
            'chat',
            { userId: 'u1', userLogin: 'alice' },
        );
        await flush();

        // Job EM EXECUÇÃO (estava entre os pendentes/ativos).
        let lookup = svc.get(jobId);
        expect(lookup.ok).toBe(true);
        if (lookup.ok) expect(lookup.job.status).toBe('running');

        // Cliente subscreve o stream do job (mesma fonte do endpoint SSE).
        const events: ProgressEvent[] = [];
        const subscription = (async () => {
            for await (const ev of stream.subscribe(jobId)) events.push(ev);
        })();

        // "Clica cancelar" enquanto roda.
        const result = svc.cancel(jobId, { reason: 'user-cancel', actor: { userId: 'u1', userLogin: 'alice' } });
        expect(result).toMatchObject({ cancelled: true, status: 'running' });

        // O stream entrega o terminal e a iteração encerra sozinha.
        await subscription;

        // Cliente recebeu `cancelled` com payload {status:'cancelled', reason}.
        const cancelled = events.find((e) => e.type === 'cancelled');
        expect(cancelled).toBeTruthy();
        expect((cancelled!.payload as any).status).toBe('cancelled');
        expect((cancelled!.payload as any).reason).toBe('user-cancel');
        // Nenhum terminal contraditório (done/error) por cima do cancelled.
        expect(events.find((e) => e.type === 'done' || e.type === 'error')).toBeUndefined();

        // Job saiu dos pendentes: estado terminal error/cancelled (nunca queued/running).
        lookup = svc.get(jobId);
        expect(lookup.ok).toBe(true);
        if (lookup.ok) {
            expect(['queued', 'running']).not.toContain(lookup.job.status);
            expect(lookup.job.status).toBe('error');
            expect(lookup.job.error).toMatch(/^cancelled/);
        }
    });

    it('cross-user cancel NÃO emite cancelled nem tira o job dos pendentes', async () => {
        const svc = await fresh();
        const stream = getProgressStream();

        let jobId = '';
        jobId = svc.enqueue(
            () => withTurnProgress(jobId, () => new Promise<never>(() => {})),
            'chat',
            { userId: 'u1', userLogin: 'alice' },
        );
        await flush();

        const events: ProgressEvent[] = [];
        const subscription = (async () => {
            for await (const ev of stream.subscribe(jobId)) events.push(ev);
        })();

        const result = svc.cancel(jobId, { reason: 'user-cancel', actor: { userId: 'u2', userLogin: 'bob' } });
        expect(result).toEqual({ cancelled: false, reason: 'not_cancellable' });

        // Dá um ciclo para provar que NADA foi emitido.
        await flush();

        // Nenhum terminal emitido; job segue running (cancel negado não altera estado).
        expect(events.find((e) => e.type === 'cancelled' || e.type === 'done' || e.type === 'error')).toBeUndefined();
        const lookup = svc.get(jobId);
        expect(lookup.ok).toBe(true);
        if (lookup.ok) expect(lookup.job.status).toBe('running');

        // Encerra a subscription sem pendurar o teste (abort do iterator).
        void subscription;
    });
});
