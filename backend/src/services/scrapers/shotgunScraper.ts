import { chromium, type Browser } from 'playwright';
import { createLogger } from '../../utils/logger';
import { RawScrapedEvent } from './symplaScraper';

const log = createLogger('ShotgunScraper');

const SHOTGUN_BASE_URL = 'https://shotgun.live/en/cities/sao-paulo';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Forma crua extraída do DOM renderizado (uma por card). */
export interface ShotgunRawCard {
    href: string;
    title: string;
    datetime: string; // ISO (atributo <time datetime>) ou texto
    imgSrc?: string;
    cardText?: string;
}

/** Converte um ISO datetime para a data local (YYYY-MM-DD) no fuso de São Paulo. */
export function isoToSaoPauloDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    // en-CA formata como YYYY-MM-DD
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Extrai um preço em reais de um texto livre ("R$20.00", "R$ 1.234,56"). */
export function parsePriceBRL(text: string): number | undefined {
    const m = text.match(/R\$\s*([\d.,]+)/);
    if (!m) return undefined;
    let s = m[1];
    const decPos = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    if (decPos !== -1 && s.length - decPos - 1 === 2) {
        // último separador com 2 dígitos depois = decimal; o resto é milhar
        s = s.slice(0, decPos).replace(/[.,]/g, '') + '.' + s.slice(decPos + 1);
    } else {
        s = s.replace(/[.,]/g, '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? undefined : n;
}

/** Mapeia um card cru do Shotgun para o formato canônico. */
export function mapShotgunCard(raw: ShotgunRawCard): RawScrapedEvent | null {
    const slug = (raw.href || '').split('/events/').pop()?.split('?')[0]?.replace(/\/$/, '') || '';
    const title = (raw.title || '').trim();
    if (!slug || title.length < 3) return null;

    const date = isoToSaoPauloDate(raw.datetime);
    if (!date) return null;

    const price = raw.cardText ? parsePriceBRL(raw.cardText) : undefined;

    return {
        sourceId: `shotgun_${slug}`,
        source: 'shotgun',
        title,
        date,
        venueName: 'São Paulo',
        venueNeighborhood: 'São Paulo',
        lineupNames: [],
        ticketPrice: price,
        isFree: price === 0,
        imageUrl: raw.imgSrc || undefined,
        sourceUrl: `https://shotgun.live/en/events/${slug}`,
    };
}

/**
 * Estratégia (2026): o Shotgun bloqueia clientes HTTP simples com 429 (anti-bot
 * a nível de CDN, inclusive no /api). Um browser real (Playwright/Chromium —
 * já é dependência, usada no screenshotService) passa e renderiza os cards.
 * Extraímos do DOM: título = alt da imagem de capa, data = <time datetime>,
 * preço = "R$..." no texto do card.
 */
export const shotgunScraper = {
    name: 'shotgun' as const,

    async scrape(): Promise<RawScrapedEvent[]> {
        log.info('Starting Shotgun scrape (Playwright)');
        let browser: Browser | undefined;
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'pt-BR' });
            const page = await context.newPage();

            const resp = await page.goto(SHOTGUN_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
            log.info(`Shotgun page status: ${resp?.status()}`);
            await page.waitForSelector('a[href*="/events/"]', { timeout: 20000 }).catch(() => null);
            await page.waitForTimeout(3000);

            const rawCards: ShotgunRawCard[] = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href*="/events/"]'));
                const seen = new Set<string>();
                const out: any[] = [];
                for (const a of anchors) {
                    const href = a.getAttribute('href') || '';
                    if (!href || seen.has(href)) continue;
                    seen.add(href);
                    // card = ancestral mais próximo que contém um <time>
                    let card: HTMLElement = a as HTMLElement;
                    for (let i = 0; i < 6 && card.parentElement; i++) {
                        if (card.querySelector('time')) break;
                        card = card.parentElement;
                    }
                    const timeEl = card.querySelector('time');
                    const datetime = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent || '') : '';
                    const imgs = Array.from(card.querySelectorAll('img'));
                    const cover = imgs.find(im => {
                        const src = im.getAttribute('src') || '';
                        const alt = im.getAttribute('alt') || '';
                        return /https?:|cloudinary|cloudfront|cdn/.test(src) && !!alt && !/decorative|gradient/i.test(alt);
                    });
                    out.push({
                        href,
                        title: cover ? (cover.getAttribute('alt') || '') : (a.textContent || '').trim(),
                        datetime,
                        imgSrc: cover ? (cover.getAttribute('src') || '') : '',
                        cardText: (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
                    });
                }
                return out;
            });

            const events: RawScrapedEvent[] = [];
            const seen = new Set<string>();
            for (const raw of rawCards) {
                const mapped = mapShotgunCard(raw);
                if (mapped && !seen.has(mapped.sourceId)) {
                    seen.add(mapped.sourceId);
                    events.push(mapped);
                }
            }

            log.info(`Shotgun scrape complete: ${events.length} events`);
            return events;
        } catch (error: any) {
            log.error(`Shotgun scrape error: ${error.message}`);
            return [];
        } finally {
            await browser?.close().catch(() => null);
        }
    },
};
