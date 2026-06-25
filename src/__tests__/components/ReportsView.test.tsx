import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

const renderWithRouter = (ui: React.ReactNode) =>
    render(<MemoryRouter>{ui}</MemoryRouter>);

describe('ReportsView — Currency standardization (#628)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Re-establish default mocks after clear
        vi.mocked(useInvoices).mockReturnValue({ data: [], isLoading: false } as any);
    });

    it('renders average invoice value in BRL via formatCurrency (no raw $ prefix)', async () => {
        const currentYear = new Date().getFullYear();
        const ts = Math.floor(new Date(currentYear, 5, 1).getTime() / 1000);
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                { id: 'inv1', ref: 'FA001', socid: 'cust1', date: ts, total_ttc: 2469.12, statut: '1', type: '0' },
            ],
            isLoading: false,
        } as any);

        const { container } = renderWithRouter(<ReportsView />);

        await screen.findByText('Valor Médio da Fatura');

        expect(container.textContent).toContain(formatCurrency(2469.12));
        expect(container.textContent).not.toMatch(/\$\d/);
    });
});

describe('ReportsView — Period selector (#628)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useInvoices).mockReturnValue({ data: [], isLoading: false } as any);
    });

    it('renders a year selector with the current year selected by default', () => {
        renderWithRouter(<ReportsView />);
        const selector = screen.getByTestId('year-selector') as HTMLSelectElement;
        expect(selector).toBeTruthy();
        expect(Number(selector.value)).toBe(new Date().getFullYear());
    });

    it('year selector offers at least 2 year options', () => {
        renderWithRouter(<ReportsView />);
        const selector = screen.getByTestId('year-selector') as HTMLSelectElement;
        expect(selector.options.length).toBeGreaterThanOrEqual(2);
    });

    it('changing the year selector updates the displayed year in the chart title', () => {
        renderWithRouter(<ReportsView />);
        const selector = screen.getByTestId('year-selector') as HTMLSelectElement;
        const prevYear = String(new Date().getFullYear() - 1);
        fireEvent.change(selector, { target: { value: prevYear } });
        expect(screen.getByText(`Desempenho Financeiro (${prevYear})`)).toBeTruthy();
    });
});

describe('ReportsView — Empty states (#628)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useInvoices).mockReturnValue({ data: [], isLoading: false } as any);
    });

    it('shows empty state for sales chart when no invoices for the period', () => {
        renderWithRouter(<ReportsView />);
        expect(screen.getByTestId('empty-sales')).toBeTruthy();
    });

    it('shows empty state for customers when no invoices for the period', () => {
        renderWithRouter(<ReportsView />);
        expect(screen.getByTestId('empty-customers')).toBeTruthy();
    });

    it('shows empty state for product catalog when no products', () => {
        renderWithRouter(<ReportsView />);
        expect(screen.getByTestId('empty-products')).toBeTruthy();
    });
});

describe('ReportsView — Monthly report link (#628)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useInvoices).mockReturnValue({ data: [], isLoading: false } as any);
    });

    it('renders a button/link to the monthly report', () => {
        renderWithRouter(<ReportsView />);
        const link = screen.getByTestId('link-monthly-report');
        expect(link).toBeTruthy();
        expect(link.textContent).toContain('Mensal');
    });
});

