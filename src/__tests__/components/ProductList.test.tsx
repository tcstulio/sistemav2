import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductList from '../../components/ProductList';
import { DolibarrService } from '../../services/dolibarrService';
import { toast } from 'sonner';
import type { Product } from '../../types';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: vi.fn(),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'https://test.dolibarr.com/api', apiKey: 'test-key' },
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useProducts: vi.fn(() => ({
        data: [
            { id: '1', ref: 'PRD-001', label: 'Produto Alpha', type: '0', price: 100, stock_reel: 10, tosell: '1', tobuy: '1' },
        ] as Product[],
        isLoading: false,
    })),
    useCategories: vi.fn(() => ({ data: [] })),
    useBOMs: vi.fn(() => ({ data: [] })),
    useSuppliers: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createProduct: vi.fn(),
        updateProduct: vi.fn(),
        deleteProduct: vi.fn(),
        createSupplierOrder: vi.fn(),
    },
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

const { notifyError } = await import('../../utils/notifyError');
const { useSuppliers } = await import('../../hooks/dolibarr');

const mockProducts: Product[] = [
    { id: '1', ref: 'PRD-001', label: 'Produto Alpha', type: '0', price: 100, stock_reel: 10, tosell: '1', tobuy: '1' },
];

describe('ProductList — no native alert/confirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(DolibarrService.createProduct).mockResolvedValue({ id: '99' } as any);
        vi.mocked(DolibarrService.updateProduct).mockResolvedValue({} as any);
        vi.mocked(DolibarrService.createSupplierOrder).mockResolvedValue({ id: '55' } as any);
        vi.mocked(useSuppliers).mockReturnValue({ data: [] } as any);
    });

    it('renders the page header', () => {
        render(<ProductList />);
        expect(screen.getByText('Produtos & Serviços')).toBeInTheDocument();
    });

    it('opens the create modal when "Novo" is clicked', async () => {
        const user = userEvent.setup();
        render(<ProductList />);
        await user.click(screen.getByText('Novo'));
        expect(screen.getByText('Novo Produto')).toBeInTheDocument();
    });

    it('calls toast.success instead of alert on successful product creation', async () => {
        const user = userEvent.setup();
        render(<ProductList />);

        await user.click(screen.getByText('Novo'));

        await user.type(screen.getByPlaceholderText('PRD-001'), 'PRD-NEW');
        await user.type(screen.getByPlaceholderText('Nome do Produto'), 'Novo Produto Teste');

        await user.click(screen.getByText('Criar'));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Produto criado com sucesso!');
        });
        expect(DolibarrService.createProduct).toHaveBeenCalled();
    });

    it('calls notifyError instead of alert when product creation fails', async () => {
        const user = userEvent.setup();
        const error = new Error('Falha ao criar');
        vi.mocked(DolibarrService.createProduct).mockRejectedValue(error);

        render(<ProductList />);

        await user.click(screen.getByText('Novo'));

        await user.type(screen.getByPlaceholderText('PRD-001'), 'PRD-FAIL');
        await user.type(screen.getByPlaceholderText('Nome do Produto'), 'Produto Falha');

        await user.click(screen.getByText('Criar'));

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Criar produto', error);
        });
    });

    it('calls toast.success instead of alert on successful product update', async () => {
        const user = userEvent.setup();

        const { container } = render(<ProductList />);

        await user.click(screen.getByText('Produto Alpha'));

        const pencilSvg = container.querySelector('svg.lucide-pencil');
        expect(pencilSvg).toBeTruthy();
        const editBtn = pencilSvg!.closest('button')!;
        await user.click(editBtn);

        await waitFor(() => {
            expect(screen.getByText('Salvar')).toBeInTheDocument();
        });
        await user.click(screen.getByText('Salvar'));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Produto atualizado com sucesso!');
        });
        expect(DolibarrService.updateProduct).toHaveBeenCalled();
    });

    it('calls notifyError instead of alert when product update fails', async () => {
        const user = userEvent.setup();
        const error = new Error('Falha ao atualizar');
        vi.mocked(DolibarrService.updateProduct).mockRejectedValue(error);

        const { container } = render(<ProductList />);

        await user.click(screen.getByText('Produto Alpha'));

        const pencilSvg = container.querySelector('svg.lucide-pencil');
        const editBtn = pencilSvg!.closest('button')!;
        await user.click(editBtn);

        await waitFor(() => {
            expect(screen.getByText('Salvar')).toBeInTheDocument();
        });
        await user.click(screen.getByText('Salvar'));

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Atualizar produto', error);
        });
    });

    it('does not use native alert or confirm', () => {
        const alertSpy = vi.spyOn(window, 'alert');
        const confirmSpy = vi.spyOn(window, 'confirm');

        render(<ProductList />);

        expect(alertSpy).not.toHaveBeenCalled();
        expect(confirmSpy).not.toHaveBeenCalled();

        alertSpy.mockRestore();
        confirmSpy.mockRestore();
    });

    // #632 — moeda R$ na lista de produtos
    it('exibe preco do produto com R$ (formatCurrency) na lista', () => {
        render(<ProductList />);
        // R$ 100,00 é o formato pt-BR/BRL para 100
        expect(screen.getByText(/R\$\s*100/)).toBeInTheDocument();
        // garante ausência do cifrão US hardcoded
        expect(screen.queryByText(/\$100/)).not.toBeInTheDocument();
    });

    // #632 — moeda R$ no detalhe (card Preço)
    it('exibe preco com R$ no card de detalhe do produto', async () => {
        const user = userEvent.setup();
        render(<ProductList />);
        await user.click(screen.getByText('Produto Alpha'));
        // Card "Preço" no painel de detalhe
        await waitFor(() => {
            expect(screen.getAllByText(/R\$\s*100/).length).toBeGreaterThanOrEqual(1);
        });
    });

    // #632 — botão Repor abre modal e Criar Pedido chama createSupplierOrder
    it('botao Repor abre modal e Criar Pedido chama createSupplierOrder', async () => {
        const user = userEvent.setup();
        vi.mocked(useSuppliers).mockReturnValue({
            data: [{ id: 'SUP-1', name: 'Fornecedor Teste', status: '1' }],
        } as any);

        render(<ProductList />);
        // Selecionar produto para abrir detalhe
        await user.click(screen.getByText('Produto Alpha'));

        // Navegar para aba Fornecedores
        await waitFor(() => {
            expect(screen.getByText('Fornecedores')).toBeInTheDocument();
        });
        await user.click(screen.getByText('Fornecedores'));

        // Clicar Repor
        await waitFor(() => {
            expect(screen.getByText('Repor')).toBeInTheDocument();
        });
        await user.click(screen.getByText('Repor'));

        // Modal aparece
        await waitFor(() => {
            expect(screen.getByText('Repor Produto')).toBeInTheDocument();
        });

        // Clicar Criar Pedido
        await user.click(screen.getByText('Criar Pedido'));

        await waitFor(() => {
            expect(DolibarrService.createSupplierOrder).toHaveBeenCalledWith(
                expect.objectContaining({ apiUrl: expect.any(String) }),
                expect.objectContaining({ socid: 'SUP-1' })
            );
        });
        expect(toast.success).toHaveBeenCalledWith('Pedido de reposição criado com sucesso!');
    });
});

