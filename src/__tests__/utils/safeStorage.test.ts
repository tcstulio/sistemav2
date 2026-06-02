import { describe, it, expect, beforeEach, vi } from 'vitest';

import { safeStorage } from '../../utils/safeStorage';

describe('safeStorage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('getItem', () => {
        it('returns null for non-existent key', () => {
            expect(safeStorage.getItem('nonexistent')).toBeNull();
        });

        it('returns stored value', () => {
            localStorage.setItem('testKey', 'testValue');
            expect(safeStorage.getItem('testKey')).toBe('testValue');
        });

        it('returns null when localStorage throws', () => {
            const originalGetItem = localStorage.getItem;
            localStorage.getItem = vi.fn(() => {
                throw new Error('Storage error');
            });
            expect(safeStorage.getItem('test')).toBeNull();
            localStorage.getItem = originalGetItem;
        });
    });

    describe('setItem', () => {
        it('sets value in localStorage', () => {
            safeStorage.setItem('key', 'value');
            expect(localStorage.getItem('key')).toBe('value');
        });

        it('does not throw when localStorage throws', () => {
            const originalSetItem = localStorage.setItem;
            localStorage.setItem = vi.fn(() => {
                throw new Error('Quota exceeded');
            });
            expect(() => safeStorage.setItem('key', 'value')).not.toThrow();
            localStorage.setItem = originalSetItem;
        });
    });

    describe('removeItem', () => {
        it('removes existing key', () => {
            localStorage.setItem('toRemove', 'value');
            safeStorage.removeItem('toRemove');
            expect(localStorage.getItem('toRemove')).toBeNull();
        });

        it('does not throw for non-existent key', () => {
            expect(() => safeStorage.removeItem('nonexistent')).not.toThrow();
        });

        it('does not throw when localStorage throws', () => {
            const originalRemoveItem = localStorage.removeItem;
            localStorage.removeItem = vi.fn(() => {
                throw new Error('Storage error');
            });
            expect(() => safeStorage.removeItem('key')).not.toThrow();
            localStorage.removeItem = originalRemoveItem;
        });
    });

    describe('getJSON', () => {
        it('returns fallback for non-existent key', () => {
            expect(safeStorage.getJSON('nonexistent', { default: true })).toEqual({ default: true });
        });

        it('parses and returns stored JSON', () => {
            const obj = { key: 'value', num: 123 };
            localStorage.setItem('jsonKey', JSON.stringify(obj));
            expect(safeStorage.getJSON('jsonKey', {})).toEqual(obj);
        });

        it('returns fallback for invalid JSON', () => {
            localStorage.setItem('badJson', 'not valid json');
            expect(safeStorage.getJSON('badJson', { fallback: true })).toEqual({ fallback: true });
        });

        it('returns fallback when localStorage throws', () => {
            const originalGetItem = localStorage.getItem;
            localStorage.getItem = vi.fn(() => {
                throw new Error('Storage error');
            });
            expect(safeStorage.getJSON('key', { default: true })).toEqual({ default: true });
            localStorage.getItem = originalGetItem;
        });

        it('handles array JSON', () => {
            const arr = [1, 2, 3];
            localStorage.setItem('arrKey', JSON.stringify(arr));
            expect(safeStorage.getJSON('arrKey', [])).toEqual(arr);
        });
    });

    describe('setJSON', () => {
        it('stringifies and stores object', () => {
            safeStorage.setJSON('objKey', { name: 'test' });
            expect(localStorage.getItem('objKey')).toBe('{"name":"test"}');
        });

        it('stringifies array', () => {
            safeStorage.setJSON('arrKey', [1, 2, 3]);
            expect(localStorage.getItem('arrKey')).toBe('[1,2,3]');
        });

        it('stringifies primitive', () => {
            safeStorage.setJSON('numKey', 42);
            expect(localStorage.getItem('numKey')).toBe('42');
        });

        it('does not throw when localStorage throws', () => {
            const originalSetItem = localStorage.setItem;
            localStorage.setItem = vi.fn(() => {
                throw new Error('Quota exceeded');
            });
            expect(() => safeStorage.setJSON('key', { data: true })).not.toThrow();
            localStorage.setItem = originalSetItem;
        });
    });

    describe('roundtrip', () => {
        it('set and get JSON roundtrip works', () => {
            const original = { items: [1, 2, 3], count: 3 };
            safeStorage.setJSON('roundtrip', original);
            const retrieved = safeStorage.getJSON('roundtrip', null);
            expect(retrieved).toEqual(original);
        });

        it('set and get string roundtrip works', () => {
            safeStorage.setItem('stringKey', 'hello world');
            expect(safeStorage.getItem('stringKey')).toBe('hello world');
        });

        it('remove makes get return null', () => {
            safeStorage.setItem('toRemove', 'value');
            safeStorage.removeItem('toRemove');
            expect(safeStorage.getItem('toRemove')).toBeNull();
        });
    });
});