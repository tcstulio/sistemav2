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

import { taskPlannerService, PlannerAction, invalidatePlannerCache, resetPlannerThrottle, setPlannerMaxConcurrent } from '../../services/taskPlannerService';
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
        resetPlannerThrottle();
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

describe('taskPlannerService — throttle de concorrência (#1117 / Epic #1113)', () => {
    // body > 50 chars força a chamada de LLM (caminho "caro" que entra no slot do throttle).
    const longBody = 'Implementar feature X no arquivo src/services/example.ts com testes unitários e cobertura ampla do fluxo completo.';

    beforeEach(async () => {
        vi.clearAllMocks();
        invalidatePlannerCache();
        resetPlannerThrottle();
        setPlannerMaxConcurrent(1); // default de produção
        const { execFile } = await import('child_process');
        vi.mocked(execFile as any).mockImplementation((cmd: string, args: string[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            cb(null, { stdout: args[1] === 'list' ? '[]' : '', stderr: '' });
        });
    });

    it('serializa análises concorrentes com plannerMaxConcurrent=1 (no máximo 1 LLM por vez)', async () => {
        let active = 0;
        let maxActive = 0;
        vi.mocked(aiJobService.runAndWait).mockImplementation(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 30));
            active--;
            return { text: JSON.stringify({ action: 'go', reason: 'ok', alreadyResolved: false }) };
        });

        const tasks = [7001, 7002, 7003].map((n) => makeTask({ issueNumber: n, body: longBody }));
        const decisions = await Promise.all(tasks.map((t) => taskPlannerService.analyzeTask(t)));

        expect(maxActive).toBe(1);
        expect(decisions.every((d) => d.action === 'go')).toBe(true);
    });

    it('permite até N análises simultâneas quando plannerMaxConcurrent=N', async () => {
        setPlannerMaxConcurrent(2);
        let active = 0;
        let maxActive = 0;
        vi.mocked(aiJobService.runAndWait).mockImplementation(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 30));
            active--;
            return { text: JSON.stringify({ action: 'go', reason: 'ok', alreadyResolved: false }) };
        });

        const tasks = [8001, 8002, 8003, 8004].map((n) => makeTask({ issueNumber: n, body: longBody }));
        const decisions = await Promise.all(tasks.map((t) => taskPlannerService.analyzeTask(t)));

        expect(maxActive).toBe(2);
        expect(decisions.every((d) => d.action === 'go')).toBe(true);
    });

    it('cache hit NÃO adquire slot do throttle (retorna imediato mesmo com slot ocupado)', async () => {
        let active = 0;
        let maxActive = 0;
        vi.mocked(aiJobService.runAndWait).mockImplementation(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 40));
            active--;
            return { text: JSON.stringify({ action: 'go', reason: 'ok', alreadyResolved: false }) };
        });

        const cached = makeTask({ issueNumber: 9001, body: longBody });
        // 1ª análise: popula o cache e consome 1 chamada de LLM.
        await taskPlannerService.analyzeTask(cached);
        expect(vi.mocked(aiJobService.runAndWait)).toHaveBeenCalledTimes(1);

        // Dispara uma análise "cara" de OUTRA issue (ocupa o slot por ~40ms)...
        const other = makeTask({ issueNumber: 9002, body: longBody });
        const expensive = taskPlannerService.analyzeTask(other);
        await new Promise((r) => setTimeout(r, 10)); // garante que 'other' entrou no slot

        // ...e simultaneamente pede a MESMA issue 9001 (cache hit): deve resolver na hora,
        // sem esperar o slot ocupado por 'other' e sem nova chamada de LLM.
        const hit = await taskPlannerService.analyzeTask(cached);
        expect(hit.action).toBe('go');

        await expensive;
        // A cache hit não chamou o LLM de novo → total continua 2 (só cached + other).
        expect(vi.mocked(aiJobService.runAndWait)).toHaveBeenCalledTimes(2);
        expect(maxActive).toBe(1);
    });

    it('libera o slot mesmo quando o caminho caro lança (finally)', async () => {
        // Força o catch de analyzeTask: listOpenPRs (execFile) rejeita.
        vi.mocked(aiJobService.runAndWait).mockResolvedValue({
            text: JSON.stringify({ action: 'go', reason: 'ok', alreadyResolved: false }),
        });
        const { execFile } = await import('child_process');
        vi.mocked(execFile as any).mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
            // listOpenPRs chama gh pr list primeiro → falha e faz analyzeTask cair no catch.
            cb(new Error('gh boom'), { stdout: '', stderr: '' });
        });

        // Primeira analyzeTask falha (catch) mas DEVE liberar o slot via finally.
        const t1 = makeTask({ issueNumber: 9200, body: longBody });
        await taskPlannerService.analyzeTask(t1);

        // Se o slot não tivesse sido liberado, esta segunda chamada travaria (timeout).
        const t2 = makeTask({ issueNumber: 9201, body: longBody });
        const result = await Promise.race([
            taskPlannerService.analyzeTask(t2),
            new Promise<string>(((_, reject) => setTimeout(() => reject(new Error('deadlock: slot não liberado')), 500))),
        ]);
        expect(result).toBeDefined();
    });

    it('mantém o contrato de PlannerDecision ao throttle (campos obrigatórios presentes)', async () => {
        vi.mocked(aiJobService.runAndWait).mockResolvedValue({
            text: JSON.stringify({ action: 'skip', reason: 'Já resolvida', alreadyResolved: true, priority: 999 }),
        });
        const task = makeTask({ issueNumber: 9100, body: longBody });
        const d = await taskPlannerService.analyzeTask(task);
        expect(d.action).toBe('skip');
        expect(typeof d.reason).toBe('string');
        expect(typeof d.alreadyResolved).toBe('boolean');
        expect(Array.isArray(d.blockedBy)).toBe(true);
    });
});
