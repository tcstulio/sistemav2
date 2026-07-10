/**
 * Helpers puros do modal de feedback (#1176).
 *
 * Extraídos para serem testáveis isoladamente (sem React), no mesmo espírito do taskBadge.
 * Duas responsabilidades:
 *
 *  1. `extractJudgeNegatives`: produz um RASCUNHO editável a partir do judgeReview — tenta
 *     destacar os pontos negativos (linhas em lista) e, sem estrutura de lista, devolve a
 *     crítica inteira como ponto de partida. Nunca lança; entrada vazia → string vazia.
 *  2. `deriveFeedbackHistory`: lista dos feedbacks anteriores da task — prefere o campo
 *     `durableFeedback` do payload; se ausente/vazio, recua para os eventos `feedback_received`.
 */
import type { Task, TaskEvent } from '../../services/taskService';

/** Marcadores de linha que indicam um item de lista (ponto negativo do Judge). */
const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Remove o marcador de lista do início de uma linha, preservando o conteúdo. */
const stripMarker = (line: string): string => line.replace(LIST_MARKER, '').trim();

/**
 * Extrai os "negativos" do judgeReview como rascunho editável.
 *
 * Heurística:
 *  - Se a crítica traz linhas em lista (-, *, •, 1.), devolve só essas (sem o marcador),
 *    uma por linha — são os pontos acionáveis.
 *  - Caso contrário, devolve a crítica inteira (tratada) como ponto de partida; o humano edita.
 *  - Entrada vazia/undefined → '' (desabilita o botão "usar os pontos do Judge").
 */
export function extractJudgeNegatives(review?: string | null): string {
    if (!review) return '';
    const text = review.trim();
    if (!text) return '';

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const bullets = lines.filter(l => LIST_MARKER.test(l));
    if (bullets.length > 0) {
        return bullets.map(stripMarker).join('\n');
    }
    return text;
}

/**
 * Lista dos feedbacks anteriores da task, do mais recente ao mais antigo.
 *
 * Regra (espelha o backend): prefere `task.durableFeedback` (persistente, sobrevive ao wipe
 * entre fases). Se ausente/vazio, recua para as mensagens dos eventos `feedback_received`.
 */
export function deriveFeedbackHistory(task: Pick<Task, 'durableFeedback' | 'events'>): string[] {
    if (task.durableFeedback && task.durableFeedback.length > 0) {
        return [...task.durableFeedback].reverse();
    }
    const events: TaskEvent[] = task.events ?? [];
    // Mantém a ordem cronológica original e inverte no fim (mais recente primeiro).
    return events
        .filter(e => e.type === 'feedback_received')
        .map(e => e.message)
        .reverse();
}
