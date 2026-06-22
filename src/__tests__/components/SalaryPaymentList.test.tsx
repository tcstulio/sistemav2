import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SalaryPaymentList from '../../components/HR/SalaryPaymentList';
import { SalaryPayment } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';

// Force a fixed viewport so react-window renders rows in jsdom
vi.mock('react-virtualized-auto-sizer', () => ({
    __esModule: true,
    default: ({ children }: { children: (size: { height: number; width: number }) => ReactNode }) =>
        children({ height: 600, width: 800 }),
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

// Dados mutáveis (hoisted) para controlar cenários por teste (#568 + #625).
const { mockData } = vi.hoisted(() => ({
    mockData: {
        payments: [
            { id: 'sp1', ref: 'SAL001', fk_user: '1', date_payment: 1700000000, amount: 2000, salary: 2500, fk_bank: 'b1', fk_typepayment: 'Transferência' },
            { id: 'sp2', ref: 'SAL002', fk_user: '1', date_payment: 1700000001, amount: 1000, salary: 2500, fk_bank: 'b1' },
        ] as SalaryPayment[],
        salaries: [] as Array<{ id: string; ref: string; fk_user: string; amount: number }>,
    },
}));

vi.mock('../../hooks/dolibarr', () => ({
    useSalaryPayments: () => ({ data: mockData.payments }),
    useSalaries: () => ({ data: mockData.salaries }),
    useUsers: () => ({
        data: [
            { id: '1', login: 'u1', firstname: 'José', lastname: 'Silva', email: 'jose@t.com', job: 'Desenvolvedor', statut: '1' },
            { id: '2', login: 'u2', firstname: 'Maria', lastname: 'Santos', email: 'maria@t.com', job: 'Designer', statut: '1' },
        ],
    }),
    useBankAccounts: () => ({ data: [] }),
}));

describe('SalaryPaymentList — Currency standardization (#642 / #625)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockData.payments = [
            { id: 'sp1', ref: 'SAL001', fk_user: '1', date_payment: 1700000000, amount: 2000, salary: 2500, fk_bank: 'b1', fk_typepayment: 'Transferência' },
            { id: 'sp2', ref: 'SAL002', fk_user: '1', date_payment: 1700000001, amount: 1000, salary: 2500, fk_bank: 'b1' },
        ];
        mockData.salaries = [];
    });

    it('renders total paid in BRL via formatCurrency (no isolated $ prefix)', () => {
        const { container } = render(<SalaryPaymentList />);

        // totalPaid = 2000 + 1000 = 3000
        const formatted = formatCurrency(3000);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(container.textContent).toContain('R$');
        // Nenhum cifrão americano isolado (todo "$" deve fazer parte de "R$")
        expect(container.textContent).not.toMatch(/(?<!R)\$/);
    });

    it('renders each payment amount in BRL via formatCurrency in the list (no isolated $ prefix)', () => {
        const { container } = render(<SalaryPaymentList />);

        // Row renders: -{formatCurrency(amount)}
        expect(container.textContent).toContain(`-${formatCurrency(2000)}`);
        expect(container.textContent).toContain(`-${formatCurrency(1000)}`);
        expect(container.textContent).not.toMatch(/(?<!R)\$/);
    });
});

describe('SalaryPaymentList — Forma de Pagamento (#625)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockData.payments = [
            { id: 'sp1', ref: 'SAL001', fk_user: '1', date_payment: 1700000000, amount: 2000, salary: 2500, fk_bank: 'b1', fk_typepayment: 'Transferência' },
            { id: 'sp2', ref: 'SAL002', fk_user: '1', date_payment: 1700000001, amount: 1000, salary: 2500, fk_bank: 'b1' },
        ];
        mockData.salaries = [];
    });

    it('shows "Forma de Pagamento" in detail when fk_typepayment is present', () => {
        render(<SalaryPaymentList />);

        // Seleciona o pagamento que possui fk_typepayment
        fireEvent.click(screen.getByText('SAL001'));

        expect(screen.getByText('Forma de Pagamento')).toBeInTheDocument();
        expect(screen.getByText('Transferência')).toBeInTheDocument();
    });

    it('omits "Forma de Pagamento" line when fk_typepayment is absent', () => {
        render(<SalaryPaymentList />);

        // Seleciona o pagamento sem fk_typepayment
        fireEvent.click(screen.getByText('SAL002'));

        expect(screen.queryByText('Forma de Pagamento')).not.toBeInTheDocument();
    });
});

describe('SalaryPaymentList — Resolver colaborador (#568)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockData.salaries = [];
    });

    it('cenário 1: com fk_user válido → mostra nome e cargo do colaborador', () => {
        mockData.payments = [
            { id: 'sp1', ref: 'SAL001', fk_user: '1', date_payment: 1700000000, amount: 2000, salary: 2500, fk_bank: 'b1' },
        ];
        render(<SalaryPaymentList />);
        fireEvent.click(screen.getByText('SAL001'));

        expect(screen.getByText('José Silva')).toBeInTheDocument();
        expect(screen.getByText('jose@t.com')).toBeInTheDocument();
        // fk_user resolve direto → não deve mostrar mensagem de fallback
        expect(screen.queryByText('Colaborador não vinculado a este pagamento')).not.toBeInTheDocument();
    });

    it('cenário 2: fk_user vazio, fk_salary resolvível → mostra colaborador correto', () => {
        mockData.payments = [
            { id: 'sp2', ref: 'SAL002', fk_user: '', fk_salary: '42', date_payment: 1700000000, amount: 3000, salary: 3500, fk_bank: 'b1' } as SalaryPayment,
        ];
        mockData.salaries = [
            { id: '42', ref: 'SAL-2024-01', fk_user: '2', amount: 3500 },
        ];
        render(<SalaryPaymentList />);
        fireEvent.click(screen.getByText('SAL002'));

        expect(screen.getByText('Maria Santos')).toBeInTheDocument();
        expect(screen.getByText('maria@t.com')).toBeInTheDocument();
        expect(screen.queryByText('Colaborador não vinculado a este pagamento')).not.toBeInTheDocument();
    });

    it('cenário 3: sem fk_user e sem fk_salary resolvível → fallback sem "ID: " vazio', () => {
        mockData.payments = [
            { id: 'sp3', ref: 'SAL003', fk_user: '', date_payment: 1700000000, amount: 1500, salary: 1800, fk_bank: 'b1' } as SalaryPayment,
        ];
        mockData.salaries = [];
        render(<SalaryPaymentList />);
        fireEvent.click(screen.getByText('SAL003'));

        expect(screen.getByText('Colaborador não vinculado a este pagamento')).toBeInTheDocument();
        // Não deve expor "ID: " vazio
        expect(screen.queryByText(/ID:\s*$/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Colaborador não encontrado/)).not.toBeInTheDocument();
    });
});
