import { describe, it, expect } from 'vitest';

import {
    getThemeClasses,
    getThemeClass,
    getCardClasses,
    ThemeColor,
} from '../../utils/theme';

describe('theme', () => {
    describe('getThemeClasses', () => {
        it('returns indigo theme classes for indigo', () => {
            const classes = getThemeClasses('indigo');
            expect(classes.bg50).toBe('bg-indigo-50');
            expect(classes.bg600).toBe('bg-indigo-600');
            expect(classes.primaryButton).toBe('bg-indigo-600 hover:bg-indigo-700 text-white');
        });

        it('returns blue theme classes for blue', () => {
            const classes = getThemeClasses('blue');
            expect(classes.bg50).toBe('bg-blue-50');
            expect(classes.primaryButton).toBe('bg-blue-600 hover:bg-blue-700 text-white');
        });

        it('returns green theme classes for green', () => {
            const classes = getThemeClasses('green');
            expect(classes.bg50).toBe('bg-green-50');
            expect(classes.primaryButton).toBe('bg-green-600 hover:bg-green-700 text-white');
        });

        it('returns red theme classes for red', () => {
            const classes = getThemeClasses('red');
            expect(classes.bg50).toBe('bg-red-50');
            expect(classes.badge).toContain('text-red-700');
        });

        it('defaults to indigo for unknown color', () => {
            const classes = getThemeClasses('unknown-color');
            expect(classes.bg50).toBe('bg-indigo-50');
        });

        it('returns all required properties for indigo', () => {
            const classes = getThemeClasses('indigo');
            expect(classes.bg50).toBeDefined();
            expect(classes.bg100).toBeDefined();
            expect(classes.bg200).toBeDefined();
            expect(classes.bg500).toBeDefined();
            expect(classes.bg600).toBeDefined();
            expect(classes.bg700).toBeDefined();
            expect(classes.bgDark900).toBeDefined();
            expect(classes.bgDark800).toBeDefined();
            expect(classes.text500).toBeDefined();
            expect(classes.text600).toBeDefined();
            expect(classes.text700).toBeDefined();
            expect(classes.border200).toBeDefined();
            expect(classes.border300).toBeDefined();
            expect(classes.border500).toBeDefined();
            expect(classes.borderDark700).toBeDefined();
            expect(classes.borderDark800).toBeDefined();
            expect(classes.ring500).toBeDefined();
            expect(classes.ringOffset).toBeDefined();
            expect(classes.hoverBg100).toBeDefined();
            expect(classes.hoverBg600).toBeDefined();
            expect(classes.hoverText700).toBeDefined();
            expect(classes.primaryButton).toBeDefined();
            expect(classes.secondaryButton).toBeDefined();
            expect(classes.ghostButton).toBeDefined();
            expect(classes.activeCard).toBeDefined();
            expect(classes.inactiveCard).toBeDefined();
            expect(classes.badge).toBeDefined();
            expect(classes.link).toBeDefined();
        });

        it('includes dark mode classes', () => {
            const classes = getThemeClasses('blue');
            expect(classes.bgDark900).toContain('dark:');
            expect(classes.bgDark800).toContain('dark:');
            expect(classes.borderDark700).toContain('dark:');
        });
    });

    describe('getThemeClass', () => {
        it('returns specific class for color and property', () => {
            const result = getThemeClass('green', 'primaryButton');
            expect(result).toBe('bg-green-600 hover:bg-green-700 text-white');
        });

        it('returns secondaryButton class', () => {
            const result = getThemeClass('red', 'secondaryButton');
            expect(result).toBe('bg-red-100 hover:bg-red-200 text-red-700');
        });

        it('returns badge class with dark mode', () => {
            const result = getThemeClass('purple', 'badge');
            expect(result).toContain('bg-purple-100');
            expect(result).toContain('dark:');
        });

        it('returns link class', () => {
            const result = getThemeClass('cyan', 'link');
            expect(result).toContain('text-cyan-600');
            expect(result).toContain('hover:text-cyan-700');
        });

        it('defaults to indigo for unknown color', () => {
            const result = getThemeClass('unknown', 'primaryButton');
            expect(result).toBe('bg-indigo-600 hover:bg-indigo-700 text-white');
        });
    });

    describe('getCardClasses', () => {
        it('returns activeCard when selected is true', () => {
            const result = getCardClasses('indigo', true);
            expect(result).toContain('bg-indigo-50');
            expect(result).toContain('border-indigo-200');
        });

        it('returns inactiveCard when selected is false', () => {
            const result = getCardClasses('indigo', false);
            expect(result).toContain('bg-white');
            expect(result).toContain('border-slate-200');
        });

        it('works with blue color', () => {
            const active = getCardClasses('blue', true);
            const inactive = getCardClasses('blue', false);
            expect(active).toContain('bg-blue-50');
            expect(inactive).toContain('bg-white');
        });

        it('works with green color', () => {
            const active = getCardClasses('green', true);
            const inactive = getCardClasses('green', false);
            expect(active).toContain('bg-green-50');
            expect(inactive).toContain('bg-white');
        });

        it('defaults to indigo for unknown color', () => {
            const result = getCardClasses('unknown', true);
            expect(result).toContain('bg-indigo-50');
        });
    });

    describe('ThemeColor type coverage', () => {
        const colors: ThemeColor[] = [
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose'
        ];

        colors.forEach(color => {
            it(`returns valid classes for ${color}`, () => {
                const classes = getThemeClasses(color);
                expect(classes.primaryButton).toBeTruthy();
                expect(classes.secondaryButton).toBeTruthy();
            });
        });
    });
});