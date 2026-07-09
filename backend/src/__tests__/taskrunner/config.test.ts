import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('taskrunner/config — parsing de TASKRUNNER_MAX_ROUNDS (#1259)', () => {
    const originalEnv = { ...process.env };
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.TASKRUNNER_MAX_ROUNDS;
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.resetModules();
    });

    afterEach(() => {
        warnSpy.mockRestore();
        process.env = { ...originalEnv };
        vi.resetModules();
    });

    async function loadConfig(): Promise<typeof import('../../taskrunner/config')> {
        vi.resetModules();
        return (await import('../../taskrunner/config')) as typeof import(
            '../../taskrunner/config'
        );
    }

    it('undefined → default 3, sem warn', async () => {
        delete process.env.TASKRUNNER_MAX_ROUNDS;
        const mod = await loadConfig();
        expect(mod.MAX_JUDGE_ROUNDS).toBe(3);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('inteiro positivo válido é usado (5), sem warn', async () => {
        process.env.TASKRUNNER_MAX_ROUNDS = '5';
        const mod = await loadConfig();
        expect(mod.MAX_JUDGE_ROUNDS).toBe(5);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('aceita outro inteiro positivo (10)', async () => {
        process.env.TASKRUNNER_MAX_ROUNDS = '10';
        const mod = await loadConfig();
        expect(mod.MAX_JUDGE_ROUNDS).toBe(10);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it.each(['', '0', '-1', '-100', 'abc', 'NaN'])(
        'env inválido %j → default 3 com console.warn informativo',
        async (value) => {
            process.env.TASKRUNNER_MAX_ROUNDS = value;
            const mod = await loadConfig();
            expect(mod.MAX_JUDGE_ROUNDS).toBe(3);
            expect(warnSpy).toHaveBeenCalledTimes(1);
            const msg = String(warnSpy.mock.calls[0]?.[0] ?? '');
            expect(msg).toContain(value);
            expect(msg).toContain('TASKRUNNER_MAX_ROUNDS');
        },
    );

    it('propaga o valor resolvido para TASKRUNNER_CONFIG.maxJudgeRounds', async () => {
        process.env.TASKRUNNER_MAX_ROUNDS = '7';
        const mod = await loadConfig();
        expect(mod.TASKRUNNER_CONFIG.maxJudgeRounds).toBe(7);
    });
});
