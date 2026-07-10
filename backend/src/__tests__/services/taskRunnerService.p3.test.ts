import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { taskRunnerService } from '../../services/taskRunnerService';
const svc = taskRunnerService as any;

beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); });

describe('#1154 P3 item 27 — countTestChanges: converter it() em it.each() NÃO é regressão', () => {
    it('it() → it.each() dá net 0 (added=1, removed=1)', () => {
        const diff = [
            'diff --git a/foo.test.ts b/foo.test.ts',
            "-  it('soma', () => { expect(1+1).toBe(2); })",
            "+  it.each([[1,1,2],[2,2,4]])('soma %s+%s', (a,b,r) => { expect(a+b).toBe(r); })",
        ].join('\n');
        const r = svc.countTestChanges(diff);
        expect(r.added).toBe(1);
        expect(r.removed).toBe(1); // net 0 → checkTestRegression NÃO bloqueia
    });

    it('test.each e it.concurrent.each também contam como caso', () => {
        const diff = [
            'diff --git a/x.test.ts b/x.test.ts',
            "+  test.each([1])('a', () => {})",
            "+  it.concurrent.each([1])('b', () => {})",
        ].join('\n');
        expect(svc.countTestChanges(diff).added).toBe(2);
    });

    it('remover casos de verdade continua contando como regressão', () => {
        const diff = [
            'diff --git a/bar.test.ts b/bar.test.ts',
            "-  it('x', () => {})",
            "-  test('y', () => {})",
            "+  it('z', () => {})",
        ].join('\n');
        const r = svc.countTestChanges(diff);
        expect(r.removed).toBe(2);
        expect(r.added).toBe(1); // net -1 → regressão detectada
    });

    it('arquivo de teste APAGADO é capturado', () => {
        const diff = [
            'diff --git a/gone.test.ts b/gone.test.ts',
            'deleted file mode 100644',
            'diff --git a/keep.ts b/keep.ts',
            'deleted file mode 100644', // não é arquivo de teste → ignorado
        ].join('\n');
        expect(svc.countTestChanges(diff).deletedTestFiles).toEqual(['gone.test.ts']);
    });
});
