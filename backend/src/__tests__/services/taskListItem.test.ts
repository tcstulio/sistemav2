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

/**
 * Benchmark de payload (#1179 — critério de aceite #1: "Payload da listagem < 2 MB com o store
 * atual (~400 tasks) — medir e registrar"). Reproduz o store de produção: ~400 tasks com ~241
 * eventos embutidos cada (a média medida em 2026-07-07 era 47,5 MB). Mede o tamanho do payload
 * ANTES (events embutidos, como era) vs DEPOIS (projeção enxuta via toTaskListItem) e registra
 * os números no log do teste. Falha se a listagem enxuta ultrapassar 2 MB (regressão de payload).
 */
describe('toTaskListItem (#1179 — benchmark de payload < 2MB)', () => {
    // ~241 eventos/task foi a média medida em produção (issue #1179: 399 tasks × ~241 eventos).
    const TASK_COUNT = 400;
    const EVENTS_PER_TASK = 241;

    const EVENT_TYPES = [
        'task_started', 'opencode_output', 'typecheck_ok', 'judge_started', 'judge_score',
        'pr_created', 'pr_merged', 'task_completed', 'error',
    ];

    function makeRealisticEvent(i: number) {
        const base = {
            ts: `2024-07-07T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
            type: EVENT_TYPES[i % EVENT_TYPES.length],
            message: `Evento ${i}: linha de log humanamente legível do task runner (opencode output/typecheck/judge) com tamanho realista de cerca de oitenta caracteres para refletir produção.`,
        };
        // ~1 em cada 8 eventos carrega `meta` com output do opencode (campo volumoso da vida real).
        return i % 8 === 0
            ? { ...base, meta: { output: 'o'.repeat(220) } }
            : base;
    }

    function makeRealisticTask(issueNumber: number): Task {
        const events = Array.from({ length: EVENTS_PER_TASK }, (_, i) => makeRealisticEvent(i));
        return {
            ...makeTask({
                issueNumber,
                title: `Task de produção #${issueNumber} — título realista para o benchmark de payload do board`,
                body: 'b'.repeat(2000),
                judgeReview: 'r'.repeat(1200),
                status: 'merged',
                prNumber: issueNumber + 1000,
                branch: `fix-${issueNumber}`,
                labels: ['bug', 'enhancement', 'opencode-task'],
            }),
            events,
        } as Task;
    }

    it('a listagem ENXUTA fica abaixo de 2 MB (e registra o tamanho antes/depois)', () => {
        const store = Array.from({ length: TASK_COUNT }, (_, i) => makeRealisticTask(i + 1));

        // ANTES: payload como era (events embutidos) — o gargalo de 47 MB.
        const beforeBytes = Buffer.byteLength(JSON.stringify(store), 'utf8');
        const beforeMB = beforeBytes / (1024 * 1024);

        // DEPOIS: projeção enxuta devolvida pelo GET /api/tasks (#1179).
        const afterBytes = Buffer.byteLength(JSON.stringify(store.map(toTaskListItem)), 'utf8');
        const afterMB = afterBytes / (1024 * 1024);

        // Registro da medição (evidência exigida pelo critério de aceite #1).
        // eslint-disable-next-line no-console
        console.log(
            `[#1179 benchmark] tasks=${TASK_COUNT} eventos/task=${EVENTS_PER_TASK} | ` +
            `antes=${beforeMB.toFixed(2)} MB -> depois=${afterMB.toFixed(2)} MB ` +
            `(${(((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(1)}% de redução)`
        );

        // Critério de aceite #1: listagem enxuta < 2 MB.
        expect(afterBytes).toBeLessThan(2 * 1024 * 1024);
        // Sanidade: a projeção precisa de fato reduzir o payload drasticamente.
        expect(afterBytes).toBeLessThan(beforeBytes / 10);
        // Garante que os events sumiram da listagem (não é só compressão de strings).
        const sample = store.map(toTaskListItem)[0];
        expect(sample).not.toHaveProperty('events');
        expect(sample.eventsCount).toBe(EVENTS_PER_TASK);
    });
});
