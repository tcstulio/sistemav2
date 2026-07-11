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
    });

    afterEach(async () => {
        // Remover .git antes do rm recursivo para evitar erros no Windows.
        await rm(join(dir, '.git'), { recursive: true, force: true });
        await rm(dir, { recursive: true, force: true });
    });

    it('#5 cria commit WIP wip-round-1 e o branch ativo permanece consistente', () => {
        const snap = snapshotWorktree(dir, 1);

        // Existe commit com mensagem wip-round-1.
        const log = git(dir, 'log', '--oneline');
        expect(log).toContain('wip-round-1');

        // O branch ativo (git rev-parse --abbrev-ref HEAD) é o mesmo reportado
        // por snapshotWorktree — o worktree permanece na branch WIP após o snapshot.
        const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
        expect(branch).toBe(snap.branch);
        expect(branch).toBe('wip-round-1');
    });
});
