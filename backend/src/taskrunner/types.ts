import { MAX_JUDGE_ROUNDS } from './config';

/**
 * Estado de uma task dentro do loop adversarial (Foundation #1054).
 * Acompanha a rodada atual, o teto de rodadas e os hashes do worktree
 * entre rodadas para detectar se houve progresso real.
 */
export interface TaskState {
    currentRound: number;
    maxRounds: number;
    lastJudgeCritique: string;
    lastWorktreeHash: string;
    previousWorktreeHash: string;
}

/**
 * Cria o estado inicial de rodadas para uma task.
 */
export function createTaskState(maxRounds: number = MAX_JUDGE_ROUNDS): TaskState {
    return {
        currentRound: 0,
        maxRounds,
        lastJudgeCritique: '',
        lastWorktreeHash: '',
        previousWorktreeHash: '',
    };
}

/**
 * True enquanto ainda há rodadas disponíveis (currentRound < maxRounds).
 */
export function hasMoreRounds(state: TaskState): boolean {
    return state.currentRound < state.maxRounds;
}

/**
 * Avança uma rodada do loop adversarial de forma imutável:
 *  - incrementa `currentRound`;
 *  - desloca `lastWorktreeHash` → `previousWorktreeHash` (para o
 *    orquestrador detectar progresso real entre rodadas);
 *  - registra `newWorktreeHash` como hash da rodada atual;
 *  - atualiza `lastJudgeCritique` quando informado (preserva a anterior caso
 *    `judgeCritique` seja omitido).
 *
 * Resolve o "dead-state" do campo `previousWorktreeHash`, centralizando o
 * shift entre rodadas em vez de deixar a cargo de cada caller.
 */
export function advanceRound(
    state: TaskState,
    newWorktreeHash: string,
    judgeCritique?: string,
): TaskState {
    return {
        ...state,
        currentRound: state.currentRound + 1,
        previousWorktreeHash: state.lastWorktreeHash,
        lastWorktreeHash: newWorktreeHash,
        lastJudgeCritique: judgeCritique ?? state.lastJudgeCritique,
    };
}
