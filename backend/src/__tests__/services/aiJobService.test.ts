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
                ['alive', 'currentProvider', 'id', 'lastHeartbeat', 'progressPct', 'queuePosition', 'startedAt', 'status'].sort()
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
