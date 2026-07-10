/**
 * Configuração do loop adversarial (Foundation #1054, issue #1259).
 *
 * MAX_JUDGE_ROUNDS: número máximo de rodadas synthesis→judge (default 3).
 * Configurável via env TASKRUNNER_MAX_ROUNDS (inteiro positivo). Quando a env
 * não está definida, usa o default silenciosamente; valores inválidos
 * (vazio, NaN, <= 0) também caem para o default, porém com um `console.warn`
 * informativo.
 */
const DEFAULT_MAX_JUDGE_ROUNDS = 3;

function resolveMaxJudgeRounds(): number {
    const raw = process.env.TASKRUNNER_MAX_ROUNDS;
    if (raw === undefined) {
        return DEFAULT_MAX_JUDGE_ROUNDS;
    }
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    console.warn(
        `[taskrunner/config] TASKRUNNER_MAX_ROUNDS="${raw}" é inválido ` +
            `(esperado um inteiro positivo); usando o padrão ${DEFAULT_MAX_JUDGE_ROUNDS}.`,
    );
    return DEFAULT_MAX_JUDGE_ROUNDS;
}

export const MAX_JUDGE_ROUNDS: number = resolveMaxJudgeRounds();

export const TASKRUNNER_CONFIG = {
    maxJudgeRounds: MAX_JUDGE_ROUNDS,
} as const;

export default TASKRUNNER_CONFIG;
