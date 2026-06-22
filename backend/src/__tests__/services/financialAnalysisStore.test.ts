import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('financialAnalysisStore', () => {
    let financialAnalysisStore: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        mockedFs.existsSync.mockReturnValue(false);

        const mod = await import('../../services/financialAnalysisStore');
        financialAnalysisStore = mod.financialAnalysisStore;
    });

    describe('constructor / load', () => {
        it('creates data dir if not exists', () => {
            expect(mockedFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
        });

        it('starts with null analysis and default config', () => {
            expect(financialAnalysisStore.getAnalysis()).toBeNull();
            const cfg = financialAnalysisStore.getAutomationConfig();
            expect(cfg).toEqual({
                enabled: false,
                schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
                lastRunAt: null,
                lastRunStatus: null
            });
        });

        it('loads persisted analysis + config from file', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            const persisted = {
                analysis: { data: { kpi: 42 }, lastRunAt: '2025-01-01T00:00:00.000Z', status: 'success' },
                automationConfig: {
                    enabled: true,
                    schedule: { dayOfWeek: 3, hour: 14, minute: 30 },
                    lastRunAt: '2025-01-02T00:00:00.000Z',
                    lastRunStatus: 'success'
                }
            };
            mockedFs.readFileSync.mockReturnValue(JSON.stringify(persisted));

            const mod = await import('../../services/financialAnalysisStore');
            const svc = mod.financialAnalysisStore;

            expect(svc.getAnalysis()).toEqual(persisted.analysis);
            expect(svc.getAutomationConfig()).toEqual(persisted.automationConfig);
        });

        it('handles load error gracefully with defaults', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockImplementation(() => { throw new Error('fail'); });

            const mod = await import('../../services/financialAnalysisStore');
            const svc = mod.financialAnalysisStore;
            expect(svc.getAnalysis()).toBeNull();
            expect(svc.getAutomationConfig().enabled).toBe(false);
        });

        it('normalizes missing/partial config fields with defaults', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ analysis: null, automationConfig: { enabled: true } }));

            const mod = await import('../../services/financialAnalysisStore');
            const svc = mod.financialAnalysisStore;
            const cfg = svc.getAutomationConfig();
            expect(cfg.enabled).toBe(true);
            expect(cfg.schedule).toEqual({ dayOfWeek: 1, hour: 8, minute: 0 });
            expect(cfg.lastRunAt).toBeNull();
            expect(cfg.lastRunStatus).toBeNull();
        });

        it('handles corrupted JSON gracefully', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue('not-json{');

            const mod = await import('../../services/financialAnalysisStore');
            const svc = mod.financialAnalysisStore;
            expect(svc.getAnalysis()).toBeNull();
            expect(svc.getAutomationConfig().enabled).toBe(false);
        });
    });

    describe('save error handling', () => {
        it('propagates atomicWriteSync errors from saveAnalysis', async () => {
            vi.resetModules();

            const atomicMod = await import('../../utils/atomicWrite');
            vi.mocked(atomicMod.atomicWriteSync).mockImplementationOnce(() => { throw new Error('write fail'); });

            const mod = await import('../../services/financialAnalysisStore');
            const svc = mod.financialAnalysisStore;
            expect(() => svc.saveAnalysis({ data: { x: 1 }, status: 'success' })).toThrow('write fail');
            expect(atomicMod.atomicWriteSync).toHaveBeenCalled();
        });

        it('propagates atomicWriteSync errors from saveAutomationConfig', async () => {
            vi.resetModules();

            const atomicMod = await import('../../utils/atomicWrite');
            vi.mocked(atomicMod.atomicWriteSync).mockImplementationOnce(() => { throw new Error('write fail'); });

            const mod = await import('../../services/financialAnalysisStore');
            const svc = mod.financialAnalysisStore;
            expect(() => svc.saveAutomationConfig({ enabled: true })).toThrow('write fail');
            expect(atomicMod.atomicWriteSync).toHaveBeenCalled();
        });
    });

    describe('getAnalysis / saveAnalysis', () => {
        it('returns null when never saved', () => {
            expect(financialAnalysisStore.getAnalysis()).toBeNull();
        });

        it('saves a success snapshot stamping lastRunAt automatically', () => {
            const result = financialAnalysisStore.saveAnalysis({ data: { revenue: 1000 }, status: 'success' });
            expect(result.status).toBe('success');
            expect(result.data).toEqual({ revenue: 1000 });
            expect(result.lastRunAt).toEqual(expect.any(String));
            expect(new Date(result.lastRunAt).getTime()).not.toBeNaN();
            expect(result.error).toBeUndefined();

            const stored = financialAnalysisStore.getAnalysis();
            expect(stored).toEqual(result);
        });

        it('saves an error snapshot with error message', () => {
            const result = financialAnalysisStore.saveAnalysis({ data: null, status: 'error', error: 'boom' });
            expect(result.status).toBe('error');
            expect(result.error).toBe('boom');
            expect(financialAnalysisStore.getAnalysis()).toEqual(result);
        });

        it('overwrites previous snapshot (only latest is kept)', () => {
            financialAnalysisStore.saveAnalysis({ data: 'first', status: 'success' });
            financialAnalysisStore.saveAnalysis({ data: 'second', status: 'success' });
            expect(financialAnalysisStore.getAnalysis().data).toBe('second');
        });

        it('respects an explicit lastRunAt override', () => {
            const fixed = '2024-12-31T23:59:59.000Z';
            const result = financialAnalysisStore.saveAnalysis({ data: {}, status: 'success', lastRunAt: fixed });
            expect(result.lastRunAt).toBe(fixed);
        });
    });

    describe('getAutomationConfig / saveAutomationConfig', () => {
        it('returns default config', () => {
            const cfg = financialAnalysisStore.getAutomationConfig();
            expect(cfg.enabled).toBe(false);
            expect(cfg.schedule).toEqual({ dayOfWeek: 1, hour: 8, minute: 0 });
        });

        it('updates enabled only, preserving schedule', () => {
            const cfg = financialAnalysisStore.saveAutomationConfig({ enabled: true });
            expect(cfg.enabled).toBe(true);
            expect(cfg.schedule).toEqual({ dayOfWeek: 1, hour: 8, minute: 0 });
            expect(financialAnalysisStore.getAutomationConfig().enabled).toBe(true);
        });

        it('updates schedule only, preserving enabled', () => {
            financialAnalysisStore.saveAutomationConfig({ enabled: true });
            const cfg = financialAnalysisStore.saveAutomationConfig({ schedule: { dayOfWeek: 5, hour: 9, minute: 15 } });
            expect(cfg.enabled).toBe(true);
            expect(cfg.schedule).toEqual({ dayOfWeek: 5, hour: 9, minute: 15 });
        });

        it('updates lastRunAt and lastRunStatus', () => {
            const cfg = financialAnalysisStore.saveAutomationConfig({
                lastRunAt: '2025-06-17T10:00:00.000Z',
                lastRunStatus: 'success'
            });
            expect(cfg.lastRunAt).toBe('2025-06-17T10:00:00.000Z');
            expect(cfg.lastRunStatus).toBe('success');
        });

        it('can clear lastRunAt back to null', () => {
            financialAnalysisStore.saveAutomationConfig({ lastRunAt: '2025-06-17T10:00:00.000Z' });
            const cfg = financialAnalysisStore.saveAutomationConfig({ lastRunAt: null });
            expect(cfg.lastRunAt).toBeNull();
        });

        it('preserves previously saved state across partial updates', () => {
            financialAnalysisStore.saveAutomationConfig({ enabled: true, schedule: { dayOfWeek: 2, hour: 3, minute: 4 } });
            const cfg = financialAnalysisStore.saveAutomationConfig({ lastRunStatus: 'error' });
            expect(cfg).toEqual({
                enabled: true,
                schedule: { dayOfWeek: 2, hour: 3, minute: 4 },
                lastRunAt: null,
                lastRunStatus: 'error'
            });
        });

        it('returns a new object reference (does not expose internal state mutation)', () => {
            const a = financialAnalysisStore.getAutomationConfig();
            const b = financialAnalysisStore.getAutomationConfig();
            // saving returns a fresh object too
            const c = financialAnalysisStore.saveAutomationConfig({ enabled: true });
            expect(c).not.toBe(a);
            expect(b).toEqual(a);
        });
    });

    describe('persistence round-trip', () => {
        it('writes the full store (analysis + config) to disk via atomicWriteSync', async () => {
            const { atomicWriteSync } = await import('../../utils/atomicWrite');
            const writeSpy = vi.mocked(atomicWriteSync);
            writeSpy.mockClear();

            financialAnalysisStore.saveAnalysis({ data: { revenue: 1000 }, status: 'success' });
            financialAnalysisStore.saveAutomationConfig({ enabled: true });

            expect(writeSpy.mock.calls.length).toBe(2);
            const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1][1] as any;
            expect(lastCall.analysis.data).toEqual({ revenue: 1000 });
            expect(lastCall.analysis.status).toBe('success');
            expect(lastCall.automationConfig.enabled).toBe(true);
            expect(lastCall.automationConfig.schedule).toEqual({ dayOfWeek: 1, hour: 8, minute: 0 });
        });

        it('saveAutomationConfig persists the config to file and returns the merged config', async () => {
            const { atomicWriteSync } = await import('../../utils/atomicWrite');
            const writeSpy = vi.mocked(atomicWriteSync);
            writeSpy.mockClear();

            const result = financialAnalysisStore.saveAutomationConfig({
                enabled: true,
                schedule: { dayOfWeek: 2, hour: 9, minute: 30 }
            });

            // returns the merged config (caminho sucesso)
            expect(result).toEqual({
                enabled: true,
                schedule: { dayOfWeek: 2, hour: 9, minute: 30 },
                lastRunAt: null,
                lastRunStatus: null
            });

            // persists the config to file via atomicWriteSync
            expect(writeSpy).toHaveBeenCalledTimes(1);
            const persisted = writeSpy.mock.calls[0][1] as any;
            expect(persisted.automationConfig).toEqual(result);
            expect(persisted.automationConfig.enabled).toBe(true);
            expect(persisted.automationConfig.schedule).toEqual({ dayOfWeek: 2, hour: 9, minute: 30 });
        });
    });
});

