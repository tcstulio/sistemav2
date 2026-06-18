import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/aiService', () => ({
    aiService: {
        generateReply: vi.fn(),
    },
}));

vi.mock('../../services/centrovibeStoreService', () => ({
    centrovibeStoreService: {
        findExternalEventBySourceId: vi.fn(),
        findCompetitorByName: vi.fn(),
        addCompetitor: vi.fn(),
        bulkUpsertExternalEvents: vi.fn(),
    },
}));

vi.mock('../../services/scrapers/symplaScraper', () => ({
    symplaScraper: { scrape: vi.fn() },
}));

vi.mock('../../services/scrapers/shotgunScraper', () => ({
    shotgunScraper: { scrape: vi.fn() },
}));

vi.mock('../../services/scrapers/blacktagScraper', () => ({
    blacktagScraper: { scrape: vi.fn() },
}));

const makeConfig = (overrides: any = {}) => {
    const { sources: srcOverride, ...rest } = overrides;
    return {
        autoRun: true,
        intervalHours: 6,
        ...rest,
        sources: {
            sympla: { enabled: true, url: 'https://sympla.test', maxPages: 3 },
            shotgun: { enabled: true, url: 'https://shotgun.test' },
            blacktag: { enabled: true, url: 'https://blacktag.test' },
            ...srcOverride,
        },
    };
};

vi.mock('../../services/scraperConfigStore', () => ({
    scraperConfigStore: { getConfig: vi.fn() },
}));

import { eventScraperService } from '../../services/eventScraperService';
import { aiService } from '../../services/aiService';
import { centrovibeStoreService } from '../../services/centrovibeStoreService';
import { symplaScraper } from '../../services/scrapers/symplaScraper';
import { shotgunScraper } from '../../services/scrapers/shotgunScraper';
import { blacktagScraper } from '../../services/scrapers/blacktagScraper';
import { scraperConfigStore } from '../../services/scraperConfigStore';

