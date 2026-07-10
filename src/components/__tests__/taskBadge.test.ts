/**
 * Testes unitários dos helpers puros de badge da kanban (#1175).
 * Cobrem as 3 regras de negócio isoladamente (sem React): cor do score contra o piso
 * REAL, fase no chip, e display "Aguardando você" vs reviewing vs "mergeando...".
 */
import { describe, it, expect } from 'vitest';
import {
    resolveScoreThresholds,
    scoreTone,
    scoreTextClasses,
    scoreBadgeClasses,
    scoreTooltip,
    phaseSuffix,
    holdReasonLabel,
    resolveCardStatusDisplay,
    DEFAULT_MIN_MERGE_SCORE,
    DEFAULT_MIN_APPROVE_SCORE,
} from '../Issues/taskBadge';
import type { Task } from '../../services/taskService';

const makeTask = (overrides: Partial<Task>): Task => ({
    issueNumber: 1,
    title: 't',
    body: '',
    labels: [],
    status: 'running',
    feedbackHistory: [],
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
});

const BASE_CONFIG = {
    pending: { color: '', bg: '', icon: null, label: 'Pendente' },
    reviewing: { color: 'text-purple-600', bg: 'bg-purple-50', icon: null, label: 'Em Revisão' },
    approved: { color: 'text-green-600', bg: 'bg-green-50', icon: null, label: 'Aprovado' },
    running: { color: 'text-blue-600', bg: 'bg-blue-50', icon: null, label: 'Executando' },
};

describe('taskBadge — resolveScoreThresholds', () => {
    it('cae nos defaults defensivos quando a config é null/undefined', () => {
        expect(resolveScoreThresholds(null)).toEqual({ minMergeScore: DEFAULT_MIN_MERGE_SCORE, minApproveScore: DEFAULT_MIN_APPROVE_SCORE });
        expect(resolveScoreThresholds(undefined)).toEqual({ minMergeScore: DEFAULT_MIN_MERGE_SCORE, minApproveScore: DEFAULT_MIN_APPROVE_SCORE });
    });

    it('usa os valores reais quando a config traz números', () => {
        expect(resolveScoreThresholds({ minMergeScore: 9, minApproveScore: 9 })).toEqual({ minMergeScore: 9, minApproveScore: 9 });
    });

    it('ignora valores não-numéricos (config parcial/corrompida) mantendo o default', () => {
        expect(resolveScoreThresholds({ minMergeScore: 'x' as unknown as number })).toEqual({
            minMergeScore: DEFAULT_MIN_MERGE_SCORE,
            minApproveScore: DEFAULT_MIN_APPROVE_SCORE,
        });
    });
});

describe('taskBadge — scoreTone contra o piso REAL', () => {
    // Config de produção do issue: piso de merge = 9.
    const t = resolveScoreThresholds({ minMergeScore: 9, minApproveScore: 9 });

    it('verde quando score >= minMergeScore (passa no gate de merge)', () => {
        expect(scoreTone(9, t)).toBe('green');
        expect(scoreTone(10, t)).toBe('green');
    });

    it('âmbar quando score >= minApproveScore - 1 mas < minMergeScore (abaixo do piso)', () => {
        expect(scoreTone(8, t)).toBe('amber');
    });

    it('vermelho quando abaixo de minApproveScore - 1', () => {
        expect(scoreTone(7, t)).toBe('red');
        expect(scoreTone(0, t)).toBe('red');
    });

    it(' verde tem prioridade sobre âmbar em sobreposição (defaults 8/9)', () => {
        const def = resolveScoreThresholds({ minMergeScore: 8, minApproveScore: 9 });
        expect(scoreTone(8, def)).toBe('green'); // 8 >= minMergeScore(8) → verde, não âmbar
    });
});

