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

const mockProducts: Product[] = [
    { id: '1', ref: 'PRD-001', label: 'Produto Alpha', type: '0', price: 100, stock_reel: 10, tosell: '1', tobuy: '1' },
];

describe('ProductList — no native alert/confirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(DolibarrService.createProduct).mockResolvedValue({ id: '99' } as any);
        vi.mocked(DolibarrService.updateProduct).mockResolvedValue({} as any);
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
});
