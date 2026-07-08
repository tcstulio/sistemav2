/**
 * Testes unitários dos helpers puros do modal de feedback (#1176).
 * Sem React: cobrem a extração dos "negativos" do Judge e a derivação do histórico.
 */
import { describe, it, expect } from 'vitest';
import { extractJudgeNegatives, deriveFeedbackHistory } from '../Issues/feedbackDraft';
import type { Task } from '../../services/taskService';

const makeTask = (overrides: Partial<Task>): Task => ({
    issueNumber: 1,
    title: 't',
    body: '',
    labels: [],
    status: 'reviewing',
    feedbackHistory: [],
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
});

describe('feedbackDraft — extractJudgeNegatives', () => {
    it('devolve "" para review vazia/undefined (desabilita o botão "usar pontos")', () => {
        expect(extractJudgeNegatives(undefined)).toBe('');
        expect(extractJudgeNegatives(null)).toBe('');
        expect(extractJudgeNegatives('')).toBe('');
        expect(extractJudgeNegatives('   \n  ')).toBe('');
    });

    it('destaca apenas as linhas em lista, sem o marcador', () => {
        const review = [
            'Resumo geral bom.',
            '- Faltou tratar lista vazia',
            '- Adicionar o teste correspondente',
            '* Sem validação de input',
        ].join('\n');
        expect(extractJudgeNegatives(review)).toBe(
            'Faltou tratar lista vazia\nAdicionar o teste correspondente\nSem validação de input',
        );
    });

    it('aceita marcadores numerados além de -, *, •', () => {
        const review = '1) Cobertura insuficiente\n2. Falta de timeout';
        expect(extractJudgeNegatives(review)).toBe('Cobertura insuficiente\nFalta de timeout');
    });

    it('sem estrutura de lista, devolve a crítica inteira como rascunho', () => {
        const review = 'Faltou tratar o caso de lista vazia e adicionar o teste correspondente.';
        expect(extractJudgeNegatives(review)).toBe(review);
    });

    it('ignora linhas que só têm o marcador (vazias após strip)', () => {
        const review = '- \n- Ponto real\n-   ';
        expect(extractJudgeNegatives(review)).toBe('Ponto real');
    });
});

describe('feedbackDraft — deriveFeedbackHistory', () => {
    it('prefere durableFeedback (mais recente primeiro)', () => {
        const task = makeTask({ durableFeedback: ['primeiro feedback', 'segundo feedback'] });
        expect(deriveFeedbackHistory(task)).toEqual(['segundo feedback', 'primeiro feedback']);
    });

    it('recua para os eventos feedback_received quando durableFeedback está vazio/ausente', () => {
        const task = makeTask({
            durableFeedback: undefined,
            events: [
                { ts: '2024-01-01T00:00:00.000Z', type: 'start', message: 'Task iniciada' },
                { ts: '2024-01-01T00:01:00.000Z', type: 'feedback_received', message: 'Feedback recebido: corrija X' },
                { ts: '2024-01-01T00:02:00.000Z', type: 'judge_score', message: 'Judge: 7/10' },
                { ts: '2024-01-01T00:03:00.000Z', type: 'feedback_received', message: 'Feedback recebido: corrija Y' },
            ],
        });
        // Só feedback_received, mais recente primeiro.
        expect(deriveFeedbackHistory(task)).toEqual([
            'Feedback recebido: corrija Y',
            'Feedback recebido: corrija X',
        ]);
    });

    it('lista vazia quando não há durableFeedback nem eventos feedback_received', () => {
        expect(deriveFeedbackHistory(makeTask({}))).toEqual([]);
        expect(deriveFeedbackHistory(makeTask({ durableFeedback: [], events: [] }))).toEqual([]);
    });

    it('não muta o durableFeedback original (copia antes de inverter)', () => {
        const task = makeTask({ durableFeedback: ['a', 'b', 'c'] });
        deriveFeedbackHistory(task);
        expect(task.durableFeedback).toEqual(['a', 'b', 'c']);
    });
});
