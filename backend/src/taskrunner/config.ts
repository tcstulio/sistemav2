/**
 * Configuração do loop adversarial (Foundation #1054).
 *
 * MAX_JUDGE_ROUNDS: número máximo de rodadas synthesis→judge (default 3).
 * Configurável via env TASKRUNNER_MAX_ROUNDS.
 */
const parsedMaxRounds = parseInt(process.env.TASKRUNNER_MAX_ROUNDS || '3', 10);

export const MAX_JUDGE_ROUNDS: number =
    Number.isFinite(parsedMaxRounds) && parsedMaxRounds > 0 ? parsedMaxRounds : 3;

export const TASKRUNNER_CONFIG = {
    maxJudgeRounds: MAX_JUDGE_ROUNDS,
} as const;

export default TASKRUNNER_CONFIG;
