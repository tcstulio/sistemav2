import { describe, it, expect } from 'vitest';
import { MAX_JUDGE_ROUNDS, TASKRUNNER_CONFIG } from '../../taskrunner/config';

describe('taskrunner/config — MAX_JUDGE_ROUNDS (#1054)', () => {
    it('default é 3', () => {
        // Sem TASKRUNNER_MAX_ROUNDS no env do runner de testes → default 3.
        expect(MAX_JUDGE_ROUNDS).toBe(3);
    });

    it('é exposto também em TASKRUNNER_CONFIG.maxJudgeRounds', () => {
        expect(TASKRUNNER_CONFIG.maxJudgeRounds).toBe(MAX_JUDGE_ROUNDS);
    });
});