// ============================================================
// #633 — campos do Dolibarr no formulário (vat_rate, seuil_stock_alerte, duration)
// ============================================================
const { useProducts: useProductsMock, useCategories: useCategoriesMock } = await import('../../hooks/dolibarr');

describe('ProductList — #633 campos do Dolibarr nos formulários', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(DolibarrService.createProduct).mockResolvedValue({ id: '99' } as any);
        vi.mocked(DolibarrService.updateProduct).mockResolvedValue({} as any);
        vi.mocked(useProductsMock).mockReturnValue({
            data: [
                { id: '1', ref: 'PRD-001', label: 'Produto Alpha', type: '0', price: 100, stock_reel: 10, tosell: '1', tobuy: '1', vat_rate: 12, seuil_stock_alerte: 3 },
                { id: '2', ref: 'SRV-001', label: 'Serviço Beta', type: '1', price: 50, tosell: '1', tobuy: '0', vat_rate: 5, duration: '2h' },
            ] as Product[],
            isLoading: false,
        } as any);
        vi.mocked(useSuppliers).mockReturnValue({ data: [] } as any);
    });

    it('formulario Novo Produto exibe campo Alerta de Estoque para produto (type=0)', async () => {
        const user = userEvent.setup();
        render(<ProductList />);
        await user.click(screen.getByText('Novo'));
        // default type is produto
        await waitFor(() => {
            expect(screen.getByLabelText(/Alerta de Estoque/i)).toBeInTheDocument();
        });
        expect(screen.queryByLabelText(/Duração/i)).not.toBeInTheDocument();
    });

    it('formulario Novo Produto exibe campo Duracao para servico (type=1)', async () => {
        const user = userEvent.setup();
        render(<ProductList />);
        await user.click(screen.getByText('Novo'));

        // Mudar tipo para Serviço
        const tipoSelect = screen.getByRole('combobox', { name: '' });
        await user.selectOptions(tipoSelect, '1');

        await waitFor(() => {
            expect(screen.getByLabelText(/Duração/i)).toBeInTheDocument();
        });
        expect(screen.queryByLabelText(/Alerta de Estoque/i)).not.toBeInTheDocument();
    });

    it('createProduct recebe vat_rate e seuil_stock_alerte no payload', async () => {
        const user = userEvent.setup();
        render(<ProductList />);
        await user.click(screen.getByText('Novo'));

        await user.type(screen.getByPlaceholderText('PRD-001'), 'PRD-NEW');
        await user.type(screen.getByPlaceholderText('Nome do Produto'), 'Novo Produto Teste');

        const vatInput = screen.getByLabelText(/Alíquota IVA/i);
        await user.clear(vatInput);
        await user.type(vatInput, '12');

        const alertInput = screen.getByLabelText(/Alerta de Estoque/i);
        await user.clear(alertInput);
        await user.type(alertInput, '3');

        await user.click(screen.getByText('Criar'));

        await waitFor(() => {
            expect(DolibarrService.createProduct).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ vat_rate: 12, seuil_stock_alerte: 3 })
            );
        });
    });

    it('updateProduct recebe vat_rate e seuil_stock_alerte atualizados', async () => {
        const user = userEvent.setup();
        const { container } = render(<ProductList />);

        // Selecionar Produto Alpha
        await user.click(screen.getByText('Produto Alpha'));

        const pencilSvg = container.querySelector('svg.lucide-pencil');
        const editBtn = pencilSvg!.closest('button')!;
        await user.click(editBtn);

        await waitFor(() => expect(screen.getByText('Salvar')).toBeInTheDocument());

        const vatInput = screen.getByLabelText(/Alíquota IVA/i);
        await user.clear(vatInput);
        await user.type(vatInput, '15');

        await user.click(screen.getByText('Salvar'));

        await waitFor(() => {
            expect(DolibarrService.updateProduct).toHaveBeenCalledWith(
                expect.anything(),
                '1',
                expect.objectContaining({ vat_rate: 15 })
            );
        });
    });

    it('campo Duracao aparece no form de edicao de servico e nao para produto', async () => {
        const user = userEvent.setup();
        const { container } = render(<ProductList />);

        // Selecionar Serviço Beta
        await user.click(screen.getByText('Serviço Beta'));

        const pencilSvg = container.querySelector('svg.lucide-pencil');
        const editBtn = pencilSvg!.closest('button')!;
        await user.click(editBtn);

        await waitFor(() => expect(screen.getByText('Salvar')).toBeInTheDocument());

        expect(screen.getByLabelText(/Duração/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/Alerta de Estoque/i)).not.toBeInTheDocument();
    });

    it('badge de estoque usa seuil_stock_alerte quando definido', () => {
        // Produto com stock_reel=4, seuil_stock_alerte=3 → deve estar ACIMA do limite (não badge Baixo)
        vi.mocked(useProductsMock).mockReturnValue({
            data: [
                { id: '10', ref: 'PRD-X', label: 'Produto X', type: '0', price: 10, stock_reel: 4, seuil_stock_alerte: 3 },
            ] as Product[],
            isLoading: false,
        } as any);
        render(<ProductList />);
        // stock=4 >= alertThreshold=3 => badge verde com quantidade
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(screen.queryByText(/Baixo/)).not.toBeInTheDocument();
    });

    it('badge de estoque mostra Baixo quando stock < seuil_stock_alerte', () => {
        vi.mocked(useProductsMock).mockReturnValue({
            data: [
                { id: '11', ref: 'PRD-Y', label: 'Produto Y', type: '0', price: 10, stock_reel: 2, seuil_stock_alerte: 5 },
            ] as Product[],
            isLoading: false,
        } as any);
        render(<ProductList />);
        expect(screen.getByText(/Baixo \(2\)/)).toBeInTheDocument();
    });
});

