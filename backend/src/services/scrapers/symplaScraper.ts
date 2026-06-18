import axios from 'axios';
import * as cheerio from 'cheerio';
import { createLogger } from '../../utils/logger';

const log = createLogger('SymplaScraper');

export interface RawScrapedEvent {
    sourceId: string;
    source: 'sympla' | 'shotgun' | 'blacktag';
    title: string;
    date: string;
    venueName: string;
    venueAddress?: string;
    venueNeighborhood?: string;
    lineupNames: string[];
    ticketPrice?: number;
    isFree?: boolean;
    description?: string;
    imageUrl?: string;
    sourceUrl: string;
    genre?: string;
}

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
};

const SYMPLA_BASE_URL = 'https://www.sympla.com.br/eventos/sao-paulo-sp/show-musica-festa/festas-e-baladas';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Estratégia atual (2026): o Sympla migrou para Next.js App Router com streaming. Os eventos
 * vêm em `self.__next_f.push([1,"…searchDataResult…"])` — um payload RSC onde o JSON está
 * escapado dentro de um literal JS. Isolamos o array `searchDataResult.data` por bracket-matching
 * (honrando as strings delimitadas por \") e desescapamos com um duplo JSON.parse.
 */
function extractFromNextFlight(html: string): any[] {
    const marker = html.indexOf('searchDataResult');
    if (marker === -1) return [];
    const di = html.indexOf('\\"data\\":', marker);
    if (di === -1) return [];
    const start = html.indexOf('[', di);
    if (start === -1) return [];

    let depth = 0;
    let inStr = false;
    let end = -1;
    for (let p = start; p < html.length; p++) {
        const c = html[p];
        if (inStr) {
            if (c === '\\') {
                if (html[p + 1] === '"') { inStr = false; p++; continue; } // \" fecha a string
                p++; continue; // \\ ou outro escape — pula o par
            }
            continue;
        }
        if (c === '\\' && html[p + 1] === '"') { inStr = true; p++; continue; }
        if (c === '[') depth++;
        else if (c === ']') { depth--; if (depth === 0) { end = p + 1; break; } }
    }
    if (end === -1) return [];

    try {
        const arrEscaped = html.slice(start, end);
        const text = JSON.parse('"' + arrEscaped + '"'); // desescapa o literal JS -> texto JSON
        const data = JSON.parse(text);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        log.warn(`Falha ao desescapar payload RSC do Sympla: ${e}`);
        return [];
    }
}

/**
 * Extract JSON event data embedded in Sympla's Next.js page
 */
function extractEventsFromHtml(html: string): any[] {
    // Strategy 0 (atual): payload RSC do App Router.
    const flight = extractFromNextFlight(html);
    if (flight.length > 0) return flight;

    const $ = cheerio.load(html);
    const events: any[] = [];

    // Strategy 1: Look for JSON data in script tags (Next.js __NEXT_DATA__ — legado)
    $('script#__NEXT_DATA__').each((_, el) => {
        try {
            const json = JSON.parse($(el).text());
            const pageProps = json?.props?.pageProps;
            if (pageProps?.searchDataResult?.data) {
                events.push(...pageProps.searchDataResult.data);
            } else if (pageProps?.events) {
                events.push(...pageProps.events);
            }
        } catch {
            // Not valid JSON, skip
        }
    });

    // Strategy 2: Search all script tags for searchDataResult pattern
    if (events.length === 0) {
        $('script').each((_, el) => {
            const text = $(el).text();
            if (text.includes('searchDataResult')) {
                try {
                    // Try to find JSON array within the script
                    const match = text.match(/"data"\s*:\s*(\[[\s\S]*?\])\s*,\s*"(?:total|page|limit)"/);
                    if (match) {
                        const parsed = JSON.parse(match[1]);
                        events.push(...parsed);
                    }
                } catch {
                    // Pattern didn't match, try broader extraction
                }
            }
        });
    }

    // Strategy 3: Parse event cards from HTML structure
    if (events.length === 0) {
        $('a[href*="/evento/"]').each((_, el) => {
            const $card = $(el);
            const href = $card.attr('href') || '';
            const title = $card.find('h3, h2, [class*="title"], [class*="name"]').first().text().trim();
            const dateText = $card.find('[class*="date"], time').first().text().trim();

            if (title && href) {
                events.push({
                    name: title,
                    url: href.startsWith('http') ? href : `https://www.sympla.com.br${href}`,
                    _fromHtml: true,
                    _dateText: dateText,
                    id: href.split('/').filter(Boolean).pop() || Date.now().toString(),
                });
            }
        });
    }

    return events;
}

/**
 * Map Sympla's raw event data to our RawScrapedEvent format
 */
function mapSymplaEvent(raw: any): RawScrapedEvent | null {
    try {
        const title = raw.name || raw.title || '';
        if (!title) return null;

        // Parse date
        let date = '';
        if (raw.start_date) {
            date = raw.start_date.split('T')[0]; // YYYY-MM-DD
        } else if (raw.start_date_formats?.en) {
            // Try to parse formatted date
            try {
                const d = new Date(raw.start_date_formats.en);
                if (!isNaN(d.getTime())) date = d.toISOString().split('T')[0];
            } catch { /* skip */ }
        } else if (raw._dateText) {
            // From HTML fallback - best effort
            date = new Date().toISOString().split('T')[0];
        }

        if (!date) return null;

        // Build venue info. No formato atual o local vem aninhado em `location`
        // (location.name = nome do local; company = organizador). Mantém fallback para o legado.
        const loc = raw.location || {};
        const venueName = loc.name || raw.company || raw.venue || loc.address || raw.address || 'Local não informado';
        const venueAddress = loc.address || raw.address || undefined;
        const venueNeighborhood = loc.neighborhood || raw.neighborhood || '';

        // Build source URL (no formato atual já vem absoluto)
        let sourceUrl = raw.url || '';
        if (sourceUrl && !sourceUrl.startsWith('http')) {
            sourceUrl = `https://www.sympla.com.br${sourceUrl}`;
        }

        // Image
        const imageUrl = raw.images?.original || raw.images?.lg || raw.images?.xs || undefined;

        return {
            sourceId: `sympla_${raw.id || Date.now()}`,
            source: 'sympla',
            title,
            date,
            venueName: venueName.trim(),
            venueAddress,
            venueNeighborhood,
            lineupNames: [],
            ticketPrice: undefined,
            isFree: raw.is_free === true,
            description: raw.description || undefined,
            imageUrl,
            sourceUrl,
            genre: raw.event_type || undefined,
        };
    } catch (error) {
        log.warn(`Failed to map Sympla event: ${error}`);
        return null;
    }
}

export const symplaScraper = {
    name: 'sympla' as const,

    async scrape(maxPages: number = 3): Promise<RawScrapedEvent[]> {
        const allEvents: RawScrapedEvent[] = [];
        log.info(`Starting Sympla scrape (max ${maxPages} pages)`);

        for (let page = 1; page <= maxPages; page++) {
            try {
                const url = page === 1 ? SYMPLA_BASE_URL : `${SYMPLA_BASE_URL}?page=${page}`;
                log.info(`Fetching Sympla page ${page}: ${url}`);

                const response = await axios.get(url, {
                    headers: BROWSER_HEADERS,
                    timeout: 15000,
                });

                const rawEvents = extractEventsFromHtml(response.data);
                log.info(`Sympla page ${page}: found ${rawEvents.length} raw events`);

                if (rawEvents.length === 0) {
                    log.info('No more events found, stopping pagination');
                    break;
                }

                for (const raw of rawEvents) {
                    const mapped = mapSymplaEvent(raw);
                    if (mapped) allEvents.push(mapped);
                }

                // Rate limit between pages
                if (page < maxPages) {
                    await delay(2000);
                }
            } catch (error: any) {
                log.error(`Sympla page ${page} error: ${error.message}`);
                break;
            }
        }

        log.info(`Sympla scrape complete: ${allEvents.length} events`);
        return allEvents;
    }
};
