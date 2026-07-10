import { describe, it, expect } from 'vitest';
import { createTaskState, hasMoreRounds, advanceRound, type TaskState } from '../../taskrunner/types';
import { MAX_JUDGE_ROUNDS } from '../../taskrunner/config';

describe('taskrunner/types — TaskState (#1054)', () => {
    it('createTaskState usa MAX_JUDGE_ROUNDS como default de maxRounds', () => {
        const s = createTaskState();
        expect(s.maxRounds).toBe(MAX_JUDGE_ROUNDS);
        expect(s.currentRound).toBe(0);
        expect(s.lastJudgeCritique).toBe('');
        expect(s.lastWorktreeHash).toBe('');
        expect(s.previousWorktreeHash).toBe('');
    });

    it('createTaskState aceita maxRounds explícito', () => {
        const s = createTaskState(5);
        expect(s.maxRounds).toBe(5);
    });

    it('tem todos os campos novos tipados (compila + presentes)', () => {
        const s: TaskState = {
            currentRound: 2,
            maxRounds: 3,
            lastJudgeCritique: 'faltam testes',
            lastWorktreeHash: 'aaa',
            previousWorktreeHash: 'bbb',
        };
        expect(s.currentRound).toBe(2);
        expect(s.lastJudgeCritique).toBe('faltam testes');
    });

    it('hasMoreRounds: true antes do limite, false ao atingir', () => {
        expect(hasMoreRounds({ ...createTaskState(3), currentRound: 0 })).toBe(true);
        expect(hasMoreRounds({ ...createTaskState(3), currentRound: 2 })).toBe(true);
        expect(hasMoreRounds({ ...createTaskState(3), currentRound: 3 })).toBe(false);
    });

    it('advanceRound: shift lastWorktreeHash → previousWorktreeHash e incrementa rodada', () => {
        const start = createTaskState(3);
        expect(start.lastWorktreeHash).toBe('');
        expect(start.previousWorktreeHash).toBe('');

        const r1 = advanceRound(start, 'hash-r1', 'faltam testes');
        expect(r1.currentRound).toBe(1);
        expect(r1.previousWorktreeHash).toBe(''); // era o lastWorktreeHash anterior
        expect(r1.lastWorktreeHash).toBe('hash-r1');
        expect(r1.lastJudgeCritique).toBe('faltam testes');

        const r2 = advanceRound(r1, 'hash-r2');
        expect(r2.currentRound).toBe(2);
        expect(r2.previousWorktreeHash).toBe('hash-r1'); // shift aplicado
        expect(r2.lastWorktreeHash).toBe('hash-r2');
        expect(r2.lastJudgeCritique).toBe('faltam testes'); // preservada quando omitida

        const r3 = advanceRound(r2, 'hash-r3', 'agora está melhor');
        expect(r3.currentRound).toBe(3);
        expect(r3.previousWorktreeHash).toBe('hash-r2');
        expect(r3.lastWorktreeHash).toBe('hash-r3');
        expect(r3.lastJudgeCritique).toBe('agora está melhor');
    });

    it('advanceRound é imutável (não muta o estado original)', () => {
        const start = createTaskState(3);
        const next = advanceRound(start, 'h', 'c');
        expect(start.currentRound).toBe(0);
        expect(start.lastWorktreeHash).toBe('');
        expect(next).not.toBe(start);
    });
});
