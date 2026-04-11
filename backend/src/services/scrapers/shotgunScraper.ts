import axios from 'axios';
import * as cheerio from 'cheerio';
import { createLogger } from '../../utils/logger';

const log = createLogger('ShotgunScraper');

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

const SHOTGUN_BASE_URL = 'https://shotgun.live/en/cities/sao-paulo';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch with retry and exponential backoff for 429 rate limits
 */
async function fetchWithRetry(url: string, maxRetries: number = 3): Promise<string | null> {
    const delays = [5000, 15000, 45000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get(url, {
                headers: BROWSER_HEADERS,
                timeout: 15000,
            });
            return response.data;
        } catch (error: any) {
            if (error.response?.status === 429 && attempt < maxRetries) {
                const waitTime = delays[attempt] || 45000;
                log.warn(`Shotgun 429 rate limit, retrying in ${waitTime / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
                await delay(waitTime);
            } else {
                throw error;
            }
        }
    }
    return null;
}

/**
 * Parse month name to number
 */
function parseMonthPt(month: string): number {
    const months: Record<string, number> = {
        'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5,
        'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11,
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
    };
    return months[month.toLowerCase().slice(0, 3)] ?? -1;
}

/**
 * Try to parse date from various text formats
 */
function parseDateText(text: string): string {
    // Try patterns like "Feb 15", "15 Feb", "15/02", "2026-02-15"
    const now = new Date();
    const year = now.getFullYear();

    // Pattern: "DD Mon" or "Mon DD"
    const match1 = text.match(/(\d{1,2})\s+(\w+)/);
    const match2 = text.match(/(\w+)\s+(\d{1,2})/);

    if (match1) {
        const day = parseInt(match1[1]);
        const month = parseMonthPt(match1[2]);
        if (month >= 0 && day >= 1 && day <= 31) {
            return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }

    if (match2) {
        const month = parseMonthPt(match2[1]);
        const day = parseInt(match2[2]);
        if (month >= 0 && day >= 1 && day <= 31) {
            return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }

    // Pattern: "DD/MM"
    const slashMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
    if (slashMatch) {
        const day = slashMatch[1].padStart(2, '0');
        const month = slashMatch[2].padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    return '';
}

export const shotgunScraper = {
    name: 'shotgun' as const,

    async scrape(): Promise<RawScrapedEvent[]> {
        const allEvents: RawScrapedEvent[] = [];
        log.info('Starting Shotgun scrape');

        try {
            const html = await fetchWithRetry(SHOTGUN_BASE_URL);
            if (!html) {
                log.warn('Failed to fetch Shotgun page after retries');
                return [];
            }

            const $ = cheerio.load(html);

            // Strategy 1: Look for JSON-LD structured data
            $('script[type="application/ld+json"]').each((_, el) => {
                try {
                    const json = JSON.parse($(el).text());
                    const events = Array.isArray(json) ? json : json['@graph'] || [json];
                    for (const item of events) {
                        if (item['@type'] === 'Event' || item['@type'] === 'MusicEvent') {
                            const date = item.startDate ? new Date(item.startDate).toISOString().split('T')[0] : '';
                            if (date) {
                                allEvents.push({
                                    sourceId: `shotgun_${item.url?.split('/').pop() || Date.now()}`,
                                    source: 'shotgun',
                                    title: item.name || '',
                                    date,
                                    venueName: item.location?.name || 'São Paulo',
                                    venueAddress: item.location?.address?.streetAddress || undefined,
                                    venueNeighborhood: item.location?.address?.addressLocality || 'São Paulo',
                                    lineupNames: [],
                                    ticketPrice: item.offers?.lowPrice ? Number(item.offers.lowPrice) : undefined,
                                    imageUrl: item.image || undefined,
                                    sourceUrl: item.url || SHOTGUN_BASE_URL,
                                    genre: undefined,
                                });
                            }
                        }
                    }
                } catch { /* skip invalid JSON-LD */ }
            });

            // Strategy 2: Parse event cards from HTML
            if (allEvents.length === 0) {
                // Shotgun typically uses Next.js or React, look for __NEXT_DATA__
                $('script#__NEXT_DATA__').each((_, el) => {
                    try {
                        const json = JSON.parse($(el).text());
                        const extractEvents = (obj: any): any[] => {
                            const results: any[] = [];
                            if (!obj || typeof obj !== 'object') return results;
                            if (Array.isArray(obj)) {
                                for (const item of obj) results.push(...extractEvents(item));
                            } else {
                                if (obj.name && (obj.startDate || obj.date || obj.start_date)) {
                                    results.push(obj);
                                }
                                for (const val of Object.values(obj)) {
                                    if (typeof val === 'object') results.push(...extractEvents(val));
                                }
                            }
                            return results;
                        };
                        const found = extractEvents(json);
                        for (const item of found) {
                            const dateStr = item.startDate || item.date || item.start_date || '';
                            const date = dateStr ? new Date(dateStr).toISOString().split('T')[0] : '';
                            if (date && item.name) {
                                allEvents.push({
                                    sourceId: `shotgun_${item.slug || item.id || Date.now()}_${allEvents.length}`,
                                    source: 'shotgun',
                                    title: item.name,
                                    date,
                                    venueName: item.venue?.name || item.location?.name || 'São Paulo',
                                    venueNeighborhood: item.venue?.city || 'São Paulo',
                                    lineupNames: item.lineup?.map((a: any) => a.name || a) || [],
                                    ticketPrice: item.price || item.min_price || undefined,
                                    imageUrl: item.cover_url || item.image || undefined,
                                    sourceUrl: item.slug ? `https://shotgun.live/en/events/${item.slug}` : SHOTGUN_BASE_URL,
                                    genre: item.genre || item.music_genre || undefined,
                                });
                            }
                        }
                    } catch { /* skip */ }
                });
            }

            // Strategy 3: Fallback to link-based extraction
            if (allEvents.length === 0) {
                $('a[href*="/events/"]').each((_, el) => {
                    const $link = $(el);
                    const href = $link.attr('href') || '';
                    const title = $link.text().trim() || $link.find('h2, h3, span').first().text().trim();
                    const dateText = $link.closest('[class*="card"], [class*="event"]').find('time, [class*="date"]').text().trim();

                    if (title && title.length > 3 && href.includes('/events/')) {
                        const slug = href.split('/events/').pop()?.split('?')[0] || '';
                        if (slug && !allEvents.some(e => e.sourceId === `shotgun_${slug}`)) {
                            allEvents.push({
                                sourceId: `shotgun_${slug}`,
                                source: 'shotgun',
                                title,
                                date: parseDateText(dateText) || new Date().toISOString().split('T')[0],
                                venueName: 'São Paulo',
                                lineupNames: [],
                                sourceUrl: `https://shotgun.live/en/events/${slug}`,
                            });
                        }
                    }
                });
            }

            log.info(`Shotgun scrape complete: ${allEvents.length} events`);
        } catch (error: any) {
            log.error(`Shotgun scrape error: ${error.message}`);
        }

        return allEvents;
    }
};
