import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('../../config/env', () => ({
    config: {
        get serperApiKey() {
            return process.env.SERPER_API_KEY || '';
        },
    },
}));
// `config.serperApiKey` é capturado uma única vez em env.ts no carregamento do
// módulo, então uma SERPER_API_KEY real exportada no ambiente de CI shadow-aria
// o `vi.stubEnv` posterior. O getter acima reflete `process.env.SERPER_API_KEY`
// em cada acesso, espelhando o fallback `config.serperApiKey ||
// process.env.SERPER_API_KEY` do scraperService e isolando estes testes de
// qualquer chave pré-existente no host.

vi.mock('../../utils/urlValidation', () => ({
    isValidExternalUrl: vi.fn((url: string) => !url.includes('192.168') && !url.includes('localhost')),
}));

import { ScraperService } from '../../services/scraperService';
import { isValidExternalUrl } from '../../utils/urlValidation';

describe('ScraperService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('SERPER_API_KEY', '');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('searchGoogle', () => {
        // Cobre o ramo "chave AUSENTE do env" (delete da var). Exercita o
        // caminho `apiKey = config.serperApiKey || process.env.SERPER_API_KEY`
        // → undefined → falsy → throw. Diferente do teste seguinte (empty string).
        it('rejects with explicit error when SERPER_API_KEY is missing (undefined)', async () => {
            delete process.env.SERPER_API_KEY;
            await expect(ScraperService.searchGoogle('test query'))
                .rejects.toThrow(/SERPER_API_KEY ausente/);
        });

        // Cobre o ramo "chave = string vazia" via stubEnv no beforeEach.
        // Diferente do teste anterior (delete → undefined).
        it('rejects with explicit error when SERPER_API_KEY is empty string', async () => {
            await expect(ScraperService.searchGoogle('test query'))
                .rejects.toThrow(/SERPER_API_KEY ausente/);
        });

        // Issue #1503 (canônico): rejeita com a mensagem EXATA exigida pela issue
        // e cobre o critério "Teste falha se alguém reintroduzir o retorno silencioso
        // []" — se a promise resolver com [], `.rejects.toThrow(...)` falha porque
        // a promise não rejeitou. Mantido como asserção dedicada/separada das
        // duas anteriores (regex) para rastreabilidade da issue e servir de guard
        // contra regressões silenciosas.
        it('#1503: rejects with the exact error message when SERPER_API_KEY is missing', async () => {
            await expect(ScraperService.searchGoogle('test query'))
                .rejects.toBeInstanceOf(Error);
            await expect(ScraperService.searchGoogle('test query'))
                .rejects.toThrow('SERPER_API_KEY ausente — busca via Serper indisponível');
        });

        it('returns shopping and organic results', async () => {
            vi.stubEnv('SERPER_API_KEY', 'test-api-key');
            (axios.post as any).mockResolvedValue({
                data: {
                    shopping: [{ source: 'Store', title: 'Product', price: 'R$ 100', link: 'https://store.com/p' }],
                    organic: [{ title: 'Result', link: 'https://www.example.com', snippet: 'desc' }],
                },
            });

            const result = await ScraperService.searchGoogle('test');
            expect(result).toHaveLength(2);
            expect(result[0].type).toBe('shopping');
            expect(result[0].price).toBe('R$ 100');
            expect(result[1].type).toBe('organic');
            expect(result[1].source).toBe('example.com');
        });

        it('returns empty on API error', async () => {
            vi.stubEnv('SERPER_API_KEY', 'test-api-key');
            (axios.post as any).mockRejectedValue(new Error('API error'));
            const result = await ScraperService.searchGoogle('test');
            expect(result).toEqual([]);
        });
    });

    describe('fetchPageContent', () => {
        it('returns null for non-external URL', async () => {
            const result = await ScraperService.fetchPageContent('http://192.168.1.1/admin');
            expect(result).toBeNull();
        });

        it('fetches and extracts text content', async () => {
            (axios.get as any).mockResolvedValue({
                data: '<html><body><script>var x=1;</script><style>.x{}</style><p>Hello World</p></body></html>',
            });

            const result = await ScraperService.fetchPageContent('https://example.com');
            expect(result).toContain('Hello World');
            expect(result).not.toContain('var x');
        });

        it('truncates long content to 20000 chars', async () => {
            const longText = 'x'.repeat(25000);
            (axios.get as any).mockResolvedValue({
                data: `<html><body><p>${longText}</p></body></html>`,
            });

            const result = await ScraperService.fetchPageContent('https://example.com');
            expect(result!.length).toBeLessThanOrEqual(20000);
        });

        it('returns null on fetch error', async () => {
            (axios.get as any).mockRejectedValue(new Error('Network error'));
            const result = await ScraperService.fetchPageContent('https://example.com');
            expect(result).toBeNull();
        });
    });
});
