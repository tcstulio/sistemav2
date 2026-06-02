import { describe, it, expect } from 'vitest';
import { getMaxCapacity, getAverageRating, getBestPrice, formatCapacity, VenuePartnership } from '../../types/venue';

describe('venue utils', () => {
    const createMockVenue = (overrides: Partial<VenuePartnership> = {}): VenuePartnership => ({
        id: '1',
        ref: 'VENUE-001',
        name: 'Espaço Teste',
        contact: { site: null, whatsapp: null, email: null, address: null },
        capacity: { standing: 100, dinnerTable: 50, smallTable: 80, reference: 60 },
        ratings: { overall: 4, classification: 5, location: 4, size: 3, price: 4, greenRoom: null, tablesChairs: null, furniture: null, reception: null, parking: null, stage: null, equipment: null },
        pricing: { weekday: 1000, weekend: 2000, corporate: 1500, party: null, cultural: 800, partnership: null, package: null },
        status: '1',
        description: null,
        typeCode: 'tipo_chique',
        typeLabel: 'Alto Padrão',
        fkSoc: '1',
        startDate: Date.now(),
        notes: null,
        includedServices: [],
        createdAt: Date.now(),
        updatedAt: new Date().toISOString(),
        ...overrides
    });

    describe('getMaxCapacity', () => {
        it('returns highest capacity value', () => {
            const venue = createMockVenue();
            expect(getMaxCapacity(venue)).toBe(100);
        });

        it('returns 0 when all capacities are null', () => {
            const venue = createMockVenue({ capacity: { standing: null, dinnerTable: null, smallTable: null, reference: null } });
            expect(getMaxCapacity(venue)).toBe(0);
        });

        it('ignores null values', () => {
            const venue = createMockVenue({ capacity: { standing: null, dinnerTable: 75, smallTable: null, reference: 50 } });
            expect(getMaxCapacity(venue)).toBe(75);
        });
    });

    describe('getAverageRating', () => {
        it('calculates average of non-null ratings', () => {
            const venue = createMockVenue({ ratings: { overall: 4, classification: 5, location: 3, size: null, price: null, greenRoom: null, tablesChairs: null, furniture: null, reception: null, parking: null, stage: null, equipment: null } });
            expect(getAverageRating(venue)).toBe(4);
        });

        it('returns 0 when all ratings are null', () => {
            const venue = createMockVenue({ ratings: { overall: null, classification: null, location: null, size: null, price: null, greenRoom: null, tablesChairs: null, furniture: null, reception: null, parking: null, stage: null, equipment: null } });
            expect(getAverageRating(venue)).toBe(0);
        });

        it('handles single rating', () => {
            const venue = createMockVenue({ ratings: { overall: 5, classification: null, location: null, size: null, price: null, greenRoom: null, tablesChairs: null, furniture: null, reception: null, parking: null, stage: null, equipment: null } });
            expect(getAverageRating(venue)).toBe(5);
        });
    });

    describe('getBestPrice', () => {
        it('returns lowest non-null price', () => {
            const venue = createMockVenue();
            expect(getBestPrice(venue)).toBe(800);
        });

        it('returns null when all prices are null', () => {
            const venue = createMockVenue({ pricing: { weekday: null, weekend: null, corporate: null, party: null, cultural: null, partnership: null, package: null } });
            expect(getBestPrice(venue)).toBeNull();
        });

        it('ignores zero prices', () => {
            const venue = createMockVenue({ pricing: { weekday: 0, weekend: 1000, corporate: null, party: null, cultural: null, partnership: null, package: null } });
            expect(getBestPrice(venue)).toBe(1000);
        });

        it('returns min of non-null non-zero prices', () => {
            const venue = createMockVenue({ pricing: { weekday: 500, weekend: 2000, corporate: 1500, party: null, cultural: 800, partnership: null, package: null } });
            expect(getBestPrice(venue)).toBe(500);
        });
    });

    describe('formatCapacity', () => {
        it('formats standing capacity', () => {
            const venue = createMockVenue({ capacity: { standing: 100, dinnerTable: null, smallTable: null, reference: null } });
            expect(formatCapacity(venue)).toBe('100 em pé');
        });

        it('formats dinner table capacity', () => {
            const venue = createMockVenue({ capacity: { standing: null, dinnerTable: 50, smallTable: null, reference: null } });
            expect(formatCapacity(venue)).toBe('50 jantar');
        });

        it('formats small table capacity', () => {
            const venue = createMockVenue({ capacity: { standing: null, dinnerTable: null, smallTable: 80, reference: null } });
            expect(formatCapacity(venue)).toBe('80 coquetel');
        });

        it('joins multiple capacities with |', () => {
            const venue = createMockVenue({ capacity: { standing: 100, dinnerTable: 50, smallTable: 80, reference: null } });
            expect(formatCapacity(venue)).toBe('100 em pé | 50 jantar | 80 coquetel');
        });

        it('returns "Não informado" when all null', () => {
            const venue = createMockVenue({ capacity: { standing: null, dinnerTable: null, smallTable: null, reference: null } });
            expect(formatCapacity(venue)).toBe('Não informado');
        });
    });
});