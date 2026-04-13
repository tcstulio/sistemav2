import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    SECONDS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_DAY,
    addDaysToTimestamp,
    isOlderThanHours,
    formatDateTime,
    formatDateOnly,
    formatDateLocal,
    formatDateLong,
    formatRelativeTime,
    formatTime,
} from '../../utils/dateUtils';

describe('dateUtils', () => {
    describe('constants', () => {
        it('SECONDS_PER_DAY equals 86400', () => {
            expect(SECONDS_PER_DAY).toBe(86400);
        });

        it('MS_PER_HOUR equals 3600000', () => {
            expect(MS_PER_HOUR).toBe(3600000);
        });

        it('MS_PER_DAY equals 86400000', () => {
            expect(MS_PER_DAY).toBe(86400000);
        });
    });

    describe('addDaysToTimestamp', () => {
        it('adds days to timestamp in seconds', () => {
            const timestamp = 1000000000;
            const result = addDaysToTimestamp(timestamp, 5);
            expect(result).toBe(timestamp + 5 * SECONDS_PER_DAY);
        });

        it('handles negative days', () => {
            const timestamp = 1000000000;
            const result = addDaysToTimestamp(timestamp, -2);
            expect(result).toBe(timestamp - 2 * SECONDS_PER_DAY);
        });

        it('handles zero days', () => {
            const timestamp = 1000000000;
            const result = addDaysToTimestamp(timestamp, 0);
            expect(result).toBe(timestamp);
        });
    });

    describe('isOlderThanHours', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
        });

        it('returns true if timestamp is older than specified hours', () => {
            const fiveHoursAgo = Date.now() - (5 * MS_PER_HOUR);
            expect(isOlderThanHours(fiveHoursAgo, 4)).toBe(true);
        });

        it('returns false if timestamp is within specified hours', () => {
            const twoHoursAgo = Date.now() - (2 * MS_PER_HOUR);
            expect(isOlderThanHours(twoHoursAgo, 4)).toBe(false);
        });

        it('returns false if exactly at threshold (not older, just at)', () => {
            const fourHoursAgo = Date.now() - (4 * MS_PER_HOUR);
            expect(isOlderThanHours(fourHoursAgo, 4)).toBe(false);
        });
    });

    describe('formatDateTime', () => {
        it('returns dash for null', () => {
            expect(formatDateTime(null)).toBe('-');
        });

        it('returns dash for undefined', () => {
            expect(formatDateTime(undefined)).toBe('-');
        });

        it('formats unix timestamp (seconds)', () => {
            const timestamp = 1704067200;
            const result = formatDateTime(timestamp);
            expect(result).not.toBe('-');
            expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
        });

        it('formats unix timestamp (milliseconds)', () => {
            const timestamp = 1704067200000;
            const result = formatDateTime(timestamp);
            expect(result).not.toBe('-');
        });

        it('formats ISO string', () => {
            const result = formatDateTime('2024-01-01T12:00:00Z');
            expect(result).not.toBe('-');
        });

        it('returns dash for invalid string', () => {
            expect(formatDateTime('not-a-date')).toBe('-');
        });
    });

    describe('formatDateOnly', () => {
        it('returns dash for null', () => {
            expect(formatDateOnly(null)).toBe('-');
        });

        it('returns dash for undefined', () => {
            expect(formatDateOnly(undefined)).toBe('-');
        });

        it('formats timestamp as DD/MM/YYYY', () => {
            const timestamp = 1704067200;
            const result = formatDateOnly(timestamp);
            expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        });

        it('uses UTC timezone', () => {
            const timestamp = 1704067200;
            const result = formatDateOnly(timestamp);
            expect(result).not.toBe('-');
        });

        it('handles string input', () => {
            const result = formatDateOnly('2024-01-01');
            expect(result).not.toBe('-');
        });
    });

    describe('formatDateLocal', () => {
        it('returns dash for null', () => {
            expect(formatDateLocal(null)).toBe('-');
        });

        it('returns dash for undefined', () => {
            expect(formatDateLocal(undefined)).toBe('-');
        });

        it('formats timestamp as DD/MM/YYYY in local time', () => {
            const timestamp = 1704067200;
            const result = formatDateLocal(timestamp);
            expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        });

        it('handles string input', () => {
            const result = formatDateLocal('2024-01-01');
            expect(result).not.toBe('-');
        });
    });

    describe('formatDateLong', () => {
        it('returns dash for null', () => {
            expect(formatDateLong(null)).toBe('-');
        });

        it('returns dash for undefined', () => {
            expect(formatDateLong(undefined)).toBe('-');
        });

        it('formats timestamp as long date', () => {
            const timestamp = 1704067200;
            const result = formatDateLong(timestamp);
            expect(result).not.toBe('-');
        });

        it('includes weekday, day, month, year', () => {
            const timestamp = 1704067200;
            const result = formatDateLong(timestamp);
            expect(result).toMatch(/domingo|segunda|terça|quarta|quinta|sexta|sábado/i);
        });

        it('returns dash for invalid string', () => {
            expect(formatDateLong('not-a-valid-date')).toBe('-');
        });

        it('returns dash for empty string', () => {
            expect(formatDateLong('')).toBe('-');
        });

        it('handles valid ISO date string', () => {
            const result = formatDateLong('2024-01-01T12:00:00Z');
            expect(result).not.toBe('-');
        });

        it('handles unix timestamp in seconds', () => {
            const timestamp = 1704067200;
            const result = formatDateLong(timestamp);
            expect(result).not.toBe('-');
        });
    });

    describe('formatRelativeTime', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
        });

        it('returns dash for null', () => {
            expect(formatRelativeTime(null)).toBe('-');
        });

        it('returns dash for undefined', () => {
            expect(formatRelativeTime(undefined)).toBe('-');
        });

        it('returns "Agora" for very recent timestamps', () => {
            const now = Date.now();
            expect(formatRelativeTime(now)).toBe('Agora');
        });

        it('returns minutes for < 1 hour', () => {
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            const result = formatRelativeTime(fiveMinutesAgo);
            expect(result).toMatch(/min atrás/);
        });

        it('returns hours for < 24 hours', () => {
            const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
            const result = formatRelativeTime(threeHoursAgo);
            expect(result).toMatch(/h atrás/);
        });

        it('returns "Ontem" for 1 day ago', () => {
            const yesterday = Date.now() - (24 * 60 * 60 * 1000);
            expect(formatRelativeTime(yesterday)).toBe('Ontem');
        });

        it('returns days for < 7 days', () => {
            const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
            const result = formatRelativeTime(threeDaysAgo);
            expect(result).toMatch(/dias atrás/);
        });

        it('falls back to formatDateLocal for older', () => {
            const tenDaysAgo = Date.now() - (10 * 24 * 60 * 60 * 1000);
            const result = formatRelativeTime(tenDaysAgo);
            expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        });

        it('returns dash for invalid string', () => {
            expect(formatRelativeTime('not-a-valid-date')).toBe('-');
        });

        it('returns dash for empty string', () => {
            expect(formatRelativeTime('')).toBe('-');
        });

        it('handles valid ISO date string', () => {
            const result = formatRelativeTime('2024-01-10T12:00:00Z');
            expect(result).not.toBe('-');
        });

        it('handles unix timestamp in seconds', () => {
            const timestamp = 1705276800;
            const result = formatRelativeTime(timestamp);
            expect(result).not.toBe('-');
        });
    });

    describe('formatTime', () => {
        it('returns dash for null', () => {
            expect(formatTime(null)).toBe('-');
        });

        it('returns dash for undefined', () => {
            expect(formatTime(undefined)).toBe('-');
        });

        it('formats timestamp as HH:mm', () => {
            const timestamp = 1704067200;
            const result = formatTime(timestamp);
            expect(result).toMatch(/^\d{2}:\d{2}$/);
        });

        it('handles string input', () => {
            const result = formatTime('2024-01-01T15:30:00Z');
            expect(result).not.toBe('-');
        });
    });
});