// Integration tests against the REAL filesystem / REAL atomicWriteSync.
// These run last and unmock the file-level mocks within their own bodies, so
// they do not interfere with the mocked tests above (mock state is per-file and
// vitest runs tests in definition order).
describe('financialAnalysisStore — real filesystem (atomicWriteSync & save() error propagation)', () => {
    it('save() propagates the error when fs.writeFileSync fails (not silenced)', async () => {
        // Use the REAL atomicWriteSync (which calls fs.writeFileSync) while keeping fs
        // mocked so we can force writeFileSync to throw.
        vi.doUnmock('../../utils/atomicWrite');
        vi.resetModules();

        const fs = await import('fs');
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
        vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
            throw new Error('disk write failed');
        });

        const mod = await import('../../services/financialAnalysisStore');
        const svc = mod.financialAnalysisStore;

        expect(() => svc.saveAutomationConfig({ enabled: true })).toThrow('disk write failed');
        // writeFileSync was actually invoked → the error went through fs.writeFileSync, not silenced
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('atomicWriteSync creates the parent directory recursively when it does not exist (isolated tmpdir)', async () => {
        vi.doUnmock('fs');
        vi.doUnmock('../../utils/atomicWrite');
        vi.resetModules();

        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const { atomicWriteSync } = await import('../../utils/atomicWrite');

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fastore-realdir-'));
        const nested = path.join(tmp, 'deep', 'nested', 'dir', 'config.json');

        try {
            expect(fs.existsSync(path.dirname(nested))).toBe(false);

            atomicWriteSync(nested, {
                enabled: true,
                schedule: { dayOfWeek: 2, hour: 9, minute: 30 }
            });

            // the file was written ...
            expect(fs.existsSync(nested)).toBe(true);
            expect(JSON.parse(fs.readFileSync(nested, 'utf-8'))).toEqual({
                enabled: true,
                schedule: { dayOfWeek: 2, hour: 9, minute: 30 }
            });
            // ... and the previously-missing directory was created
            expect(fs.existsSync(path.dirname(nested))).toBe(true);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
