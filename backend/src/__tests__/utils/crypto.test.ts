import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt, isEncrypted } from '../../utils/crypto';

const ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-32b';

describe('crypto utils', () => {
    beforeEach(() => {
        process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
    });

    afterEach(() => {
        delete process.env.ENCRYPTION_KEY;
    });

    describe('encrypt', () => {
        it('returns string with enc: prefix', () => {
            const result = encrypt('hello');
            expect(result.startsWith('enc:')).toBe(true);
        });

        it('produces different outputs for same input due to random IV', () => {
            const a = encrypt('hello');
            const b = encrypt('hello');
            expect(a).not.toBe(b);
        });

        it('returns correctly formatted string with three colon-separated parts after prefix', () => {
            const result = encrypt('hello');
            const parts = result.slice(4).split(':');
            expect(parts).toHaveLength(3);
        });

        it('throws when ENCRYPTION_KEY not set', () => {
            delete process.env.ENCRYPTION_KEY;
            expect(() => encrypt('hello')).toThrow('ENCRYPTION_KEY not set');
        });
    });

    describe('decrypt', () => {
        it('reverses encrypt', () => {
            const plaintext = 'sensitive data 123!@#';
            const encrypted = encrypt(plaintext);
            expect(decrypt(encrypted)).toBe(plaintext);
        });

        it('returns plaintext as-is when no enc: prefix', () => {
            expect(decrypt('plain text value')).toBe('plain text value');
        });

        it('throws on invalid format', () => {
            expect(() => decrypt('enc:invalid')).toThrow('Invalid encrypted value format');
        });

        it('throws when ENCRYPTION_KEY not set and value has enc: prefix', () => {
            delete process.env.ENCRYPTION_KEY;
            expect(() => decrypt('enc:aabbcc:ddeeff:112233')).toThrow('ENCRYPTION_KEY not set');
        });

        it('does not throw when ENCRYPTION_KEY not set and value has no enc: prefix', () => {
            delete process.env.ENCRYPTION_KEY;
            expect(decrypt('plain')).toBe('plain');
        });

        it('handles empty string encryption roundtrip', () => {
            const encrypted = encrypt('');
            expect(decrypt(encrypted)).toBe('');
        });

        it('handles unicode encryption roundtrip', () => {
            const plaintext = 'héllo wörld 日本語 🚀';
            const encrypted = encrypt(plaintext);
            expect(decrypt(encrypted)).toBe(plaintext);
        });
    });

    describe('isEncrypted', () => {
        it('returns true for encrypted values', () => {
            expect(isEncrypted(encrypt('test'))).toBe(true);
        });

        it('returns false for plain values', () => {
            expect(isEncrypted('plain text')).toBe(false);
        });

        it('returns false for empty string', () => {
            expect(isEncrypted('')).toBe(false);
        });

        it('returns true for string starting with enc:', () => {
            expect(isEncrypted('enc:anything')).toBe(true);
        });
    });
});
