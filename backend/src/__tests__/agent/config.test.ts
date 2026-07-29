import { describe, it, expect } from 'vitest';
import {
    MAX_DELEGATION_DEPTH,
    MAX_CONCURRENT_SUBAGENTS,
    MAX_DELEGATION_SUMMARY_LENGTH,
    MAX_DELEGATIONS_PER_TASK,
    DELEGATION_DEPTH_EXCEEDED_MSG,
    CONCURRENT_SUBAGENTS_EXCEEDED_MSG,
} from '../../agent/config';

describe('#1037 agent/config — constantes de guard rails', () => {
    it('MAX_DELEGATION_DEPTH = 2 (corta recursão no nível 2)', () => {
        expect(MAX_DELEGATION_DEPTH).toBe(2);
    });

    it('MAX_CONCURRENT_SUBAGENTS = 3 (4º simultâneo é rejeitado)', () => {
        expect(MAX_CONCURRENT_SUBAGENTS).toBe(3);
    });

    it('MAX_DELEGATION_SUMMARY_LENGTH = 500', () => {
        expect(MAX_DELEGATION_SUMMARY_LENGTH).toBe(500);
    });

    it('MAX_DELEGATIONS_PER_TASK = 5 (warning acima disso)', () => {
        expect(MAX_DELEGATIONS_PER_TASK).toBe(5);
    });

    it('mensagens de erro incluem os limites numéricos', () => {
        expect(DELEGATION_DEPTH_EXCEEDED_MSG).toContain('2');
        expect(CONCURRENT_SUBAGENTS_EXCEEDED_MSG).toContain('3');
        expect(CONCURRENT_SUBAGENTS_EXCEEDED_MSG).toMatch(/Aguarde/i);
    });
});
