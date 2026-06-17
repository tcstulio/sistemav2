import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const DAY = 24 * 60 * 60 * 1000;

const mockAi = vi.hoisted(() => ({
    getLatestFinancialAnalysis: vi.fn(),
    analyzeFinancialHealth: vi.fn(),
}));

const mockSave = vi.hoisted(() => vi.fn());

vi.mock('../../services/aiService', () => ({ AiService: mockAi }));
vi.mock('../../services/dashboardArtifacts', () => ({
    saveFinancialAnalysis: (...args: any[]) => mockSave(...args),
}));
// Renderiza o markdown como texto puro para podermos inspecionar o conteúdo.
vi.mock('react-markdown', () => ({
    default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

import { FinancialHealthWidget } from '../../components/Finance/FinancialHealthWidget';

describe('FinancialHealthWidget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAi.getLatestFinancialAnalysis.mockResolvedValue(null);
        mockAi.analyzeFinancialHealth.mockResolvedValue('');
        mockSave.mockResolvedValue({ generatedAt: Date.now(), generatedBy: 'test', value: '' });
    });

    it('carrega e exibe a última análise persistida sem clique manual', async () => {
        mockAi.getLatestFinancialAnalysis.mockResolvedValue({
            data: '# Saúde financeira estável',
            lastRunAt: new Date(Date.now() - 2 * DAY).toISOString(),
            status: 'success',
        });

        render(<FinancialHealthWidget data={{ revenue: 1000 }} />);

        // Aparece automaticamente (sem interação)
        expect(await screen.findByText('# Saúde financeira estável')).toBeInTheDocument();
        // Timestamp da última execução visível
        expect(screen.getByText(/Última análise:/)).toBeInTheDocument();
        // O endpoint de "latest" foi chamado na montagem
        expect(mockAi.getLatestFinancialAnalysis).toHaveBeenCalledTimes(1);
        // O botão de fallback continua disponível
        expect(screen.getByRole('button', { name: /Regenerar/ })).toBeInTheDocument();
    });

    it('mostra mensagem amigável quando não há análise salva', async () => {
        mockAi.getLatestFinancialAnalysis.mockResolvedValue(null);

        render(<FinancialHealthWidget data={{}} />);

        expect(await screen.findByText('Nenhuma análise disponível ainda.')).toBeInTheDocument();
    });

    it('mostra indicador de análise desatualizada quando mais antiga que 7 dias', async () => {
        mockAi.getLatestFinancialAnalysis.mockResolvedValue({
            data: '# Relatório antigo',
            lastRunAt: new Date(Date.now() - 8 * DAY).toISOString(),
            status: 'success',
        });

        render(<FinancialHealthWidget data={{}} />);

        expect(await screen.findByText(/Análise desatualizada/)).toBeInTheDocument();
    });

    it('não mostra indicador de desatualização para análise recente', async () => {
        mockAi.getLatestFinancialAnalysis.mockResolvedValue({
            data: '# Relatório recente',
            lastRunAt: new Date(Date.now() - 1 * DAY).toISOString(),
            status: 'success',
        });

        render(<FinancialHealthWidget data={{}} />);

        expect(await screen.findByText('# Relatório recente')).toBeInTheDocument();
        expect(screen.queryByText(/Análise desatualizada/)).toBeNull();
    });

    it('gera análise manualmente via botão de fallback', async () => {
        const user = userEvent.setup();
        // Sem análise persistida inicialmente
        mockAi.getLatestFinancialAnalysis.mockResolvedValue(null);
        mockAi.analyzeFinancialHealth.mockResolvedValue('# Análise gerada manualmente');

        render(<FinancialHealthWidget data={{ revenue: 500 }} />);

        // Aguarda o estado de "sem análise"
        const button = await screen.findByRole('button', { name: /Gerar Análise/ });
        await user.click(button);

        // O botão manual dispara a geração e o resultado aparece
        await waitFor(() => expect(screen.getByText('# Análise gerada manualmente')).toBeInTheDocument());
        expect(mockAi.analyzeFinancialHealth).toHaveBeenCalledWith({ revenue: 500 });
        expect(mockSave).toHaveBeenCalledWith('# Análise gerada manualmente');
    });

    it('exibe mensagem de erro quando a geração manual falha', async () => {
        const user = userEvent.setup();
        mockAi.getLatestFinancialAnalysis.mockResolvedValue(null);
        mockAi.analyzeFinancialHealth.mockRejectedValue(new Error('boom'));

        render(<FinancialHealthWidget data={{}} />);

        const button = await screen.findByRole('button', { name: /Gerar Análise/ });
        await user.click(button);

        await waitFor(() => expect(screen.getByText('Erro ao gerar análise.')).toBeInTheDocument());
    });
});
