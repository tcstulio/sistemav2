import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FinanceTab } from '../../../components/Reports/FinanceTab';

vi.mock('recharts', () => {
    const stub = ({ children }: any) => (children ? <div>{children}</div> : null);
    return {
        ResponsiveContainer: stub,
        BarChart: stub,
        Bar: stub,
        XAxis: stub,
        YAxis: stub,
        CartesianGrid: stub,
        Tooltip: stub,
        PieChart: stub,
        Pie: stub,
        Cell: stub,
        Legend: stub,
    };
});

const baseFinancialStats = {
    inflow: 10000,
    outflow: 5000,
    net: 5000,
    breakdown: {
        suppliers: 2000,
        salaries: 2000,
        taxes: 1000,
    },
};

describe('FinanceTab', () => {
    it('shows supplier name when soc_name is available', () => {
        const supplierPayments = [
            {
                id: 1, ref: 'FORN-001', date_payment: '2026-01-15',
                amount: 5000, soc_name: 'Fornecedor Alpha S.A.', socid: '99'
            },
        ];
        render(
            <FinanceTab
                financialStats={baseFinancialStats}
                payments={[]}
                supplierPayments={supplierPayments as any}
                salaries={[]}
            />
        );
        expect(screen.getByText('Fornecedor Alpha S.A.')).toBeInTheDocument();
    });

    it('shows fallback #id when soc_name is not available but socid exists', () => {
        const supplierPayments = [
            {
                id: 2, ref: 'FORN-002', date_payment: '2026-01-20',
                amount: 3000, soc_name: undefined, socid: '77'
            },
        ];
        render(
            <FinanceTab
                financialStats={baseFinancialStats}
                payments={[]}
                supplierPayments={supplierPayments as any}
                salaries={[]}
            />
        );
        expect(screen.getByText('#77')).toBeInTheDocument();
    });

    it('shows dash when neither soc_name nor socid is available', () => {
        const supplierPayments = [
            {
                id: 3, ref: 'FORN-003', date_payment: '2026-01-25',
                amount: 1000, soc_name: undefined, socid: undefined
            },
        ];
        render(
            <FinanceTab
                financialStats={baseFinancialStats}
                payments={[]}
                supplierPayments={supplierPayments as any}
                salaries={[]}
            />
        );
        // The Fornecedor column should show '-'
        const rows = screen.getAllByRole('row');
        // First row is header, second is data
        expect(rows[1].textContent).toContain('-');
    });

    it('renders "Fornecedor" column header', () => {
        render(
            <FinanceTab
                financialStats={baseFinancialStats}
                payments={[]}
                supplierPayments={[]}
                salaries={[]}
            />
        );
        expect(screen.getByText('Fornecedor')).toBeInTheDocument();
    });

    it('renders empty state message when no supplier payments', () => {
        render(
            <FinanceTab
                financialStats={baseFinancialStats}
                payments={[]}
                supplierPayments={[]}
                salaries={[]}
            />
        );
        expect(screen.getByText(/Nenhum pagamento encontrado/i)).toBeInTheDocument();
    });
});
