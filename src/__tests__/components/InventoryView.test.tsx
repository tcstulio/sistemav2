/**
 * Testes para a tela InventoryView (#569, #634)
 * Cobre: lista de armazéns, drill-in ao clicar no card, estado vazio,
 * navegação de volta, não conflito com botões Editar/Excluir,
 * cor de tema nas abas, abertura/fechamento dos modais (#634).
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
import { useDolibarr } from '../../context/DolibarrContext';

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

describe('InventoryView (#634) — cor de tema e modais padronizados', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('aba ativa usa classes estáticas da cor do tema (emerald)', () => {
        // Mockar themeColor = emerald
        vi.mocked(useDolibarr).mockReturnValue({
            config: { ...mockConfig, themeColor: 'emerald' },
            refreshData: mockRefreshData,
        } as any);

        render(<InventoryView />);

        const tabArmazens = screen.getByTestId('tab-warehouses');
        // A aba ativa deve ter a classe estática correspondente ao emerald
        expect(tabArmazens.className).toContain('text-emerald-600');
        expect(tabArmazens.className).toContain('border-emerald-600');
        // Não deve conter interpolação de string com $
        expect(tabArmazens.className).not.toContain('${');
    });

    it('clicar em Movimentações troca a aba ativa', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: mockConfig,
            refreshData: mockRefreshData,
        } as any);

        render(<InventoryView />);

        const tabMovements = screen.getByTestId('tab-movements');
        fireEvent.click(tabMovements);

        // Depois de clicar, aba movimentações deve ficar ativa (contendo text-indigo-600)
        expect(tabMovements.className).toContain('text-indigo-600');
    });

    it('clicar em Armazém abre o modal de criação', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: mockConfig,
            refreshData: mockRefreshData,
        } as any);

        render(<InventoryView />);
        fireEvent.click(screen.getByTestId('btn-new-warehouse'));

        expect(screen.getByText('Novo Armazém')).toBeInTheDocument();
    });

    it('clicar em Transferir abre o modal de transferência', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: mockConfig,
            refreshData: mockRefreshData,
        } as any);

        render(<InventoryView />);
        fireEvent.click(screen.getByTestId('btn-transfer'));

        expect(screen.getByText('Nova Transferência de Estoque')).toBeInTheDocument();
    });

    it('clicar em Ajustar abre o modal de correção', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: mockConfig,
            refreshData: mockRefreshData,
        } as any);

        render(<InventoryView />);
        fireEvent.click(screen.getByTestId('btn-adjust'));

        expect(screen.getByText('Correção de Estoque')).toBeInTheDocument();
    });

    it('submeter form de armazém chama createWarehouse com os valores', async () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: mockConfig,
            refreshData: mockRefreshData,
        } as any);

        render(<InventoryView />);
        fireEvent.click(screen.getByTestId('btn-new-warehouse'));

        const labelInput = screen.getByPlaceholderText('Armazém Principal');
        fireEvent.change(labelInput, { target: { value: 'Armazém Teste' } });

        const form = document.getElementById('warehouse-form') as HTMLFormElement;
        fireEvent.submit(form);

        await waitFor(() => {
            expect(mockSvc.createWarehouse).toHaveBeenCalledWith(
                mockConfig,
                expect.objectContaining({ label: 'Armazém Teste' })
            );
        });
    });
});
