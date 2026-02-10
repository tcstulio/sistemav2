import { centrovibeStoreService } from './centrovibeStoreService';
import { aiService } from './aiService';
import { symplaScraper, RawScrapedEvent } from './scrapers/symplaScraper';
import { shotgunScraper } from './scrapers/shotgunScraper';
import { blacktagScraper } from './scrapers/blacktagScraper';
import { logger } from '../utils/logger';

const log = logger.child('EventScraper');

interface PlatformStatus {
    lastSuccess: string | null;
    eventsFound: number;
    error?: string;
}

interface ScraperStatus {
    lastRun: string | null;
    isRunning: boolean;
    platforms: {
        sympla: PlatformStatus;
        shotgun: PlatformStatus;
        blacktag: PlatformStatus;
    };
    totalNewEvents: number;
    totalUpdated: number;
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are a music event classifier for São Paulo nightlife. Classify events into exactly one cluster based on their title, description, and genre.`;

const CLASSIFICATION_PROMPT = `Classifique cada evento abaixo em UM dos clusters musicais. Use o título e contexto para decidir:
- brasil_raiz: Samba, Pagode, MPB, Forró, Axé, Chorinho, Bossa Nova
- urbano_hype: Funk, Trap, Hip Hop, Baile, MC, DJ de funk
- latinidades: Reggaeton, Salsa, Latin, Cumbia, Bachata
- povao_coracao: Sertanejo, Piseiro, Arrocha, Forró universitário
- open_format: Mistura de hits, Top 40, Open bar, Karaokê, festa genérica
- eclectic: Jazz, Blues, Instrumental, Chill, Rock, Indie, Alternativo, Eletrônico, Techno, House, Trance

Se não for possível determinar, use "open_format".

Eventos:
EVENTS_PLACEHOLDER

Retorne APENAS um JSON array com os clusters na mesma ordem, ex: ["urbano_hype", "brasil_raiz", "open_format"]`;

const DEFAULT_PLATFORM_STATUS: PlatformStatus = { lastSuccess: null, eventsFound: 0 };

class EventScraperService {
    private status: ScraperStatus = {
        lastRun: null,
        isRunning: false,
        platforms: {
            sympla: { ...DEFAULT_PLATFORM_STATUS },
            shotgun: { ...DEFAULT_PLATFORM_STATUS },
            blacktag: { ...DEFAULT_PLATFORM_STATUS },
        },
        totalNewEvents: 0,
        totalUpdated: 0,
    };

    private workerInterval: ReturnType<typeof setInterval> | null = null;

    getStatus(): ScraperStatus {
        return { ...this.status };
    }

    async runScrape(): Promise<ScraperStatus> {
        if (this.status.isRunning) {
            log.warn('Scrape already in progress, skipping');
            return this.status;
        }

        log.info('=== Starting Event Scrape ===');
        this.status.isRunning = true;
        this.status.totalNewEvents = 0;
        this.status.totalUpdated = 0;

        const allRawEvents: RawScrapedEvent[] = [];

        // Run each adapter sequentially to respect rate limits
        const adapters = [
            { adapter: symplaScraper, key: 'sympla' as const },
            { adapter: shotgunScraper, key: 'shotgun' as const },
            { adapter: blacktagScraper, key: 'blacktag' as const },
        ];

        for (const { adapter, key } of adapters) {
            try {
                log.info(`Running ${key} adapter...`);
                const events = await adapter.scrape();
                this.status.platforms[key] = {
                    lastSuccess: new Date().toISOString(),
                    eventsFound: events.length,
                };
                allRawEvents.push(...events);
                log.info(`${key}: ${events.length} events scraped`);
            } catch (error: any) {
                log.error(`${key} adapter failed: ${error.message}`);
                this.status.platforms[key] = {
                    ...this.status.platforms[key],
                    error: error.message,
                };
            }
        }

        if (allRawEvents.length === 0) {
            log.info('No events scraped from any platform');
            this.status.isRunning = false;
            this.status.lastRun = new Date().toISOString();
            return this.status;
        }

        log.info(`Total raw events: ${allRawEvents.length}. Processing...`);

        // Filter out events that already exist (by sourceId)
        const newEvents: RawScrapedEvent[] = [];
        const updatableEvents: RawScrapedEvent[] = [];

        for (const raw of allRawEvents) {
            const existing = centrovibeStoreService.findExternalEventBySourceId(raw.sourceId);
            if (existing) {
                // Check if title or date changed
                if (existing.title !== raw.title || existing.date !== raw.date) {
                    updatableEvents.push(raw);
                }
            } else {
                newEvents.push(raw);
            }
        }

        log.info(`New events: ${newEvents.length}, Updates: ${updatableEvents.length}`);

        // Classify new events with AI (in batches of 20)
        const classifiedEvents = await this.classifyEvents(newEvents);

        // Process new events: resolve competitors and persist
        const externalEvents = [];
        for (let i = 0; i < classifiedEvents.length; i++) {
            const raw = newEvents[i];
            const cluster = classifiedEvents[i];

            // Resolve or create competitor
            const competitorId = this.resolveCompetitor(raw);

            externalEvents.push({
                id: Date.now().toString() + '_' + i,
                competitorId,
                title: raw.title,
                date: raw.date,
                cluster,
                lineupNames: raw.lineupNames,
                ticketPrice: raw.isFree ? 0 : raw.ticketPrice,
                source: raw.source,
                sourceUrl: raw.sourceUrl,
                sourceId: raw.sourceId,
                imageUrl: raw.imageUrl,
                scrapedAt: new Date().toISOString(),
            });
        }

        // Process updatable events
        const updateEvents = updatableEvents.map(raw => ({
            sourceId: raw.sourceId,
            title: raw.title,
            date: raw.date,
            ticketPrice: raw.isFree ? 0 : raw.ticketPrice,
            imageUrl: raw.imageUrl,
            scrapedAt: new Date().toISOString(),
        }));

        // Bulk upsert
        const result = centrovibeStoreService.bulkUpsertExternalEvents([
            ...externalEvents,
            ...updateEvents.map(u => ({ ...u, id: '', competitorId: '', cluster: 'open_format', lineupNames: [] })),
        ]);

        this.status.totalNewEvents = result.added;
        this.status.totalUpdated = result.updated;
        this.status.isRunning = false;
        this.status.lastRun = new Date().toISOString();

        log.info(`=== Scrape Complete: ${result.added} added, ${result.updated} updated ===`);
        return this.status;
    }

    /**
     * Classify events into clusters using AI (batched)
     */
    private async classifyEvents(events: RawScrapedEvent[]): Promise<string[]> {
        if (events.length === 0) return [];

        const clusters: string[] = [];
        const batchSize = 20;

        for (let i = 0; i < events.length; i += batchSize) {
            const batch = events.slice(i, i + batchSize);
            const eventLines = batch.map((e, idx) =>
                `${idx + 1}. "${e.title}"${e.genre ? ` - ${e.genre}` : ''}${e.description ? ` (${e.description.slice(0, 80)})` : ''}`
            ).join('\n');

            const prompt = CLASSIFICATION_PROMPT.replace('EVENTS_PLACEHOLDER', eventLines);

            try {
                const history = [
                    { role: 'system' as const, parts: CLASSIFICATION_SYSTEM_PROMPT },
                    { role: 'user' as const, parts: prompt },
                ];

                const reply = await aiService.generateReply(history, '', undefined, 'centrovibe');

                // Parse JSON array from response
                const jsonMatch = reply.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]) as string[];
                    const validClusters = ['brasil_raiz', 'urbano_hype', 'latinidades', 'povao_coracao', 'open_format', 'eclectic'];
                    const validated = parsed.map(c => validClusters.includes(c) ? c : 'open_format');
                    clusters.push(...validated);
                } else {
                    // Fallback: all open_format
                    clusters.push(...batch.map(() => 'open_format'));
                }
            } catch (error: any) {
                log.error(`AI classification error: ${error.message}`);
                // Fallback: classify by keywords
                clusters.push(...batch.map(e => this.classifyByKeywords(e)));
            }
        }

        return clusters;
    }

    /**
     * Fallback keyword-based classification when AI is unavailable
     */
    private classifyByKeywords(event: RawScrapedEvent): string {
        const text = `${event.title} ${event.genre || ''} ${event.description || ''}`.toLowerCase();

        if (/samba|pagode|mpb|bossa|chorinho|roda de/.test(text)) return 'brasil_raiz';
        if (/funk|trap|hip.?hop|baile|mc\s|rap/.test(text)) return 'urbano_hype';
        if (/reggaeton|salsa|latin|cumbia|bachata|noche/.test(text)) return 'latinidades';
        if (/sertanejo|piseiro|arrocha|forró/.test(text)) return 'povao_coracao';
        if (/jazz|blues|instrumental|chill|rock|indie|techno|house|trance|eletr[oô]n/.test(text)) return 'eclectic';
        return 'open_format';
    }

    /**
     * Resolve venue name to competitor ID, creating if needed
     */
    private resolveCompetitor(raw: RawScrapedEvent): string {
        const existing = centrovibeStoreService.findCompetitorByName(raw.venueName);
        if (existing) return existing.id;

        // Auto-create competitor
        const newComp = {
            id: `scraped_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: raw.venueName,
            neighborhood: raw.venueNeighborhood || '',
            address: raw.venueAddress || '',
            capacity: 0,
            mainClusters: [] as string[],
            priceRange: 'mid' as const,
            source: 'scraped' as const,
        };

        centrovibeStoreService.addCompetitor(newComp);
        log.info(`Auto-created competitor: ${raw.venueName}`);
        return newComp.id;
    }

    /**
     * Start the automatic scraping worker
     */
    startWorker(intervalHours: number = 6) {
        if (this.workerInterval) {
            log.warn('Worker already running');
            return;
        }

        const intervalMs = intervalHours * 60 * 60 * 1000;
        log.info(`Starting scraper worker (interval: ${intervalHours}h)`);

        // Run first scrape after a 2-minute delay (let server warm up)
        setTimeout(() => {
            this.runScrape().catch(err => log.error(`Scheduled scrape error: ${err.message}`));
        }, 2 * 60 * 1000);

        this.workerInterval = setInterval(() => {
            this.runScrape().catch(err => log.error(`Scheduled scrape error: ${err.message}`));
        }, intervalMs);
    }

    stopWorker() {
        if (this.workerInterval) {
            clearInterval(this.workerInterval);
            this.workerInterval = null;
            log.info('Scraper worker stopped');
        }
    }
}

export const eventScraperService = new EventScraperService();
