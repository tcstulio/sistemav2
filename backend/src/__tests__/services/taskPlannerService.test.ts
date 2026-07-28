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
        redoTask: vi.fn(async () => ({})), // #1455: o planner re-despacha bloqueador parado
        isExecInFlight: vi.fn(() => false), // #flip PR-B: default "não em voo" → o deadlock-kick segue firando
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

describe('taskPlannerService — auto-deadlock: bloqueador PARADO (#1455)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // #flip PR-B: clearAllMocks NÃO reseta o mockReturnValue — restaura o default "não em voo" p/ isolar
        // os testes (senão o mockReturnValue(true) de um teste vaza p/ os seguintes e suprime o deadlock-kick).
        vi.mocked((taskRunnerService as any).isExecInFlight).mockReturnValue(false);
        invalidatePlannerCache();
        resetPlannerThrottle();
        const { execFile } = await import('child_process');
        // gh pr list → 1 PR aberto na branch fix-1353; gh pr diff → toca src/services/foo.ts
        vi.mocked(execFile as any).mockImplementation((cmd: string, args: string[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            if (args[1] === 'list') cb(null, { stdout: JSON.stringify([{ number: 1458, title: 'feat(#1353)', headRefName: 'fix-1353' }]), stderr: '' });
            else if (args[1] === 'diff') cb(null, { stdout: 'src/services/foo.ts\n', stderr: '' });
            else cb(null, { stdout: '', stderr: '' });
        });
    });

    const taskTouchingFoo = () => makeTask({ issueNumber: 9999, body: 'Alterar src/services/foo.ts' });

    it('bloqueador PARADO (pending) → re-despacha via redoTask usando a ISSUE 1353 (não o PR 1458) + wait + incrementa o teto', async () => {
        const blocker = makeTask({ issueNumber: 1353, status: 'pending' });
        vi.mocked(taskRunnerService.getTask).mockReturnValue(blocker);

        const d = await taskPlannerService.analyzeTask(taskTouchingFoo());

        // o BUG do #1455 era getTask(prNum): aqui garantimos que resolve pela BRANCH fix-1353 → ISSUE 1353
        expect(taskRunnerService.getTask).toHaveBeenCalledWith(1353);
        expect(taskRunnerService.getTask).not.toHaveBeenCalledWith(1458);
        expect((taskRunnerService as any).redoTask).toHaveBeenCalledWith(1353, expect.any(String));
        expect(blocker.deadlockKicks).toBe(1); // teto incrementado (0→1)
        expect(d.action).toBe('wait');
    });

    it('branch com SUFIXO (fix-1353-2) → resolve a ISSUE 1353, NÃO a 2 (regex do prefixo, não dos dígitos do fim)', async () => {
        const { execFile } = await import('child_process');
        vi.mocked(execFile as any).mockImplementation((cmd: string, args: string[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            if (args[1] === 'list') cb(null, { stdout: JSON.stringify([{ number: 1470, title: 'feat(#1353)', headRefName: 'fix-1353-2' }]), stderr: '' });
            else if (args[1] === 'diff') cb(null, { stdout: 'src/services/foo.ts\n', stderr: '' });
            else cb(null, { stdout: '', stderr: '' });
        });
        vi.mocked(taskRunnerService.getTask).mockReturnValue(makeTask({ issueNumber: 1353, status: 'pending' }));

        await taskPlannerService.analyzeTask(taskTouchingFoo());

        expect(taskRunnerService.getTask).toHaveBeenCalledWith(1353);
        expect(taskRunnerService.getTask).not.toHaveBeenCalledWith(2); // o bug do regex ancorado no fim casaria a issue 2
        expect((taskRunnerService as any).redoTask).toHaveBeenCalledWith(1353, expect.any(String));
    });

    it('bloqueador ATIVO (running) → NÃO re-despacha (esperar evita conflito) + wait', async () => {
        vi.mocked(taskRunnerService.getTask).mockReturnValue(makeTask({ issueNumber: 1353, status: 'running' }));

        const d = await taskPlannerService.analyzeTask(taskTouchingFoo());

        expect((taskRunnerService as any).redoTask).not.toHaveBeenCalled();
        expect(d.action).toBe('wait');
    });

    it('bloqueador parado mas TETO de kicks atingido (deadlockKicks=2) → NÃO re-despacha (não loopa)', async () => {
        vi.mocked(taskRunnerService.getTask).mockReturnValue(makeTask({ issueNumber: 1353, status: 'pending', deadlockKicks: 2 }));

        await taskPlannerService.analyzeTask(taskTouchingFoo());

        expect((taskRunnerService as any).redoTask).not.toHaveBeenCalled();
    });

    it('#flip PR-B: bloqueador parado mas COM exec em voo → NÃO re-despacha (skip, evita 2º redo da mesma issue)', async () => {
        vi.mocked(taskRunnerService.getTask).mockReturnValue(makeTask({ issueNumber: 1353, status: 'pending' }));
        vi.mocked((taskRunnerService as any).isExecInFlight).mockReturnValue(true); // dispatch já em voo

        await taskPlannerService.analyzeTask(taskTouchingFoo());

        // ORÁCULO G6: com o bloqueador já em voo, o quebra-deadlock NÃO dispara um 2º redo da mesma issue.
        // (Sem kick, cai no ramo "nenhum bloqueador re-despachável" → LLM decide; o que importa é o não-kick.)
        expect((taskRunnerService as any).redoTask).not.toHaveBeenCalled(); // NUNCA 2 execs da mesma issue
    });
});

