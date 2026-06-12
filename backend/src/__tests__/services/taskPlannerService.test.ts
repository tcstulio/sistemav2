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

import { taskPlannerService, PlannerAction } from '../../services/taskPlannerService';
import { aiJobService } from '../../services/aiJobService';
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
