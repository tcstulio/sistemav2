import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));

import { STORES, DB_VERSION, DB_NAME } from '../../services/dbService';

describe('IndexedDB STORES — issue #821 (salaries)', () => {
    it("inclui o store 'salaries' usado pelo hook useSalaries", () => {
        expect(STORES).toContain('salaries');
    });

    it('a versão do banco foi incrementada para acionar onupgradeneeded', () => {
        // O loop STORES.forEach(createObjectStore) só roda em onupgradeneended,
        // que só dispara quando a versão sobe. Antes do fix era 29.
        expect(DB_VERSION).toBeGreaterThan(29);
    });

    it("mantém 'salaryPayments' distinto de 'salaries' (sem regressão)", () => {
        expect(STORES).toContain('salaryPayments');
    });

    it("nome e versão do banco continuam consistentes", () => {
        expect(DB_NAME).toBe('CoolGrooveDB');
        expect(DB_VERSION).toBe(30);
    });

    it('TODO storeName declarado nos hooks está presente em STORES (regressão)', () => {
        // Lê o fonte de hooks.ts para extrair todos os storeName literais e
        // garantir que nenhum hook referencie um object store inexistente —
        // exatamente a causa raiz do #821.
        const hooksPath = path.resolve(__dirname, '../../hooks/dolibarr/hooks.ts');
        const source = fs.readFileSync(hooksPath, 'utf-8');

        const re = /storeName:\s*'([^']+)'/g;
        const declared: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) {
            declared.push(match[1]);
        }

        // Sanidade: o regex deve ter encontrado dezenas de hooks.
        expect(declared.length).toBeGreaterThan(30);

        const missing = declared.filter((s) => !STORES.includes(s));
        expect(missing).toEqual([]);
    });
});
