import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { isValidExternalUrl } from '../utils/urlValidation';

const log = logger.child('ScraperService');

export const ScraperService = {

    /**
     * Search Google using Serper.dev API
     */
    searchGoogle: async (query: string): Promise<any[]> => {
        const apiKey = config.serperApiKey || process.env.SERPER_API_KEY;

        if (!apiKey) {
            throw new Error('SERPER_API_KEY ausente — busca via Serper indisponível');
        }

        try {
            const response = await axios.post(
                'https://google.serper.dev/search',
                { q: query, gl: 'br', hl: 'pt-br', num: 10 },
                { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
            );

            // Normalize results
            const results = [];

            // Shopping results (if available) are great for products
            if (response.data.shopping) {
                results.push(...response.data.shopping.map((item: any) => ({
                    source: item.source,
                    title: item.title,
                    price: item.price,
                    link: item.link,
                    type: 'shopping'
                })));
            }

            // Organic results
            if (response.data.organic) {
                results.push(...response.data.organic.map((item: any) => ({
                    source: new URL(item.link).hostname.replace('www.', ''),
                    title: item.title,
                    price: null, // Organic usually doesn't have price field directly
                    link: item.link,
                    snippet: item.snippet,
                    type: 'organic'
                })));
            }

            return results;

        } catch (error: any) {
            log.error(`Serper Search Error: ${error.message}`);
            return [];
        }
    },

    /**
     * Fetch HTML content from a URL for LLM extraction
     */
    fetchPageContent: async (url: string): Promise<string | null> => {
        try {
            if (!isValidExternalUrl(url)) {
                log.warn(`Blocked fetch to non-external URL: ${url}`);
                return null;
            }

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                timeout: 10000
            });

            const html = response.data;
            const $ = cheerio.load(html);

            // Remove scripts, styles, comments to reduce token count
            $('script').remove();
            $('style').remove();
            $('noscript').remove();
            $('iframe').remove();
            $('comment').remove();

            // Get text content
            // We want to preserve some structure, so maybe just body text
            let text = $('body').text().replace(/\s+/g, ' ').trim();

            // Cap length to avoid context overflow (approx 20k chars is plenty for price check)
            if (text.length > 20000) text = text.substring(0, 20000);

            return text;

        } catch (error: any) {
            log.error(`Scrape Error (${url}): ${error.message}`);
            return null;
        }
    }
};
