import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SalaryPaymentList from '../../components/HR/SalaryPaymentList';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const mockConfig = {
    apiUrl: 'http://test',
    apiKey: 'key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
};

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: mockConfig }),
}));

const mockRefetch = vi.fn();

vi.mock('../../hooks/dolibarr', () => ({
    useSalaryPayments: vi.fn(() => ({ data: [], isLoading: false, isError: false, error: null, refetch: mockRefetch })),
    useSalaries: () => ({ data: [] }),
    useUsers: () => ({ data: [] }),
    useBankAccounts: () => ({ data: [] }),
}));

vi.mock('react-virtualized-auto-sizer', () => ({
    __esModule: true,
    default: ({ children }: { children: (size: { height: number; width: number }) => React.ReactNode }) =>
        children({ height: 600, width: 800 }),
}));

import { useSalaryPayments } from '../../hooks/dolibarr';

describe('SalaryPaymentList — loading e erro (#829)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useSalaryPayments).mockReturnValue({
            data: [],
            isLoading: false,
            isError: false,
            error: null,
            refetch: mockRefetch,
        } as any);
    });

    it('exibe spinner de carregamento na primeira carga (isLoading=true, sem dados)', () => {
        vi.mocked(useSalaryPayments).mockReturnValue({
            data: [],
            isLoading: true,
            isError: false,
            error: null,
            refetch: mockRefetch,
        } as any);

        render(<SalaryPaymentList />);

        expect(screen.getByText('Carregando pagamentos…')).toBeInTheDocument();
    });

    it('exibe EmptyState quando carregou com sucesso mas não há pagamentos', () => {
        vi.mocked(useSalaryPayments).mockReturnValue({
            data: [],
            isLoading: false,
            isError: false,
            error: null,
            refetch: mockRefetch,
        } as any);

        render(<SalaryPaymentList />);

        expect(screen.getByText('Nenhum pagamento encontrado')).toBeInTheDocument();
    });

    it('exibe ErrorState com botão "Tentar novamente" quando isError=true', () => {
        vi.mocked(useSalaryPayments).mockReturnValue({
            data: [],
            isLoading: false,
            isError: true,
            error: new Error('Falha na sincronização de salários'),
            refetch: mockRefetch,
        } as any);

        render(<SalaryPaymentList />);

        expect(screen.getByText('Falha na sincronização de salários')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
    });

    it('botão "Tentar novamente" dispara refetch', () => {
        vi.mocked(useSalaryPayments).mockReturnValue({
            data: [],
            isLoading: false,
            isError: true,
            error: new Error('Falhou'),
            refetch: mockRefetch,
        } as any);

        render(<SalaryPaymentList />);

        fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));

        expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it('erro tem precedência sobre loading quando isError=true', () => {
        vi.mocked(useSalaryPayments).mockReturnValue({
            data: [],
            isLoading: true,
            isError: true,
            error: new Error('Erro dominante'),
            refetch: mockRefetch,
        } as any);

        render(<SalaryPaymentList />);

        expect(screen.getByText('Erro dominante')).toBeInTheDocument();
        expect(screen.queryByText('Carregando pagamentos…')).not.toBeInTheDocument();
    });
});
