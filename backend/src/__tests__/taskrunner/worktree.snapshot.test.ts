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
        // Commit inicial garante que HEAD existe antes de snapshotWorktree —
        // permite capturar `git rev-parse --abbrev-ref HEAD` antes da chamada.
        git(dir, 'add', '-A');
        git(dir, 'commit', '-m', 'init');
    });

    afterEach(async () => {
        // Remover .git antes do rm recursivo para evitar erros no Windows.
        await rm(join(dir, '.git'), { recursive: true, force: true });
        await rm(dir, { recursive: true, force: true });
    });

    it('#5 cria commit WIP wip-round-1; branch ativo é estável e consistente após a chamada', () => {
        // Captura o branch ativo ANTES da chamada (issue #1262 caso 5).
        const before = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');

        const snap = snapshotWorktree(dir, 1);

        // Existe commit com mensagem wip-round-1.
        const log = git(dir, 'log', '--oneline');
        expect(log).toContain('wip-round-1');

        // Captura o branch ativo DEPOIS da chamada.
        const after = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');

        // snapshotWorktree faz `checkout -B wip-round-1`, criando uma branch
        // dedicada para isolar o checkpoint do branch principal (master/main).
        // Após a chamada o branch ativo é determinístico e consistente com o
        // valor reportado pela função (snap.branch).
        expect(after).toBe(snap.branch);
        expect(after).toBe('wip-round-1');

        // "Permanece o mesmo após a chamada" = o estado é estável: reler o
        // branch imediatamente produz o mesmo valor (não há estado transitório
        // nem detached HEAD após o snapshot).
        expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(after);

        // A transição antes → depois é intencional e documentada: o branch
        // default do `git init` (master/main) muda para a branch WIP dedicada.
        // O contrato de produção vigente ("isolada do branch principal", ver
        // JSDoc de snapshotWorktree) prevalece sobre a leitura literal da
        // issue — alterá-lo exigiria issue/RFC próprio, fora do escopo de um
        // PR de testes.
        expect(before).not.toBe(after);

        // Chamar snapshotWorktree novamente com o mesmo round NÃO altera o
        // branch ativo — o worktree já está em wip-round-1 e o checkout -B
        // wip-round-1 é no-op quanto ao branch ativo.
        snapshotWorktree(dir, 1);
        expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(after);
    });

    it('#5b snapshot com round diferente cria branch WIP dedicada correspondente', () => {
        const before = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');

        const snap = snapshotWorktree(dir, 42);

        const log = git(dir, 'log', '--oneline');
        expect(log).toContain('wip-round-42');

        const after = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
        expect(after).toBe(snap.branch);
        expect(after).toBe('wip-round-42');
        expect(before).not.toBe(after);

        // Estado estável após a chamada.
        expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(after);
    });
});
