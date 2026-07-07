import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks (hoisted) — espelham as deps externas do taskRunnerService (padrão do queue/gate test). ===
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

// axios: mockado p/ inspecionar os HEADERS enviados no download de imagem (teste de segurança).
// vi.hoisted p/ a fn existir ANTES do vi.mock hoisteado (senão "cannot access before initialization").
const { axiosGet } = vi.hoisted(() => ({ axiosGet: vi.fn(async () => ({ data: Buffer.from('img') })) }));
vi.mock('axios', () => ({ default: { get: axiosGet }, get: axiosGet }));

import { taskRunnerService } from '../../services/taskRunnerService';
const svc = taskRunnerService as any;

describe('#1154 P0-1 — segurança: token do GitHub só p/ hosts confiáveis (anti-exfiltração)', () => {
    beforeEach(() => { axiosGet.mockClear(); axiosGet.mockResolvedValue({ data: Buffer.from('img') }); });

    it('NÃO envia Authorization p/ host de ATACANTE (evil.com), mesmo com .png', async () => {
        await svc.downloadImageBase64('https://evil.com/steal.png');
        expect(axiosGet).toHaveBeenCalled();
        for (const call of axiosGet.mock.calls) {
            const headers = call[1]?.headers || {};
            expect(headers.Authorization).toBeUndefined(); // token NUNCA vaza p/ terceiros
        }
    });

    it('host confiável (user-attachments) reconhecido como GitHub', () => {
        const isTrusted = (svc.constructor as any).isTrustedGithubHost;
        expect(isTrusted('https://github.com/user-attachments/assets/x.png')).toBe(true);
        expect(isTrusted('https://objects.githubusercontent.com/y.png')).toBe(true);
        expect(isTrusted('https://evil.com/a.png')).toBe(false);
        expect(isTrusted('https://evil.githubusercontent.com.attacker.net/a.png')).toBe(false); // não casa por substring
        expect(isTrusted('não-é-url')).toBe(false);
    });
});

describe('#1154 P0-2 — timer-bomba do worktreeLock: caminho FELIZ não dispara efeitos colaterais', () => {
    beforeEach(() => {
        svc.stopPolling?.();
        svc.worktreeLock = Promise.resolve();
        svc.store = { tasks: {} };
        svc.sweepOrphanedOpencode = vi.fn(async () => false);
        svc.cleanStaleLocks = vi.fn();
        svc.save = vi.fn();
        svc.recordEvent = vi.fn();
        svc.emitStatus = vi.fn();
        vi.useFakeTimers();
        vi.clearAllTimers();
    });
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

    it('aquisição bem-sucedida CANCELA o watchdog — avançar 4h NÃO mata opencode nem falha task', async () => {
        // Semeia uma task inocente "running" que o timer-bomba (antes do fix) marcaria como failed.
        svc.store.tasks = { 42: { issueNumber: 42, status: 'running' } };

        // Aquisição no caminho FELIZ (prev já resolvido) — roda o fn e libera.
        await svc.withWorktreeLock('exec #42', async () => 'ok');

        // Avança MUITO além do watchdog (3h05). Sem o clearTimeout, o setTimeout dispararia AQUI.
        await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);

        // Efeitos colaterais do timer NÃO podem ter rodado no caminho feliz:
        expect(svc.sweepOrphanedOpencode).not.toHaveBeenCalled();
        expect(svc.store.tasks[42].status).toBe('running'); // task inocente intacta (não virou failed)
    });
});
