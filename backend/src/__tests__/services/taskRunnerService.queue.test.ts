import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks (hoisted) — cobrem as dependências externas do taskRunnerService ===
// child_process: git/gh via execFile (callback style p/ promisify); sh via exec; spawn não usado.
vi.mock('child_process', () => ({
    execFile: vi.fn(),
    exec: vi.fn(),
    spawn: vi.fn(),
}));

vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/aiService', () => ({ aiService: { generateReply: vi.fn() } }));
vi.mock('../../services/aiJobService', () => ({ aiJobService: { runAndWait: vi.fn() } }));
vi.mock('../../utils/previewPorts', () => ({
    previewPortsFor: vi.fn(() => ({ frontendPort: 5999, backendPort: 6000 })),
}));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { captureForTask: vi.fn() } }));
vi.mock('../../services/taskUsageTracker', () => ({
    recordUsage: vi.fn(),
    getUsageForTask: vi.fn(() => null),
}));

// processTree: killTree FALHA (reproduz o "taskkill: Command failed"); isAlive true (órfão vivo).
vi.mock('../../utils/processTree', () => ({
    killTree: vi.fn(async () => ({ ok: false, signal: 'taskkill failed: Command failed', durationMs: 10, alreadyDead: false })),
    isAlive: vi.fn(() => true),
    killOpencodeOrphans: vi.fn(async () => ({ killed: [], errors: [], confirmedGone: true, discriminated: true })),
    killByImageName: vi.fn(async () => undefined),
    listPidsByName: vi.fn(async () => []),
}));

// runOpencode: controlável — pendura até o teste rejeitar (simulando o settle forçado pós-kill falho).
vi.mock('../../utils/runOpencode', () => ({
    runOpencode: vi.fn(),
    resolveBash: vi.fn(() => 'bash'),
}));

// Módulos carregados via require() dinâmico dentro do serviço.
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/uiConfigService', () => ({
    uiConfigService: { get: vi.fn() },
}));
vi.mock('../../services/notificationService', () => ({
    notificationService: { create: vi.fn(async () => ({})) },
}));

import { execFile, exec } from 'child_process';
import { taskRunnerService } from '../../services/taskRunnerService';
import { runOpencode } from '../../utils/runOpencode';
import { killTree } from '../../utils/processTree';
import type { Task } from '../../services/taskRunnerService';

// Resolvers pendurados de cada chamada do runOpencode mockado.
const runResolvers: { resolve: (v: string) => void; reject: (e: Error) => void }[] = [];

function makeStoredTask(n: number): Task {
    return {
        issueNumber: n,
        title: `#${n}`,
        body: 'body da issue',
        labels: ['opencode-task'],
        status: 'pending',
        feedbackHistory: [],
        events: [],
        attempts: [],
        updatedAt: new Date().toISOString(),
        phase: 'done',
        kind: 'task',
        branch: `fix-${n}`,
    } as Task;
}

// Drena a fila de micro/macrotasks até que `pred()` seja verdadeiro (com timeout de segurança).
// 15s (era 4s): sob carga do CI (vários arquivos de teste concorrentes) o cascade async da fila
// demora a assentar e estourava o deadline → flaky (1 falha intermitente travava TODOS os PRs).
// O deadline é só rede de segurança contra hang real; aumentá-lo não mascara bug (ainda falha,
// só mais devagar), mas elimina o falso-negativo de timing.
async function flushUntil(pred: () => boolean, timeoutMs = 15000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
        if (Date.now() > deadline) throw new Error('flushUntil: condição não atingida no tempo');
        await new Promise((r) => setImmediate(r));
    }
}

