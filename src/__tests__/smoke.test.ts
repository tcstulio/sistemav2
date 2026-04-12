import { describe, it, expect, vi } from 'vitest';

describe('Frontend test infrastructure', () => {
    it('vitest is working', () => {
        expect(1 + 1).toBe(2);
    });

    it('jsdom environment works', () => {
        expect(typeof document).toBe('object');
        const div = document.createElement('div');
        div.textContent = 'hello';
        expect(div.textContent).toBe('hello');
    });

    it('fetch is mocked', () => {
        expect(typeof fetch).toBe('function');
    });

    it('localStorage is mocked', () => {
        localStorage.setItem('test', 'value');
        expect(localStorage.getItem('test')).toBe('value');
    });

    it('jest-dom matchers work', () => {
        const el = document.createElement('div');
        el.textContent = 'Hello World';
        document.body.appendChild(el);
        expect(el).toBeInTheDocument();
        document.body.removeChild(el);
    });
});
