import { describe, it, expect } from 'vitest';
import { isValidExternalUrl } from '../../utils/urlValidation';

describe('isValidExternalUrl', () => {
    describe('valid external URLs', () => {
        it('returns true for valid HTTPS URLs', () => {
            expect(isValidExternalUrl('https://example.com')).toBe(true);
        });

        it('returns true for valid HTTP URLs', () => {
            expect(isValidExternalUrl('http://example.com')).toBe(true);
        });

        it('returns true for google.com', () => {
            expect(isValidExternalUrl('https://google.com')).toBe(true);
        });

        it('returns true for URLs with paths and query params', () => {
            expect(isValidExternalUrl('https://example.com/path?query=1')).toBe(true);
        });

        it('returns true for URLs with port', () => {
            expect(isValidExternalUrl('https://example.com:443/path')).toBe(true);
        });
    });

    describe('invalid protocols', () => {
        it('returns false for ftp://', () => {
            expect(isValidExternalUrl('ftp://example.com')).toBe(false);
        });

        it('returns false for javascript:', () => {
            expect(isValidExternalUrl('javascript:alert(1)')).toBe(false);
        });

        it('returns false for data:', () => {
            expect(isValidExternalUrl('data:text/html,<h1>hi</h1>')).toBe(false);
        });
    });

    describe('localhost and loopback', () => {
        it('returns false for localhost', () => {
            expect(isValidExternalUrl('http://localhost')).toBe(false);
            expect(isValidExternalUrl('http://localhost:3000')).toBe(false);
        });

        it('returns false for 127.0.0.1', () => {
            expect(isValidExternalUrl('http://127.0.0.1')).toBe(false);
            expect(isValidExternalUrl('http://127.0.0.1:8080/api')).toBe(false);
        });

        it('returns false for 0.0.0.0', () => {
            expect(isValidExternalUrl('http://0.0.0.0')).toBe(false);
        });
    });

    describe('private IP ranges', () => {
        it('returns false for 10.x.x.x', () => {
            expect(isValidExternalUrl('http://10.0.0.1')).toBe(false);
            expect(isValidExternalUrl('http://10.255.255.255')).toBe(false);
        });

        it('returns false for 172.16.x.x through 172.31.x.x', () => {
            expect(isValidExternalUrl('http://172.16.0.1')).toBe(false);
            expect(isValidExternalUrl('http://172.20.0.1')).toBe(false);
            expect(isValidExternalUrl('http://172.31.255.255')).toBe(false);
        });

        it('returns true for 172.15.x.x (not private)', () => {
            expect(isValidExternalUrl('http://172.15.0.1')).toBe(true);
        });

        it('returns true for 172.32.x.x (not private)', () => {
            expect(isValidExternalUrl('http://172.32.0.1')).toBe(true);
        });

        it('returns false for 192.168.x.x', () => {
            expect(isValidExternalUrl('http://192.168.0.1')).toBe(false);
            expect(isValidExternalUrl('http://192.168.1.100')).toBe(false);
        });

        it('returns false for 169.254.x.x (link-local)', () => {
            expect(isValidExternalUrl('http://169.254.0.1')).toBe(false);
            expect(isValidExternalUrl('http://169.254.169.254')).toBe(false);
        });

        it('returns false for 0.x.x.x', () => {
            expect(isValidExternalUrl('http://0.1.2.3')).toBe(false);
        });
    });

    describe('internal domains', () => {
        it('returns false for .internal domains', () => {
            expect(isValidExternalUrl('http://my.service.internal')).toBe(false);
            expect(isValidExternalUrl('https://app.internal')).toBe(false);
        });

        it('returns false for .local domains', () => {
            expect(isValidExternalUrl('http://my.service.local')).toBe(false);
            expect(isValidExternalUrl('https://app.local')).toBe(false);
        });
    });

    describe('invalid inputs', () => {
        it('returns false for invalid URL string', () => {
            expect(isValidExternalUrl('not-a-url')).toBe(false);
        });

        it('returns false for empty string', () => {
            expect(isValidExternalUrl('')).toBe(false);
        });

        it('returns false for just a hostname without scheme', () => {
            expect(isValidExternalUrl('example.com')).toBe(false);
        });
    });
});
