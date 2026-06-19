import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReportsView from '../../components/ReportsView';
import { useInvoices } from '../../hooks/dolibarr';
import { formatCurrency } from '../../utils/formatUtils';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key' } })),
}));

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

vi.mock('../../hooks/dolibarr', () => ({
    useInvoices: vi.fn(() => ({ data: [], isLoading: false })),
    useSupplierInvoices: vi.fn(() => ({ data: [], isLoading: false })),
    useCustomers: vi.fn(() => ({ data: [], isLoading: false })),
    useProducts: vi.fn(() => ({ data: [], isLoading: false })),
}));

describe('ReportsView — Currency standardization (#639)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders average invoice value in BRL via formatCurrency (no raw $ prefix)', async () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                { id: 'inv1', ref: 'FA001', socid: 'cust1', date: 1700000000, total_ttc: 2469.12, statut: '1', type: '0' },
            ],
            isLoading: false,
        } as any);

        const { container } = render(<ReportsView />);

        await screen.findByText('Valor Médio da Fatura');

        expect(container.textContent).toContain(formatCurrency(2469.12));
        expect(container.textContent).not.toMatch(/\$\d/);
    });
});
