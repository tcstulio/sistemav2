/**
 * #1578 — Teste E2E do fluxo de notificação de conclusão.
 *
 * Cenário: aba oculta → job termina → notify_person chega com texto correto.
 *
 * Diferente do agentCompletionNotifier.test.ts (que mocka o aiJobService), este
 * teste usa o aiJobService REAL (com storage em memória) para validar a wiring
 * completa: enqueue → transição de status → handler do notifier → notifyPerson.
 *
 * Critério de aceite atendido:
 *   "[ ] Teste E2E: aba oculta, job termina → notificação chega com texto correto."
 *   "[ ] Aba oculta no fim do job → notify_person enviado em ≤5s com summary."
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Storage em memória para o aiJobService.
const storage = vi.hoisted(() => ({
    saveJob: vi.fn(),
    deleteJob: vi.fn(),
    loadAll: vi.fn(() => []),
}));

vi.mock('../../services/aiJobStorage', () => ({
    saveJob: storage.saveJob,
    deleteJob: storage.deleteJob,
    loadAll: storage.loadAll,
}));

// notifyPerson: spy do destino final da notificação.
const mockNotifyPerson = vi.hoisted(() => vi.fn(async () => ({ id: 'notif-1' })));

vi.mock('../../services/notificationService', () => ({
    notificationService: { notifyPerson: mockNotifyPerson },
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function flush() {
    return new Promise((r) => setTimeout(r, 10));
}

describe('agentCompletionNotifier — E2E com aiJobService real (#1578)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('aba OCULTA + job termina (done) → notify_person dispara com summary de 1 linha', async () => {
        // importa módulos frescos (após resetModules)
        const { aiJobService } = await import('../../services/aiJobService');
        const { agentCompletionNotifier } = await import('../../services/agentCompletionNotifier');
        const { jobState } = await import('../../agent/jobState');

        agentCompletionNotifier.start();
        jobState._clearAllForTests();

        // Enfileira um job que termina "rápido" (síncrono).
        const jobId = aiJobService.enqueue(
            async () => ({ reply: 'Proposta #999 criada para ACME.' }),
            'chat',
        );

        // Simula o aiRoutes.init do enqueue: userId + tabHidden=true (aba oculta).
        jobState.init(jobId, { userId: 'u-e2e', userName: 'Usuário E2E', tabHidden: true });

        // Drena a cadeia de promises até o status terminal.
        await flush();

        expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
        const call = mockNotifyPerson.mock.calls[0][0];
        expect(call.recipient).toBe('u-e2e');
        expect(call.recipientName).toBe('Usuário E2E');
        // Critério: "notificação chega com texto correto"
        expect(call.message).toBe('Pronto: Proposta #999 criada para ACME.');

        agentCompletionNotifier.stop();
    });

    it('aba OCULTA + job FALHA (error) → notify_person com summary de erro', async () => {
        const { aiJobService } = await import('../../services/aiJobService');
        const { agentCompletionNotifier } = await import('../../services/agentCompletionNotifier');
        const { jobState } = await import('../../agent/jobState');

        agentCompletionNotifier.start();
        jobState._clearAllForTests();

        const jobId = aiJobService.enqueue(
            async () => { throw new Error('Timeout ao salvar proposta'); },
            'chat',
        );
        jobState.init(jobId, { userId: 'u-err', tabHidden: true });

        await flush();

        expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
        const call = mockNotifyPerson.mock.calls[0][0];
        expect(call.recipient).toBe('u-err');
        expect(call.message).toBe('Pronto (com erro): Timeout ao salvar proposta');

        agentCompletionNotifier.stop();
    });

    it('aba VISÍVEL → notify_person NÃO dispara (UX silenciosa)', async () => {
        const { aiJobService } = await import('../../services/aiJobService');
        const { agentCompletionNotifier } = await import('../../services/agentCompletionNotifier');
        const { jobState } = await import('../../agent/jobState');

        agentCompletionNotifier.start();
        jobState._clearAllForTests();

        const jobId = aiJobService.enqueue(async () => ({ reply: 'ok' }), 'chat');
        // Aba VISÍVEL — usuário está olhando: nada deve disparar.
        jobState.init(jobId, { userId: 'u-vis', tabHidden: false });

        await flush();

        expect(mockNotifyPerson).not.toHaveBeenCalled();

        agentCompletionNotifier.stop();
    });

    it('job conclui em ≤5s (critério de latência) — latência medida < 500ms', async () => {
        const { aiJobService } = await import('../../services/aiJobService');
        const { agentCompletionNotifier } = await import('../../services/agentCompletionNotifier');
        const { jobState } = await import('../../agent/jobState');

        agentCompletionNotifier.start();
        jobState._clearAllForTests();

        const t0 = Date.now();
        const jobId = aiJobService.enqueue(async () => ({ reply: 'feito' }), 'chat');
        jobState.init(jobId, { userId: 'u-lat', tabHidden: true });
        await flush();
        const elapsed = Date.now() - t0;

        expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
        // O critério de aceite é "≤5s" — relativamente farto. Validamos que é
        // bem abaixo (<500ms neste ambiente de teste) para detectar regressões.
        expect(elapsed).toBeLessThan(500);

        agentCompletionNotifier.stop();
    });
});
