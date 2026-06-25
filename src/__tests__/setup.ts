import { vi } from 'vitest';
import '@testing-library/jest-dom';

Object.defineProperty(globalThis, 'fetch', {
    value: vi.fn(() =>
        Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({}),
            text: () => Promise.resolve(''),
            headers: new Headers(),
            clone() { return this; },
        })
    ),
    writable: true,
});

const mockIDB = {
    open: vi.fn(() => ({
        result: {},
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
    })),
};

Object.defineProperty(globalThis, 'indexedDB', {
    value: mockIDB,
    writable: true,
});

const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
        clear: vi.fn(() => { store = {}; }),
        get length() { return Object.keys(store).length; },
        key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
Object.defineProperty(globalThis, 'sessionStorage', { value: localStorageMock });

Object.defineProperty(globalThis, 'matchMedia', {
    value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: vi.fn(function () {
        return {
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        };
    }),
    writable: true,
    configurable: true,
});

Object.defineProperty(globalThis, 'ResizeObserver', {
    value: vi.fn(function () {
        return {
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        };
    }),
});

vi.mock('./services/dbService', () => ({
    dbService: {
        getAll: vi.fn(() => Promise.resolve([])),
        get: vi.fn(() => Promise.resolve(null)),
        put: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
        clear: vi.fn(() => Promise.resolve()),
        count: vi.fn(() => Promise.resolve(0)),
    },
}));

vi.mock('./utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(() => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        })),
    },
    default: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
    },
}));