// ============================================================
// #566 — separar insumos x aluguel por categoria (id=174)
// ============================================================

describe('ProductList — #566 filtro por categoria e insumos x aluguel', () => {
    const mockProductsWithCategories: Product[] = [
        { id: '1', ref: 'PRD-001', label: 'Insumo Alpha', type: '0', price: 100, stock_reel: 10, category_ids: ['10', '20'] },
        { id: '2', ref: 'PRD-002', label: 'Item Aluguel Beta', type: '0', price: 200, stock_reel: 5, category_ids: ['174'] },
        { id: '3', ref: 'PRD-003', label: 'Sem Categoria Gama', type: '0', price: 50, stock_reel: 3 },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(DolibarrService.createProduct).mockResolvedValue({ id: '99' } as any);
        vi.mocked(DolibarrService.updateProduct).mockResolvedValue({} as any);
        vi.mocked(useProductsMock).mockReturnValue({
            data: mockProductsWithCategories,
            isLoading: false,
        } as any);
        vi.mocked(useCategoriesMock).mockReturnValue({ data: [] } as any);
        vi.mocked(useSuppliers).mockReturnValue({ data: [] } as any);
    });

    it('renderiza produtos com e sem category_ids sem quebrar', () => {
        render(<ProductList />);
        expect(screen.getByText('Insumo Alpha')).toBeInTheDocument();
        expect(screen.getByText('Item Aluguel Beta')).toBeInTheDocument();
        expect(screen.getByText('Sem Categoria Gama')).toBeInTheDocument();
    });

    it('badge de aluguel aparece para produto na categoria 174', () => {
        render(<ProductList />);
        // Item Aluguel Beta tem category_ids=['174'] → deve ter badge
        const rentalBadges = screen.getAllByTestId('rental-badge');
        expect(rentalBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('filtro Insumos exclui itens de aluguel e inclui sem categoria', async () => {
        const user = userEvent.setup();
        render(<ProductList />);

        const categorySelect = screen.getByRole('combobox', { name: /Filtrar por categoria/i });
        await user.selectOptions(categorySelect, 'supply');

        await waitFor(() => {
            expect(screen.getByText('Insumo Alpha')).toBeInTheDocument();
            expect(screen.getByText('Sem Categoria Gama')).toBeInTheDocument();
            expect(screen.queryByText('Item Aluguel Beta')).not.toBeInTheDocument();
        });
    });

    it('filtro Itens de Aluguel mostra apenas produtos na categoria 174', async () => {
        const user = userEvent.setup();
        render(<ProductList />);

        const categorySelect = screen.getByRole('combobox', { name: /Filtrar por categoria/i });
        await user.selectOptions(categorySelect, 'rental');

        await waitFor(() => {
            expect(screen.getByText('Item Aluguel Beta')).toBeInTheDocument();
            expect(screen.queryByText('Insumo Alpha')).not.toBeInTheDocument();
            expect(screen.queryByText('Sem Categoria Gama')).not.toBeInTheDocument();
        });
    });

    it('aba Estoque mostra mensagem de aluguel para produto na categoria 174', async () => {
        const user = userEvent.setup();
        render(<ProductList />);

        await user.click(screen.getByText('Item Aluguel Beta'));

        // Clicar na aba Estoque (button de tab, não a option do sort dropdown)
        await waitFor(() => {
            const estoqueTab = screen.getByRole('button', { name: 'Estoque' });
            expect(estoqueTab).toBeInTheDocument();
        });
        await user.click(screen.getByRole('button', { name: 'Estoque' }));

        await waitFor(() => {
            expect(screen.getByText(/Item de Aluguel/i)).toBeInTheDocument();
            expect(screen.getByText(/não registra consumo de estoque/i)).toBeInTheDocument();
        });
    });

    it('filtro Todas Categorias mostra todos os produtos', async () => {
        const user = userEvent.setup();
        render(<ProductList />);

        const categorySelect = screen.getByRole('combobox', { name: /Filtrar por categoria/i });
        await user.selectOptions(categorySelect, 'supply');
        await user.selectOptions(categorySelect, 'all');

        await waitFor(() => {
            expect(screen.getByText('Insumo Alpha')).toBeInTheDocument();
            expect(screen.getByText('Item Aluguel Beta')).toBeInTheDocument();
            expect(screen.getByText('Sem Categoria Gama')).toBeInTheDocument();
        });
    });
});
