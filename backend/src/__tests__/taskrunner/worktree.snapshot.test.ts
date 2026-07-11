import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { snapshotWorktree } from '../../taskrunner/worktree';

// Caso 5 do issue #1262: snapshotWorktree com git REAL.
// Este arquivo NÃO faz vi.mock('child_process') (ao contrário de worktree.test.ts),
// permitindo exercitar o fluxo completo de git num repositório temporário.

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

describe('snapshotWorktree #1262 — git real', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'wt-snap-1262-'));
        git(dir, 'init');
        git(dir, 'config', 'user.email', 'test@example.com');
        git(dir, 'config', 'user.name', 'Test');
        await writeFile(join(dir, 'hello.txt'), 'world\n');
        // Commit inicial para que HEAD exista antes de snapshotWorktree —
        // permite capturar `git rev-parse --abbrev-ref HEAD` antes da chamada.
        git(dir, 'add', '-A');
        git(dir, 'commit', '-m', 'init');
    });

    afterEach(async () => {
        // Remover .git antes do rm recursivo para evitar erros no Windows.
        await rm(join(dir, '.git'), { recursive: true, force: true });
        await rm(dir, { recursive: true, force: true });
    });

    it('#5 cria commit WIP wip-round-1 e o branch ativo permanece o mesmo após a chamada', () => {
        // Captura o branch ANTES da chamada (issue #1262 caso 5).
        const before = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');

        const snap = snapshotWorktree(dir, 1);

        // Existe commit com mensagem wip-round-1.
        const log = git(dir, 'log', '--oneline');
        expect(log).toContain('wip-round-1');

        // Captura o branch DEPOIS da chamada.
        const after = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');

        // O branch ativo permanece o mesmo antes e depois (requisito literal do issue).
        expect(after).toBe(before);

        // E é consistente com o que snapshotWorktree reporta.
        expect(after).toBe(snap.branch);
    });

    it('#5b snapshot com round diferente ainda preserva o branch ativo', () => {
        const before = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');

        const snap = snapshotWorktree(dir, 42);

        const log = git(dir, 'log', '--oneline');
        expect(log).toContain('wip-round-42');

        const after = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
        expect(after).toBe(before);
        expect(snap.branch).toBe(before);
    });
});
