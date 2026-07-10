import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('child_process', () => ({ execFileSync: vi.fn() }));

import { execFileSync } from 'child_process';
import { computeWorktreeHash, snapshotWorktree } from '../../taskrunner/worktree';

const HEX64 = /^[0-9a-f]{64}$/;
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('computeWorktreeHash (#1054)', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'wt-hash-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('retorna SHA256 hex de 64 chars', async () => {
        await writeFile(join(dir, 'a.txt'), 'hello');
        const h = await computeWorktreeHash(dir);
        expect(h).toMatch(HEX64);
    });

    it('idêntico para mesmo conteúdo (determinístico)', async () => {
        await writeFile(join(dir, 'a.txt'), 'hello');
        await mkdir(join(dir, 'sub'));
        await writeFile(join(dir, 'sub', 'b.ts'), 'export const x = 1;');
        const h1 = await computeWorktreeHash(dir);
        const h2 = await computeWorktreeHash(dir);
        expect(h1).toBe(h2);
    });

    it('diferente após mudança de conteúdo', async () => {
        await writeFile(join(dir, 'a.txt'), 'hello');
        const before = await computeWorktreeHash(dir);
        await writeFile(join(dir, 'a.txt'), 'world');
        const after = await computeWorktreeHash(dir);
        expect(after).not.toBe(before);
    });

    it('diferente ao adicionar novo arquivo', async () => {
        await writeFile(join(dir, 'a.txt'), 'hello');
        const before = await computeWorktreeHash(dir);
        await writeFile(join(dir, 'b.txt'), 'novo');
        const after = await computeWorktreeHash(dir);
        expect(after).not.toBe(before);
    });

    it('worktree vazio → SHA256 do vazio (determinístico)', async () => {
        expect(await computeWorktreeHash(dir)).toBe(EMPTY_SHA256);
    });

    it('exclui node_modules, .git, dist, build, coverage do hash', async () => {
        const clean = await mkdtemp(join(tmpdir(), 'wt-clean-'));
        const junk = await mkdtemp(join(tmpdir(), 'wt-junk-'));
        try {
            await mkdir(join(clean, 'src'));
            await writeFile(join(clean, 'src', 'index.ts'), 'export const x = 1;\n');
            await writeFile(join(clean, 'root.txt'), 'same');

            await mkdir(join(junk, 'src'));
            await writeFile(join(junk, 'src', 'index.ts'), 'export const x = 1;\n');
            await writeFile(join(junk, 'root.txt'), 'same');
            for (const excluded of ['node_modules', '.git', 'dist', 'build', 'coverage']) {
                await mkdir(join(junk, excluded));
                await writeFile(join(junk, excluded, 'noise.js'), 'IRRELEVANTE ' + excluded);
            }

            expect(await computeWorktreeHash(junk)).toBe(await computeWorktreeHash(clean));
        } finally {
            await rm(clean, { recursive: true, force: true });
        }
    });

    it('ordem de criação diferente não muda o hash (sort estável)', async () => {
        const a = await mkdtemp(join(tmpdir(), 'wt-ord-a-'));
        const b = await mkdtemp(join(tmpdir(), 'wt-ord-b-'));
        try {
            await writeFile(join(a, 'z.txt'), 'z');
            await writeFile(join(a, 'a.txt'), 'a');
            await writeFile(join(a, 'm.txt'), 'm');

            await writeFile(join(b, 'a.txt'), 'a');
            await writeFile(join(b, 'm.txt'), 'm');
            await writeFile(join(b, 'z.txt'), 'z');

            expect(await computeWorktreeHash(a)).toBe(await computeWorktreeHash(b));
        } finally {
            await rm(a, { recursive: true, force: true });
            await rm(b, { recursive: true, force: true });
        }
    });

    it('ignora symlinks no hash (decisão documentada)', async () => {
        await writeFile(join(dir, 'real.txt'), 'x');
        const baseHash = await computeWorktreeHash(dir);

        // Symlinks são ignorados propositalmente (ver comentário em collectFiles).
        // Em Windows sem Developer Mode/admin a criação de symlink pode falhar;
        // quando isso ocorre, o tratamento explícito no código permanece válido —
        // apenas não o exercitamos aqui.
        let created = false;
        try {
            await symlink(join(dir, 'real.txt'), join(dir, 'link.txt'));
            created = true;
        } catch {
            created = false;
        }
        if (created) {
            // symlink presente não altera o hash (é ignorado de forma determinística)
            expect(await computeWorktreeHash(dir)).toBe(baseHash);
        }
    });

    it('computeWorktreeHash roda em < 2s para worktree típico', async () => {
        const N = 200;
        for (let i = 0; i < N; i++) {
            await mkdir(join(dir, `pkg${i % 10}`), { recursive: true });
            await writeFile(join(dir, `pkg${i % 10}`, `f${i}.ts`), `export const v${i} = ${i};\n`);
        }
        const start = Date.now();
        const h = await computeWorktreeHash(dir);
        const elapsed = Date.now() - start;
        expect(h).toMatch(HEX64);
        expect(elapsed).toBeLessThan(2000);
    });
});

