import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    isEpic,
    progressFromSubtasks,
    getEpicSubtasks,
    computeEpicProgress,
    EpicProgressBar,
} from '../../components/Issues/epicAggregation';
import type { Task } from '../../services/taskService';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
    issueNumber: 1,
    title: 't',
    body: '',
    labels: [],
    status: 'pending',
    feedbackHistory: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
});

const sub = (n: number, status: Task['status']): Task => makeTask({ issueNumber: n, status, parentEpic: 100 });

describe('epicAggregation - isEpic', () => {
    it('reconhece kind=epic', () => {
        expect(isEpic(makeTask({ kind: 'epic' }))).toBe(true);
    });
    it('rejeita task comum e kind ausente', () => {
        expect(isEpic(makeTask({ kind: 'task' }))).toBe(false);
        expect(isEpic(makeTask({}))).toBe(false);
    });
});

describe('epicAggregation - progressFromSubtasks', () => {
    it('conta merged/inProgress/failed/pending e calcula percent', () => {
        const subs = [
            sub(1, 'merged'),
            sub(2, 'merged'),
            sub(3, 'running'),
            sub(4, 'fixing'),
            sub(5, 'reviewing'),
            sub(6, 'failed'),
            sub(7, 'cancelled'),
            sub(8, 'pending'),
        ];
        const p = progressFromSubtasks(subs);
        expect(p.total).toBe(8);
        expect(p.merged).toBe(2);
        expect(p.inProgress).toBe(3); // running, fixing, reviewing
        expect(p.failed).toBe(2); // failed, cancelled
        expect(p.pending).toBe(1);
        expect(p.percent).toBe(25); // 2/8
    });

    it('lista vazia → total 0 e percent 0 (sem divisão por zero)', () => {
        const p = progressFromSubtasks([]);
        expect(p.total).toBe(0);
        expect(p.merged).toBe(0);
        expect(p.percent).toBe(0);
    });

    it('todas merged → 100%', () => {
        const subs = [sub(1, 'merged'), sub(2, 'merged')];
        expect(progressFromSubtasks(subs).percent).toBe(100);
    });

    it('arredonda o percent (2/3 ≈ 67)', () => {
        const subs = [sub(1, 'merged'), sub(2, 'merged'), sub(3, 'pending')];
        expect(progressFromSubtasks(subs).percent).toBe(67);
    });
});

describe('epicAggregation - getEpicSubtasks', () => {
    it('prioriza epic.subTasks preservando a ordem planejada', () => {
        const epic = makeTask({ issueNumber: 100, kind: 'epic', subTasks: [3, 1, 2] });
        const all = [sub(1, 'pending'), sub(2, 'pending'), sub(3, 'pending')];
        const result = getEpicSubtasks(epic, all);
        // ordem deve seguir subTasks: 3,1,2 — não a numérica.
        expect(result.map(t => t.issueNumber)).toEqual([3, 1, 2]);
    });

    it('ignora ids que não existem no store', () => {
        const epic = makeTask({ issueNumber: 100, kind: 'epic', subTasks: [1, 999] });
        const all = [sub(1, 'pending')];
        expect(getEpicSubtasks(epic, all).map(t => t.issueNumber)).toEqual([1]);
    });

    it('faz fallback para parentEpic quando subTasks ausente (ordem por issueNumber)', () => {
        const epic = makeTask({ issueNumber: 100, kind: 'epic' });
        const all = [sub(3, 'pending'), sub(1, 'pending'), sub(2, 'pending')];
        expect(getEpicSubtasks(epic, all).map(t => t.issueNumber)).toEqual([1, 2, 3]);
    });

    it('conta APENAS as subtasks da própria épica (não vaza de outras épicas)', () => {
        const epicA = makeTask({ issueNumber: 100, kind: 'epic', subTasks: [1, 2] });
        const epicB = makeTask({ issueNumber: 200, kind: 'epic', subTasks: [3, 4] });
        const all = [sub(1, 'pending'), sub(2, 'pending'), sub(3, 'pending'), sub(4, 'pending')];
        expect(getEpicSubtasks(epicA, all).map(t => t.issueNumber)).toEqual([1, 2]);
        expect(getEpicSubtasks(epicB, all).map(t => t.issueNumber)).toEqual([3, 4]);
    });
});

describe('epicAggregation - computeEpicProgress', () => {
    it('combina resolução + contagem', () => {
        const epic = makeTask({ issueNumber: 100, kind: 'epic', subTasks: [1, 2, 3, 4] });
        const all = [
            sub(1, 'merged'),
            sub(2, 'merged'),
            sub(3, 'running'),
            sub(4, 'rejected'),
        ];
        const p = computeEpicProgress(epic, all);
        expect(p).toMatchObject({ total: 4, merged: 2, inProgress: 1, failed: 1, pending: 0, percent: 50 });
    });
});

describe('epicAggregation - EpicProgressBar', () => {
    it('renderiza merged/total e role=progressbar', () => {
        render(<EpicProgressBar progress={{ total: 4, merged: 1, inProgress: 1, failed: 1, pending: 1, percent: 25 }} />);
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '25');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar).toHaveTextContent('1/4');
    });

    it('modo compact não quebra e mantém o texto', () => {
        const { container } = render(<EpicProgressBar progress={{ total: 2, merged: 2, inProgress: 0, failed: 0, pending: 0, percent: 100 }} compact />);
        expect(screen.getByText('2/2')).toBeInTheDocument();
        // largura 100% refletida no style inline do fill
        const fill = container.querySelector('[style*="width"]');
        expect(fill?.getAttribute('style')).toContain('width: 100%');
    });
});
