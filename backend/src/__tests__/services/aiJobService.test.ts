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
