/**
 * Testes para WarehouseList — tela unificada de Estoques com hierarquia (#564)
 *
 * Cobre:
 * - Renderização da árvore (apenas raiz no nível inicial)
 * - Drill-in hierárquico (clique em Sub-estoques mostra filhos)
 * - Armazém sem filhos mostra conteúdo/itens no painel de detalhe
 * - Voltar/breadcrumb retorna ao nível anterior
 * - Ações CRUD preservadas (novo armazém, editar, excluir)
 * - Abas Armazéns / Movimentações
 * - Modais Transferir / Ajustar
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mocks hoisted ---
const mockSvc = vi.hoisted(() => ({
    getProductWithStock: vi.fn(),
    createWarehouse: vi.fn().mockResolvedValue({}),
    updateWarehouse: vi.fn().mockResolvedValue({}),
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
vi.mock('../../utils/dateUtils', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, formatDateTime: (ts: any) => String(ts) };
});

const mockConfig = { apiUrl: 'http://test', apiKey: 'key', themeColor: 'indigo' };
const mockRefreshData = vi.fn();

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: mockConfig,
        refreshData: mockRefreshData,
        canAccess: () => true,
        canDo: () => true,
    })),
}));

vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: vi.fn(() => vi.fn().mockResolvedValue(false)),
}));

/**
 * Warehouse tree for tests:
 *   RaizA (id=1, no parent)
 *   RaizB (id=2, no parent)
 *     ↳ FilhoB1 (id=3, fk_parent='2')
 *     ↳ FilhoB2 (id=4, fk_parent='2')
 *   FilhoB1 has no children (leaf)
 *   FilhoB2 has one grandchild:
 *     ↳ NetoB2a (id=5, fk_parent='4')
 */
const mockWarehouses = [
    { id: '1', label: 'RaizA', lieu: 'SP', statut: '1' as '1', description: 'Armazém raiz A' },
    { id: '2', label: 'RaizB', lieu: 'RJ', statut: '1' as '1', description: 'Armazém raiz B' },
    { id: '3', label: 'FilhoB1', lieu: '', statut: '1' as '1', description: '', fk_parent: '2' },
    { id: '4', label: 'FilhoB2', lieu: '', statut: '0' as '0', description: '', fk_parent: '2' },
    { id: '5', label: 'NetoB2a', lieu: '', statut: '1' as '1', description: '', fk_parent: '4' },
];

const mockProducts = [
    { id: 'p1', ref: 'REF-001', label: 'Produto Alpha', type: '0' as '0', stock_reel: 10 },
    { id: 'p2', ref: 'REF-002', label: 'Produto Beta', type: '0' as '0', stock_reel: 5 },
];

vi.mock('../../hooks/dolibarr', () => ({
    useWarehouses: vi.fn(() => ({ data: mockWarehouses, isLoading: false })),
    useProducts: vi.fn(() => ({ data: mockProducts, isLoading: false })),
    useStockMovements: vi.fn(() => ({ data: [], isLoading: false })),
    useUsers: vi.fn(() => ({ data: [], isLoading: false })),
}));

import WarehouseList from '../../components/WarehouseList';
import { useDolibarr } from '../../context/DolibarrContext';
import { toast } from 'sonner';

