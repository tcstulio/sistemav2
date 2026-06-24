import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { LlmSettingsTab } from '../../components/DevelopmentConsole/LlmSettingsTab';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock toast
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Mock logger
vi.mock('../../utils/logger', () => ({
    logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));

// Mock formatCurrency
vi.mock('../../utils/formatUtils', () => ({
    formatCurrency: (v: number) => `R$ ${v.toFixed(2)}`,
}));

const HEALTH_DATA = {
    providers: [
        {
            provider: 'glm',
            state: 'healthy',
            consecutiveErrors: 0,
            totalCalls: 42,
            totalErrors: 2,
            totalFallbacks: 1,
        },
        {
            provider: 'minimax',
            state: 'exhausted',
            consecutiveErrors: 2,
            cooldownMs: 120000,
            exhaustedSince: Date.now() - 30000, // 30s ago → 90s remaining
            lastError: '429 Too Many Requests',
            totalCalls: 10,
            totalErrors: 3,
            totalFallbacks: 0,
        },
    ],
    modules: {
        chat: { chain: ['glm', 'minimax'], active: 'glm' },
        banking: { chain: ['glm', 'minimax'], active: 'glm' },
    },
};

const FALLBACK_CHAINS = {
    chat: ['glm', 'minimax'],
    banking: ['glm', 'minimax', 'google'],
    system_analysis: ['glm'],
    proposals: ['glm', 'minimax'],
};

function setupAxiosMocks() {
    mockedAxios.get = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/admin/llm-health')) {
            return Promise.resolve({ data: HEALTH_DATA });
        }
        if (url.includes('/api/admin/config/llm/fallback-chain')) {
            return Promise.resolve({ data: FALLBACK_CHAINS });
        }
        if (url.includes('/api/admin/config/llm/stats')) {
            return Promise.resolve({
                data: {
                    callsToday: 100,
                    tokensToday: 50000,
                    errors: 3,
                    lastError: null,
                    lastCallTime: Date.now(),
                    currentProvider: 'glm',
                    currentModel: 'glm-5.1',
                    estimatedCost: 0.05,
                },
            });
        }
        if (url.includes('/api/admin/config/llm/modules')) {
            return Promise.resolve({
                data: {
                    chat: { provider: 'glm', model: 'glm-5.1' },
                    banking: { provider: 'glm', model: 'glm-5.1' },
                },
            });
        }
        if (url.includes('/api/admin/config/llm/prompts')) {
            return Promise.resolve({ data: { system_base: 'Test prompt' } });
        }
        if (url.includes('/api/admin/config/llm')) {
            return Promise.resolve({
                data: { configProvider: 'glm', localUrl: 'http://localhost:11434/v1', localModelName: 'glm-5.1' },
            });
        }
        return Promise.resolve({ data: {} });
    });
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { success: true } });
}

/**
 * Helper: render and flush initial async effects without running polling timers.
 * Uses real timers for rendering so intervals don't blow up.
 */
async function renderAndFlush() {
    // Use real timers so setInterval doesn't conflict
    vi.useRealTimers();
    let result: ReturnType<typeof render> | undefined;
    await act(async () => {
        result = render(<LlmSettingsTab />);
    });
    return result!;
}

/**
 * Click a tab and flush promises so async fetches resolve.
 */
async function clickTab(tabText: string) {
    await act(async () => {
        fireEvent.click(screen.getByText(tabText));
        // Let promises settle
        await new Promise<void>((r) => setTimeout(r, 50));
    });
}

