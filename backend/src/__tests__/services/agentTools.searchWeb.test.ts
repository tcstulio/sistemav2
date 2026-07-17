import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockScraper = vi.hoisted(() => ({
    searchGoogle: vi.fn(),
    fetchPageContent: vi.fn(),
}));
vi.mock('../../services/scraperService', () => ({ ScraperService: mockScraper }));
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-1504' } }));
vi.mock('../../services/uiConfigService', () => ({
    uiConfigService: { get: () => ({ actionGovernance: { irreversibleRequiresApproval: false, adminBypassIrreversible: true } }) },
}));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, TOOLS_PROMPT, getToolsPrompt } from '../../services/agentTools';

describe('agentTools — #1504 remover search_web do TOOLS_PROMPT', () => {
    it('TOOLS_PROMPT (admin e não-admin) NÃO contém a string `search_web(`', () => {
        // Critério de aceite da issue #1504: o nome `search_web` (token de ferramenta que o LLM
        // poderia escolher proativamente) NÃO aparece no prompt. O case no dispatch e o helper
        // `getToolsPrompt` precisam refletir isso tanto para admin quanto não-admin.
        const admin = getToolsPrompt({ isAdmin: true });
        const nonAdmin = getToolsPrompt({ isAdmin: false });

        for (const prompt of [admin, nonAdmin, TOOLS_PROMPT]) {
            expect(prompt).not.toMatch(/\bsearch_web\s*\(/);
        }
    });

    it('web_search continua descrito no TOOLS_PROMPT (não foi removido por engano)', () => {
        expect(TOOLS_PROMPT).toMatch(/\bweb_search\s*\(/);
    });

    it('extract_from_url continua descrito no TOOLS_PROMPT', () => {
        expect(TOOLS_PROMPT).toMatch(/\bextract_from_url\s*\(/);
    });
});

describe('agentTools — #1504 dispatch de search_web devolve erro explícito', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('chamar search_web SEM SERPER_API_KEY devolve a mensagem com "SERPER_API_KEY ausente", NÃO "Nenhum resultado encontrado"', async () => {
        // O scraperService lança um Error com mensagem começando com 'SERPER_API_KEY ausente' quando
        // a chave está ausente — espelhamos o comportamento real aqui (sem rede).
        mockScraper.searchGoogle.mockRejectedValueOnce(
            new Error('SERPER_API_KEY ausente — busca via Serper indisponível'),
        );

        const out = await executeTool('search_web', { query: 'notebook dell' });

        expect(out).toMatch(/SERPER_API_KEY\s+ausente/);
        expect(out).not.toMatch(/^Nenhum resultado encontrado/);
    });

    it('qualquer erro do searchGoogle é propagado como string "Erro: <msg>" (caminho genérico)', async () => {
        mockScraper.searchGoogle.mockRejectedValueOnce(new Error('boom genérico'));

        const out = await executeTool('search_web', { query: 'qualquer' });

        expect(out).toBe('Erro: boom genérico');
    });

    it('search_web SEM erros continua retornando a lista formatada (não regrediu)', async () => {
        mockScraper.searchGoogle.mockResolvedValueOnce([
            { title: 'Loja X', link: 'https://x.com', snippet: 'preços de notebook' },
        ]);

        const out = await executeTool('search_web', { query: 'notebook' });

        expect(out).toMatch(/Resultados da Web/);
        expect(out).toMatch(/Loja X/);
    });

    it('search_web sem resultados devolve "Nenhum resultado encontrado" (caminho NO RESULTS continua intencional)', async () => {
        // Importante: o caminho "sem resultados" NÃO é coberto pelo catch — é uma resposta válida
        // do scraper. Este teste blinda contra uma regressão que coloque o catch também nesse caminho.
        mockScraper.searchGoogle.mockResolvedValueOnce([]);

        const out = await executeTool('search_web', { query: 'xyz123' });

        expect(out).toMatch(/Nenhum resultado encontrado para "xyz123"/);
    });
});
