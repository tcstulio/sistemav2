import { describe, it, expect, vi, beforeEach } from 'vitest';

// #atribuicao — commits e PRs do TaskRunner deixam de ser indistinguíveis de trabalho escrito à mão.
// O que estes testes protegem:
//  (1) o modelo REGISTRADO é o que de fato rodou, não o configurado — sob fallback GLM→MiniMax os
//      dois divergem, e era exatamente esse caso que não tinha como auditar;
//  (2) a mensagem de commit carrega trailers legíveis por máquina (git log --format='%(trailers:...)'),
//      porque o tasks.json é local e não viaja com o repositório;
//  (3) a label nunca derruba a criação do PR (gh pr create --label FALHA se a label não existe).
//
// Header de mocks espelhado de antiDoubleRun.test.ts (mesmo bloco hoisted).
vi.mock('child_process', () => ({ execFile: vi.fn(), exec: vi.fn(), spawn: vi.fn() }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/aiService', () => ({ aiService: { generateReply: vi.fn() } }));
vi.mock('../../services/aiJobService', () => ({ aiJobService: { runAndWait: vi.fn() } }));
vi.mock('../../utils/previewPorts', () => ({ previewPortsFor: vi.fn(() => ({ frontendPort: 5999, backendPort: 6000 })) }));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { captureForTask: vi.fn() } }));
vi.mock('../../services/taskUsageTracker', () => ({ recordUsage: vi.fn(), getUsageForTask: vi.fn(() => null) }));
vi.mock('../../utils/processTree', () => ({
    killTree: vi.fn(async () => ({ ok: true })), isAlive: vi.fn(() => false),
    killOpencodeOrphans: vi.fn(async () => ({ killed: [], errors: [], confirmedGone: true, discriminated: true })),
    killByImageName: vi.fn(async () => undefined), listPidsByName: vi.fn(async () => []),
}));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn() } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));

import * as childProcess from 'child_process';
import { taskRunnerService } from '../../services/taskRunnerService';

const svc = taskRunnerService as any;
const execFileMock = childProcess.execFile as unknown as ReturnType<typeof vi.fn>;

function makeTask(num: number, over: Record<string, any> = {}) {
    return {
        issueNumber: num, title: `Task ${num}`, body: '', labels: ['opencode-task'],
        status: 'running', feedbackHistory: [], events: [],
        updatedAt: new Date().toISOString(), phase: 'exploring', attempts: [], kind: 'task',
        ...over,
    };
}

beforeEach(() => {
    svc.stopPolling?.();
    vi.clearAllMocks();
    svc.store = { tasks: {} };
});

describe('#atribuicao — recordCoderModel registra o modelo que RODOU', () => {
    it('cria a lista na primeira chamada e preserva a ordem de execução', () => {
        const t = makeTask(1);
        svc.recordCoderModel(t, 'minimax-coding-plan/MiniMax-M3');
        svc.recordCoderModel(t, 'zai-coding-plan/glm-5.2');
        // a ordem É a informação: primeiro o primário, depois o fallback que salvou a rodada.
        expect(t.coderModelsUsed).toEqual(['minimax-coding-plan/MiniMax-M3', 'zai-coding-plan/glm-5.2']);
    });

    it('é idempotente por valor — o mesmo modelo em vários rounds não vira várias entradas', () => {
        const t = makeTask(2);
        svc.recordCoderModel(t, 'minimax-coding-plan/MiniMax-M3');
        svc.recordCoderModel(t, 'minimax-coding-plan/MiniMax-M3');
        svc.recordCoderModel(t, 'minimax-coding-plan/MiniMax-M3');
        expect(t.coderModelsUsed).toEqual(['minimax-coding-plan/MiniMax-M3']);
    });

    it('modelo vazio (comando sem --model) é registrado como default explícito, não some', () => {
        // Sem isto, uma task rodada no default do opencode ficaria com a lista VAZIA e o trailer
        // diria "(nao registrado)" — que é a mesma coisa que o campo dizer nada. São estados
        // diferentes: "rodou no default" ≠ "não sabemos".
        const t = makeTask(3);
        svc.recordCoderModel(t, '');
        svc.recordCoderModel(t, undefined);
        svc.recordCoderModel(t, '   ');
        expect(t.coderModelsUsed).toEqual(['(default do opencode)']);
    });

    it('distingue a escalada Claude do coder barato', () => {
        const t = makeTask(4);
        svc.recordCoderModel(t, 'zai-coding-plan/glm-5.2');
        svc.recordCoderModel(t, 'claude:opus');
        expect(t.coderModelsUsed).toEqual(['zai-coding-plan/glm-5.2', 'claude:opus']);
    });
});