describe('taskPlannerService — não esperar no PRÓPRIO PR (#1460 rescue-gap)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.mocked((taskRunnerService as any).isExecInFlight).mockReturnValue(false); // #flip PR-B: default "não em voo"
        invalidatePlannerCache();
        resetPlannerThrottle();
    });

    it('o PR da PRÓPRIA task (branch fix-9999) NÃO é conflito → não espera em si mesma nem se re-despacha', async () => {
        const { execFile } = await import('child_process');
        // gh pr list → só o PR da PRÓPRIA task (branch fix-9999); gh pr diff → toca o MESMO arquivo do body.
        vi.mocked(execFile as any).mockImplementation((cmd: string, args: string[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            if (args[1] === 'list') cb(null, { stdout: JSON.stringify([{ number: 1468, title: 'feat(#9999)', headRefName: 'fix-9999' }]), stderr: '' });
            else if (args[1] === 'diff') cb(null, { stdout: 'src/services/foo.ts\n', stderr: '' });
            else cb(null, { stdout: '', stderr: '' });
        });
        // Se o próprio PR NÃO fosse filtrado, o owner-resolve chamaria getTask(9999) e faria self-kick.
        vi.mocked(taskRunnerService.getTask).mockReturnValue(makeTask({ issueNumber: 9999, status: 'pending' }));

        const d = await taskPlannerService.analyzeTask(makeTask({ issueNumber: 9999, body: 'Alterar src/services/foo.ts' }));

        expect(d.action).not.toBe('wait');                                  // não espera em si mesma
        expect((taskRunnerService as any).redoTask).not.toHaveBeenCalled(); // não faz self-kick (self-deadlock)
        expect(d.blockedBy).toEqual([]);                                    // o próprio PR não é bloqueador
    });

    it('cirúrgico: próprio PR + PR de OUTRA task → filtra só o próprio; o de outra SEGUE bloqueando (#1455 intacto)', async () => {
        const { execFile } = await import('child_process');
        vi.mocked(execFile as any).mockImplementation((cmd: string, args: string[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            if (args[1] === 'list') cb(null, { stdout: JSON.stringify([
                { number: 1468, title: 'feat(#9999)', headRefName: 'fix-9999' }, // o PRÓPRIO
                { number: 1458, title: 'feat(#1353)', headRefName: 'fix-1353' }, // de OUTRA task
            ]), stderr: '' });
            else if (args[1] === 'diff') cb(null, { stdout: 'src/services/foo.ts\n', stderr: '' });
            else cb(null, { stdout: '', stderr: '' });
        });
        vi.mocked(taskRunnerService.getTask).mockReturnValue(makeTask({ issueNumber: 1353, status: 'pending' }));

        const d = await taskPlannerService.analyzeTask(makeTask({ issueNumber: 9999, body: 'Alterar src/services/foo.ts' }));

        // o PR de OUTRA task (fix-1353) ainda dispara o deadlock-kick do #1455; o próprio (fix-9999) foi filtrado
        expect((taskRunnerService as any).redoTask).toHaveBeenCalledWith(1353, expect.any(String));
        expect((taskRunnerService as any).getTask).not.toHaveBeenCalledWith(9999); // próprio nunca vira "bloqueador"
        expect(d.blockedBy).toEqual([1458]);                                       // só o de outra task
        expect(d.action).toBe('wait');
    });
});
