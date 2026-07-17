import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('../../config/env', () => ({
    config: {
        serperApiKey: '',
    },
}));

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
        it('rejects with explicit error when SERPER_API_KEY is missing (undefined)', async () => {
            delete process.env.SERPER_API_KEY;
            await expect(ScraperService.searchGoogle('test query'))
                .rejects.toThrow(/SERPER_API_KEY ausente/);
        });

        it('rejects with explicit error when SERPER_API_KEY is empty string', async () => {
            await expect(ScraperService.searchGoogle('test query'))
                .rejects.toThrow(/SERPER_API_KEY ausente/);
        });

        it('#1503: rejects with the exact error message when SERPER_API_KEY is missing', async () => {
            const promise = ScraperService.searchGoogle('test query');
            await expect(promise).rejects.toBeInstanceOf(Error);
            await expect(promise).rejects.toThrow(
                'SERPER_API_KEY ausente — busca via Serper indisponível'
            );
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
