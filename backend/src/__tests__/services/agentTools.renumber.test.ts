import { describe, it, expect, vi } from 'vitest';

// #1491: TOOLS_PROMPT usa numeração sequencial única por ferramenta. Antes os números
// #33/#34 colidiam entre os blocos detalhe/ação e havia sub-rótulos tipo "42b"/"110b"
// que confundiam o LLM (ele lê o número como identidade da ferramenta).
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-renumber' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { TOOLS_PROMPT } from '../../services/agentTools';

function extractToolNumbers(prompt: string): number[] {
    const re = /^\s+(\d+)\.\s+\w+\(/gm;
    const out: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) out.push(Number(m[1]));
    return out;
}

describe('agentTools — numeração do TOOLS_PROMPT (#1491)', () => {
    const numbers = extractToolNumbers(TOOLS_PROMPT);

    it('tem pelo menos 1 ferramenta numerada', () => {
        expect(numbers.length).toBeGreaterThan(0);
    });

    it('cada número é único (sem colisões entre blocos)', () => {
        const seen = new Set<number>();
        const dups: number[] = [];
        for (const n of numbers) {
            if (seen.has(n)) dups.push(n);
            else seen.add(n);
        }
        expect(dups, `números duplicados: ${dups.join(', ')}`).toEqual([]);
    });

    it('a numeração é sequencial 1..N sem buracos', () => {
        for (let i = 1; i <= numbers.length; i++) {
            expect(numbers[i - 1], `esperado ${i} no índice ${i - 1}, achei ${numbers[i - 1]}`)
                .toBe(i);
        }
    });

    it('não há sub-rótulos tipo "42b"/"110b" (sem letras após o número)', () => {
        expect(TOOLS_PROMPT).not.toMatch(/^\s+\d+[a-z]\.\s+\w+\(/m);
    });
});
