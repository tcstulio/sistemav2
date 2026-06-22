/**
 * Testes para a tela InventoryView (#569)
 * Cobre: lista de armazéns, drill-in ao clicar no card, estado vazio,
 * navegação de volta, e não conflito com botões Editar/Excluir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// --- Mocks hoisted ---
const mockSvc = vi.hoisted(() => ({
    getProductWithStock: vi.fn(),
    updateWarehouse: vi.fn().mockResolvedValue({}),
    createWarehouse: vi.fn().mockResolvedValue({}),
    deleteWarehouse: vi.fn().mockResolvedValue({}),
    createStockTransfer: vi.fn().mockResolvedValue({}),
    createStockCorrection: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockSvc }));
vi.mock('../../utils/logger', () => ({
    logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock('../../utils/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const mockConfig = { apiUrl: 'http://test', apiKey: 'key', themeColor: 'indigo' };
const mockRefreshData = vi.fn();

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: mockConfig,
        refreshData: mockRefreshData,
    })),
}));

const mockWarehouses = [
    { id: '1', label: 'Armazém Central', lieu: 'São Paulo', statut: '1', description: 'Principal' },
    { id: '2', label: 'Armazém Secundário', lieu: '', statut: '0', description: '' },
];

const mockProducts = [
    { id: 'p1', ref: 'REF-001', label: 'Produto Alpha', type: '0', stock_reel: 10 },
    { id: 'p2', ref: 'REF-002', label: 'Produto Beta', type: '0', stock_reel: 5 },
    { id: 'p3', ref: 'REF-003', label: 'Serviço X', type: '1', stock_reel: 0 },
];

vi.mock('../../hooks/dolibarr', () => ({
    useWarehouses: vi.fn(() => ({ data: mockWarehouses, isLoading: false })),
    useStockMovements: vi.fn(() => ({ data: [], isLoading: false })),
    useProducts: vi.fn(() => ({ data: mockProducts, isLoading: false })),
    useUsers: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: vi.fn(() => vi.fn().mockResolvedValue(false)),
}));

import { InventoryView } from '../../components/InventoryView';

describe('InventoryView (#569) — drill-in de armazém', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renderiza a lista de armazéns na aba Armazéns', () => {
        render(<InventoryView />);
        expect(screen.getByText('Armazém Central')).toBeInTheDocument();
        expect(screen.getByText('Armazém Secundário')).toBeInTheDocument();
    });

    it('clicar em um card abre a visualização de conteúdo com itens', async () => {
        // Armazém 1 tem estoque do produto p1 (qty=7) e p2 (qty=3)
        mockSvc.getProductWithStock.mockImplementation((_cfg: any, productId: string) => {
            if (productId === 'p1') return Promise.resolve({ stock_warehouse: { '1': { real: '7' } } });
            if (productId === 'p2') return Promise.resolve({ stock_warehouse: { '1': { real: '3' } } });
            return Promise.resolve({});
        });

        render(<InventoryView />);

        // Clicar no card do armazém
        fireEvent.click(screen.getByTestId('warehouse-card-1'));

        // Painel de conteúdo deve aparecer com título do armazém
        await waitFor(() => {
            expect(screen.getByText('Armazém Central')).toBeInTheDocument();
        });

        // Itens devem ser listados
        await waitFor(() => {
            expect(screen.getByTestId('stock-items')).toBeInTheDocument();
        });
        expect(screen.getByText('Produto Alpha')).toBeInTheDocument();
        expect(screen.getByText('REF-001')).toBeInTheDocument();
        expect(screen.getByText('Produto Beta')).toBeInTheDocument();

        // Quantidades devem aparecer
        expect(screen.getByText('7')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('armazém sem itens exibe estado vazio amigável', async () => {
        // Nenhum produto tem estoque no armazém 2
        mockSvc.getProductWithStock.mockResolvedValue({ stock_warehouse: {} });

        render(<InventoryView />);
        fireEvent.click(screen.getByTestId('warehouse-card-2'));

        await waitFor(() => {
            expect(screen.getByTestId('empty-state')).toBeInTheDocument();
        });
        expect(screen.getByText('Nenhum item em estoque')).toBeInTheDocument();
    });

    it('botão voltar retorna à lista de armazéns', async () => {
        mockSvc.getProductWithStock.mockResolvedValue({ stock_warehouse: {} });

        render(<InventoryView />);

        // Abrir drill-in
        fireEvent.click(screen.getByTestId('warehouse-card-1'));

        // Esperar o painel aparecer (botão voltar presente)
        await waitFor(() => {
            expect(screen.getByTestId('back-button')).toBeInTheDocument();
        });

        // Clicar em voltar
        fireEvent.click(screen.getByTestId('back-button'));

        // Lista de armazéns deve estar visível novamente
        await waitFor(() => {
            expect(screen.getByTestId('warehouse-card-1')).toBeInTheDocument();
            expect(screen.getByTestId('warehouse-card-2')).toBeInTheDocument();
        });
    });

    it('clicar em Editar NÃO abre o drill-in', async () => {
        render(<InventoryView />);

        const editBtn = screen.getByTestId('edit-btn-1');
        fireEvent.click(editBtn);

        // O painel de conteúdo não deve aparecer (os cards de armazém devem continuar visíveis)
        expect(screen.queryByTestId('back-button')).not.toBeInTheDocument();
        // Armazéns ainda listados
        expect(screen.getByTestId('warehouse-card-1')).toBeInTheDocument();
    });

    it('clicar em Excluir NÃO abre o drill-in', async () => {
        render(<InventoryView />);

        const deleteBtn = screen.getByTestId('delete-btn-1');
        fireEvent.click(deleteBtn);

        // Sem drill-in
        expect(screen.queryByTestId('back-button')).not.toBeInTheDocument();
        expect(screen.getByTestId('warehouse-card-1')).toBeInTheDocument();
    });

    it('exibe spinner enquanto carrega o estoque', async () => {
        // Simular resposta lenta
        let resolveStock: () => void;
        const stockPromise = new Promise<any>(resolve => {
            resolveStock = () => resolve({ stock_warehouse: {} });
        });
        mockSvc.getProductWithStock.mockReturnValue(stockPromise);

        render(<InventoryView />);
        fireEvent.click(screen.getByTestId('warehouse-card-1'));

        // Spinner deve aparecer enquanto carrega
        await waitFor(() => {
            expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
        });

        // Resolver a promise
        resolveStock!();
        await waitFor(() => {
            expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        });
    });
});

describe('InventoryView (#634) — UI padronizada e cor de tema', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('usa PageHeader: exibe título "Estoque e Inventário"', () => {
        render(<InventoryView />);
        expect(screen.getByText('Estoque e Inventário')).toBeInTheDocument();
        expect(screen.getByText('Gerencie armazéns e movimentações')).toBeInTheDocument();
    });

    it('abas usam Tabs estático: aba ativa contém classe border-indigo-600 (tema indigo)', () => {
        render(<InventoryView />);
        // The Tabs component renders static indigo classes — find the active tab button
        const warehouseTab = screen.getByText('Armazéns');
        expect(warehouseTab.className).toContain('border-indigo-600');
        expect(warehouseTab.className).toContain('text-indigo-600');
        // No interpolated template literal in the className
        expect(warehouseTab.className).not.toContain('${');
    });

    it('clicar em Movimentações troca o conteúdo exibido', () => {
        render(<InventoryView />);
        const movTab = screen.getByText('Movimentações');
        fireEvent.click(movTab);
        // Movements list is active; warehouse cards should not be visible
        expect(screen.queryByTestId('warehouse-card-1')).not.toBeInTheDocument();
    });

    it('clicar em Armazém abre o modal (componente padrão: role=dialog)', () => {
        render(<InventoryView />);
        fireEvent.click(screen.getByText('Armazém'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Novo Armazém')).toBeInTheDocument();
    });

    it('fechar modal de Armazém remove o dialog', () => {
        render(<InventoryView />);
        fireEvent.click(screen.getByText('Armazém'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Cancelar'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('clicar em Transferir abre modal de transferência', () => {
        render(<InventoryView />);
        fireEvent.click(screen.getByText('Transferir'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Nova Transferência de Estoque')).toBeInTheDocument();
    });

    it('clicar em Ajustar abre modal de correção', () => {
        render(<InventoryView />);
        fireEvent.click(screen.getByText('Ajustar'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Correção de Estoque')).toBeInTheDocument();
    });

    it('submeter form de armazém chama createWarehouse com valores do form', async () => {
        render(<InventoryView />);
        fireEvent.click(screen.getByText('Armazém'));

        const dialog = screen.getByRole('dialog');
        const labelInput = dialog.querySelector('input[placeholder="Armazém Principal"]') as HTMLInputElement;
        fireEvent.change(labelInput, { target: { value: 'Novo Dep' } });

        fireEvent.submit(dialog.querySelector('form')!);

        await waitFor(() => {
            expect(mockSvc.createWarehouse).toHaveBeenCalledWith(
                mockConfig,
                expect.objectContaining({ label: 'Novo Dep' })
            );
        });
    });
});