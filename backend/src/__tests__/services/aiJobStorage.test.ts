import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// O setup.ts mocka `fs` globalmente. Aqui queremos I/O real p/ validar durabilidade,
// então desmockamos `fs` para este arquivo (e seus imports transitive, como atomicWrite).
vi.unmock('fs');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { saveJob, deleteJob, loadAll, getStorageDir } from '../../services/aiJobStorage';

describe('aiJobStorage (#1012)', () => {
    let dir: string;
    const prevEnv = process.env.AI_JOB_STORAGE_DIR;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aijob-'));
        process.env.AI_JOB_STORAGE_DIR = dir;
    });

    afterEach(() => {
        process.env.AI_JOB_STORAGE_DIR = prevEnv;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('saveJob grava <id>.json e o .tmp não permanece (rename atômico)', () => {
        saveJob({ id: 'abc', status: 'done', createdAt: 1, expiresAt: 2 });

        const file = path.join(dir, 'abc.json');
        expect(fs.existsSync(file)).toBe(true);
        expect(fs.existsSync(file + '.tmp')).toBe(false);
    });

    it('cria o diretório de dados quando ele não existe', () => {
        const nested = path.join(dir, 'nested', 'deep');
        process.env.AI_JOB_STORAGE_DIR = nested;

        saveJob({ id: 'x', createdAt: 1 });

        expect(fs.existsSync(path.join(nested, 'x.json'))).toBe(true);
    });

    it('round-trip: loadAll devolve exatamente o job salvo (durabilidade)', () => {
        const job = {
            id: 'j1',
            status: 'done',
            result: { x: 1 },
            createdAt: 10,
            finishedAt: 20,
            expiresAt: 30,
            label: 'chat',
        };
        saveJob(job);

        const loaded = loadAll();
        expect(loaded).toHaveLength(1);
        expect(loaded[0]).toMatchObject(job);
    });

    it('loadAll reidrata múltiplos jobs', () => {
        saveJob({ id: 'a', createdAt: 1 });
        saveJob({ id: 'b', createdAt: 2 });

        expect(loadAll().map((j) => j.id).sort()).toEqual(['a', 'b']);
    });

    it('loadAll ignora arquivos não-.json e .tmp (escrita parcial)', () => {
        saveJob({ id: 'keep', createdAt: 1 });
        fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
        fs.writeFileSync(path.join(dir, 'partial.json.tmp'), '{}');

        expect(loadAll().map((j) => j.id)).toEqual(['keep']);
    });

    it('loadAll ignora silenciosamente JSON inválido', () => {
        fs.writeFileSync(path.join(dir, 'broken.json'), '{not valid json');
        expect(loadAll()).toEqual([]);
    });

    it('loadAll ignora registro sem id', () => {
        fs.writeFileSync(path.join(dir, 'noid.json'), JSON.stringify({ status: 'done' }));
        expect(loadAll()).toEqual([]);
    });

    it('deleteJob remove o arquivo e é idempotente', () => {
        saveJob({ id: 'del', createdAt: 1 });
        const file = path.join(dir, 'del.json');
        expect(fs.existsSync(file)).toBe(true);

        deleteJob('del');
        expect(fs.existsSync(file)).toBe(false);

        expect(() => deleteJob('del')).not.toThrow();
    });

    it('loadAll retorna [] quando o diretório não existe', () => {
        process.env.AI_JOB_STORAGE_DIR = path.join(dir, 'inexistente-sub');
        expect(loadAll()).toEqual([]);
    });

    it('getStorageDir honra AI_JOB_STORAGE_DIR absoluto', () => {
        process.env.AI_JOB_STORAGE_DIR = dir;
        expect(getStorageDir()).toBe(dir);
    });

    it('getStorageDir resolve caminho relativo contra o cwd', () => {
        process.env.AI_JOB_STORAGE_DIR = 'sub/rel/dir';
        expect(getStorageDir()).toBe(path.resolve(process.cwd(), 'sub/rel/dir'));
    });

    it('sobrevive a kill -9: job salvo permanece acessível numa leitura posterior', () => {
        saveJob({ id: 'persistente', status: 'done', result: { preComputado: 42 }, createdAt: 1, expiresAt: Date.now() + 60000 });

        // Rele o diretório como se fosse um novo processo (loadAll sempre lê do disco).
        const loaded = loadAll();
        expect(loaded.find((j) => j.id === 'persistente')?.result).toEqual({ preComputado: 42 });
    });
});
