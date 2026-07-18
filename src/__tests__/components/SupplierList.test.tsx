import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplierList } from '../../components/SupplierList';
import { DolibarrService } from '../../services/dolibarrService';
import { toast } from 'sonner';
import type { ThirdParty, SupplierInvoice, SupplierOrder, Product, Warehouse } from '../../types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'https://test.dolibarr.com/api', apiKey: 'test-key', themeColor: 'indigo', darkMode: false },
        refreshData: vi.fn(),
        canAccess: () => true,
        canDo: () => true,
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useSuppliers: vi.fn(() => ({ data: [], refetch: vi.fn() })),
    useProducts: vi.fn(() => ({ data: [] })),
    useSupplierInvoices: vi.fn(() => ({ data: [] })),
    useSupplierOrders: vi.fn(() => ({ data: [] })),
    useWarehouses: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
    useContacts: vi.fn(() => ({ data: [] })),
    useCategories: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../hooks/useMutations', () => ({
    useSupplierMutations: vi.fn(() => ({
        createSupplier: { mutateAsync: vi.fn() },
        updateSupplier: { mutateAsync: vi.fn() },
    })),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createThirdParty: vi.fn().mockResolvedValue({ id: '99' }),
        updateThirdParty: vi.fn().mockResolvedValue({}),
        deleteThirdParty: vi.fn().mockResolvedValue({}),
        validateSupplierOrder: vi.fn().mockResolvedValue({}),
        approveSupplierOrder: vi.fn().mockResolvedValue({}),
        createStockCorrection: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

vi.mock('../../components/common/ThirdPartyContacts', () => ({
    ThirdPartyContacts: () => null,
}));

vi.mock('react-window', () => ({
    FixedSizeList: ({ children, itemCount }: any) => (
        <div data-testid="virtual-list">
            {Array.from({ length: itemCount }, (_, index) =>
                children({ index, style: {} })
            )}
        </div>
    ),
}));