describe('ReportsView — Top 5 Clientes responsivo (#562)', () => {
    const currentYear = new Date().getFullYear();
    const ts = (y: number, m: number) => Math.floor(new Date(y, m, 1).getTime() / 1000);

    const longNameInvoices = [
        { id: 'inv1', ref: 'FA001', socid: '10', date: ts(currentYear, 5), total_ttc: 5000, statut: '2', type: '0' },
        { id: 'inv2', ref: 'FA002', socid: '20', date: ts(currentYear, 5), total_ttc: 4000, statut: '2', type: '0' },
        { id: 'inv3', ref: 'FA003', socid: '30', date: ts(currentYear, 5), total_ttc: 3000, statut: '2', type: '0' },
        { id: 'inv4', ref: 'FA004', socid: '40', date: ts(currentYear, 5), total_ttc: 2000, statut: '2', type: '0' },
        { id: 'inv5', ref: 'FA005', socid: '50', date: ts(currentYear, 5), total_ttc: 1000, statut: '2', type: '0' },
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
        renderWithRouter(<ReportsView />);
        expect(screen.getByText('Top 5 Clientes')).toBeTruthy();
    });

    it('renders the responsive legend list with aria-label', async () => {
        renderWithRouter(<ReportsView />);
        expect(screen.getByRole('list', { name: 'top-clientes-legenda' })).toBeTruthy();
    });

    it('renders all 5 customer names as list items', async () => {
        renderWithRouter(<ReportsView />);
        const list = screen.getByRole('list', { name: 'top-clientes-legenda' });
        const items = list.querySelectorAll('li');
        expect(items.length).toBe(5);
    });

    it('renders customer names with title attribute for long-name tooltip', async () => {
        renderWithRouter(<ReportsView />);
        const list = screen.getByRole('list', { name: 'top-clientes-legenda' });
        const nameSpans = list.querySelectorAll('span.truncate');
        expect(nameSpans.length).toBeGreaterThan(0);
        nameSpans.forEach(span => {
            expect(span.getAttribute('title')).toBeTruthy();
        });
    });

    it('renders customer names with truncate class for overflow control', async () => {
        renderWithRouter(<ReportsView />);
        const list = screen.getByRole('list', { name: 'top-clientes-legenda' });
        const truncatedSpans = list.querySelectorAll('span.truncate');
        expect(truncatedSpans.length).toBe(5);
    });

    it('renders currency values for each customer entry', async () => {
        renderWithRouter(<ReportsView />);
        const container = screen.getByRole('list', { name: 'top-clientes-legenda' });
        expect(container.textContent).toContain(formatCurrency(5000));
        expect(container.textContent).toContain(formatCurrency(4000));
    });

    it('falls back to "ID: <socid>" for unknown customer with title attribute', async () => {
        vi.mocked(useCustomers).mockReturnValue({ data: [], isLoading: false } as any);
        renderWithRouter(<ReportsView />);
        const list = screen.getByRole('list', { name: 'top-clientes-legenda' });
        const nameSpans = list.querySelectorAll('span.truncate');
        expect(nameSpans.length).toBeGreaterThan(0);
        nameSpans.forEach(span => {
            expect(span.textContent).toMatch(/^ID: \d+$/);
            expect(span.getAttribute('title')).toMatch(/^ID: \d+$/);
        });
    });
});

// ============================================================
// #825 — chaves estáveis na legenda do Pie (Top Clientes)
// ============================================================
describe('ReportsView — legenda Top Clientes com chave estável (#825)', () => {
    const currentYear = new Date().getFullYear();
    const ts = Math.floor(new Date(currentYear, 5, 1).getTime() / 1000);

    const invoices = [
        { id: 'inv1', ref: 'FA001', socid: '10', date: ts, total_ttc: 5000, statut: '2', type: '0' },
        { id: 'inv2', ref: 'FA002', socid: '20', date: ts, total_ttc: 4000, statut: '2', type: '0' },
        { id: 'inv3', ref: 'FA003', socid: '30', date: ts, total_ttc: 3000, statut: '2', type: '0' },
    ];
    const customers = [
        { id: '10', name: 'Cliente Alpha' },
        { id: '20', name: 'Cliente Beta' },
        { id: '30', name: 'Cliente Gama' },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useInvoices).mockReturnValue({ data: invoices, isLoading: false } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: customers, isLoading: false } as any);
    });

    it('pareia cada cliente ao seu valor correto, em ordem decrescente (chave estável entry.name)', async () => {
        renderWithRouter(<ReportsView />);
        const list = await screen.findByRole('list', { name: 'top-clientes-legenda' });
        const items = list.querySelectorAll('li');
        expect(items).toHaveLength(3);

        // Ordem decrescente por valor; cada <li> (key=entry.name) mantém nome↔valor
        expect(items[0].textContent).toContain('Cliente Alpha');
        expect(items[0].textContent).toContain(formatCurrency(5000));
        expect(items[0].textContent).not.toContain('Cliente Beta');

        expect(items[1].textContent).toContain('Cliente Beta');
        expect(items[1].textContent).toContain(formatCurrency(4000));

        expect(items[2].textContent).toContain('Cliente Gama');
        expect(items[2].textContent).toContain(formatCurrency(3000));
    });
});