describe('#atribuicao — mensagem de commit', () => {
    it('carrega os trailers Tulipa-Model e Tulipa-Task', () => {
        const t = makeTask(1546, { coderModelsUsed: ['minimax-coding-plan/MiniMax-M3'] });
        const msg = svc.buildCommitMessage(t, 1546, 'Backend: criar describeVideo');

        expect(msg).toContain('Tulipa-Model: minimax-coding-plan/MiniMax-M3');
        expect(msg).toContain('Tulipa-Task: #1546');
        expect(msg.split('\n')[0]).toBe('feat(#1546): Backend: criar describeVideo');
    });

    it('trailers ficam num bloco separado do corpo por linha em branco (exigência do git)', () => {
        // `git interpret-trailers` / `%(trailers:key=...)` só reconhecem o bloco FINAL precedido de
        // linha em branco. Sem isso o trailer vira texto solto e a auditoria por git log não funciona.
        const t = makeTask(7, { coderModelsUsed: ['x/y'] });
        const linhas = svc.buildCommitMessage(t, 7, 'titulo').split('\n');
        const iModel = linhas.findIndex((l: string) => l.startsWith('Tulipa-Model:'));
        expect(iModel).toBeGreaterThan(0);
        expect(linhas[iModel - 1]).toBe('');
        // e o último trailer é a última linha (nada solto depois)
        expect(linhas[linhas.length - 1]).toBe('Tulipa-Task: #7');
    });

    it('lista TODOS os modelos quando houve fallback — é o caso que não dava para auditar', () => {
        const t = makeTask(8, { coderModelsUsed: ['zai-coding-plan/glm-5.2', 'minimax-coding-plan/MiniMax-M3'] });
        expect(svc.buildCommitMessage(t, 8, 'titulo'))
            .toContain('Tulipa-Model: zai-coding-plan/glm-5.2, minimax-coding-plan/MiniMax-M3');
    });

    it('sem modelo registrado, diz explicitamente que não foi registrado', () => {
        const t = makeTask(9);
        expect(svc.buildCommitMessage(t, 9, 'titulo')).toContain('Tulipa-Model: (nao registrado)');
    });

    it('trunca o assunto em 72 chars (limite de assunto do git)', () => {
        const t = makeTask(10, { coderModelsUsed: ['x'] });
        const titulo = 'A'.repeat(200);
        const assunto = svc.buildCommitMessage(t, 10, titulo).split('\n')[0];
        expect(assunto).toBe(`feat(#10): ${'A'.repeat(72)}`);
    });

    it('marca que é automação — o texto que um humano lê no git log', () => {
        const t = makeTask(11, { coderModelsUsed: ['x'] });
        expect(svc.buildCommitMessage(t, 11, 'titulo')).toContain('TaskRunner');
    });
});

describe('#atribuicao — label do PR nunca derruba a criação do PR', () => {
    const driveGh = (impl: (args: string[], cb: any) => void) => {
        execFileMock.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
            impl(args, cb);
            return {} as any;
        });
    };

    it('true quando a label é criada', async () => {
        driveGh((_args, cb) => cb(null, { stdout: '', stderr: '' }));
        await expect(svc.ensureTaskRunnerLabel()).resolves.toBe(true);
    });

    it('true quando a label JÁ existe — é sucesso para o nosso propósito', async () => {
        driveGh((_args, cb) => cb(Object.assign(new Error('label already exists'), { code: 1 })));
        await expect(svc.ensureTaskRunnerLabel()).resolves.toBe(true);
    });

    it('false em qualquer outra falha (rede, permissão) — e NÃO lança', async () => {
        // O ponto do teste: se isto lançasse, uma falha de rede na criação da label mataria a
        // criação do PR inteiro. Perder a label é aceitável; perder o PR não.
        driveGh((_args, cb) => cb(Object.assign(new Error('HTTP 403 forbidden'), { code: 1 })));
        await expect(svc.ensureTaskRunnerLabel()).resolves.toBe(false);
    });

    it('cria a label com nome e descrição estáveis', async () => {
        const vistos: string[][] = [];
        driveGh((args, cb) => { vistos.push(args); cb(null, { stdout: '', stderr: '' }); });
        await svc.ensureTaskRunnerLabel();
        expect(vistos[0].slice(0, 3)).toEqual(['label', 'create', 'taskrunner']);
    });
});
