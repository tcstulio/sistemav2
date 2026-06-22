import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaymentList from '../PaymentList';
import { useDolibarr } from '../../context/DolibarrContext';
import { usePayments } from '../../hooks/dolibarr';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const baseConfig = { apiUrl: 'http://test', apiKey: 'key' };

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: baseConfig, isLoading: false, error: null })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    usePayments: vi.fn(() => ({
        data: [],
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
    })),
    useInvoices: vi.fn(() => ({ data: [] })),
    usePaymentInvoiceLinks: vi.fn(() => ({ data: [] })),
    useBankAccounts: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
    useCustomers: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDolibarr).mockReturnValue({ config: baseConfig, isLoading: false, error: null } as any);
});

describe('PaymentList — estados de loading e erro (#648)', () => {
    it('mostra o spinner "Carregando" enquanto isLoading é true', () => {
        vi.mocked(usePayments).mockReturnValue({
            data: undefined,
            isLoading: true,
            isFetching: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
        } as any);

        render(<PaymentList />);

        expect(screen.getByText(/Carregando pagamentos/i)).toBeTruthy();
    });

    it('mostra mensagem de erro e botão de retry quando isError é true', () => {
        vi.mocked(usePayments).mockReturnValue({
            data: undefined,
            isLoading: false,
            isFetching: false,
            isError: true,
            error: new Error('Falha de rede'),
            refetch: vi.fn(),
        } as any);

        render(<PaymentList />);

        expect(screen.getByText(/Falha de rede/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeTruthy();
    });

    it('chama refetch() ao clicar em "Tentar novamente"', async () => {
        const refetch = vi.fn();
        vi.mocked(usePayments).mockReturnValue({
            data: undefined,
            isLoading: false,
            isFetching: false,
            isError: true,
            error: new Error('Falha de rede'),
            refetch,
        } as any);

        const user = userEvent.setup();
        render(<PaymentList />);

        await user.click(screen.getByRole('button', { name: /Tentar novamente/i }));

        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('mostra estado vazio quando carrega com sucesso mas não há pagamentos', () => {
        vi.mocked(usePayments).mockReturnValue({
            data: [],
            isLoading: false,
            isFetching: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
        } as any);

        render(<PaymentList />);

        expect(screen.getByText(/Nenhum pagamento encontrado/i)).toBeTruthy();
    });

    it('mostra indicador sutil durante background refetch (isFetching)', () => {
        // Lista vazia + isFetching: o header (que abriga o indicador) renderiza sem
        // acionar o AutoSizer/react-window, evitando dependência de ResizeObserver.
        vi.mocked(usePayments).mockReturnValue({
            data: [],
            isLoading: false,
            isFetching: true,
            isError: false,
            error: null,
            refetch: vi.fn(),
        } as any);

        render(<PaymentList />);

        expect(screen.getByTestId('payments-fetching-indicator')).toBeTruthy();
    });
});
