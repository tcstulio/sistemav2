import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
    execFile: vi.fn(),
}));

vi.mock('../../services/aiService', () => ({
    aiService: {
        generateReply: vi.fn(),
    },
}));

vi.mock('../../services/aiJobService', () => ({
    aiJobService: {
        runAndWait: vi.fn(),
    },
}));

vi.mock('../../services/taskRunnerService', () => ({
    taskRunnerService: {
        getTask: vi.fn(),
        getAllTasks: vi.fn(() => []),
    },
}));

import { taskPlannerService, PlannerAction, invalidatePlannerCache } from '../../services/taskPlannerService';
import { aiJobService } from '../../services/aiJobService';
import { taskRunnerService } from '../../services/taskRunnerService';
import type { Task } from '../../services/taskRunnerService';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
    issueNumber: 1,
    title: 'Test task',
    body: 'Test body',
    labels: [],
    status: 'pending',
    feedbackHistory: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
});

describe('taskPlannerService.queryLLM', () => {
    it('retorna null quando LLM retorna texto sem JSON', async () => {
        vi.mocked(aiJobService.runAndWait).mockResolvedValue({ text: 'no json here' });
        const result = await taskPlannerService.queryLLM('prompt');
        expect(result).toBeNull();
    });

    it('retorna decisão parcial com campos obrigatórios preenchidos', async () => {
        vi.mocked(aiJobService.runAndWait).mockResolvedValue({
            text: JSON.stringify({ action: 'go', reason: 'Sem conflitos', alreadyResolved: false }),
        });
        const result = await taskPlannerService.queryLLM('prompt');
        expect(result).not.toBeNull();
        expect(result!.action).toBe('go');
        expect(result!.reason).toBe('Sem conflitos');
        expect(result!.alreadyResolved).toBe(false);
    });

    it('retorna action "go" quando action é inválida', async () => {
        vi.mocked(aiJobService.runAndWait).mockResolvedValue({
            text: JSON.stringify({ action: 'invalid', reason: 'test', alreadyResolved: false }),
        });
        const result = await taskPlannerService.queryLLM('prompt');
        expect(result!.action).toBe('go');
    });
});

describe('taskPlannerService — type safety', () => {
    it('não atribui undefined aos campos de PlannerDecision quando LLM retorna campos parciais', async () => {
        vi.mocked(aiJobService.runAndWait).mockResolvedValue({
            text: JSON.stringify({
                action: 'skip',
                reason: 'Já resolvida',
                alreadyResolved: true,
                priority: 50,
            }),
        });

        const task = makeTask({ issueNumber: 42, body: 'Implementar feature X no arquivo src/services/example.ts com testes unitários' });
        const { execFile } = await import('child_process');
        const execFileMock = vi.mocked(execFile as any);

        execFileMock.mockImplementation((cmd: string, args: string[], opts: any, cb: any) => {
            if (typeof opts === 'function') { cb = opts; }
            if (args[1] === 'list') {
                cb(null, { stdout: '[]', stderr: '' });
            } else {
                cb(null, { stdout: '', stderr: '' });
            }
        });

        const decision = await taskPlannerService.analyzeTask(task);

        expect(decision.action).toBe('skip');
        expect(typeof decision.action).toBe('string');
        expect(typeof decision.reason).toBe('string');
        expect(typeof decision.alreadyResolved).toBe('boolean');
    });
});

describe('taskPlannerService — cache de decisões (#712)', () => {
    // body > 50 chars força a chamada de LLM (analyzeTask só consulta o LLM com corpo relevante).
    const longBody = 'Implementar feature X no arquivo src/services/example.ts com testes unitários e cobertura ampla do fluxo.';

    beforeEach(async () => {
        vi.clearAllMocks();
        invalidatePlannerCache();
        const { execFile } = await import('child_process');
        vi.mocked(execFile as any).mockImplementation((cmd: string, args: string[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            cb(null, { stdout: args[1] === 'list' ? '[]' : '', stderr: '' });
        });
        vi.mocked(aiJobService.runAndWait).mockResolvedValue({
            text: JSON.stringify({ action: 'go', reason: 'ok', alreadyResolved: false }),
        });
    });

    it('reaproveita a decisão (cache hit) na 2ª análise da mesma issue sem nova chamada de LLM', async () => {
        const task = makeTask({ issueNumber: 712, body: longBody });
        const d1 = await taskPlannerService.analyzeTask(task);
        const d2 = await taskPlannerService.analyzeTask(task);
        expect(d1.action).toBe('go');
        expect(d2.action).toBe('go');
        expect(vi.mocked(aiJobService.runAndWait)).toHaveBeenCalledTimes(1);
    });

    it('invalida o cache quando o corpo da issue muda (hash diferente) → nova análise', async () => {
        const task = makeTask({ issueNumber: 712, body: longBody });
        await taskPlannerService.analyzeTask(task);
        await taskPlannerService.analyzeTask({ ...task, body: longBody + ' (editado, conteúdo novo e diferente)' });
        expect(vi.mocked(aiJobService.runAndWait)).toHaveBeenCalledTimes(2);
    });

    it('{ noCache: true } ignora o cache e re-analisa', async () => {
        const task = makeTask({ issueNumber: 712, body: longBody });
        await taskPlannerService.analyzeTask(task);
        await taskPlannerService.analyzeTask(task, { noCache: true });
        expect(vi.mocked(aiJobService.runAndWait)).toHaveBeenCalledTimes(2);
    });

    it('invalidatePlannerCache() força recomputação na análise seguinte', async () => {
        const task = makeTask({ issueNumber: 712, body: longBody });
        await taskPlannerService.analyzeTask(task);
        invalidatePlannerCache(712);
        await taskPlannerService.analyzeTask(task);
        expect(vi.mocked(aiJobService.runAndWait)).toHaveBeenCalledTimes(2);
    });

    it('reevaluateWaiting aplica teto de 20 tasks por chamada (PLANNER_REEVAL_MAX default)', async () => {
        const waiting: Task[] = Array.from({ length: 25 }, (_, i) =>
            makeTask({ issueNumber: 1000 + i, body: longBody, status: 'pending', queuePriority: 100 + i }),
        );
        vi.mocked(taskRunnerService.getAllTasks).mockReturnValue(waiting);
        const results = await taskPlannerService.reevaluateWaiting();
        expect(results.length).toBe(20);
    });
});