describe('taskRunnerService — robustez da fila (#644)', () => {
    beforeEach(() => {
        const svc = taskRunnerService as any;
        // Reseta o estado interno do singleton p/ isolar cada teste (o singleton é construído
        // no import e compartilhado; sem isto, pendingExecs/execChain/store vazam entre testes).
        svc.pendingExecs = 0;
        svc.execChain = Promise.resolve();
        svc.worktreeLock = Promise.resolve();
        svc.stuckSince = null;
        svc.store = { tasks: {} };

        // O serviço carrega uiConfig/taskPlanner via require() dinâmico (CJS p/ quebrar import
        // circular). No sandbox ESM do vitest o require lança, então getAutomationConfig cairia
        // no catch com autoPlay=false. Stubamos o método na instância p/ representar a
        // pré-condição real (autoPlay ligado) e exercitar o cascade autoPlayNext — alvo do #644.
        svc.getAutomationConfig = () => ({
            autoPlay: true, autoMerge: false, autoDecompose: false, minMergeScore: 8,
        });

        // runOpencode pendura: salva o childPid (p/ killTask mirar) e nunca settle sozinho.
        runResolvers.length = 0;
        vi.mocked(runOpencode).mockImplementation((_cmd, _cwd, task: any) => {
            task.childPid = 50000 + runResolvers.length;
            return new Promise<string>((resolve, reject) => {
                runResolvers.push({
                    resolve: (v) => { task.childPid = undefined; resolve(v); },
                    reject: (e) => { task.childPid = undefined; reject(e); },
                });
            });
        });

        // git → ok (stdout vazio); gh issue view → JSON; gh issue/pr list → [] / {}.
        vi.mocked(execFile).mockImplementation((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') { cb = opts; }
            const a = args || [];
            let stdout = '';
            if (file === 'gh') {
                if (a.includes('list')) stdout = '[]';
                else if (a.includes('view') && a.includes('issue')) {
                    const num = a[a.indexOf('view') + 1];
                    stdout = JSON.stringify({ number: Number(num), title: `Issue ${num}`, body: 'body', labels: [{ name: 'opencode-task' }], comments: [] });
                } else if (a[0] === 'pr') stdout = '{}';
            }
            setImmediate(() => cb(null, { stdout, stderr: '' }));
            return undefined as any;
        });
        vi.mocked(exec).mockImplementation((_cmd: string, opts: any, cb: any) => {
            if (typeof opts === 'function') { cb = opts; }
            setImmediate(() => cb(null, { stdout: '', stderr: '' }));
            return undefined as any;
        });
    });

    afterEach(async () => {
        const svc = taskRunnerService as any;
        // Limpa qualquer exec pendurada: marca cancel + rejeita resolvers restantes p/ a cadeia
        // settar de forma limpa (sem loops de rounds cumulativos sobrando após o teste).
        try {
            for (const t of Object.values(svc.store.tasks || {}) as any[]) {
                t.status = 'cancelled';
                t.killRequested = true;
            }
            for (const r of runResolvers.splice(0)) {
                try { r.reject(new Error('cleanup')); } catch { /* já settou */ }
            }
            await new Promise((res) => setImmediate(res));
            await new Promise((res) => setImmediate(res));
        } catch { /* ignore */ }
        svc.stopPolling?.();
        vi.restoreAllMocks();
    });

    it('cancel com kill FALHO NÃO trava a fila — a próxima task roda', async () => {
        const svc = taskRunnerService as any;

        // Duas tasks na fila; só a primeira é startada (o cascade pega a segunda).
        svc.store.tasks = { 100: makeStoredTask(100), 101: makeStoredTask(101) };
        const t100: Task = svc.store.tasks[100];
        const t101: Task = svc.store.tasks[101];

        // 1) Inicia #100 — executa e pendura no runOpencode.
        await svc.startTask(100, { mode: 'cumulative' });
        await flushUntil(() => runResolvers.length >= 1);
        expect(t100.status).toBe('running');
        expect(typeof t100.childPid).toBe('number');
        const pid100 = t100.childPid;

        // 2) Cancela #100 — o kill da árvore FALHA (mock) e é registrado (evidência do issue).
        await svc.killTask(100, 'admin request');
        expect(t100.status).toBe('cancelled');
        // Evidência exata do bug: "Process tree killed via taskkill failed: Command failed".
        expect(t100.events.some((e) => /taskkill failed/.test(e.message))).toBe(true);
        expect(vi.mocked(killTree)).toHaveBeenCalledWith(pid100);

        // 3) Simula o settle forçado do runOpencode pós-kill falho (o que libera a cadeia).
        //    Sem isto (antes do fix), a promise pendurava para sempre e a fila inteira travava.
        runResolvers[0].reject(new Error('opencode kill não confirmado — liberando a cadeia'));

        // 4) A PRÓXIMA task roda — a fila NÃO travou, mesmo com kill falho. runResolvers>=2
        //    prova que #101 chegou a CHAMAR o runOpencode (execução efetiva, não só 'running').
        await flushUntil(() => runResolvers.length >= 2);
        expect(t101.status).toBe('running');
        expect(runResolvers.length).toBe(2);

        // #100 permanece 'cancelled' — o catch robusto NÃO transforma um cancelamento em 'failed'.
        expect(t100.status).toBe('cancelled');
        // pendingExecs reflete APENAS #101 ativa (o slot de #100 foi decrementado no finally).
        expect(svc.pendingExecs).toBe(1);
    }, 20000); // timeout do it() = 20s: o flushUntil tem deadline de 15s, mas o DEFAULT do vitest é
    // 5s — sob carga do CI o teste era MORTO aos 5s (antes do flushUntil), causando o flaky "Test
    // timed out in 5000ms" que travava TODOS os PRs. Alinha o teto do it() ao deadline interno.
});
