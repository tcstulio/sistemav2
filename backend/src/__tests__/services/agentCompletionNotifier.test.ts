import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do aiJobService: precisamos controlar onTransition (registrar listeners).
const mockOnTransition = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock('../../services/aiJobService', () => ({
    aiJobService: { onTransition: mockOnTransition },
}));

// Mock do notificationService: spy do notifyPerson.
const mockNotifyPerson = vi.hoisted(() => vi.fn(async () => ({ id: 'notif-1' })));

vi.mock('../../services/notificationService', () => ({
    notificationService: { notifyPerson: mockNotifyPerson },
}));

// Mock do userNotifyPrefsStore: objeto mutável para testes forçarem opt-out.
const mockPrefs = vi.hoisted(() => ({
    optedOut: new Set<string>(),
    isOptedOut: vi.fn((uid: string) => mockPrefs.optedOut.has(uid)),
    reset() { mockPrefs.optedOut.clear(); },
}));

vi.mock('../../services/userNotifyPrefsStore', () => ({
    userNotifyPrefsStore: { isOptedOut: mockPrefs.isOptedOut },
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Importa DEPOIS dos mocks. jobState é o módulo REAL (em memória).
import { handleTransition, buildSummary, agentCompletionNotifier } from '../../services/agentCompletionNotifier';
import { jobState } from '../../agent/jobState';
import type { AiJob, AiJobTransition } from '../../services/aiJobService';

function mkJob(over: Partial<AiJob> = {}): AiJob {
    return {
        id: 'job-1',
        status: 'done',
        createdAt: 1,
        finishedAt: 2,
        ...over,
    } as AiJob;
}

function mkTransition(job: AiJob, from: any = 'running', to: any = job.status): AiJobTransition {
    return { jobId: job.id, from, to, job };
}

describe('agentCompletionNotifier (#1578)', () => {
    beforeEach(() => {
        jobState._clearAllForTests();
        mockNotifyPerson.mockClear();
        mockNotifyPerson.mockResolvedValue({ id: 'notif-1' });
        mockOnTransition.mockClear();
        mockOnTransition.mockReturnValue(() => {});
        mockPrefs.reset();
        mockPrefs.isOptedOut.mockClear();
        mockPrefs.isOptedOut.mockImplementation((uid: string) => mockPrefs.optedOut.has(uid));
        agentCompletionNotifier.stop();
    });

    describe('buildSummary', () => {
        it('done com reply de múltiplas linhas → primeira linha, prefixada', () => {
            const job = mkJob({
                status: 'done',
                result: { reply: 'Criei a proposta #123 para ACME.\nSegunda linha.\nTerceira.' },
            });
            expect(buildSummary(job)).toBe('Pronto: Criei a proposta #123 para ACME.');
        });

        it('done com reply tipo string direta (sem envelope)', () => {
            const job = mkJob({ status: 'done', result: 'Tarefa concluída com sucesso' });
            expect(buildSummary(job)).toBe('Pronto: Tarefa concluída com sucesso');
        });

        it('error → prefixo "Pronto (com erro):" + primeira linha do erro', () => {
            const job = mkJob({ status: 'error', error: 'API timeout\nDetalhe técnico' });
            expect(buildSummary(job)).toBe('Pronto (com erro): API timeout');
        });

        it('error sem message → fallback humano', () => {
            const job = mkJob({ status: 'error', error: undefined });
            expect(buildSummary(job)).toBe('Pronto (com erro): falha ao processar');
        });

        it('done sem reply → fallback p/ o label do job', () => {
            const job = mkJob({ status: 'done', result: { foo: 'bar' }, label: 'chat' });
            expect(buildSummary(job)).toBe('Pronto: chat');
        });

        it('trunca resumos longos em 140 chars (prefixo incluso)', () => {
            const long = 'x'.repeat(500);
            const job = mkJob({ status: 'done', result: { reply: long } });
            const summary = buildSummary(job);
            expect(summary.startsWith('Pronto: ')).toBe(true);
            expect(summary.length).toBeLessThanOrEqual('Pronto: '.length + 140);
        });
    });

    describe('handleTransition — gating (silêncios)', () => {
        it('silencia quando aba está VISÍVEL (tabHidden=false)', async () => {
            jobState.init('job-vis', { userId: 'u1', tabHidden: false });
            await handleTransition(mkTransition(mkJob({ id: 'job-vis' })));
            expect(mockNotifyPerson).not.toHaveBeenCalled();
            expect(jobState.get('job-vis')!.notified).toBe(true);
        });

        it('silencia quando usuário está em opt-out (mesmo com aba oculta)', async () => {
            mockPrefs.optedOut.add('u-opt');
            jobState.init('job-opt', { userId: 'u-opt', tabHidden: true });
            await handleTransition(mkTransition(mkJob({ id: 'job-opt' })));
            expect(mockNotifyPerson).not.toHaveBeenCalled();
            expect(mockPrefs.isOptedOut).toHaveBeenCalledWith('u-opt');
            expect(jobState.get('job-opt')!.notified).toBe(true);
        });

        it('silencia quando job não está trackeado no jobState', async () => {
            // sem init — job desconhecido do jobState
            await handleTransition(mkTransition(mkJob({ id: 'job-unknown' })));
            expect(mockNotifyPerson).not.toHaveBeenCalled();
        });

        it('silencia quando userId ausente do jobState', async () => {
            jobState.init('job-nouserid', { tabHidden: true } as any);
            await handleTransition(mkTransition(mkJob({ id: 'job-nouserid' })));
            expect(mockNotifyPerson).not.toHaveBeenCalled();
            expect(jobState.get('job-nouserid')!.notified).toBe(true);
        });

        it('IGNORA transições NÃO-terminais (running → running, queued → running)', async () => {
            jobState.init('job-run', { userId: 'u1', tabHidden: true });
            await handleTransition({ jobId: 'job-run', from: 'queued', to: 'running', job: mkJob({ id: 'job-run', status: 'running' }) });
            expect(mockNotifyPerson).not.toHaveBeenCalled();
            // notified não foi marcado (transição ignorada, não "decidida")
            expect(jobState.get('job-run')!.notified).toBeUndefined();
        });

        it('dedupe: segunda transição terminal não dispara de novo', async () => {
            jobState.init('job-dedup', { userId: 'u1', tabHidden: true });
            await handleTransition(mkTransition(mkJob({ id: 'job-dedup' })));
            expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
            await handleTransition(mkTransition(mkJob({ id: 'job-dedup', status: 'error' })));
            expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
        });
    });

    describe('handleTransition — caminho feliz (dispara notify_person)', () => {
        it('aba oculta + opt-in → notify_person com summary de 1 linha (done)', async () => {
            jobState.init('job-ok', {
                userId: 'u1',
                userName: 'Ana',
                tabHidden: true,
                label: 'chat',
            });
            const job = mkJob({
                id: 'job-ok',
                status: 'done',
                result: { reply: 'Proposta #123 criada para ACME.' },
            });
            await handleTransition(mkTransition(job));

            expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
            const call = mockNotifyPerson.mock.calls[0][0];
            expect(call.recipient).toBe('u1');
            expect(call.recipientName).toBe('Ana');
            expect(call.event).toBe('agent.action');
            expect(call.channels).toEqual(['in-app']);
            // critério de aceite: "summary de 1 linha com texto correto"
            expect(call.message).toBe('Pronto: Proposta #123 criada para ACME.');
            expect(jobState.get('job-ok')!.notified).toBe(true);
        });

        it('aba oculta + opt-in → notify_person com summary de erro (error)', async () => {
            jobState.init('job-err', { userId: 'u1', tabHidden: true });
            const job = mkJob({ id: 'job-err', status: 'error', error: 'Falha ao salvar' });
            await handleTransition(mkTransition(job));

            expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
            const call = mockNotifyPerson.mock.calls[0][0];
            expect(call.message).toBe('Pronto (com erro): Falha ao salvar');
        });

        it('falha do notify_person NÃO lança — marca notified e loga', async () => {
            mockNotifyPerson.mockRejectedValueOnce(new Error('socket down'));
            jobState.init('job-fail', { userId: 'u1', tabHidden: true });
            const job = mkJob({ id: 'job-fail', result: { reply: 'ok' } });
            await expect(handleTransition(mkTransition(job))).resolves.toBeUndefined();
            expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
            // dedupe: marca notified mesmo em falha (não retenta)
            expect(jobState.get('job-fail')!.notified).toBe(true);
        });
    });

    describe('start / stop (wiring com aiJobService)', () => {
        it('start assina onTransition UMA vez; start duplicado é no-op', () => {
            agentCompletionNotifier.start();
            agentCompletionNotifier.start();
            expect(mockOnTransition).toHaveBeenCalledTimes(1);
            expect(agentCompletionNotifier._isStarted()).toBe(true);
        });

        it('stop desliga o notifier (idempotente)', () => {
            agentCompletionNotifier.start();
            agentCompletionNotifier.stop();
            agentCompletionNotifier.stop();
            expect(agentCompletionNotifier._isStarted()).toBe(false);
        });

        it('handler registrado é o handleTransition exportado', () => {
            agentCompletionNotifier.start();
            const registered = mockOnTransition.mock.calls[0][0];
            expect(registered).toBe(handleTransition);
        });
    });
});