describe('EventScraperService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (scraperConfigStore.getConfig as any).mockReturnValue(makeConfig());
    });

    afterEach(() => {
        eventScraperService.stopWorker();
        vi.useRealTimers();
    });

    const mockRawEvent = (overrides = {}) => ({
        sourceId: 'evt-1',
        title: 'Funk Night',
        date: '2024-03-15',
        venueName: 'Club XYZ',
        venueNeighborhood: 'Centro',
        venueAddress: 'Rua 1',
        genre: 'Funk',
        description: 'A funk party',
        lineupNames: ['DJ Test'],
        ticketPrice: 50,
        isFree: false,
        source: 'sympla' as const,
        sourceUrl: 'https://sympla.com/evt1',
        imageUrl: 'https://img.com/1.jpg',
        ...overrides,
    });

    describe('getStatus', () => {
        it('returns initial status', () => {
            const status = eventScraperService.getStatus();
            expect(status.isRunning).toBe(false);
            expect(status.platforms.sympla).toBeDefined();
            expect(status.platforms.shotgun).toBeDefined();
            expect(status.platforms.blacktag).toBeDefined();
        });
    });

    describe('runScrape', () => {
        it('skips if already running', async () => {
            (eventScraperService as any).status.isRunning = true;
            const status = await eventScraperService.runScrape();
            expect(status.isRunning).toBe(true);
            (eventScraperService as any).status.isRunning = false;
        });

        it('handles no events scraped', async () => {
            (symplaScraper.scrape as any).mockResolvedValue([]);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);

            const status = await eventScraperService.runScrape();
            expect(status.isRunning).toBe(false);
            expect(status.totalNewEvents).toBe(0);
        });

        it('handles adapter failure', async () => {
            (symplaScraper.scrape as any).mockRejectedValue(new Error('Scrape failed'));
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);

            const status = await eventScraperService.runScrape();
            expect(status.platforms.sympla.error).toBe('Scrape failed');
        });

        it('skips sources disabled in config', async () => {
            (scraperConfigStore.getConfig as any).mockReturnValue(
                makeConfig({ sources: { shotgun: { enabled: false, url: 'https://shotgun.test' } } })
            );
            (symplaScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);

            const status = await eventScraperService.runScrape();

            expect(shotgunScraper.scrape).not.toHaveBeenCalled();
            expect(symplaScraper.scrape).toHaveBeenCalled();
            expect(status.platforms.shotgun.disabled).toBe(true);
        });

        it('passes the configured url/maxPages to each adapter', async () => {
            (symplaScraper.scrape as any).mockResolvedValue([]);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);

            await eventScraperService.runScrape();

            expect(symplaScraper.scrape).toHaveBeenCalledWith({ url: 'https://sympla.test', maxPages: 3 });
            expect(blacktagScraper.scrape).toHaveBeenCalledWith({ url: 'https://blacktag.test', maxPages: undefined });
        });

        it('processes new events with classification', async () => {
            const events = [mockRawEvent()];
            (symplaScraper.scrape as any).mockResolvedValue(events);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);
            (centrovibeStoreService.findExternalEventBySourceId as any).mockReturnValue(undefined);
            (centrovibeStoreService.findCompetitorByName as any).mockReturnValue(undefined);
            (centrovibeStoreService.addCompetitor as any).mockReturnValue(undefined);
            (centrovibeStoreService.bulkUpsertExternalEvents as any).mockReturnValue({ added: 1, updated: 0 });
            (aiService.generateReply as any).mockResolvedValue('["urbano_hype"]');

            const status = await eventScraperService.runScrape();
            expect(status.totalNewEvents).toBe(1);
        });

        it('updates existing events with changed data', async () => {
            const events = [mockRawEvent({ title: 'Updated Title' })];
            (symplaScraper.scrape as any).mockResolvedValue(events);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);
            (centrovibeStoreService.findExternalEventBySourceId as any).mockReturnValue({
                title: 'Old Title',
                date: '2024-03-10',
            });
            (centrovibeStoreService.bulkUpsertExternalEvents as any).mockReturnValue({ added: 0, updated: 1 });

            const status = await eventScraperService.runScrape();
            expect(status.totalUpdated).toBe(1);
        });

        it('skips unchanged existing events', async () => {
            const events = [mockRawEvent()];
            (symplaScraper.scrape as any).mockResolvedValue(events);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);
            (centrovibeStoreService.findExternalEventBySourceId as any).mockReturnValue({
                title: events[0].title,
                date: events[0].date,
            });
            (centrovibeStoreService.bulkUpsertExternalEvents as any).mockReturnValue({ added: 0, updated: 0 });

            const status = await eventScraperService.runScrape();
            expect(status.totalNewEvents).toBe(0);
            expect(status.totalUpdated).toBe(0);
        });

        it('resolves existing competitor', async () => {
            const events = [mockRawEvent()];
            (symplaScraper.scrape as any).mockResolvedValue(events);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);
            (centrovibeStoreService.findExternalEventBySourceId as any).mockReturnValue(undefined);
            (centrovibeStoreService.findCompetitorByName as any).mockReturnValue({ id: 'comp-1' });
            (aiService.generateReply as any).mockResolvedValue('["open_format"]');
            (centrovibeStoreService.bulkUpsertExternalEvents as any).mockReturnValue({ added: 1, updated: 0 });

            const status = await eventScraperService.runScrape();
            expect(status.totalNewEvents).toBe(1);
        });

        it('auto-creates competitor when not found', async () => {
            const events = [mockRawEvent({ venueName: 'New Venue' })];
            (symplaScraper.scrape as any).mockResolvedValue(events);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);
            (centrovibeStoreService.findExternalEventBySourceId as any).mockReturnValue(undefined);
            (centrovibeStoreService.findCompetitorByName as any).mockReturnValue(undefined);
            (aiService.generateReply as any).mockResolvedValue('["open_format"]');
            (centrovibeStoreService.bulkUpsertExternalEvents as any).mockReturnValue({ added: 1, updated: 0 });

            const status = await eventScraperService.runScrape();
            expect(centrovibeStoreService.addCompetitor).toHaveBeenCalled();
        });

        it('handles free events', async () => {
            const events = [mockRawEvent({ isFree: true })];
            (symplaScraper.scrape as any).mockResolvedValue(events);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);
            (centrovibeStoreService.findExternalEventBySourceId as any).mockReturnValue(undefined);
            (centrovibeStoreService.findCompetitorByName as any).mockReturnValue({ id: 'c1' });
            (aiService.generateReply as any).mockResolvedValue('["open_format"]');
            (centrovibeStoreService.bulkUpsertExternalEvents as any).mockReturnValue({ added: 1, updated: 0 });

            const status = await eventScraperService.runScrape();
            expect(status.totalNewEvents).toBe(1);
        });
    });

    describe('classification', () => {
        it('handles AI response without JSON array', async () => {
            const events = [mockRawEvent()];
            (symplaScraper.scrape as any).mockResolvedValue(events);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);
            (centrovibeStoreService.findExternalEventBySourceId as any).mockReturnValue(undefined);
            (centrovibeStoreService.findCompetitorByName as any).mockReturnValue({ id: 'c1' });
            (aiService.generateReply as any).mockResolvedValue('no json here');
            (centrovibeStoreService.bulkUpsertExternalEvents as any).mockReturnValue({ added: 1, updated: 0 });

            const status = await eventScraperService.runScrape();
            expect(status.totalNewEvents).toBe(1);
        });

        it('uses keyword fallback when AI fails', async () => {
            const events = [
                mockRawEvent({ genre: 'Samba', title: 'Samba Night' }),
                mockRawEvent({ genre: 'Funk', title: 'Funk Party' }),
                mockRawEvent({ genre: 'Jazz', title: 'Jazz Club' }),
                mockRawEvent({ genre: 'Reggaeton', title: 'Latin Night' }),
                mockRawEvent({ genre: 'Sertanejo', title: 'Sertanejo Show' }),
                mockRawEvent({ genre: 'Rock', title: 'Rock Concert' }),
                mockRawEvent({ title: 'Open Bar Party' }),
            ];
            (symplaScraper.scrape as any).mockResolvedValue(events);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);
            (centrovibeStoreService.findExternalEventBySourceId as any).mockReturnValue(undefined);
            (centrovibeStoreService.findCompetitorByName as any).mockReturnValue({ id: 'c1' });
            (aiService.generateReply as any).mockRejectedValue(new Error('AI fail'));
            (centrovibeStoreService.bulkUpsertExternalEvents as any).mockReturnValue({ added: 7, updated: 0 });

            const status = await eventScraperService.runScrape();
            expect(status.totalNewEvents).toBe(7);
        });

        it('handles invalid cluster from AI', async () => {
            const events = [mockRawEvent()];
            (symplaScraper.scrape as any).mockResolvedValue(events);
            (shotgunScraper.scrape as any).mockResolvedValue([]);
            (blacktagScraper.scrape as any).mockResolvedValue([]);
            (centrovibeStoreService.findExternalEventBySourceId as any).mockReturnValue(undefined);
            (centrovibeStoreService.findCompetitorByName as any).mockReturnValue({ id: 'c1' });
            (aiService.generateReply as any).mockResolvedValue('["invalid_cluster"]');
            (centrovibeStoreService.bulkUpsertExternalEvents as any).mockReturnValue({ added: 1, updated: 0 });

            const status = await eventScraperService.runScrape();
            expect(status.totalNewEvents).toBe(1);
        });
    });

    describe('worker', () => {
        it('startWorker starts the interval', () => {
            eventScraperService.startWorker();
            expect((eventScraperService as any).workerInterval).not.toBeNull();
        });

        it('startWorker does not schedule when autoRun is off', () => {
            (scraperConfigStore.getConfig as any).mockReturnValue(makeConfig({ autoRun: false }));
            eventScraperService.startWorker();
            expect((eventScraperService as any).workerInterval).toBeNull();
        });

        it('startWorker skips if already running', () => {
            eventScraperService.startWorker();
            eventScraperService.startWorker();
        });

        it('reconfigureWorker restarts with the current config', () => {
            eventScraperService.startWorker();
            eventScraperService.reconfigureWorker();
            expect((eventScraperService as any).workerInterval).not.toBeNull();
        });

        it('stopWorker clears the interval', () => {
            eventScraperService.startWorker();
            eventScraperService.stopWorker();
            expect((eventScraperService as any).workerInterval).toBeNull();
        });

        it('stopWorker does nothing if not running', () => {
            eventScraperService.stopWorker();
            expect((eventScraperService as any).workerInterval).toBeNull();
        });
    });
});
