import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('simulatorStore', () => {
    let simulatorStore: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        mockedFs.existsSync.mockReturnValue(false);

        const mod = await import('../../services/simulatorStore');
        simulatorStore = mod.simulatorStore;
    });

    describe('constructor / load', () => {
        it('creates data dir if not exists', () => {
            expect(mockedFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
        });

        it('starts with empty simulations list', () => {
            expect(simulatorStore.list()).toEqual([]);
        });

        it('loads persisted simulations from file', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            const snap = {
                id: '1',
                name: 'Test',
                date: 1000,
                data: { x: 1 },
                summary: { revenue: 100, profit: 50, modelLabel: 'A' }
            };
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ simulations: [snap] }));

            const mod = await import('../../services/simulatorStore');
            expect(mod.simulatorStore.list()).toEqual([snap]);
        });

        it('handles load error gracefully with empty list', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockImplementation(() => { throw new Error('fail'); });

            const mod = await import('../../services/simulatorStore');
            expect(mod.simulatorStore.list()).toEqual([]);
        });

        it('handles corrupted JSON gracefully with empty list', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue('not-json{');

            const mod = await import('../../services/simulatorStore');
            expect(mod.simulatorStore.list()).toEqual([]);
        });
    });

    describe('create', () => {
        it('persists a new snapshot and appears in list', () => {
            const snap = {
                id: '1',
                name: 'Test',
                date: 1000,
                data: { x: 1 },
                summary: { revenue: 100, profit: 50, modelLabel: 'A' }
            };
            const result = simulatorStore.create(snap);
            expect(result).toEqual(snap);
            expect(simulatorStore.list()).toHaveLength(1);
            expect(simulatorStore.list()[0]).toEqual(snap);
        });

        it('calls atomicWriteSync on create', async () => {
            const { atomicWriteSync } = await import('../../utils/atomicWrite');
            const writeSpy = vi.mocked(atomicWriteSync);
            writeSpy.mockClear();

            simulatorStore.create({ id: '2', name: 'B', date: 2000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'B' } });
            expect(writeSpy).toHaveBeenCalledTimes(1);
        });

        it('prepends new snapshot to list', () => {
            simulatorStore.create({ id: '1', name: 'First', date: 1000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'A' } });
            simulatorStore.create({ id: '2', name: 'Second', date: 2000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'B' } });
            expect(simulatorStore.list()[0].id).toBe('2');
            expect(simulatorStore.list()[1].id).toBe('1');
        });
    });

    describe('update', () => {
        it('updates name and reflects in list', () => {
            simulatorStore.create({ id: '1', name: 'Old', date: 1000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'A' } });
            const updated = simulatorStore.update('1', { name: 'New' });
            expect(updated).not.toBeNull();
            expect(updated.name).toBe('New');
            expect(simulatorStore.list()[0].name).toBe('New');
        });

        it('returns null for non-existent id', () => {
            expect(simulatorStore.update('999', { name: 'X' })).toBeNull();
        });

        it('calls atomicWriteSync on update', async () => {
            const { atomicWriteSync } = await import('../../utils/atomicWrite');
            const writeSpy = vi.mocked(atomicWriteSync);
            simulatorStore.create({ id: '1', name: 'A', date: 1000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'A' } });
            writeSpy.mockClear();
            simulatorStore.update('1', { name: 'Updated' });
            expect(writeSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('delete', () => {
        it('removes an existing snapshot', () => {
            simulatorStore.create({ id: '1', name: 'A', date: 1000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'A' } });
            const result = simulatorStore.delete('1');
            expect(result).toBe(true);
            expect(simulatorStore.list()).toHaveLength(0);
        });

        it('returns false when id not found', () => {
            expect(simulatorStore.delete('999')).toBe(false);
        });

        it('calls atomicWriteSync on delete', async () => {
            const { atomicWriteSync } = await import('../../utils/atomicWrite');
            const writeSpy = vi.mocked(atomicWriteSync);
            simulatorStore.create({ id: '1', name: 'A', date: 1000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'A' } });
            writeSpy.mockClear();
            simulatorStore.delete('1');
            expect(writeSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('getById', () => {
        it('returns the snapshot when found', () => {
            const snap = { id: '1', name: 'A', date: 1000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'A' } };
            simulatorStore.create(snap);
            expect(simulatorStore.getById('1')).toEqual(snap);
        });

        it('returns undefined when not found', () => {
            expect(simulatorStore.getById('999')).toBeUndefined();
        });
    });

    describe('save error propagation', () => {
        it('propagates atomicWriteSync errors from create', async () => {
            vi.resetModules();
            const atomicMod = await import('../../utils/atomicWrite');
            vi.mocked(atomicMod.atomicWriteSync).mockImplementationOnce(() => { throw new Error('write fail'); });

            const mod = await import('../../services/simulatorStore');
            const svc = mod.simulatorStore;

            expect(() => svc.create({ id: '1', name: 'A', date: 1000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'A' } }))
                .toThrow('write fail');
        });
    });
});
