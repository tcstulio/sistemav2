import axios from 'axios';
import * as cheerio from 'cheerio';
import { createLogger } from '../../utils/logger';
import { RawScrapedEvent } from './symplaScraper';

const log = createLogger('BlacktagScraper');

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

const BLACKTAG_URL = 'https://blacktag.com.br/eventos?cidade=S%C3%A3o+Paulo';

const MONTH_MAP: Record<string, number> = {
    'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4, 'mai': 5, 'jun': 6,
    'jul': 7, 'ago': 8, 'set': 9, 'out': 10, 'nov': 11, 'dez': 12,
};

/**
 * Parse "Ter 10 de Fev" or "10 de Fev" style dates
 */
function parseBlacktagDate(text: string): string {
    const year = new Date().getFullYear();
    // Match "DD de MMM" pattern
    const match = text.match(/(\d{1,2})\s+de\s+(\w{3})/i);
    if (match) {
        const day = match[1].padStart(2, '0');
        const month = MONTH_MAP[match[2].toLowerCase()];
        if (month) {
            return `${year}-${String(month).padStart(2, '0')}-${day}`;
        }
    }
    return '';
}

export const blacktagScraper = {
    name: 'blacktag' as const,

    async scrape(): Promise<RawScrapedEvent[]> {
        const allEvents: RawScrapedEvent[] = [];
        log.info('Starting Blacktag scrape');

        try {
            const response = await axios.get(BLACKTAG_URL, {
                headers: BROWSER_HEADERS,
                timeout: 15000,
            });

            const $ = cheerio.load(response.data);

            // Blacktag uses server-rendered cards with image + title + date + venue
            // Look for event card patterns
            $('a[href*="/eventos/"]').each((_, el) => {
                const $card = $(el);
                const href = $card.attr('href') || '';
                if (!href || href === '/eventos/') return;

                // Extract title from heading element
                const title = $card.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim()
                    || $card.find('strong, b').first().text().trim();

                // Extract date text
                const dateText = $card.find('[class*="date"], [class*="data"], time').text().trim()
                    || $card.text().match(/\d{1,2}\s+de\s+\w{3}/i)?.[0] || '';

                // Extract venue
                const venue = $card.find('[class*="venue"], [class*="local"], [class*="location"]').text().trim();

                // Extract image
                const img = $card.find('img').first();
                const imageUrl = img.attr('src') || img.attr('data-src') || undefined;

                if (title && title.length > 3) {
                    const slug = href.split('/eventos/').pop()?.split('/')[0]?.split('?')[0] || '';
                    const sourceId = `blacktag_${slug || Date.now()}_${allEvents.length}`;

                    // Skip duplicates
                    if (allEvents.some(e => e.sourceId === sourceId)) return;

                    allEvents.push({
                        sourceId,
                        source: 'blacktag',
                        title,
                        date: parseBlacktagDate(dateText) || new Date().toISOString().split('T')[0],
                        venueName: venue || 'São Paulo',
                        lineupNames: [],
                        imageUrl: imageUrl && !imageUrl.startsWith('data:') ? imageUrl : undefined,
                        sourceUrl: href.startsWith('http') ? href : `https://blacktag.com.br${href}`,
                    });
                }
            });

            log.info(`Blacktag scrape complete: ${allEvents.length} events`);
        } catch (error: any) {
            log.error(`Blacktag scrape error: ${error.message}`);
        }

        return allEvents;
    }
};
