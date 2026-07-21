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

// Degrau-2 PR-2: tryOpusCoderRound recebe o `slot` por parâmetro (era a const global WT_ROOT).
// Slot fake — o claudeCliService.runCode e worktreeChanges estão stubados, então o path não pesa.
const fakeSlot = { id: 1, root: '/tmp/fake-slot', dataDir: null };

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

    it('custo $ alto NÃO bloqueia (assinatura renova; custo é só observabilidade)', () => {
        svc.store.opusDay = { date: today(), escalations: 0, costUsd: 999 };
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(true); // volume ok → escala mesmo com custo alto
    });

    it('em COOLDOWN de cota (cooldownUntil futuro) → false', () => {
        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        svc.store.opusDay = { date: today(), escalations: 0, costUsd: 0, cooldownUntil: future };
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(false);
    });

    it('cooldown JÁ EXPIRADO (cooldownUntil passado) → true (a assinatura renovou; retenta)', () => {
        const past = new Date(Date.now() - 60 * 1000).toISOString();
        svc.store.opusDay = { date: today(), escalations: 0, costUsd: 0, cooldownUntil: past };
        expect(svc.shouldEscalateToOpus(taskOk())).toBe(true);
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

describe('tryOpusCoderRound — modelo de ASSINATURA (marca só se rodou; sem-token não consome)', () => {
    beforeEach(() => {
        svc.buildSynthesisPrompt = vi.fn(() => 'PROMPT_BASE');
        svc.recordEvent = vi.fn();
        svc.emitLog = vi.fn();
        svc.worktreeChanges = vi.fn(async () => ['a.ts']);
    });

    it('produz diff → "changed", consome a tentativa e acumula o custo $ (observabilidade)', async () => {
        claudeMock.available.mockResolvedValue(true);
        claudeMock.runCode.mockResolvedValue({ isError: false, text: 'ok', costUsd: 1.5, numTurns: 4 });
        svc.worktreeChanges = vi.fn(async () => ['a.ts', 'b.ts']);
        const t = taskOk();
        expect(await svc.tryOpusCoderRound(t, {}, fakeSlot)).toBe('changed');
        expect(t.opusEscalated).toBe(true);
        expect(svc.opusEscalationsToday()).toBe(1);
        expect(svc.opusCostToday()).toBe(1.5);
        expect(t.opusInFlightAt).toBeUndefined(); // limpo ao concluir
    });

    it('SEM TOKEN (isError de cota) → "quota-blocked": NÃO marca, NÃO conta, aplica cooldown', async () => {
        claudeMock.available.mockResolvedValue(true);
        claudeMock.runCode.mockResolvedValue({ isError: true, text: 'You have hit your monthly spend limit', costUsd: 0 });
        svc.worktreeChanges = vi.fn(async () => []);
        const t = taskOk();
        expect(await svc.tryOpusCoderRound(t, {}, fakeSlot)).toBe('quota-blocked');
        expect(t.opusEscalated).toBeFalsy();        // tentativa NÃO consumida (retenta depois)
        expect(svc.opusEscalationsToday()).toBe(0); // NÃO contou
        expect(svc.opusInCooldown()).toBe(true);    // cooldown aplicado
        expect(t.opusInFlightAt).toBeUndefined();
    });

    it('após o cooldown a mesma task volta a ser elegível (a assinatura renovou)', async () => {
        // aplica cooldown por quota
        claudeMock.available.mockResolvedValue(true);
        claudeMock.runCode.mockResolvedValue({ isError: true, text: 'rate limit exceeded', costUsd: 0 });
        svc.worktreeChanges = vi.fn(async () => []);
        const t = taskOk();
        await svc.tryOpusCoderRound(t, {}, fakeSlot);
        expect(svc.shouldEscalateToOpus(t)).toBe(false); // em cooldown
        // simula renovação: cooldown expirou
        svc.store.opusDay.cooldownUntil = new Date(Date.now() - 1000).toISOString();
        expect(svc.shouldEscalateToOpus(t)).toBe(true);  // volta a ser elegível
    });

    it('exceção no runCode (ex.: timeout) → "no-changes": CONSOME a tentativa (falha genuína, não cota)', async () => {
        claudeMock.available.mockResolvedValue(true);
        claudeMock.runCode.mockRejectedValue(new Error('opencode timeout'));
        const t = taskOk();
        expect(await svc.tryOpusCoderRound(t, {}, fakeSlot)).toBe('no-changes');
        expect(t.opusEscalated).toBe(true);         // consumida (não re-escala)
        expect(svc.opusEscalationsToday()).toBe(1);
        expect(t.opusInFlightAt).toBeUndefined();
    });

    it('CLI indisponível → "unavailable": NÃO marca (nada rodou)', async () => {
        claudeMock.available.mockResolvedValue(false);
        const t = taskOk();
        expect(await svc.tryOpusCoderRound(t, {}, fakeSlot)).toBe('unavailable');
        expect(t.opusEscalated).toBeFalsy();
        expect(svc.opusEscalationsToday()).toBe(0);
    });

    it('isError por QUALIDADE (não cota) → "no-changes", consome a tentativa, SEM cooldown', async () => {
        claudeMock.available.mockResolvedValue(true);
        claudeMock.runCode.mockResolvedValue({ isError: true, text: 'compilation failed in foo.ts', costUsd: 0.5 });
        svc.worktreeChanges = vi.fn(async () => []);
        const t = taskOk();
        expect(await svc.tryOpusCoderRound(t, {}, fakeSlot)).toBe('no-changes');
        expect(t.opusEscalated).toBe(true);     // rodou de fato → consome
        expect(svc.opusInCooldown()).toBe(false); // não é cota → sem cooldown
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

describe('escalada MANUAL (botão do admin) — forceEscalation + escalateTask', () => {
    beforeEach(() => {
        svc.scheduleExec = vi.fn();     // não dispara execução real
        svc.recordEvent = vi.fn();
        svc.emitStatus = vi.fn();
    });

    it('forceEscalation=true BYPASSA todos os gates automáticos (toggle off, score alto, já escalada)', () => {
        svc.getAutomationConfig = vi.fn(() => ({ ...CFG_OK, opusEscalationEnabled: false }));
        // task que FALHARIA em tudo: toggle off, score>=merge, já escalada, poucos rounds do juiz
        const t = taskOk({ forceEscalation: true, opusEscalated: true, judgeScore: 10, judgeAttempts: 0, judgeModelUsed: 'claude:sonnet' });
        expect(svc.shouldEscalateToOpus(t)).toBe(true);
    });

    it('sem forceEscalation, o caminho automático segue igual (não afeta a lógica existente)', () => {
        expect(svc.shouldEscalateToOpus(taskOk({ forceEscalation: false }))).toBe(true); // condições ok
        expect(svc.shouldEscalateToOpus(taskOk({ forceEscalation: false, opusEscalated: true }))).toBe(false);
    });

    it('escalateTask(opus): seta forceEscalation + override e re-enfileira', async () => {
        svc.store.tasks[7] = { issueNumber: 7, status: 'reviewing', branch: 'fix-7' };
        const t = await svc.escalateTask(7, 'opus');
        expect(t.forceEscalation).toBe(true);
        expect(t.coderEscalationModelOverride).toBe('opus');
        expect(svc.scheduleExec).toHaveBeenCalledWith(t, 'fix-7', 'running', expect.objectContaining({ id: 1 })); // #slot-chain: 4º arg = slot
    });

    it('escalateTask(FABLE): aceita e normaliza (case-insensitive)', async () => {
        svc.store.tasks[8] = { issueNumber: 8, status: 'failed', branch: 'fix-8' };
        const t = await svc.escalateTask(8, 'FABLE');
        expect(t.coderEscalationModelOverride).toBe('fable');
    });

    it('escalateTask rejeita modelo inválido', async () => {
        svc.store.tasks[9] = { issueNumber: 9, status: 'reviewing', branch: 'fix-9' };
        await expect(svc.escalateTask(9, 'gpt4')).rejects.toThrow(/inválido/i);
        expect(svc.scheduleExec).not.toHaveBeenCalled();
    });

    it('escalateTask rejeita task inexistente ou já em execução', async () => {
        await expect(svc.escalateTask(999, 'opus')).rejects.toThrow(/not found/i);
        svc.store.tasks[10] = { issueNumber: 10, status: 'running', branch: 'fix-10' };
        await expect(svc.escalateTask(10, 'opus')).rejects.toThrow(/já está/i);
    });

    it('escalateTask rejeita task TERMINAL (merged/rejected/cancelled) — não reabre trabalho fechado', async () => {
        for (const st of ['merged', 'rejected', 'rejected_precheck', 'cancelled']) {
            svc.store.tasks[20] = { issueNumber: 20, status: st, branch: 'fix-20' };
            await expect(svc.escalateTask(20, 'opus')).rejects.toThrow(/encerrada|escalável/i);
        }
        expect(svc.scheduleExec).not.toHaveBeenCalled();
    });
});
