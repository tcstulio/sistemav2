// #escalada-opus: escalada do CODER para Opus quando o coder barato empaca por qualidade.
// Gasta $ real — as travas são o ponto. Padrão do projeto: semear o singleton privado direto
// (vitest não mocka require() lazy) + mockar deps por import.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// O kill-switch de OPS é lido do env NO IMPORT do módulo. O import ESM é HOISTED acima de código
// normal, então setar o env aqui via vi.hoisted (que roda ANTES dos imports) — senão o módulo
// avaliaria OPUS_ESCALATION_ENABLED com o env ainda ausente.
vi.hoisted(() => { process.env.TASKRUNNER_OPUS_ESCALATION = '1'; });

vi.mock('child_process', () => ({ execFile: vi.fn(), exec: vi.fn(), spawn: vi.fn() }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/aiService', () => ({ aiService: { generateReply: vi.fn() } }));
vi.mock('../../services/aiJobService', () => ({ aiJobService: { runAndWait: vi.fn() } }));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { captureForTask: vi.fn() } }));
vi.mock('../../services/taskUsageTracker', () => ({ recordUsage: vi.fn(), getUsageForTask: vi.fn(() => null) }));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn() } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));
// Controla a cota de infra (isQuotaExhausted) e o Claude CLI (coder Opus). vi.hoisted p/ os
// factories de vi.mock (hoisted) poderem referenciar estas variáveis.
const quotaState = vi.hoisted(() => ({ exhausted: false }));
const claudeMock = vi.hoisted(() => ({ available: vi.fn(async () => true), runCode: vi.fn(), runText: vi.fn() }));
vi.mock('../../services/llmQuotaState', () => ({
    isQuotaError: vi.fn(() => false),
    isQuotaExhausted: vi.fn(() => quotaState.exhausted),
    markQuotaExhausted: vi.fn(),
    clearQuotaExhausted: vi.fn(),
    quotaStatus: vi.fn(() => ({ exhausted: false })),
}));
vi.mock('../../services/claudeCliService', () => ({ claudeCliService: claudeMock }));

import { taskRunnerService } from '../../services/taskRunnerService';
const svc = taskRunnerService as any;
const today = () => new Date().toISOString().slice(0, 10);

// Config default que SATISFAZ todas as condições de escalada (cada teste desliga uma).
const CFG_OK = {
    opusEscalationEnabled: true, judgeModel: 'opus', minMergeScore: 8, minApproveScore: 9,
    maxJudgeRounds: 3, maxOpusEscalationsPerDay: 2, maxOpusCostUsdPerDay: 5, coderEscalationModel: 'opus',
};
// Task que SATISFAZ todas as condições (score 5 < merge 8, 3 rodadas do juiz forte, não escalada ainda).
const taskOk = (over: any = {}) => ({
    issueNumber: 1, judgeScore: 5, judgeModelUsed: 'claude:opus', judgeAttempts: 3,
    opusEscalated: false, durableFeedback: ['crítica X'], ...over,
});

beforeEach(() => {
    svc.stopPolling?.();
    vi.clearAllMocks();
    quotaState.exhausted = false;
    svc.store = { tasks: {} };
    svc.save = vi.fn();
    svc.getAutomationConfig = vi.fn(() => ({ ...CFG_OK }));
});

describe('shouldEscalateToOpus — gatilho e travas', () => {
    it('todas as condições satisfeitas → true', () => {
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(true);
    });

    it('toggle de admin OFF (opusEscalationEnabled=false) → false', () => {
        svc.getAutomationConfig = vi.fn(() => ({ ...CFG_OK, opusEscalationEnabled: false }));
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(false);
    });

    it('máx 1/task: opusEscalated=true → false (invariante da guarda TERMINAL, não re-escala)', () => {
        expect(svc.shouldEscalateToOpus(taskOk({ opusEscalated: true }))).toBe(false);
    });

    it('score de juiz-FALLBACK (judgeModelUsed != claude:opus) → false (não gasta com score ruidoso)', () => {
        expect(svc.shouldEscalateToOpus(taskOk({ judgeModelUsed: 'chat-chain' }))).toBe(false);
    });

    it('faixa >= piso de merge (score 8) → false (não gasta por 1 ponto marginal)', () => {
        expect(svc.shouldEscalateToOpus(taskOk({ judgeScore: 8 }))).toBe(false);
    });

    it('auto-fix barato ainda com folga (judgeAttempts < maxJudgeRounds) → false', () => {
        expect(svc.shouldEscalateToOpus(taskOk({ judgeAttempts: 2 }))).toBe(false);
    });

    it('infra: isQuotaExhausted (hang/cota GLM) → false (não é incapacidade do coder)', () => {
        quotaState.exhausted = true;
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(false);
    });

    it('teto DIÁRIO de escaladas atingido → false', () => {
        svc.store.opusDay = { date: today(), escalations: 2, costUsd: 0 };
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(false);
    });

    it('teto de CUSTO $ diário atingido → false (trava dura de orçamento)', () => {
        svc.store.opusDay = { date: today(), escalations: 0, costUsd: 5 };
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(false);
    });

    it('circuit-breaker aberto → false', () => {
        svc.store.opusDay = { date: today(), escalations: 0, costUsd: 0, circuitOpen: true };
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(false);
    });

    it('sem judgeScore numérico → false', () => {
        expect(svc.shouldEscalateToOpus(taskOk({ judgeScore: undefined }))).toBe(false);
    });
});

