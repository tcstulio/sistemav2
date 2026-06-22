import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReportsView from '../../components/ReportsView';
import { useInvoices, useCustomers } from '../../hooks/dolibarr';
import { formatCurrency } from '../../utils/formatUtils';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key', themeColor: 'indigo' } })),
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

describe('ReportsView — Top 5 Clientes responsivo (#562)', () => {
    const longNameInvoices = [
        { id: 'inv1', ref: 'FA001', socid: '10', date: 1700000000, total_ttc: 5000, statut: '2', type: '0' },
        { id: 'inv2', ref: 'FA002', socid: '20', date: 1700000000, total_ttc: 4000, statut: '2', type: '0' },
        { id: 'inv3', ref: 'FA003', socid: '30', date: 1700000000, total_ttc: 3000, statut: '2', type: '0' },
        { id: 'inv4', ref: 'FA004', socid: '40', date: 1700000000, total_ttc: 2000, statut: '2', type: '0' },
        { id: 'inv5', ref: 'FA005', socid: '50', date: 1700000000, total_ttc: 1000, statut: '2', type: '0' },
    ];
    const longNameCustomers = [
        { id: '10', name: 'Empresa Distribuidora de Materiais de Construção Ltda' },
        { id: '20', name: 'Comércio e Representações Norte do Brasil S/A' },
        { id: '30', name: 'Indústria e Comércio de Equipamentos Tecnológicos EIRELI' },
        { id: '40', name: 'Grupo Atacadista de Produtos Alimentícios do Nordeste' },
        { id: '50', name: 'Serviços Integrados de Logística e Transporte do Sul ME' },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useInvoices).mockReturnValue({ data: longNameInvoices, isLoading: false } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: longNameCustomers, isLoading: false } as any);
    });

    it('renders the "Top 5 Clientes" heading', async () => {
        render(<ReportsView />);
        expect(screen.getByText('Top 5 Clientes')).toBeTruthy();
    });

    it('renders the responsive legend list with aria-label', async () => {
        render(<ReportsView />);
        expect(screen.getByRole('list', { name: 'top-clientes-legenda' })).toBeTruthy();
    });

    it('renders all 5 customer names as list items', async () => {
        render(<ReportsView />);
        const list = screen.getByRole('list', { name: 'top-clientes-legenda' });
        const items = list.querySelectorAll('li');
        expect(items.length).toBe(5);
    });

    it('renders customer names with title attribute for long-name tooltip', async () => {
        render(<ReportsView />);
        const list = screen.getByRole('list', { name: 'top-clientes-legenda' });
        const nameSpans = list.querySelectorAll('span.truncate');
        expect(nameSpans.length).toBeGreaterThan(0);
        nameSpans.forEach(span => {
            expect(span.getAttribute('title')).toBeTruthy();
        });
    });

    it('renders customer names with truncate class for overflow control', async () => {
        render(<ReportsView />);
        const list = screen.getByRole('list', { name: 'top-clientes-legenda' });
        const truncatedSpans = list.querySelectorAll('span.truncate');
        expect(truncatedSpans.length).toBe(5);
    });

    it('renders currency values for each customer entry', async () => {
        render(<ReportsView />);
        // Top customer should have R$ 5.000,00 or equivalent
        const container = screen.getByRole('list', { name: 'top-clientes-legenda' });
        expect(container.textContent).toContain(formatCurrency(5000));
        expect(container.textContent).toContain(formatCurrency(4000));
    });

    it('falls back to "ID: <socid>" for unknown customer with title attribute', async () => {
        vi.mocked(useCustomers).mockReturnValue({ data: [], isLoading: false } as any);
        render(<ReportsView />);
        const list = screen.getByRole('list', { name: 'top-clientes-legenda' });
        // All items should show "ID: <socid>" for unknown customers
        const nameSpans = list.querySelectorAll('span.truncate');
        expect(nameSpans.length).toBeGreaterThan(0);
        nameSpans.forEach(span => {
            expect(span.textContent).toMatch(/^ID: \d+$/);
            expect(span.getAttribute('title')).toMatch(/^ID: \d+$/);
        });
    });
});
