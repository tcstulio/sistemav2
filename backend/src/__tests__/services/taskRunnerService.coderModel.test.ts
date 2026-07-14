import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (mesmo preâmbulo das outras suítes do taskRunnerService) ===
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

// #1420: o coder consulta a saúde do provedor.
vi.mock('../../services/llmHealthService', () => ({
    llmHealthService: {
        getStatusByModule: vi.fn(),
        recordSuccess: vi.fn(),
        recordQuotaError: vi.fn(),
    },
}));

import { llmHealthService } from '../../services/llmHealthService';
import { taskRunnerService } from '../../services/taskRunnerService';

const svc = taskRunnerService as any;

// Sanidade: sem o env override, resolveCoderModel deve cair no ramo de saúde.
// (Se o ambiente de teste tivesse TASKRUNNER_OPENCODE_PRIMARY_MODEL setado, estes testes
//  falhariam alto retornando o override — o que também é um sinal válido.)
beforeEach(() => {
    vi.clearAllMocks();
});

describe('resolveCoderModel — roteamento do coder por saúde do provedor (#1420)', () => {
    it('sem override + GLM saudável (active=glm) → default do opencode (sem --model), provider glm', () => {
        vi.mocked(llmHealthService.getStatusByModule).mockReturnValue({ chain: ['glm', 'minimax'], active: 'glm', providers: [] } as any);
        expect(svc.resolveCoderModel()).toEqual({ modelArg: '', provider: 'glm' });
    });

    it('sem override + GLM exhausted (active=minimax) → MiniMax direto', () => {
        vi.mocked(llmHealthService.getStatusByModule).mockReturnValue({ chain: ['glm', 'minimax'], active: 'minimax', providers: [] } as any);
        expect(svc.resolveCoderModel()).toEqual({ modelArg: 'minimax/MiniMax-M3', provider: 'minimax' });
    });

    it('ambos exhausted (active=undefined) → cai em glm (default seguro do opencode)', () => {
        vi.mocked(llmHealthService.getStatusByModule).mockReturnValue({ chain: ['glm', 'minimax'], active: undefined, providers: [] } as any);
        expect(svc.resolveCoderModel()).toEqual({ modelArg: '', provider: 'glm' });
    });
});