describe('contadores PERSISTIDOS (sobrevivem a restart) — opusDay no TaskStore', () => {
    it('accountOpusEscalation incrementa e persiste (save)', () => {
        svc.accountOpusEscalation();
        expect(svc.store.opusDay.escalations).toBe(1);
        expect(svc.store.opusDay.date).toBe(today());
        expect(svc.save).toHaveBeenCalled();
    });

    it('teto sobrevive a "restart": store recarregado com opusDay do MESMO dia mantém o contador', () => {
        // simula persistência: o valor gravado no store é o que um novo boot leria do tasks.json
        svc.store = { tasks: {}, opusDay: { date: today(), escalations: 2, costUsd: 3.5 } };
        expect(svc.opusEscalationsToday()).toBe(2);
        expect(svc.opusCostToday()).toBe(3.5);
        // com teto 2, não escala (o restart NÃO reabriu o teto)
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(false);
    });

    it('reset LAZY por virada de ISO date (opusDay de ontem → zera hoje)', () => {
        svc.store = { tasks: {}, opusDay: { date: '1999-01-01', escalations: 9, costUsd: 99 } };
        expect(svc.opusEscalationsToday()).toBe(0);
        expect(svc.opusCostToday()).toBe(0);
    });

    it('accountOpusCost acumula só valores positivos', () => {
        svc.accountOpusCost(1.25);
        svc.accountOpusCost(0);
        svc.accountOpusCost(-3);
        expect(svc.opusCostToday()).toBe(1.25);
    });
});

describe('tryOpusCoderRound — marca ANTES de gastar + circuit-breaker', () => {
    beforeEach(() => {
        svc.buildSynthesisPrompt = vi.fn(() => 'PROMPT_BASE');
        svc.recordEvent = vi.fn();
        svc.emitLog = vi.fn();
        svc.worktreeChanges = vi.fn(async () => ['a.ts']);
    });

    it('marca opusEscalated + conta a escalada ANTES de rodar (sobrevive a runCode que LANÇA)', async () => {
        claudeMock.available.mockResolvedValue(true);
        claudeMock.runCode.mockRejectedValue(new Error('boom'));
        const t = taskOk();
        const changed = await svc.tryOpusCoderRound(t, {});
        expect(changed).toBe(false);            // erro → sem mudanças
        expect(t.opusEscalated).toBe(true);     // MARCADO mesmo com falha (não re-tenta)
        expect(svc.opusEscalationsToday()).toBe(1); // CONTADO antes de gastar
    });

    it('produz diff → retorna true e acumula o custo $', async () => {
        claudeMock.available.mockResolvedValue(true);
        claudeMock.runCode.mockResolvedValue({ isError: false, text: 'ok', costUsd: 1.5, numTurns: 4 });
        svc.worktreeChanges = vi.fn(async () => ['a.ts', 'b.ts']);
        const changed = await svc.tryOpusCoderRound(taskOk(), {});
        expect(changed).toBe(true);
        expect(svc.opusCostToday()).toBe(1.5);
    });

    it('CLI indisponível → false, mas já marcou (1 tentativa consumida)', async () => {
        claudeMock.available.mockResolvedValue(false);
        const t = taskOk();
        expect(await svc.tryOpusCoderRound(t, {})).toBe(false);
        expect(t.opusEscalated).toBe(true);
    });

    it('circuit-breaker: runCode isError com texto de COTA → abre o circuito (persistido)', async () => {
        claudeMock.available.mockResolvedValue(true);
        claudeMock.runCode.mockResolvedValue({ isError: true, text: 'You have hit your monthly spend limit', costUsd: 0 });
        svc.worktreeChanges = vi.fn(async () => []);
        await svc.tryOpusCoderRound(taskOk(), {});
        expect(svc.opusCircuitOpen()).toBe(true);
        // com o circuito aberto, a próxima task não escala
        expect(svc.shouldEscalateToOpus(taskOk({ issueNumber: 2 }))).toBe(false);
    });

    it('isError por QUALIDADE (não cota) NÃO abre o circuito', async () => {
        claudeMock.available.mockResolvedValue(true);
        claudeMock.runCode.mockResolvedValue({ isError: true, text: 'compilation failed in foo.ts', costUsd: 0.5 });
        svc.worktreeChanges = vi.fn(async () => []);
        await svc.tryOpusCoderRound(taskOk(), {});
        expect(svc.opusCircuitOpen()).toBe(false);
    });
});

describe('kill-switch de OPS (env) — desligado bloqueia tudo', () => {
    it('sem TASKRUNNER_OPUS_ESCALATION=1, shouldEscalateToOpus é sempre false', async () => {
        vi.resetModules();
        delete process.env.TASKRUNNER_OPUS_ESCALATION;
        const mod = await import('../../services/taskRunnerService');
        const svc2 = mod.taskRunnerService as any;
        svc2.stopPolling?.();
        svc2.store = { tasks: {} };
        svc2.save = vi.fn();
        svc2.getAutomationConfig = vi.fn(() => ({ ...CFG_OK }));
        expect(svc2.shouldEscalateToOpus(taskOk())).toBe(false);
        process.env.TASKRUNNER_OPUS_ESCALATION = '1'; // restaura p/ os demais
    });
});