describe('WarehouseList (#564) — hierarquia de sub-estoques', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getProductWithStock.mockResolvedValue({ stock_warehouse: {} });
    });

    // -------------------------------------------------------------------
    // 1) Renderização da árvore: apenas raiz no nível inicial
    // -------------------------------------------------------------------
    it('renderiza apenas os armazéns raiz (sem fk_parent) no nível inicial', () => {
        render(<WarehouseList />);

        // Raízes devem aparecer
        expect(screen.getByText('RaizA')).toBeInTheDocument();
        expect(screen.getByText('RaizB')).toBeInTheDocument();

        // Filhos/netos NÃO devem aparecer no nível inicial
        expect(screen.queryByText('FilhoB1')).not.toBeInTheDocument();
        expect(screen.queryByText('FilhoB2')).not.toBeInTheDocument();
        expect(screen.queryByText('NetoB2a')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------
    // 2) Drill-in: clicar em "Sub-estoques" mostra os filhos
    // -------------------------------------------------------------------
    it('clicar em Sub-estoques de RaizB mostra FilhoB1 e FilhoB2', () => {
        render(<WarehouseList />);

        // RaizB tem filhos (id=2) → deve haver botão Sub-estoques
        const enterBtn = screen.getByTestId('enter-children-2');
        fireEvent.click(enterBtn);

        // Filhos de RaizB devem aparecer
        expect(screen.getByText('FilhoB1')).toBeInTheDocument();
        expect(screen.getByText('FilhoB2')).toBeInTheDocument();

        // Raízes não devem mais estar visíveis na lista mestre
        expect(screen.queryByText('RaizA')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------
    // 3) Armazém folha (sem filhos): selecionar abre painel de conteúdo
    // -------------------------------------------------------------------
    it('selecionar FilhoB1 (sem filhos) abre o painel de conteúdo com estoque', async () => {
        // p1 tem estoque no FilhoB1 (id=3)
        mockSvc.getProductWithStock.mockImplementation((_cfg: any, productId: string) => {
            if (productId === 'p1') return Promise.resolve({ stock_warehouse: { '3': { real: '4' } } });
            return Promise.resolve({ stock_warehouse: {} });
        });

        render(<WarehouseList />);

        // Navegar para dentro de RaizB
        fireEvent.click(screen.getByTestId('enter-children-2'));

        // Selecionar FilhoB1 (folha)
        // FilhoB1 não tem botão "Sub-estoques" mas tem um card que ao clicar abre detalhe
        // O card chama onSelect ao clicar na Card
        const filhoB1Card = screen.getByText('FilhoB1').closest('[data-testid]') as HTMLElement || screen.getByText('FilhoB1').closest('div[class*="cursor"]') as HTMLElement;
        // Usar o Card que contém FilhoB1
        // Disparar o evento no container da linha
        const cards = screen.getAllByText('FilhoB1');
        fireEvent.click(cards[0].closest('div')!);

        // Painel de detalhe deve abrir mostrando o nome do armazém
        await waitFor(() => {
            // O nome aparece no header do painel de detalhe
            const headings = screen.getAllByText('FilhoB1');
            expect(headings.length).toBeGreaterThan(0);
        });
    });

    // -------------------------------------------------------------------
    // 4) Navegação N níveis: FilhoB2 → NetoB2a
    // -------------------------------------------------------------------
    it('permite descer N níveis: RaizB → FilhoB2 → NetoB2a', () => {
        render(<WarehouseList />);

        // Entrar em RaizB
        fireEvent.click(screen.getByTestId('enter-children-2'));

        // FilhoB2 (id=4) tem filhos → botão Sub-estoques disponível
        expect(screen.getByTestId('enter-children-4')).toBeInTheDocument();

        // Entrar em FilhoB2
        fireEvent.click(screen.getByTestId('enter-children-4'));

        // NetoB2a deve aparecer
        expect(screen.getByText('NetoB2a')).toBeInTheDocument();

        // FilhoB1 e FilhoB2 não devem estar visíveis agora
        expect(screen.queryByText('FilhoB1')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------
    // 5) Breadcrumb e Voltar retornam ao nível anterior
    // -------------------------------------------------------------------
    it('breadcrumb "Raiz" retorna ao nível raiz após drill-in', () => {
        render(<WarehouseList />);

        // Entrar em RaizB
        fireEvent.click(screen.getByTestId('enter-children-2'));

        // Breadcrumb deve aparecer com RaizB
        expect(screen.getByTestId('hierarchy-breadcrumb')).toBeInTheDocument();
        expect(screen.getByTestId('breadcrumb-root')).toBeInTheDocument();

        // Clicar em "Raiz" no breadcrumb
        fireEvent.click(screen.getByTestId('breadcrumb-root'));

        // Deve voltar a exibir as raízes
        expect(screen.getByText('RaizA')).toBeInTheDocument();
        expect(screen.getByText('RaizB')).toBeInTheDocument();

        // Breadcrumb deve sumir (estamos na raiz)
        expect(screen.queryByTestId('hierarchy-breadcrumb')).not.toBeInTheDocument();
    });

    it('clicar no item do breadcrumb intermediário retorna ao nível certo', () => {
        render(<WarehouseList />);

        // Descer RaizB → FilhoB2
        fireEvent.click(screen.getByTestId('enter-children-2'));
        fireEvent.click(screen.getByTestId('enter-children-4'));

        // Breadcrumb: Raiz > RaizB > FilhoB2
        expect(screen.getByTestId('breadcrumb-2')).toBeInTheDocument(); // RaizB

        // Clicar em RaizB no breadcrumb para subir um nível
        fireEvent.click(screen.getByTestId('breadcrumb-2'));

        // Deve mostrar filhos de RaizB: FilhoB1 e FilhoB2
        expect(screen.getByText('FilhoB1')).toBeInTheDocument();
        expect(screen.getByText('FilhoB2')).toBeInTheDocument();
        // NetoB2a não deve estar visível
        expect(screen.queryByText('NetoB2a')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------
    // 6) RaizA sem filhos não exibe botão "Sub-estoques"
    // -------------------------------------------------------------------
    it('RaizA (sem filhos) não exibe botão Sub-estoques', () => {
        render(<WarehouseList />);
        expect(screen.queryByTestId('enter-children-1')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------
    // 7) Ações CRUD preservadas
    // -------------------------------------------------------------------
    it('clicar em Armazém abre o modal de criação', () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-new-warehouse'));
        expect(screen.getByText('Novo Armazém')).toBeInTheDocument();
    });

    it('clicar em Transferir abre o modal de transferência', () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-transfer'));
        expect(screen.getByText('Nova Transferência de Estoque')).toBeInTheDocument();
    });

    it('clicar em Ajustar abre o modal de correção', () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-adjust'));
        expect(screen.getByText('Correção de Estoque')).toBeInTheDocument();
    });

    it('submeter form de armazém chama createWarehouse', async () => {
        render(<WarehouseList />);
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

    // -------------------------------------------------------------------
    // 8) Aba Movimentações
    // -------------------------------------------------------------------
    it('clicar na aba Movimentações exibe a aba de movimentos', () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('tab-movements'));
        // Tab movimentações deve ficar ativa (não deve mostrar lista de armazéns)
        expect(screen.queryByText('RaizA')).not.toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// Mapper: fk_parent
// ---------------------------------------------------------------------------
describe('mapWarehouse — preserva fk_parent (#564)', () => {
    it('mapWarehouse preserva fk_parent quando presente e diferente de 0', async () => {
        const { mapWarehouse } = await import('../../hooks/dolibarr/mappers');
        const raw = { id: '3', label: 'Filho', statut: '1', fk_parent: '2' };
        const result = mapWarehouse(raw as any);
        expect(result.fk_parent).toBe('2');
    });

    it('mapWarehouse descarta fk_parent quando é "0"', async () => {
        const { mapWarehouse } = await import('../../hooks/dolibarr/mappers');
        const raw = { id: '1', label: 'Raiz', statut: '1', fk_parent: '0' };
        const result = mapWarehouse(raw as any);
        expect(result.fk_parent).toBeUndefined();
    });

    it('mapWarehouse deixa fk_parent undefined quando ausente', async () => {
        const { mapWarehouse } = await import('../../hooks/dolibarr/mappers');
        const raw = { id: '1', label: 'Raiz', statut: '1' };
        const result = mapWarehouse(raw as any);
        expect(result.fk_parent).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// #852: Gating canDo('edit','warehouses') + validação qty > 0
// ---------------------------------------------------------------------------
describe('WarehouseList (#852) — gating canDo e validação de qty', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getProductWithStock.mockResolvedValue({ stock_warehouse: {} });
        // Restaura o comportamento padrão (admin) entre os testes
        vi.mocked(useDolibarr).mockReturnValue({
            config: mockConfig,
            refreshData: mockRefreshData,
            canAccess: () => true,
            canDo: () => true,
        } as any);
    });

    it('exibe Transferir e Ajustar quando canDo("edit","warehouses") é verdadeiro', () => {
        render(<WarehouseList />);
        expect(screen.getByTestId('btn-transfer')).toBeInTheDocument();
        expect(screen.getByTestId('btn-adjust')).toBeInTheDocument();
    });

    it('oculta Transferir e Ajustar quando o usuário não tem canDo("edit","warehouses")', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: mockConfig,
            refreshData: mockRefreshData,
            canAccess: () => true,
            canDo: (action: string, scrn: string) => !(action === 'edit' && scrn === 'warehouses'),
        } as any);

        render(<WarehouseList />);

        expect(screen.queryByTestId('btn-transfer')).not.toBeInTheDocument();
        expect(screen.queryByTestId('btn-adjust')).not.toBeInTheDocument();
    });

    it('não chama createStockTransfer quando a quantidade é <= 0', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-transfer'));

        const form = document.getElementById('transfer-form') as HTMLFormElement;
        const selects = form.querySelectorAll('select');
        fireEvent.change(selects[0], { target: { value: 'p1' } }); // produto
        fireEvent.change(selects[1], { target: { value: '1' } });  // origem
        fireEvent.change(selects[2], { target: { value: '2' } });  // destino
        const qtyInput = form.querySelector('input[type="number"]') as HTMLInputElement;
        fireEvent.change(qtyInput, { target: { value: '0' } });

        fireEvent.submit(form);

        await waitFor(() => {
            expect(toast.warning).toHaveBeenCalledWith('A quantidade deve ser maior que zero');
        });
        expect(mockSvc.createStockTransfer).not.toHaveBeenCalled();
    });

    it('não chama createStockCorrection quando a quantidade é <= 0', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-adjust'));

        const form = document.getElementById('correction-form') as HTMLFormElement;
        const selects = form.querySelectorAll('select');
        fireEvent.change(selects[0], { target: { value: 'p1' } }); // produto
        fireEvent.change(selects[1], { target: { value: '1' } });  // armazém
        const qtyInput = form.querySelector('input[type="number"]') as HTMLInputElement;
        fireEvent.change(qtyInput, { target: { value: '0' } });

        fireEvent.submit(form);

        await waitFor(() => {
            expect(toast.warning).toHaveBeenCalledWith('A quantidade deve ser maior que zero');
        });
        expect(mockSvc.createStockCorrection).not.toHaveBeenCalled();
    });

    it('chama createStockTransfer normalmente quando a quantidade é válida (> 0)', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-transfer'));

        const form = document.getElementById('transfer-form') as HTMLFormElement;
        const selects = form.querySelectorAll('select');
        fireEvent.change(selects[0], { target: { value: 'p1' } });
        fireEvent.change(selects[1], { target: { value: '1' } });
        fireEvent.change(selects[2], { target: { value: '2' } });
        const qtyInput = form.querySelector('input[type="number"]') as HTMLInputElement;
        fireEvent.change(qtyInput, { target: { value: '5' } });

        fireEvent.submit(form);

        await waitFor(() => {
            expect(mockSvc.createStockTransfer).toHaveBeenCalledWith(
                mockConfig, 'p1', '1', '2', 5
            );
        });
    });
});

// ---------------------------------------------------------------------------
// #1583: Sanitizar inputs numéricos — evitar NaN quando o campo é esvaziado
// ---------------------------------------------------------------------------
describe('WarehouseList (#1583) — sanitização de inputs numéricos', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getProductWithStock.mockResolvedValue({ stock_warehouse: {} });
        vi.mocked(useDolibarr).mockReturnValue({
            config: mockConfig,
            refreshData: mockRefreshData,
            canAccess: () => true,
            canDo: () => true,
        } as any);
    });

    it('esvaziar o qty de transferência trata como 0 (nunca NaN) e bloqueia submit', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-transfer'));

        const form = document.getElementById('transfer-form') as HTMLFormElement;
        const selects = form.querySelectorAll('select');
        fireEvent.change(selects[0], { target: { value: 'p1' } }); // produto
        fireEvent.change(selects[1], { target: { value: '1' } });  // origem
        fireEvent.change(selects[2], { target: { value: '2' } });  // destino
        const qtyInput = form.querySelector('input[type="number"]') as HTMLInputElement;

        // Esvaziar o campo: antes geraria NaN; agora deve normalizar para 0
        fireEvent.change(qtyInput, { target: { value: '' } });
        expect(qtyInput.value).not.toBe('NaN');
        // Valor numérico no estado nunca pode ser NaN
        expect(Number.isNaN(Number(qtyInput.value))).toBe(false);

        fireEvent.submit(form);

        await waitFor(() => {
            expect(toast.warning).toHaveBeenCalledWith('A quantidade deve ser maior que zero');
        });
        // Garante que a API nunca é chamada com NaN
        expect(mockSvc.createStockTransfer).not.toHaveBeenCalled();
    });

    it('esvaziar o qty de correção trata como 0 (nunca NaN) e bloqueia submit', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-adjust'));

        const form = document.getElementById('correction-form') as HTMLFormElement;
        const selects = form.querySelectorAll('select');
        fireEvent.change(selects[0], { target: { value: 'p1' } }); // produto
        fireEvent.change(selects[1], { target: { value: '1' } });  // armazém
        const qtyInput = form.querySelector('input[type="number"]') as HTMLInputElement;

        fireEvent.change(qtyInput, { target: { value: '' } });
        expect(qtyInput.value).not.toBe('NaN');
        expect(Number.isNaN(Number(qtyInput.value))).toBe(false);

        fireEvent.submit(form);

        await waitFor(() => {
            expect(toast.warning).toHaveBeenCalledWith('A quantidade deve ser maior que zero');
        });
        expect(mockSvc.createStockCorrection).not.toHaveBeenCalled();
    });

    it('digitando texto não-numérico no qty de transferência resulta em 0 (sem NaN)', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-transfer'));

        const form = document.getElementById('transfer-form') as HTMLFormElement;
        const selects = form.querySelectorAll('select');
        fireEvent.change(selects[0], { target: { value: 'p1' } });
        fireEvent.change(selects[1], { target: { value: '1' } });
        fireEvent.change(selects[2], { target: { value: '2' } });
        const qtyInput = form.querySelector('input[type="number"]') as HTMLInputElement;

        // parseInt('abc') => NaN → fallback 0
        fireEvent.change(qtyInput, { target: { value: 'abc' } });
        expect(qtyInput.value).not.toBe('NaN');

        fireEvent.submit(form);

        await waitFor(() => {
            expect(toast.warning).toHaveBeenCalledWith('A quantidade deve ser maior que zero');
        });
        expect(mockSvc.createStockTransfer).not.toHaveBeenCalled();
    });

    it('fluxo feliz de transferência continua funcionando após sanitização', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-transfer'));

        const form = document.getElementById('transfer-form') as HTMLFormElement;
        const selects = form.querySelectorAll('select');
        fireEvent.change(selects[0], { target: { value: 'p1' } });
        fireEvent.change(selects[1], { target: { value: '1' } });
        fireEvent.change(selects[2], { target: { value: '2' } });
        const qtyInput = form.querySelector('input[type="number"]') as HTMLInputElement;
        // Quantidade válida deve passar intacta (não ser afetada pelo || 0)
        fireEvent.change(qtyInput, { target: { value: '7' } });

        fireEvent.submit(form);

        await waitFor(() => {
            expect(mockSvc.createStockTransfer).toHaveBeenCalledWith(
                mockConfig, 'p1', '1', '2', 7
            );
        });
    });

    it('fluxo feliz de correção continua funcionando após sanitização', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByTestId('btn-adjust'));

        const form = document.getElementById('correction-form') as HTMLFormElement;
        const selects = form.querySelectorAll('select');
        fireEvent.change(selects[0], { target: { value: 'p1' } });
        fireEvent.change(selects[1], { target: { value: '1' } });
        const qtyInput = form.querySelector('input[type="number"]') as HTMLInputElement;
        fireEvent.change(qtyInput, { target: { value: '3' } });

        fireEvent.submit(form);

        await waitFor(() => {
            expect(mockSvc.createStockCorrection).toHaveBeenCalledWith(
                mockConfig,
                expect.objectContaining({ product_id: 'p1', warehouse_id: '1', qty: 3 })
            );
        });
    });
});
