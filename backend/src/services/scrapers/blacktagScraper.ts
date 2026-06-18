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
 * Parse "Sex 19 de Jun" / "19 de Jun" style dates -> YYYY-MM-DD.
 * O site não traz ano; assume o ano corrente e rola para o próximo
 * quando o mês já passou (lista é sempre de eventos futuros).
 */
export function parseBlacktagDate(text: string, now: Date = new Date()): string {
    // Pega "DD de MMM" ignorando o dia da semana ("Sex ") na frente.
    const match = text.match(/(\d{1,2})\s+de\s+([A-Za-zçÇ]{3})/i);
    if (!match) return '';
    const day = parseInt(match[1], 10);
    const month = MONTH_MAP[match[2].toLowerCase()];
    if (!month || day < 1 || day > 31) return '';

    let year = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    if (month < currentMonth) year += 1; // evento do mês que já passou -> próximo ano
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Extrai eventos do HTML server-rendered do Blacktag.
 * Estrutura (2026): cards `<article class="card-event">` com
 *   <span class="text-primary">Sex 19 de Jun</span>
 *   <h5 ...>TÍTULO</h5>
 *   <p class="card-text">Local</p>
 *   <img class="event-cover" alt="TÍTULO" src="...">
 * O título antes era buscado só em h2/h3/h4 (mas vem em h5) -> 0 eventos.
 */
export function parseBlacktagEvents(html: string, now: Date = new Date()): RawScrapedEvent[] {
    const $ = cheerio.load(html);
    const events: RawScrapedEvent[] = [];
    const seen = new Set<string>();

    $('article.card-event').each((_, el) => {
        const $card = $(el);

        const href = $card.find('a[href*="/eventos/"]').first().attr('href') || '';
        const slug = href.split('/eventos/').pop()?.split('?')[0] || '';
        if (!slug) return;

        const img = $card.find('img').first();
        const title = (
            $card.find('h5').first().text().trim() ||
            $card.find('h2, h3, h4').first().text().trim() ||
            img.attr('alt')?.trim() ||
            ''
        );
        if (title.length < 3) return;

        const sourceId = `blacktag_${slug.split('/')[0]}`;
        if (seen.has(sourceId)) return;
        seen.add(sourceId);

        const dateText = $card.find('span.text-primary').first().text().trim()
            || $card.text().match(/\d{1,2}\s+de\s+[A-Za-zçÇ]{3}/i)?.[0]
            || '';
        const date = parseBlacktagDate(dateText, now);
        if (!date) return; // sem data confiável, descarta

        const venue = $card.find('p.card-text').first().text().trim();
        const imageUrl = img.attr('src') || img.attr('data-src') || undefined;

        events.push({
            sourceId,
            source: 'blacktag',
            title,
            date,
            venueName: venue || 'São Paulo',
            lineupNames: [],
            imageUrl: imageUrl && !imageUrl.startsWith('data:') ? imageUrl : undefined,
            sourceUrl: href.startsWith('http') ? href : `https://blacktag.com.br${href}`,
        });
    });

    return events;
}

export const blacktagScraper = {
    name: 'blacktag' as const,

    async scrape(): Promise<RawScrapedEvent[]> {
        log.info('Starting Blacktag scrape');
        try {
            const response = await axios.get(BLACKTAG_URL, {
                headers: BROWSER_HEADERS,
                timeout: 15000,
            });

            const events = parseBlacktagEvents(response.data);
            log.info(`Blacktag scrape complete: ${events.length} events`);
            return events;
        } catch (error: any) {
            log.error(`Blacktag scrape error: ${error.message}`);
            return [];
        }
    },
};