vi.mock('react-virtualized-auto-sizer', () => ({
    __esModule: true,
    default: ({ children }: any) => <>{children({ height: 600, width: 400 })}</>,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const supplierAlpha: ThirdParty = {
    id: 'sup1',
    name: 'Fornecedor Alpha',
    client: '0',
    fournisseur: '1',
    status: '1',
    category_ids: ['cat1'],
};

const supplierBeta: ThirdParty = {
    id: 'sup2',
    name: 'Fornecedor Beta',
    client: '0',
    fournisseur: '1',
    status: '1',
    category_ids: ['cat2'],
};

const invoiceWithProject: SupplierInvoice = {
    id: 'inv1',
    ref: 'FA-0001',
    socid: 'sup1',
    type: '0',
    date: Math.floor(new Date('2024-06-01').getTime() / 1000),
    total_ttc: 1000,
    paye: '0',
    statut: '1',
    project_id: 'proj1',
};

const invoiceWithoutProject: SupplierInvoice = {
    id: 'inv2',
    ref: 'FA-0002',
    socid: 'sup1',
    type: '0',
    date: Math.floor(new Date('2024-06-02').getTime() / 1000),
    total_ttc: 500,
    paye: '1',
    statut: '2',
    // no project_id
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function renderAndOpenSupplierInvoices() {
    const {
        useSuppliers,
        useSupplierInvoices,
        useProjects,
        useCategories,
    } = await import('../../hooks/dolibarr');

    vi.mocked(useSuppliers).mockReturnValue({
        data: [supplierAlpha],
        refetch: vi.fn(),
    } as any);
    vi.mocked(useSupplierInvoices).mockReturnValue({
        data: [invoiceWithProject, invoiceWithoutProject],
    } as any);
    vi.mocked(useProjects).mockReturnValue({
        data: [{ id: 'proj1', title: 'Projeto X', ref: 'PRJ-001', statut: '1' }],
    } as any);
    vi.mocked(useCategories).mockReturnValue({ data: [] } as any);

    const user = userEvent.setup();
    render(<SupplierList />);

    // Click on the supplier to open detail
    await user.click(screen.getByText('Fornecedor Alpha'));

    // Click on the Faturas tab
    const faturasTab = screen.getByRole('button', { name: /Faturas/i });
    await user.click(faturasTab);

    return user;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SupplierList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renderiza o cabeçalho da tela', () => {
        render(<SupplierList />);
        expect(screen.getByText('Fornecedores')).toBeTruthy();
    });

    it('exibe estado vazio quando não há fornecedores', () => {
        render(<SupplierList />);
        expect(screen.getByText('Nenhum fornecedor encontrado')).toBeTruthy();
    });

    it('renderiza fornecedores na lista virtual', async () => {
        const { useSuppliers, useCategories } = await import('../../hooks/dolibarr');
        vi.mocked(useSuppliers).mockReturnValue({
            data: [supplierAlpha, supplierBeta],
            refetch: vi.fn(),
        } as any);
        vi.mocked(useCategories).mockReturnValue({ data: [] } as any);

        render(<SupplierList />);
        expect(screen.getByText('Fornecedor Alpha')).toBeTruthy();
        expect(screen.getByText('Fornecedor Beta')).toBeTruthy();
    });

    // ── #555 Filtro por categoria ──────────────────────────────────────────

    it('#555: exibe dropdown de filtro por categoria', async () => {
        const { useSuppliers, useCategories } = await import('../../hooks/dolibarr');
        vi.mocked(useSuppliers).mockReturnValue({
            data: [supplierAlpha, supplierBeta],
            refetch: vi.fn(),
        } as any);
        vi.mocked(useCategories).mockReturnValue({
            data: [
                { id: 'cat1', label: 'Categoria A', type: '1' },
                { id: 'cat2', label: 'Categoria B', type: '1' },
            ],
        } as any);

        render(<SupplierList />);

        const select = screen.getByRole('combobox', { name: /filtrar por categoria/i });
        expect(select).toBeTruthy();
        expect(screen.getByText('Todas Categorias')).toBeTruthy();
        expect(screen.getByText('Categoria A')).toBeTruthy();
        expect(screen.getByText('Categoria B')).toBeTruthy();
    });

    it('#555: selecionar categoria filtra a lista de fornecedores', async () => {
        const { useSuppliers, useCategories } = await import('../../hooks/dolibarr');
        vi.mocked(useSuppliers).mockReturnValue({
            data: [supplierAlpha, supplierBeta],
            refetch: vi.fn(),
        } as any);
        vi.mocked(useCategories).mockReturnValue({
            data: [
                { id: 'cat1', label: 'Categoria A', type: '1' },
                { id: 'cat2', label: 'Categoria B', type: '1' },
            ],
        } as any);

        const user = userEvent.setup();
        render(<SupplierList />);

        // Initially both suppliers visible
        expect(screen.getByText('Fornecedor Alpha')).toBeTruthy();
        expect(screen.getByText('Fornecedor Beta')).toBeTruthy();

        // Select category that only Alpha belongs to
        const select = screen.getByRole('combobox', { name: /filtrar por categoria/i });
        await user.selectOptions(select, 'cat1');

        await waitFor(() => {
            expect(screen.queryByText('Fornecedor Beta')).not.toBeInTheDocument();
        });
        expect(screen.getByText('Fornecedor Alpha')).toBeTruthy();
    });

    it('#555: selecionar "Todas" restaura a lista completa', async () => {
        const { useSuppliers, useCategories } = await import('../../hooks/dolibarr');
        vi.mocked(useSuppliers).mockReturnValue({
            data: [supplierAlpha, supplierBeta],
            refetch: vi.fn(),
        } as any);
        vi.mocked(useCategories).mockReturnValue({
            data: [
                { id: 'cat1', label: 'Categoria A', type: '1' },
                { id: 'cat2', label: 'Categoria B', type: '1' },
            ],
        } as any);

        const user = userEvent.setup();
        render(<SupplierList />);

        const select = screen.getByRole('combobox', { name: /filtrar por categoria/i });

        // Filter by cat1 first
        await user.selectOptions(select, 'cat1');
        await waitFor(() => {
            expect(screen.queryByText('Fornecedor Beta')).not.toBeInTheDocument();
        });

        // Restore to "all"
        await user.selectOptions(select, 'all');
        await waitFor(() => {
            expect(screen.getByText('Fornecedor Beta')).toBeTruthy();
        });
        expect(screen.getByText('Fornecedor Alpha')).toBeTruthy();
    });

    // ── #555 Projeto nas faturas do fornecedor ─────────────────────────────

    it('#555: exibe nome do projeto na aba Faturas quando fatura tem project_id', async () => {
        await renderAndOpenSupplierInvoices();

        await waitFor(() => {
            expect(screen.getByText('Projeto X')).toBeTruthy();
        });
    });

    it('#555: exibe "Sem projeto" na aba Faturas quando fatura não tem project_id', async () => {
        await renderAndOpenSupplierInvoices();

        await waitFor(() => {
            expect(screen.getByText('Sem projeto')).toBeTruthy();
        });
    });
});

describe('SupplierList — Recepção de fornecedor (#1582)', () => {
    const approvedOrder: SupplierOrder = {
        id: 'ord1',
        ref: 'PO-0001',
        socid: 'sup1',
        date_creation: Math.floor(new Date('2024-06-01').getTime() / 1000),
        total_ttc: 1000,
        statut: '2', // Aprovado → botão "Receber" visível
        lines: [{ id: 'l1', parent_id: 'ord1', label: 'Item A', description: '', qty: 5, vat_rate: 0, subprice: 200, total_ht: 1000, total_ttc: 1000, fk_product: 'prod1' }],
    };

    const product: Product = {
        id: 'prod1',
        ref: 'P-001',
        label: 'Parafuso',
        type: '0',
        price: 0,
    };

    const warehouse: Warehouse = {
        id: 'wh1',
        label: 'Almoxarifado Central',
        statut: '1',
    };

    async function openReceptionModal() {
        const {
            useSuppliers,
            useSupplierOrders,
            useProducts,
            useWarehouses,
        } = await import('../../hooks/dolibarr');

        vi.mocked(useSuppliers).mockReturnValue({
            data: [supplierAlpha],
            refetch: vi.fn(),
        } as any);
        vi.mocked(useSupplierOrders).mockReturnValue({
            data: [approvedOrder],
        } as any);
        vi.mocked(useProducts).mockReturnValue({
            data: [product],
        } as any);
        vi.mocked(useWarehouses).mockReturnValue({
            data: [warehouse],
        } as any);

        const user = userEvent.setup();
        render(<SupplierList />);

        await user.click(screen.getByText('Fornecedor Alpha'));
        await user.click(screen.getByRole('button', { name: /Pedidos/i }));
        await user.click(screen.getByText('Receber'));

        // Modal de recepção aberto com qty inicial = 1
        await waitFor(() => {
            expect(screen.getByText('Receber Itens')).toBeTruthy();
        });

        return user;
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('apagar o campo de qty envia 0 (não NaN) ao backend e não emite toast de erro', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const user = await openReceptionModal();

        const qtyInput = screen.getByLabelText('Quantidade') as HTMLInputElement;
        // Garante que começa com o valor padrão (1)
        expect(qtyInput.value).toBe('1');

        // Apaga o campo completamente
        await user.clear(qtyInput);
        // Sanitização: e.target.value === '' → qty = 0 (input controlado re-renderiza para "0")
        expect(qtyInput.value).toBe('0');

        // Confirma o recibo
        await user.click(screen.getByText('Confirmar Recibo'));

        await waitFor(() => {
            expect(DolibarrService.createStockCorrection).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ qty: 0 })
            );
        });

        // Nenhum toast de erro deve ser disparado
        expect(toast.error).not.toHaveBeenCalled();
        // Nenhum NaN no console
        const nanLogs = errorSpy.mock.calls.filter((call) =>
            JSON.stringify(call).includes('NaN')
        );
        expect(nanLogs).toHaveLength(0);
        errorSpy.mockRestore();
    });

    it('valor positivo continua sendo persistido normalmente', async () => {
        const user = await openReceptionModal();

        const qtyInput = screen.getByLabelText('Quantidade') as HTMLInputElement;
        await user.clear(qtyInput);
        await user.type(qtyInput, '7');

        expect(qtyInput.value).toBe('7');

        await user.click(screen.getByText('Confirmar Recibo'));

        await waitFor(() => {
            expect(DolibarrService.createStockCorrection).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ qty: 7 })
            );
        });
    });

    it('digitar texto não-numérico no campo qty cai no fallback 0 (sem NaN)', async () => {
        const user = await openReceptionModal();

        const qtyInput = screen.getByLabelText('Quantidade') as HTMLInputElement;
        await user.clear(qtyInput);
        // type aceita apenas caracteres que o input aceita; um número inválido via fireEvent:
        await user.type(qtyInput, 'abc');

        // O input type=number não aceita letras; o state interno ainda deve ser número
        // (sem NaN). Confirmamos apenas que clicar em "Confirmar" não dispara erro.
        await user.click(screen.getByText('Confirmar Recibo'));

        await waitFor(() => {
            expect(DolibarrService.createStockCorrection).toHaveBeenCalled();
        });
        const call = vi.mocked(DolibarrService.createStockCorrection).mock.calls.at(-1);
        expect(call).toBeDefined();
        expect(Number.isNaN((call![1] as any).qty)).toBe(false);
    });
});
