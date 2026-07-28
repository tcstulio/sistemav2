import { describe, it, expect } from 'vitest';

import {
    getThemeClasses,
    getThemeClass,
    getCardClasses,
    getTabClasses,
    getToggleCheckedBg,
    getOutlineColor,
    TAB_ACTIVE_CLASSES,
    TAB_INACTIVE_CLASSES,
    TOGGLE_CHECKED_BG_CLASSES,
    OUTLINE_COLOR_CLASSES,
    ThemeColor,
} from '../../utils/theme';
import type { ThemeClasses } from '../../utils/theme';

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

    describe('getTabClasses / TAB_ACTIVE_CLASSES (#1094)', () => {
        const ALL_TAB_COLORS: ThemeColor[] = [
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose',
        ];

        it('TAB_ACTIVE_CLASSES contém todas as 22 cores de ThemeColor', () => {
            ALL_TAB_COLORS.forEach((c) => expect(TAB_ACTIVE_CLASSES[c]).toBeDefined());
            expect(Object.keys(TAB_ACTIVE_CLASSES).sort()).toEqual([...ALL_TAB_COLORS].sort());
        });

        it('TAB_ACTIVE_CLASSES lista apenas classes literais (sem interpolação em runtime)', () => {
            Object.values(TAB_ACTIVE_CLASSES).forEach((v) => expect(v).not.toContain('${'));
        });

        it('TAB_ACTIVE_CLASSES referencia a própria cor em cada valor (border + text light/dark)', () => {
            ALL_TAB_COLORS.forEach((c) => {
                expect(TAB_ACTIVE_CLASSES[c]).toContain(`border-${c}-600`);
                expect(TAB_ACTIVE_CLASSES[c]).toContain(`text-${c}-600`);
                expect(TAB_ACTIVE_CLASSES[c]).toContain(`dark:border-${c}-400`);
                expect(TAB_ACTIVE_CLASSES[c]).toContain(`dark:text-${c}-400`);
            });
        });

        it('valores de amostra do TAB_ACTIVE_CLASSES estão exatos', () => {
            expect(TAB_ACTIVE_CLASSES.indigo).toBe('border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400');
            expect(TAB_ACTIVE_CLASSES.emerald).toBe('border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400');
            expect(TAB_ACTIVE_CLASSES.rose).toBe('border-rose-600 text-rose-600 dark:border-rose-400 dark:text-rose-400');
        });

        it('TAB_INACTIVE_CLASSES é a string neutra esperada (sem cor de tema)', () => {
            expect(TAB_INACTIVE_CLASSES).toBe('border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200');
            expect(TAB_INACTIVE_CLASSES).not.toContain('${');
        });

        it('getTabClasses retorna as classes ativas quando isActive=true', () => {
            expect(getTabClasses('indigo', true)).toBe(TAB_ACTIVE_CLASSES.indigo);
            expect(getTabClasses('blue', true)).toBe(TAB_ACTIVE_CLASSES.blue);
        });

        it('getTabClasses retorna TAB_INACTIVE_CLASSES quando isActive=false', () => {
            expect(getTabClasses('indigo', false)).toBe(TAB_INACTIVE_CLASSES);
            expect(getTabClasses('rose', false)).toBe(TAB_INACTIVE_CLASSES);
        });

        it('getTabClasses sempre retorna TAB_INACTIVE_CLASSES para inativo, mesmo com cor desconhecida', () => {
            expect(getTabClasses('cor-que-nao-existe', false)).toBe(TAB_INACTIVE_CLASSES);
        });

        it('getTabClasses cai no fallback indigo para cor desconhecida ativa', () => {
            expect(getTabClasses('unknown-color', true)).toBe(TAB_ACTIVE_CLASSES.indigo);
            expect(getTabClasses('', true)).toBe(TAB_ACTIVE_CLASSES.indigo);
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

    // ---------------------------------------------------------------------------
    // (#1322) Matching completo: cada ThemeColor x variante do themeClassMap tem
    // classe estática não-vazia, sem interpolação runtime, referenciando a cor.
    // ---------------------------------------------------------------------------
    describe('themeClassMap — matching completo ThemeColor x variante (#1322)', () => {
        const colors: ThemeColor[] = [
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose',
        ];

        const themeKeys = Object.keys(getThemeClasses('indigo')) as (keyof ThemeClasses)[];

        it('themeKeys cobre todas as propriedades esperadas de ThemeClasses', () => {
            // Sanity: garante que estamos iterando sobre o conjunto completo.
            expect(themeKeys).toEqual(expect.arrayContaining([
                'bg50', 'bg100', 'bg200', 'bg500', 'bg600', 'bg700',
                'bgDark900', 'bgDark800',
                'text500', 'text600', 'text700',
                'border200', 'border300', 'border500', 'borderDark700', 'borderDark800',
                'ring500', 'ringOffset',
                'hoverBg100', 'hoverBg600', 'hoverText700',
                'primaryButton', 'secondaryButton', 'ghostButton',
                'activeCard', 'inactiveCard', 'badge', 'link',
            ]));
        });

        colors.forEach((color) => {
            describe(`cor ${color}`, () => {
                const classes = getThemeClasses(color);

                themeKeys.forEach((key) => {
                    it(`${key} retorna classe estática não-vazia (sem interpolação)`, () => {
                        const value = classes[key];
                        expect(value).toBeTruthy();
                        expect(typeof value).toBe('string');
                        expect(value.length).toBeGreaterThan(0);
                        // Nenhuma interpolação dinâmica sobrou.
                        expect(value).not.toContain('${');
                    });
                });

                // Variantes derivadas da cor devem referenciar a própria cor.
                const colorDerivedKeys = themeKeys.filter(
                    (k) => k !== 'inactiveCard',
                ) as (keyof ThemeClasses)[];

                colorDerivedKeys.forEach((key) => {
                    it(`${key} referencia a cor ${color} no valor`, () => {
                        expect(classes[key]).toContain(`-${color}-`);
                    });
                });

                it('inactiveCard é o cartão neutro (referencia slate, não a cor de tema)', () => {
                    expect(classes.inactiveCard).toContain('bg-white');
                    expect(classes.inactiveCard).toContain('slate');
                    expect(classes.inactiveCard).not.toContain('${');
                });
            });
        });
    });

    // ---------------------------------------------------------------------------
    // (#1322) TOGGLE_CHECKED_BG_CLASSES — toggle peer-checked:bg-* por cor
    // ---------------------------------------------------------------------------
    describe('TOGGLE_CHECKED_BG_CLASSES / getToggleCheckedBg (#1322)', () => {
        const ALL_TOGGLE_COLORS: ThemeColor[] = [
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose',
        ];

        it('TOGGLE_CHECKED_BG_CLASSES contém todas as 22 cores de ThemeColor', () => {
            ALL_TOGGLE_COLORS.forEach((c) => expect(TOGGLE_CHECKED_BG_CLASSES[c]).toBeDefined());
            expect(Object.keys(TOGGLE_CHECKED_BG_CLASSES).sort()).toEqual([...ALL_TOGGLE_COLORS].sort());
        });

        it('TOGGLE_CHECKED_BG_CLASSES lista apenas classes literais (sem interpolação runtime)', () => {
            Object.values(TOGGLE_CHECKED_BG_CLASSES).forEach((v) => {
                expect(v).not.toContain('${');
                expect(v.length).toBeGreaterThan(0);
            });
        });

        it('TOGGLE_CHECKED_BG_CLASSES referencia peer-checked + bg + a própria cor por chave', () => {
            ALL_TOGGLE_COLORS.forEach((c) => {
                expect(TOGGLE_CHECKED_BG_CLASSES[c]).toBe(`peer-checked:bg-${c}-600`);
            });
        });

        it('valores de amostra do TOGGLE_CHECKED_BG_CLASSES estão exatos', () => {
            expect(TOGGLE_CHECKED_BG_CLASSES.indigo).toBe('peer-checked:bg-indigo-600');
            expect(TOGGLE_CHECKED_BG_CLASSES.emerald).toBe('peer-checked:bg-emerald-600');
            expect(TOGGLE_CHECKED_BG_CLASSES.rose).toBe('peer-checked:bg-rose-600');
        });

        it('getToggleCheckedBg retorna a classe correta para cores válidas', () => {
            expect(getToggleCheckedBg('indigo')).toBe('peer-checked:bg-indigo-600');
            expect(getToggleCheckedBg('blue')).toBe('peer-checked:bg-blue-600');
            expect(getToggleCheckedBg('green')).toBe('peer-checked:bg-green-600');
        });

        it('getToggleCheckedBg nunca retorna string vazia (fallback indigo para cor desconhecida)', () => {
            expect(getToggleCheckedBg('cor-que-nao-existe')).toBe('peer-checked:bg-indigo-600');
            expect(getToggleCheckedBg('')).toBe('peer-checked:bg-indigo-600');
            expect(getToggleCheckedBg('unknown')).toBeTruthy();
        });
    });

    // ---------------------------------------------------------------------------
    // (#1322) OUTLINE_COLOR_CLASSES — outline por cor (ring/border/outline/text)
    // ---------------------------------------------------------------------------
    describe('OUTLINE_COLOR_CLASSES / getOutlineColor (#1322)', () => {
        const ALL_OUTLINE_COLORS: ThemeColor[] = [
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose',
        ];

        it('OUTLINE_COLOR_CLASSES contém todas as 22 cores de ThemeColor', () => {
            ALL_OUTLINE_COLORS.forEach((c) => expect(OUTLINE_COLOR_CLASSES[c]).toBeDefined());
            expect(Object.keys(OUTLINE_COLOR_CLASSES).sort()).toEqual([...ALL_OUTLINE_COLORS].sort());
        });

        it('OUTLINE_COLOR_CLASSES lista apenas classes literais (sem interpolação runtime)', () => {
            Object.values(OUTLINE_COLOR_CLASSES).forEach((v) => {
                expect(v).not.toContain('${');
                expect(v.length).toBeGreaterThan(0);
            });
        });

        it('OUTLINE_COLOR_CLASSES referencia outline + a própria cor por chave', () => {
            ALL_OUTLINE_COLORS.forEach((c) => {
                expect(OUTLINE_COLOR_CLASSES[c]).toBe(`outline-${c}-500`);
            });
        });

        it('valores de amostra do OUTLINE_COLOR_CLASSES estão exatos', () => {
            expect(OUTLINE_COLOR_CLASSES.indigo).toBe('outline-indigo-500');
            expect(OUTLINE_COLOR_CLASSES.emerald).toBe('outline-emerald-500');
            expect(OUTLINE_COLOR_CLASSES.rose).toBe('outline-rose-500');
        });

        it('getOutlineColor retorna a classe correta para cores válidas', () => {
            expect(getOutlineColor('indigo')).toBe('outline-indigo-500');
            expect(getOutlineColor('cyan')).toBe('outline-cyan-500');
            expect(getOutlineColor('violet')).toBe('outline-violet-500');
        });

        it('getOutlineColor nunca retorna string vazia (fallback indigo para cor desconhecida)', () => {
            expect(getOutlineColor('cor-que-nao-existe')).toBe('outline-indigo-500');
            expect(getOutlineColor('')).toBe('outline-indigo-500');
            expect(getOutlineColor('unknown')).toBeTruthy();
        });
    });

    // ---------------------------------------------------------------------------
    // (#1322) Família de mapas estáticos — garantia conjunta de cobertura
    // ---------------------------------------------------------------------------
    describe('mapas estáticos por cor — cobertura conjunta (#1322)', () => {
        const ALL_COLORS: ThemeColor[] = [
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose',
        ];

        const STATIC_MAPS: Record<string, Record<ThemeColor, string>> = {
            TAB_ACTIVE_CLASSES,
            TOGGLE_CHECKED_BG_CLASSES,
            OUTLINE_COLOR_CLASSES,
        };

        Object.entries(STATIC_MAPS).forEach(([mapName, map]) => {
            it(`${mapName} cobre exatamente as 22 cores de ThemeColor`, () => {
                expect(Object.keys(map).sort()).toEqual([...ALL_COLORS].sort());
            });

            it(`${mapName} não contém valores vazios/undefined nem interpolação`, () => {
                ALL_COLORS.forEach((c) => {
                    expect(map[c]).toBeTruthy();
                    expect(map[c]).not.toContain('${');
                });
            });
        });
    });

    // ---------------------------------------------------------------------------
    // (#1322) Novas variantes adicionadas ao ThemeClasses — matching exato
    // (text400, border400, ring600, outline500, toggleOn, solidButton,
    //  iconColor, selectedCard, tabFill). Garante composição exata por cor.
    // ---------------------------------------------------------------------------
    describe('themeClassMap — novas variantes por cor (#1322)', () => {
        const ALL_COLORS: ThemeColor[] = [
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose',
        ];

        type ThemeKey = keyof ThemeClasses;
        type Check = { key: ThemeKey; expected: (c: string) => string };
        const checks: Check[] = [
            { key: 'text400',      expected: (c) => `text-${c}-400` },
            { key: 'border400',    expected: (c) => `border-${c}-400` },
            { key: 'ring600',      expected: (c) => `ring-${c}-600` },
            { key: 'outline500',   expected: (c) => `outline-${c}-500` },
            { key: 'toggleOn',     expected: (c) => `peer-checked:bg-${c}-600` },
            { key: 'solidButton',  expected: (c) => `bg-${c}-600 text-white` },
            { key: 'iconColor',    expected: (c) => `text-${c}-600 dark:text-${c}-400` },
            { key: 'selectedCard', expected: (c) => `border-${c}-400 bg-${c}-50 dark:bg-${c}-900/20` },
            { key: 'tabFill',      expected: (c) => `bg-${c}-50 text-${c}-700 dark:bg-${c}-900/20 dark:text-${c}-300` },
        ];

        // Critério (c): nenhuma variante nova retorna string vazia/undefined.
        it('todas as novas variantes são strings não-vazias e sem interpolação runtime', () => {
            ALL_COLORS.forEach((color) => {
                checks.forEach(({ key }) => {
                    const value = getThemeClass(color, key);
                    expect(typeof value).toBe('string');
                    expect(value.length).toBeGreaterThan(0);
                    expect(value).not.toContain('${');
                });
            });
        });

        // Matching completo: cada ThemeColor x variante tem a classe estática esperada.
        it.each(ALL_COLORS.map((c) => [c] as const))(
            'novas variantes de %s correspondem exatamente ao esperado',
            (color) => {
                const classes = getThemeClasses(color);
                checks.forEach(({ key, expected }) => {
                    expect(classes[key]).toBe(expected(color));
                });
            },
        );

        it('expõe as 9 novas chaves de variante na interface', () => {
            const sample = getThemeClasses('indigo');
            const newKeys = checks.map((c) => c.key);
            newKeys.forEach((k) => expect(sample[k]).toBeDefined());
            expect(newKeys.length).toBe(9);
        });
    });

    // ---------------------------------------------------------------------------
    // (#1322) Consistência entre as variantes do ThemeClasses e os mapas
    // dedicados (TOGGLE_CHECKED_BG_CLASSES / OUTLINE_COLOR_CLASSES) — garante
    // que as duas formas de acesso nunca divergem.
    // ---------------------------------------------------------------------------
    describe('consistência toggleOn/outline500 x mapas dedicados (#1322)', () => {
        const ALL_COLORS: ThemeColor[] = [
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose',
        ];

        it('getThemeClass(c, "toggleOn") == getToggleCheckedBg(c) para todas as cores', () => {
            ALL_COLORS.forEach((c) => {
                expect(getThemeClass(c, 'toggleOn')).toBe(getToggleCheckedBg(c));
                expect(getThemeClass(c, 'toggleOn')).toBe(TOGGLE_CHECKED_BG_CLASSES[c]);
            });
        });

        it('getThemeClass(c, "outline500") == getOutlineColor(c) para todas as cores', () => {
            ALL_COLORS.forEach((c) => {
                expect(getThemeClass(c, 'outline500')).toBe(getOutlineColor(c));
                expect(getThemeClass(c, 'outline500')).toBe(OUTLINE_COLOR_CLASSES[c]);
            });
        });
    });

    // ---------------------------------------------------------------------------
    // (#1322) Cobertura exaustiva ThemeColor x variante — todas as chaves do
    // ThemeClasses (37 variantes) são strings não-vazias, sem interpolação e
    // (exceto inactiveCard) referenciam a própria cor do tema.
    // ---------------------------------------------------------------------------
    describe('cobertura exaustiva ThemeColor x variante (#1322)', () => {
        const ALL_COLORS: ThemeColor[] = [
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose',
        ];

        const ALL_KEYS: Array<keyof ThemeClasses> = [
            'bg50', 'bg100', 'bg200', 'bg500', 'bg600', 'bg700',
            'bgDark900', 'bgDark800',
            'text400', 'text500', 'text600', 'text700',
            'border200', 'border300', 'border400', 'border500',
            'borderDark700', 'borderDark800',
            'ring500', 'ring600', 'outline500', 'ringOffset',
            'hoverBg100', 'hoverBg600', 'hoverText700',
            'toggleOn', 'solidButton',
            'primaryButton', 'secondaryButton', 'ghostButton', 'iconColor',
            'activeCard', 'inactiveCard', 'selectedCard', 'tabFill', 'badge', 'link',
        ];

        it('ALL_KEYS cobre exatamente as chaves expostas por getThemeClasses', () => {
            const sampleKeys = Object.keys(getThemeClasses('indigo'));
            expect(ALL_KEYS.length).toBe(sampleKeys.length);
            expect(sampleKeys.sort()).toEqual([...ALL_KEYS].sort());
            expect(ALL_KEYS.length).toBe(37);
        });

        it('cada ThemeColor x variante é string não-vazia e sem interpolação runtime', () => {
            ALL_COLORS.forEach((color) => {
                const classes = getThemeClasses(color);
                ALL_KEYS.forEach((key) => {
                    const value = classes[key];
                    expect(typeof value).toBe('string');
                    expect(value.length).toBeGreaterThan(0);
                    expect(value).not.toContain('${');
                });
            });
        });

        // Classes coloridas (que NÃO são neutras como inactiveCard) citam a própria cor.
        it('classes coloridas referenciam a própria cor do tema', () => {
            const colorlessKeys = new Set<keyof ThemeClasses>(['inactiveCard']);
            ALL_COLORS.forEach((color) => {
                const classes = getThemeClasses(color);
                ALL_KEYS.forEach((key) => {
                    if (colorlessKeys.has(key)) return;
                    expect(classes[key]).toContain(`-${color}-`);
                });
            });
        });

        it('número de chaves enumeradas corresponde ao total de variantes do mapa (37)', () => {
            const sample = getThemeClasses('indigo');
            expect(ALL_KEYS.length).toBe(Object.keys(sample).length);
            expect(ALL_KEYS.length).toBe(37);
        });
    });
});