import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplierList } from '../../components/SupplierList';
import { useSuppliers, useProducts, useSupplierInvoices, useSupplierOrders } from '../../hooks/dolibarr';
import { formatCurrency } from '../../utils/formatUtils';

// --- Mock DolibarrContext ---
vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key' } })),
}));

// --- Mock dolibarr hooks ---
vi.mock('../../hooks/dolibarr', () => ({
    useSuppliers: vi.fn(() => ({ data: [], refetch: vi.fn() })),
    useProducts: vi.fn(() => ({ data: [] })),
    useSupplierInvoices: vi.fn(() => ({ data: [] })),
    useSupplierOrders: vi.fn(() => ({ data: [] })),
    useWarehouses: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
}));

// --- Mock mutations ---
vi.mock('../../hooks/useMutations', () => ({
    useSupplierMutations: vi.fn(() => ({ createSupplier: vi.fn(), updateSupplier: vi.fn() })),
}));

// --- Mock prefill ---
vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

// --- Mock DolibarrService (used by ConfirmDeleteButton onDelete) ---
vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        deleteThirdParty: vi.fn().mockResolvedValue({}),
    },
}));

// --- Mock LinkedObjects to avoid heavy dependencies ---
vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

// --- Mock virtualization (jsdom has no layout) ---
vi.mock('react-virtualized-auto-sizer', () => ({
    default: ({ children }: any) => children({ height: 600, width: 800 }),
}));

vi.mock('react-window', () => ({
    FixedSizeList: ({ children, itemCount }: any) => (
        <>
            {Array.from({ length: itemCount }, (_, index) =>
                children({ index, style: {} })
            )}
        </>
    ),
}));

const mockSupplier = { id: 'sup1', name: 'Fornecedor Teste', email: 'f@test.com', phone: '', address: '', town: '', zip: '' };
const mockOrder = {
    id: 'ord1',
    ref: 'CMD001',
    socid: 'sup1',
    date_creation: 1700000000,
    total_ttc: 1234.56,
    statut: '3',
    fk_user_author: null,
    lines: [{ id: 'l1', parent_id: 'ord1', label: 'Item', description: '', qty: 1, vat_rate: 0, subprice: 1234.56, total_ht: 1234.56, total_ttc: 1234.56, fk_product: 'prod1' }],
};
const mockInvoice = { id: 'inv1', ref: 'FA001', socid: 'sup1', date: 1700000000, total_ttc: 987.65, paye: '0', statut: '1' };
const mockProduct = { id: 'prod1', ref: 'P001', label: 'Produto A', type: '0', price: 50.25 };

const setupData = (overrides: Partial<{ suppliers: any[]; orders: any[]; invoices: any[]; products: any[] }> = {}) => {
    vi.mocked(useSuppliers).mockReturnValue({ data: overrides.suppliers ?? [mockSupplier], refetch: vi.fn() } as any);
    vi.mocked(useProducts).mockReturnValue({ data: overrides.products ?? [mockProduct] } as any);
    vi.mocked(useSupplierInvoices).mockReturnValue({ data: overrides.invoices ?? [mockInvoice] } as any);
    vi.mocked(useSupplierOrders).mockReturnValue({ data: overrides.orders ?? [mockOrder] } as any);
};

const renderComponent = () => render(<SupplierList />);

describe('SupplierList — currency formatting (#640)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupData();
    });

    it('renders order total as BRL via formatCurrency (no raw $ prefix)', async () => {
        const user = userEvent.setup();
        const { container } = renderComponent();

        await user.click(screen.getByText('Fornecedor Teste'));

        // Switch to "Pedidos" tab
        await user.click(screen.getByText(/Pedidos/));

        const formatted = formatCurrency(1234.56);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders invoice total as BRL via formatCurrency (no raw $ prefix)', async () => {
        const user = userEvent.setup();
        const { container } = renderComponent();

        await user.click(screen.getByText('Fornecedor Teste'));

        // Switch to "Faturas" tab
        await user.click(screen.getByText(/Faturas/));

        const formatted = formatCurrency(987.65);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders product price as BRL via formatCurrency (no raw $ prefix)', async () => {
        const user = userEvent.setup();
        const { container } = renderComponent();

        await user.click(screen.getByText('Fornecedor Teste'));

        // Switch to "Produtos" tab
        await user.click(screen.getByText(/Produtos/));

        const formatted = formatCurrency(50.25);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });
});
