import { describe, it, expect } from 'vitest';
import { parseBlacktagEvents, parseBlacktagDate } from '../../services/scrapers/blacktagScraper';
import { mapShotgunCard, isoToSaoPauloDate, parsePriceBRL } from '../../services/scrapers/shotgunScraper';

const NOW = new Date('2026-06-01T12:00:00Z');

const blacktagCard = (href: string, dateLabel: string, title: string, venue: string) => `
<article class="card mb-4 border-0 card-event"><div class="row">
  <div class="col-5 col-sm-12"><a href="${href}" class="w-100">
    <img src="https://cdn.example.com/cover.jpg" alt="${title}" class="rounded event-cover"/>
  </a></div>
  <div class="col-7 col-sm-12"><div class="card-body"><a href="${href}">
    <span class="mb-0 text-primary">${dateLabel}</span>
    <h5 class="mb-1 mb-sm-3 text-dark">${title}</h5>
    <p class="card-text text-dark"> ${venue} </p>
  </a></div></div>
</div></article>`;

describe('blacktagScraper', () => {
    describe('parseBlacktagDate', () => {
        it('parses "Sex 19 de Jun" ignoring weekday', () => {
            expect(parseBlacktagDate('Sex 19 de Jun', NOW)).toBe('2026-06-19');
        });
        it('parses "10 de Jan" rolling over to next year when month already passed', () => {
            expect(parseBlacktagDate('10 de Jan', NOW)).toBe('2027-01-10');
        });
        it('returns empty string for unparseable text', () => {
            expect(parseBlacktagDate('em breve', NOW)).toBe('');
        });
    });

    describe('parseBlacktagEvents', () => {
        it('extracts title (h5), date, venue and image from card-event articles', () => {
            const html = `<html><body>
                ${blacktagCard('/eventos/32036/copa-arena', 'Sex 19 de Jun', 'COPA ARENA ÉPICO', 'Arena Épico')}
                ${blacktagCard('/eventos/32350/supra', 'Sáb 20 de Jun', 'Supra Augusta', 'Supra Club')}
            </body></html>`;
            const events = parseBlacktagEvents(html, NOW);
            expect(events).toHaveLength(2);
            expect(events[0]).toMatchObject({
                sourceId: 'blacktag_32036',
                source: 'blacktag',
                title: 'COPA ARENA ÉPICO',
                date: '2026-06-19',
                venueName: 'Arena Épico',
                sourceUrl: 'https://blacktag.com.br/eventos/32036/copa-arena',
                imageUrl: 'https://cdn.example.com/cover.jpg',
            });
        });

        it('deduplicates cards that share the same event id', () => {
            const card = blacktagCard('/eventos/999/festa', 'Sex 19 de Jun', 'Festa', 'Local');
            const events = parseBlacktagEvents(`<body>${card}${card}</body>`, NOW);
            expect(events).toHaveLength(1);
        });

        it('skips cards without a usable date', () => {
            const card = blacktagCard('/eventos/1/x', 'data a definir', 'Evento Sem Data', 'Local');
            expect(parseBlacktagEvents(`<body>${card}</body>`, NOW)).toHaveLength(0);
        });

        it('returns empty array for HTML without event cards', () => {
            expect(parseBlacktagEvents('<html><body><p>nada</p></body></html>', NOW)).toEqual([]);
        });
    });
});

describe('shotgunScraper', () => {
    describe('isoToSaoPauloDate', () => {
        it('converts UTC ISO to the local São Paulo date (UTC-3)', () => {
            // 02:59Z = 23:59 do dia anterior em BRT
            expect(isoToSaoPauloDate('2026-06-20T02:59:00.000Z')).toBe('2026-06-19');
            expect(isoToSaoPauloDate('2026-06-18T23:00:00.000Z')).toBe('2026-06-18');
        });
        it('returns empty string for invalid input', () => {
            expect(isoToSaoPauloDate('not-a-date')).toBe('');
        });
    });

    describe('parsePriceBRL', () => {
        it('parses dot-decimal prices ("R$20.00")', () => {
            expect(parsePriceBRL('Evento R$20.00 Pop')).toBe(20);
            expect(parsePriceBRL('R$70.00')).toBe(70);
        });
        it('parses BR-style thousands+comma ("R$ 1.234,56")', () => {
            expect(parsePriceBRL('R$ 1.234,56')).toBe(1234.56);
        });
        it('returns undefined when there is no price', () => {
            expect(parsePriceBRL('Entrada gratuita')).toBeUndefined();
        });
    });

    describe('mapShotgunCard', () => {
        it('maps a raw card to the canonical event', () => {
            const ev = mapShotgunCard({
                href: '/en/events/agrada-brasileiros-copa',
                title: 'Agrada Brasileiros - Copa',
                datetime: '2026-06-13T21:00:00.000Z',
                imgSrc: 'https://res.cloudinary.com/shotgun/x.png',
                cardText: 'Agrada Brasileiros - CopaR$20.00AudioJun13–20',
            });
            expect(ev).toMatchObject({
                sourceId: 'shotgun_agrada-brasileiros-copa',
                source: 'shotgun',
                title: 'Agrada Brasileiros - Copa',
                date: '2026-06-13',
                ticketPrice: 20,
                sourceUrl: 'https://shotgun.live/en/events/agrada-brasileiros-copa',
            });
        });
        it('returns null for too-short title', () => {
            expect(mapShotgunCard({ href: '/en/events/x', title: 'a', datetime: '2026-06-13T21:00:00.000Z' })).toBeNull();
        });
        it('returns null for unparseable date', () => {
            expect(mapShotgunCard({ href: '/en/events/x', title: 'Valid Title', datetime: 'nope' })).toBeNull();
        });
    });
});
