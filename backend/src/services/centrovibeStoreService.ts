import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('CentroVibeStore');

interface TicketBatch {
    id: string;
    name: string;
    price: number;
    status: 'sold_out' | 'active' | 'scheduled';
    soldCount?: number;
    totalCount?: number;
}

interface VenueEvent {
    id: string;
    title: string;
    description: string;
    startTime: string;
    endTime: string;
    space: 'green_area' | 'main_hall';
    cluster: string;
    genre: string;
    lineup?: string[];
    tickets?: TicketBatch[];
}

interface DaySchedule {
    day: string;
    theme: string;
    events: VenueEvent[];
}

interface Artist {
    id: string;
    name: string;
    role: 'dj' | 'band' | 'producer' | 'performer';
    cluster: string;
    subGenre: string;
    instagram?: string;
    rate?: string;
}

interface Competitor {
    id: string;
    name: string;
    neighborhood: string;
    address: string;
    capacity: number;
    mainClusters: string[];
    priceRange: 'low' | 'mid' | 'high';
    source?: 'manual' | 'scraped';
    sourceUrl?: string;
}

interface ExternalEvent {
    id: string;
    competitorId: string;
    title: string;
    date: string;
    cluster: string;
    lineupNames: string[];
    ticketPrice?: number;
    tickets?: TicketBatch[];
    notes?: string;
    source?: 'manual' | 'sympla' | 'shotgun' | 'blacktag';
    sourceUrl?: string;
    sourceId?: string;
    imageUrl?: string;
    scrapedAt?: string;
}

interface CentroVibeStore {
    schedule: DaySchedule[];
    artists: Artist[];
    competitors: Competitor[];
    externalEvents: ExternalEvent[];
}

const STORE_PATH = path.join(__dirname, '../../data/centrovibe.json');

const DEFAULT_DATA: CentroVibeStore = {
    schedule: [],
    artists: [],
    competitors: [],
    externalEvents: []
};

class CentroVibeStoreService {
    private data: CentroVibeStore;

    constructor() {
        this.data = { ...DEFAULT_DATA };
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(STORE_PATH)) {
                const content = fs.readFileSync(STORE_PATH, 'utf-8');
                const parsed = JSON.parse(content);
                this.data = {
                    schedule: parsed.schedule || [],
                    artists: parsed.artists || [],
                    competitors: parsed.competitors || [],
                    externalEvents: parsed.externalEvents || []
                };
            }
        } catch (error) {
            log.error('Load Error', error);
        }
    }

    private save() {
        try {
            atomicWriteSync(STORE_PATH, this.data);
        } catch (error) {
            log.error('Save Error', error);
        }
    }

    // --- Full Data ---

    getData(): CentroVibeStore {
        return this.data;
    }

    saveData(data: CentroVibeStore) {
        this.data = {
            schedule: data.schedule || [],
            artists: data.artists || [],
            competitors: data.competitors || [],
            externalEvents: data.externalEvents || []
        };
        this.save();
    }

    // --- Schedule ---

    getSchedule(): DaySchedule[] {
        return this.data.schedule;
    }

    saveSchedule(schedule: DaySchedule[]) {
        this.data.schedule = schedule;
        this.save();
    }

    // --- Artists ---

    getArtists(): Artist[] {
        return this.data.artists;
    }

    addArtist(artist: Artist) {
        this.data.artists.push(artist);
        this.save();
        return artist;
    }

    updateArtist(id: string, updates: Partial<Artist>) {
        const idx = this.data.artists.findIndex(a => a.id === id);
        if (idx === -1) return null;
        this.data.artists[idx] = { ...this.data.artists[idx], ...updates };
        this.save();
        return this.data.artists[idx];
    }

    deleteArtist(id: string) {
        const before = this.data.artists.length;
        this.data.artists = this.data.artists.filter(a => a.id !== id);
        if (this.data.artists.length < before) {
            this.save();
            return true;
        }
        return false;
    }

    // --- Competitors ---

    getCompetitors(): Competitor[] {
        return this.data.competitors;
    }

    addCompetitor(competitor: Competitor) {
        this.data.competitors.push(competitor);
        this.save();
        return competitor;
    }

    updateCompetitor(id: string, updates: Partial<Competitor>) {
        const idx = this.data.competitors.findIndex(c => c.id === id);
        if (idx === -1) return null;
        this.data.competitors[idx] = { ...this.data.competitors[idx], ...updates };
        this.save();
        return this.data.competitors[idx];
    }

    deleteCompetitor(id: string) {
        const before = this.data.competitors.length;
        this.data.competitors = this.data.competitors.filter(c => c.id !== id);
        if (this.data.competitors.length < before) {
            this.save();
            return true;
        }
        return false;
    }

    // --- External Events ---

    getExternalEvents(): ExternalEvent[] {
        return this.data.externalEvents;
    }

    addExternalEvent(event: ExternalEvent) {
        this.data.externalEvents.push(event);
        this.save();
        return event;
    }

    updateExternalEvent(id: string, updates: Partial<ExternalEvent>) {
        const idx = this.data.externalEvents.findIndex(e => e.id === id);
        if (idx === -1) return null;
        this.data.externalEvents[idx] = { ...this.data.externalEvents[idx], ...updates };
        this.save();
        return this.data.externalEvents[idx];
    }

    deleteExternalEvent(id: string) {
        const before = this.data.externalEvents.length;
        this.data.externalEvents = this.data.externalEvents.filter(e => e.id !== id);
        if (this.data.externalEvents.length < before) {
            this.save();
            return true;
        }
        return false;
    }

    // --- Scraper Helpers ---

    findCompetitorByName(name: string): Competitor | undefined {
        const normalized = name.toLowerCase().trim();
        return this.data.competitors.find(c =>
            c.name.toLowerCase().trim() === normalized ||
            c.name.toLowerCase().includes(normalized) ||
            normalized.includes(c.name.toLowerCase())
        );
    }

    findExternalEventBySourceId(sourceId: string): ExternalEvent | undefined {
        return this.data.externalEvents.find(e => e.sourceId === sourceId);
    }

    bulkUpsertExternalEvents(events: ExternalEvent[]): { added: number; updated: number } {
        let added = 0;
        let updated = 0;

        for (const event of events) {
            if (event.sourceId) {
                const existing = this.findExternalEventBySourceId(event.sourceId);
                if (existing) {
                    // Update existing: merge fields
                    const idx = this.data.externalEvents.findIndex(e => e.sourceId === event.sourceId);
                    if (idx !== -1) {
                        this.data.externalEvents[idx] = { ...this.data.externalEvents[idx], ...event, id: this.data.externalEvents[idx].id };
                        updated++;
                    }
                    continue;
                }
            }
            // New event
            this.data.externalEvents.push(event);
            added++;
        }

        if (added > 0 || updated > 0) {
            this.save();
        }
        return { added, updated };
    }
}

export const centrovibeStoreService = new CentroVibeStoreService();
