import { describe, it, expect } from 'vitest';
import {
    toTaskListItem,
    LIST_BODY_MAX_CHARS,
    LIST_JUDGE_REVIEW_MAX_CHARS,
} from '../../services/taskListItem';
import type { Task } from '../../services/taskRunnerService';

function makeTask(over: Partial<Task> = {}): Task {
    return {
        issueNumber: 1,
        title: 'Task',
        body: 'corpo',
        labels: [],
        status: 'pending',
        feedbackHistory: [],
        events: [],
        updatedAt: '2024-01-01T00:00:00.000Z',
        phase: 'done',
        attempts: [],
        kind: 'task',
        ...over,
    } as Task;
}

describe('toTaskListItem (#1179 — projecao enxuta)', () => {
    it('omite o array `events` e inclui `eventsCount` correto', () => {
        const task = makeTask({
            events: [
                { ts: '2024-01-01T00:00:00.000Z', type: 'task_started', message: 'a' },
                { ts: '2024-01-01T00:00:01.000Z', type: 'pr_created', message: 'b' },
                { ts: '2024-01-01T00:00:02.000Z', type: 'pr_merged', message: 'c' },
            ],
        });
        const item = toTaskListItem(task);
        expect(item).not.toHaveProperty('events');
        expect(item.eventsCount).toBe(3);
    });

    it('eventsCount=0 quando nao ha events', () => {
        const item = toTaskListItem(makeTask({ events: [] }));
        expect(item.eventsCount).toBe(0);
    });

    it('trunca `body` em LIST_BODY_MAX_CHARS e adiciona reticencias', () => {
        const item = toTaskListItem(makeTask({ body: 'x'.repeat(LIST_BODY_MAX_CHARS * 3) }));
        expect(item.body.length).toBe(LIST_BODY_MAX_CHARS + 1); // +1 da reticencia
        expect(item.body.endsWith('…')).toBe(true);
    });

    it('trunca `judgeReview` em LIST_JUDGE_REVIEW_MAX_CHARS e adiciona reticencias', () => {
        const item = toTaskListItem({
            ...makeTask(),
            judgeReview: 'y'.repeat(LIST_JUDGE_REVIEW_MAX_CHARS * 3),
        });
        expect(item.judgeReview!.length).toBe(LIST_JUDGE_REVIEW_MAX_CHARS + 1);
        expect(item.judgeReview!.endsWith('…')).toBe(true);
    });

    it('preserva campos curtos sem truncar', () => {
        const item = toTaskListItem(makeTask({ body: 'curto', judgeReview: 'ok' }));
        expect(item.body).toBe('curto');
        expect(item.judgeReview).toBe('ok');
    });

    it('omite campos internos volumosos (cpuMemSamples, baseline*)', () => {
        const item = toTaskListItem(
            makeTask({
                cpuMemSamples: [{ ts: 't', cpuPercent: 1, rssMb: 2 }],
                baselineErrors: ['err'],
                baselineGlobals: ['glob'],
                baselineSha: 'abc',
            } as any)
        );
        expect(item).not.toHaveProperty('cpuMemSamples');
        expect(item).not.toHaveProperty('baselineErrors');
        expect(item).not.toHaveProperty('baselineGlobals');
    });

    it('preserva campos essenciais da task (issueNumber, status, prNumber...)', () => {
        const item = toTaskListItem(makeTask({ issueNumber: 42, status: 'running', prNumber: 99 }));
        expect(item.issueNumber).toBe(42);
        expect(item.status).toBe('running');
        expect(item.prNumber).toBe(99);
    });
});