describe('taskBadge — classes e tooltip', () => {
    it('scoreTextClasses devolve classes distintas por tom', () => {
        expect(scoreTextClasses('green')).toContain('text-green-600');
        expect(scoreTextClasses('amber')).toContain('text-amber-600');
        expect(scoreTextClasses('red')).toContain('text-red-600');
    });

    it('scoreBadgeClasses inclui bg da pílula', () => {
        expect(scoreBadgeClasses('green')).toContain('bg-green-50');
        expect(scoreBadgeClasses('amber')).toContain('bg-amber-50');
    });

    it('scoreTooltip mostra o piso: "8/10 — piso de merge: 9"', () => {
        expect(scoreTooltip(8, { minMergeScore: 9, minApproveScore: 9 })).toBe('8/10 — piso de merge: 9');
    });
});

describe('taskBadge — phaseSuffix (fase no chip)', () => {
    it('null para tasks não-ativas', () => {
        expect(phaseSuffix(makeTask({ status: 'approved' }))).toBeNull();
        expect(phaseSuffix(makeTask({ status: 'pending' }))).toBeNull();
    });

    it('null quando fase ausente ou "done"', () => {
        expect(phaseSuffix(makeTask({ status: 'running', phase: undefined }))).toBeNull();
        expect(phaseSuffix(makeTask({ status: 'running', phase: 'done' }))).toBeNull();
    });

    it('"julgando" para phase judging', () => {
        expect(phaseSuffix(makeTask({ status: 'running', phase: 'judging' }))).toBe('julgando');
    });

    it('"síntese N/3" usando synthesisAttempt', () => {
        expect(phaseSuffix(makeTask({ status: 'running', phase: 'synthesizing', synthesisAttempt: 2 }))).toBe('síntese 2/3');
    });

    it('"síntese" (sem contador) quando synthesisAttempt ausente', () => {
        expect(phaseSuffix(makeTask({ status: 'running', phase: 'synthesizing' }))).toBe('síntese');
    });

    it('"exploração 2/3" derivado de 1 exploração concluída em attempts', () => {
        const task = makeTask({
            status: 'running', phase: 'exploring',
            attempts: [{ index: 1, phase: 'exploring', diff: '', typecheckOk: true, filesChanged: [] }],
        });
        expect(phaseSuffix(task)).toBe('exploração 2/3');
    });

    it('"exploração 1/3" sem tentativas anteriores', () => {
        expect(phaseSuffix(makeTask({ status: 'running', phase: 'exploring', attempts: [] }))).toBe('exploração 1/3');
    });

    it('também aplica a fixing (re-run passa pelo pipeline novamente)', () => {
        expect(phaseSuffix(makeTask({ status: 'fixing', phase: 'judging' }))).toBe('julgando');
    });
});

describe('taskBadge — resolveCardStatusDisplay (separar "Aguardando você")', () => {
    it('approved COM mergeHoldReason → "Aguardando você" (distinto de reviewing)', () => {
        const d = resolveCardStatusDisplay(
            makeTask({ status: 'approved', mergeHoldReason: 'Score 8/10 abaixo do piso.' }),
            BASE_CONFIG,
        );
        expect(d.label).toBe('Aguardando você');
        expect(d.bg).toContain('amber'); // visual distinto do roxo de reviewing
    });

    it('approved SEM mergeHoldReason → "mergeando..." (transitório)', () => {
        const d = resolveCardStatusDisplay(makeTask({ status: 'approved' }), BASE_CONFIG);
        expect(d.label).toBe('mergeando...');
    });

    it('reviewing mantém o label "Em Revisão" do baseConfig', () => {
        const d = resolveCardStatusDisplay(makeTask({ status: 'reviewing' }), BASE_CONFIG);
        expect(d.label).toBe('Em Revisão');
    });

    it('demais status usam o baseConfig direto', () => {
        const d = resolveCardStatusDisplay(makeTask({ status: 'running' }), BASE_CONFIG);
        expect(d.label).toBe('Executando');
    });
});

describe('taskBadge — holdReasonLabel', () => {
    it('devolve o motivo apenas para approved com hold', () => {
        expect(holdReasonLabel(makeTask({ status: 'approved', mergeHoldReason: 'motivo X' }))).toBe('motivo X');
        expect(holdReasonLabel(makeTask({ status: 'approved' }))).toBeNull();
        expect(holdReasonLabel(makeTask({ status: 'reviewing', mergeHoldReason: 'algo' }))).toBeNull();
    });
});