describe('LlmSettingsTab', () => {
    beforeEach(() => {
        setupAxiosMocks();
        vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('{}');
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders without crashing and shows header', async () => {
        await renderAndFlush();
        expect(screen.getByText('Central de IA')).toBeTruthy();
    });

    it('renders all tabs including Saúde', async () => {
        await renderAndFlush();
        expect(screen.getByText('Saúde')).toBeTruthy();
        expect(screen.getByText('Provider')).toBeTruthy();
        expect(screen.getByText('Módulos')).toBeTruthy();
        expect(screen.getByText('Playground')).toBeTruthy();
        expect(screen.getByText('Monitor')).toBeTruthy();
        expect(screen.getByText('Prompts')).toBeTruthy();
    });

    it('shows health tab content when Saúde tab is clicked', async () => {
        await renderAndFlush();
        await clickTab('Saúde');

        await waitFor(() => {
            expect(screen.getByText('Saúde dos Modelos')).toBeTruthy();
        }, { timeout: 3000 });
    });

    it('shows provider cards with correct status on health tab', async () => {
        await renderAndFlush();
        await clickTab('Saúde');

        await waitFor(() => {
            // Multiple "Z.AI (GLM)" spans exist (header badge + chain editor + health card)
            expect(screen.getAllByText('Z.AI (GLM)').length).toBeGreaterThan(0);
            expect(screen.getByText('Saudável')).toBeTruthy();
            expect(screen.getAllByText('MiniMax').length).toBeGreaterThan(0);
            expect(screen.getByText('Exausto')).toBeTruthy();
        }, { timeout: 3000 });
    });

    it('shows cooldown remaining for exhausted provider', async () => {
        await renderAndFlush();
        await clickTab('Saúde');

        await waitFor(() => {
            expect(screen.getByText(/Cooldown restante/)).toBeTruthy();
        }, { timeout: 3000 });
    });

    it('reset button is disabled with correct title when endpoint not available', async () => {
        await renderAndFlush();
        await clickTab('Saúde');

        await waitFor(() => {
            const resetButtons = screen.getAllByTitle('endpoint pendente');
            expect(resetButtons.length).toBeGreaterThan(0);
            resetButtons.forEach((btn) => {
                expect((btn as HTMLButtonElement).disabled).toBe(true);
            });
        }, { timeout: 3000 });
    });

    it('shows fallback chain editor in health tab', async () => {
        await renderAndFlush();
        await clickTab('Saúde');

        await waitFor(() => {
            expect(screen.getByText('Editor de Cadeia de Fallback')).toBeTruthy();
        }, { timeout: 3000 });
    });

    it('saves fallback chain when Salvar Cadeia button clicked', async () => {
        await renderAndFlush();
        await clickTab('Saúde');

        await waitFor(() => {
            expect(screen.getAllByText('Salvar Cadeia').length).toBeGreaterThan(0);
        }, { timeout: 3000 });

        await act(async () => {
            fireEvent.click(screen.getAllByText('Salvar Cadeia')[0]);
            await new Promise<void>((r) => setTimeout(r, 50));
        });

        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/admin/config/llm/fallback-chain',
            expect.objectContaining({ module: expect.any(String), chain: expect.any(Array) }),
            expect.anything()
        );
    });

    it('shows exhausted provider banner when provider is exhausted', async () => {
        await renderAndFlush();
        await clickTab('Saúde');

        await waitFor(() => {
            // Banner visible in header because minimax is exhausted with remaining cooldown
            expect(screen.getByText(/em cooldown/i)).toBeTruthy();
        }, { timeout: 3000 });
    });

    it('shows module chain status in health tab', async () => {
        await renderAndFlush();
        await clickTab('Saúde');

        await waitFor(() => {
            expect(screen.getByText('Cadeia ativa por módulo')).toBeTruthy();
        }, { timeout: 3000 });
    });

    it('can reorder providers with up/down buttons', async () => {
        await renderAndFlush();
        await clickTab('Saúde');

        await waitFor(() => {
            expect(screen.getAllByTitle('Mover para baixo').length).toBeGreaterThan(0);
        }, { timeout: 3000 });

        // Move first item down — should not throw
        await act(async () => {
            fireEvent.click(screen.getAllByTitle('Mover para baixo')[0]);
        });
    });
});