describe('snapshotWorktree (#1054)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('cria commit WIP wip-round-{n} e retorna o SHA', () => {
        vi.mocked(execFileSync).mockImplementation((_file: any, args: any) => {
            const a = args as string[];
            if (a[0] === 'rev-parse') return 'abc123commitsha\n';
            return '';
        });

        const snap = snapshotWorktree('/fake/worktree', 1);

        expect(snap.sha).toBe('abc123commitsha');
        expect(snap.message).toBe('wip-round-1');
        expect(snap.round).toBe(1);

        const calls = vi.mocked(execFileSync).mock.calls as unknown as [string, string[], { cwd: string }][];
        const argLists = calls.map((c) => c[1]);
        expect(argLists).toContainEqual(['add', '-A']);
        expect(argLists).toContainEqual(['commit', '--allow-empty', '-m', 'wip-round-1']);
        expect(argLists).toContainEqual(['rev-parse', 'HEAD']);
    });

    it('todas as chamadas git rodam com cwd = worktreePath', () => {
        vi.mocked(execFileSync).mockReturnValue('sha\n');
        snapshotWorktree('C:/wt/xyz', 2);
        const calls = vi.mocked(execFileSync).mock.calls as unknown as [string, string[], { cwd: string }][];
        // checkout(-B) + add + commit + rev-parse = 4 chamadas
        expect(calls.length).toBe(4);
        expect(calls.every((c) => c[2].cwd === 'C:/wt/xyz')).toBe(true);
    });

    it('usa --allow-empty no commit (checkpoint recuperável mesmo sem mudanças)', () => {
        vi.mocked(execFileSync).mockReturnValue('sha\n');
        snapshotWorktree('/wt', 3);
        const calls = vi.mocked(execFileSync).mock.calls as unknown as [string, string[], { cwd: string }][];
        const commitCall = calls.find((c) => c[1][0] === 'commit');
        expect(commitCall).toBeDefined();
        expect(commitCall![1]).toContain('--allow-empty');
        expect(commitCall![1]).toContain('wip-round-3');
    });

    it('o número da rodada aparece na mensagem', () => {
        vi.mocked(execFileSync).mockReturnValue('sha\n');
        const snap = snapshotWorktree('/wt', 7);
        expect(snap.message).toBe('wip-round-7');
    });

    it('cria branch dedicada wip-round-{n} antes do commit (não polui o branch principal)', () => {
        vi.mocked(execFileSync).mockImplementation((_file: any, args: any) => {
            const a = args as string[];
            if (a[0] === 'rev-parse') return 'sha-isolated\n';
            return '';
        });

        const snap = snapshotWorktree('/wt', 4);
        const calls = vi.mocked(execFileSync).mock.calls as unknown as [string, string[], { cwd: string }][];
        const argLists = calls.map((c) => c[1]);

        // Cria/muda para branch dedicada wip-round-4 → main permanece intacto.
        expect(argLists).toContainEqual(['checkout', '-B', 'wip-round-4']);
        expect(snap.branch).toBe('wip-round-4');
        expect(snap.sha).toBe('sha-isolated');

        // O commit só pode acontecer DEPOIS do checkout para a branch isolada.
        const checkoutIdx = argLists.findIndex((a) => a[0] === 'checkout');
        const commitIdx = argLists.findIndex((a) => a[0] === 'commit');
        expect(checkoutIdx).toBeGreaterThanOrEqual(0);
        expect(commitIdx).toBeGreaterThan(checkoutIdx);
    });
});
