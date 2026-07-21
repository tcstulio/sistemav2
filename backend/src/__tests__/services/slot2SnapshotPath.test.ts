import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// === Harness padrão dos testes do taskRunnerService (espelha claimAtomic.test.ts) ===
// fs NÃO é mockado aqui de propósito — espiamos fs.existsSync p/ provar a derivação do snapRoot.
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
    killOpencodeOrphans: vi.fn(async () => ({ killed: [], errors: [], confirmedGone: true })),
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

afterEach(() => vi.restoreAllMocks());

describe('cleanSnapshotLockFor — snapRoot derivado do dataDir do slot (PR-1)', () => {
    it('dataDir=null (slot-1) → snapRoot = ~/.local/share/opencode/snapshot (byte-idêntico ao de antes)', () => {
        const spy = vi.spyOn(fs, 'existsSync').mockReturnValue(false); // early-return: só checamos o path
        svc.cleanSnapshotLockFor('C:/wt', null, false);
        const expected = path.join(os.homedir(), '.local', 'share', 'opencode', 'snapshot');
        expect(spy).toHaveBeenCalledWith(expected);
    });

    it('dataDir=<XDG do slot-2> → snapRoot = <XDG>/opencode/snapshot (senão o limpador do #335 não acha os snapshots do slot-2)', () => {
        const spy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        svc.cleanSnapshotLockFor('C:/slot2', 'C:/tmp/slot2-xdg', false);
        const expected = path.join('C:/tmp/slot2-xdg', 'opencode', 'snapshot');
        expect(spy).toHaveBeenCalledWith(expected);
    });
});
