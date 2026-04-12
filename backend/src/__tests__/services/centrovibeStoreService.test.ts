import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('centrovibeStoreService', () => {
    let centrovibeStoreService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        mockedFs.existsSync.mockReturnValue(false);

        const mod = await import('../../services/centrovibeStoreService');
        centrovibeStoreService = mod.centrovibeStoreService;
    });

    const resetData = () => {
        centrovibeStoreService.saveData({ schedule: [], artists: [], competitors: [], externalEvents: [] });
    };

    describe('constructor / load', () => {
        it('creates data dir if not exists', () => {
            expect(mockedFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
        });

        it('loads data from file', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            const mockData = JSON.stringify({
                schedule: [{ day: '2024-01-01', theme: 'Test', events: [] }],
                artists: [{ id: 'a1', name: 'DJ Test', role: 'dj', cluster: 'house', subGenre: 'deep' }],
                competitors: [{ id: 'c1', name: 'Venue', neighborhood: 'Downtown', address: '1 St', capacity: 500, mainClusters: ['house'], priceRange: 'mid' }],
                externalEvents: [{ id: 'e1', competitorId: 'c1', title: 'Event', date: '2024-01-01', cluster: 'house', lineupNames: [] }],
            });
            mockedFs.readFileSync.mockReturnValue(mockData);

            const mod = await import('../../services/centrovibeStoreService');
            const svc = mod.centrovibeStoreService;
            expect(svc.getArtists()).toHaveLength(1);
            expect(svc.getSchedule()).toHaveLength(1);
            expect(svc.getCompetitors()).toHaveLength(1);
            expect(svc.getExternalEvents()).toHaveLength(1);
        });

        it('handles load error gracefully', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockImplementation(() => { throw new Error('fail'); });

            const mod = await import('../../services/centrovibeStoreService');
            const svc = mod.centrovibeStoreService;
            expect(svc.getData()).toEqual({ schedule: [], artists: [], competitors: [], externalEvents: [] });
        });

        it('handles missing fields with defaults', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({}));

            const mod = await import('../../services/centrovibeStoreService');
            const svc = mod.centrovibeStoreService;
            const data = svc.getData();
            expect(data.schedule).toEqual([]);
            expect(data.artists).toEqual([]);
            expect(data.competitors).toEqual([]);
            expect(data.externalEvents).toEqual([]);
        });
    });

    describe('save error handling', () => {
        it('handles atomicWriteSync error gracefully', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            const mockAtomicWrite = vi.fn().mockImplementation(() => { throw new Error('write fail'); });
            vi.doMock('../../utils/atomicWrite', () => ({ atomicWriteSync: mockAtomicWrite }));
            mockedFs.existsSync.mockReturnValue(false);

            const mod = await import('../../services/centrovibeStoreService');
            const svc = mod.centrovibeStoreService;
            svc.addArtist({ id: 'a1', name: 'Test', role: 'dj', cluster: 'house', subGenre: 'deep' });
            expect(mockAtomicWrite).toHaveBeenCalled();
        });
    });

    describe('getData / saveData', () => {
        it('returns full data', () => {
            const data = centrovibeStoreService.getData();
            expect(data).toHaveProperty('schedule');
            expect(data).toHaveProperty('artists');
            expect(data).toHaveProperty('competitors');
            expect(data).toHaveProperty('externalEvents');
        });

        it('saves full data with defaults for missing fields', () => {
            centrovibeStoreService.saveData({} as any);
            const data = centrovibeStoreService.getData();
            expect(data.schedule).toEqual([]);
            expect(data.artists).toEqual([]);
        });
    });

    describe('Schedule', () => {
        it('gets and saves schedule', () => {
            const schedule = [{ day: '2024-01-01', theme: 'Test', events: [] }];
            centrovibeStoreService.saveSchedule(schedule);
            expect(centrovibeStoreService.getSchedule()).toEqual(schedule);
        });
    });

    describe('Artists', () => {
        const artist = {
            id: 'a1', name: 'DJ Test', role: 'dj' as const,
            cluster: 'house', subGenre: 'deep',
        };

        it('starts empty', () => {
            expect(centrovibeStoreService.getArtists()).toEqual([]);
        });

        it('adds artist', () => {
            const result = centrovibeStoreService.addArtist(artist);
            expect(result).toEqual(artist);
            expect(centrovibeStoreService.getArtists()).toHaveLength(1);
        });

        it('updates artist', () => {
            centrovibeStoreService.addArtist(artist);
            const updated = centrovibeStoreService.updateArtist('a1', { name: 'DJ Updated' });
            expect(updated).not.toBeNull();
            expect(updated.name).toBe('DJ Updated');
        });

        it('returns null when updating non-existent artist', () => {
            expect(centrovibeStoreService.updateArtist('nonexistent', { name: 'X' })).toBeNull();
        });

        it('deletes artist', () => {
            centrovibeStoreService.addArtist(artist);
            expect(centrovibeStoreService.deleteArtist('a1')).toBe(true);
            expect(centrovibeStoreService.getArtists()).toHaveLength(0);
        });

        it('returns false when deleting non-existent artist', () => {
            expect(centrovibeStoreService.deleteArtist('nonexistent')).toBe(false);
        });
    });

    describe('Competitors', () => {
        const competitor = {
            id: 'c1', name: 'Venue X', neighborhood: 'Downtown', address: '123 St',
            capacity: 500, mainClusters: ['techno'], priceRange: 'mid' as const,
        };

        it('starts empty', () => {
            expect(centrovibeStoreService.getCompetitors()).toEqual([]);
        });

        it('adds competitor', () => {
            const result = centrovibeStoreService.addCompetitor(competitor);
            expect(result).toEqual(competitor);
        });

        it('updates competitor', () => {
            centrovibeStoreService.addCompetitor(competitor);
            const updated = centrovibeStoreService.updateCompetitor('c1', { name: 'Venue Y' });
            expect(updated).not.toBeNull();
            expect(updated.name).toBe('Venue Y');
        });

        it('returns null when updating non-existent competitor', () => {
            expect(centrovibeStoreService.updateCompetitor('nonexistent', { name: 'X' })).toBeNull();
        });

        it('deletes competitor', () => {
            centrovibeStoreService.addCompetitor(competitor);
            expect(centrovibeStoreService.deleteCompetitor('c1')).toBe(true);
            expect(centrovibeStoreService.getCompetitors()).toHaveLength(0);
        });

        it('returns false when deleting non-existent competitor', () => {
            expect(centrovibeStoreService.deleteCompetitor('nonexistent')).toBe(false);
        });
    });

    describe('External Events', () => {
        const event = {
            id: 'e1', competitorId: 'c1', title: 'Party', date: '2024-01-01',
            cluster: 'house', lineupNames: ['DJ A'],
        };

        it('starts empty', () => {
            expect(centrovibeStoreService.getExternalEvents()).toEqual([]);
        });

        it('adds external event', () => {
            const result = centrovibeStoreService.addExternalEvent(event);
            expect(result).toEqual(event);
        });

        it('updates external event', () => {
            centrovibeStoreService.addExternalEvent(event);
            const updated = centrovibeStoreService.updateExternalEvent('e1', { title: 'Big Party' });
            expect(updated).not.toBeNull();
            expect(updated.title).toBe('Big Party');
        });

        it('returns null when updating non-existent event', () => {
            expect(centrovibeStoreService.updateExternalEvent('nonexistent', { title: 'X' })).toBeNull();
        });

        it('deletes external event', () => {
            centrovibeStoreService.addExternalEvent(event);
            expect(centrovibeStoreService.deleteExternalEvent('e1')).toBe(true);
            expect(centrovibeStoreService.getExternalEvents()).toHaveLength(0);
        });

        it('returns false when deleting non-existent event', () => {
            expect(centrovibeStoreService.deleteExternalEvent('nonexistent')).toBe(false);
        });
    });

    describe('findCompetitorByName', () => {
        beforeEach(() => {
            centrovibeStoreService.addCompetitor({
                id: 'c1', name: 'Blue Club', neighborhood: 'Center', address: '1 St',
                capacity: 300, mainClusters: ['house'], priceRange: 'mid',
            });
            centrovibeStoreService.addCompetitor({
                id: 'c2', name: 'Red', neighborhood: 'North', address: '2 St',
                capacity: 200, mainClusters: ['techno'], priceRange: 'low',
            });
        });

        it('finds by exact name match (case insensitive)', () => {
            expect(centrovibeStoreService.findCompetitorByName('blue club')).toBeDefined();
            expect(centrovibeStoreService.findCompetitorByName('Blue Club')).toBeDefined();
        });

        it('finds by partial match (name contains search)', () => {
            expect(centrovibeStoreService.findCompetitorByName('Blue')).toBeDefined();
        });

        it('finds by partial match (search contains name)', () => {
            expect(centrovibeStoreService.findCompetitorByName('Red Lounge Event')).toBeDefined();
        });

        it('trims whitespace', () => {
            expect(centrovibeStoreService.findCompetitorByName('  Blue Club  ')).toBeDefined();
        });

        it('returns undefined for no match', () => {
            expect(centrovibeStoreService.findCompetitorByName('Green Bar')).toBeUndefined();
        });
    });

    describe('findExternalEventBySourceId', () => {
        it('finds event by sourceId', () => {
            centrovibeStoreService.addExternalEvent({
                id: 'e1', competitorId: 'c1', title: 'Event', date: '2024-01-01',
                cluster: 'house', lineupNames: [], sourceId: 'src-123',
            });
            expect(centrovibeStoreService.findExternalEventBySourceId('src-123')).toBeDefined();
        });

        it('returns undefined for unknown sourceId', () => {
            expect(centrovibeStoreService.findExternalEventBySourceId('unknown')).toBeUndefined();
        });
    });

    describe('bulkUpsertExternalEvents', () => {
        it('adds new events', () => {
            const result = centrovibeStoreService.bulkUpsertExternalEvents([
                { id: 'e1', competitorId: 'c1', title: 'Event 1', date: '2024-01-01', cluster: 'house', lineupNames: [] },
                { id: 'e2', competitorId: 'c1', title: 'Event 2', date: '2024-01-02', cluster: 'techno', lineupNames: [] },
            ]);
            expect(result.added).toBe(2);
            expect(result.updated).toBe(0);
            expect(centrovibeStoreService.getExternalEvents()).toHaveLength(2);
        });

        it('updates existing events by sourceId', () => {
            centrovibeStoreService.addExternalEvent({
                id: 'e1', competitorId: 'c1', title: 'Old Title', date: '2024-01-01',
                cluster: 'house', lineupNames: [], sourceId: 'src-1',
            });

            const result = centrovibeStoreService.bulkUpsertExternalEvents([
                { id: 'e-new', competitorId: 'c1', title: 'New Title', date: '2024-01-01',
                  cluster: 'house', lineupNames: [], sourceId: 'src-1' },
            ]);

            expect(result.added).toBe(0);
            expect(result.updated).toBe(1);

            const events = centrovibeStoreService.getExternalEvents();
            expect(events).toHaveLength(1);
            expect(events[0].title).toBe('New Title');
            expect(events[0].id).toBe('e1');
        });

        it('mixes adds and updates', () => {
            centrovibeStoreService.addExternalEvent({
                id: 'e1', competitorId: 'c1', title: 'Old', date: '2024-01-01',
                cluster: 'house', lineupNames: [], sourceId: 'src-1',
            });

            const result = centrovibeStoreService.bulkUpsertExternalEvents([
                { id: 'e-new', competitorId: 'c1', title: 'Updated', date: '2024-01-01',
                  cluster: 'house', lineupNames: [], sourceId: 'src-1' },
                { id: 'e2', competitorId: 'c1', title: 'New Event', date: '2024-01-02',
                  cluster: 'techno', lineupNames: [] },
            ]);

            expect(result.added).toBe(1);
            expect(result.updated).toBe(1);
            expect(centrovibeStoreService.getExternalEvents()).toHaveLength(2);
        });

        it('does not save when no changes', () => {
            const result = centrovibeStoreService.bulkUpsertExternalEvents([]);
            expect(result.added).toBe(0);
            expect(result.updated).toBe(0);
        });

        it('handles events without sourceId as new', () => {
            const result = centrovibeStoreService.bulkUpsertExternalEvents([
                { id: 'e1', competitorId: 'c1', title: 'No Source', date: '2024-01-01',
                  cluster: 'house', lineupNames: [] },
            ]);
            expect(result.added).toBe(1);
            expect(result.updated).toBe(0);
        });

        it('adds event with sourceId when no existing match found', () => {
            const result = centrovibeStoreService.bulkUpsertExternalEvents([
                { id: 'e1', competitorId: 'c1', title: 'New', date: '2024-01-01',
                  cluster: 'house', lineupNames: [], sourceId: 'src-new' },
            ]);
            expect(result.added).toBe(1);
            expect(result.updated).toBe(0);
        });

        it('skips update when findExternalEventBySourceId finds match but findIndex does not', () => {
            centrovibeStoreService.findExternalEventBySourceId = () => ({ id: 'e1' } as any);
            const result = centrovibeStoreService.bulkUpsertExternalEvents([
                { id: 'e-new', competitorId: 'c1', title: 'Event', date: '2024-01-01',
                  cluster: 'house', lineupNames: [], sourceId: 'src-1' },
            ]);
            expect(result.updated).toBe(0);
            expect(result.added).toBe(0);
        });
    });
});
