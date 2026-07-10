import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import OrderList from '../../components/OrderList';
import { DolibarrService } from '../../services/dolibarrService';
import { useOrders, useShipments } from '../../hooks/dolibarr';

const { toastMock } = vi.hoisted(() => ({
    toastMock: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key' }, canAccess: () => true, canDo: () => true })),
}));

const mockRefetch = vi.fn();

const defaultOrder = {
    id: 'ord1',
    ref: 'CO2501-0001',
    socid: 'cust1',
    date: 1700000000,
    total_ttc: 1200,
    statut: '1' as const,
    project_id: 'proj1',
    fk_user_author: 'user1',
    fk_user_valid: undefined as string | undefined,
};

vi.mock('../../hooks/dolibarr', () => ({
    useOrders: vi.fn(),
    useCustomers: vi.fn(() => ({ data: [{ id: 'cust1', name: 'Cliente Teste' }] })),
    useProjects: vi.fn(() => ({ data: [{ id: 'proj1', ref: 'PR-001', title: 'Projeto Alpha' }] })),
    useShipments: vi.fn(() => ({ data: [] })),
    useInvoices: vi.fn(() => ({ data: [], isRefetching: false, refetch: mockRefetch })),
    useUsers: vi.fn(() => ({
        data: [{ id: 'user1', firstname: 'João', lastname: 'Silva', login: 'joao.silva' }],
    })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        deleteOrder: vi.fn(),
        validateOrder: vi.fn(),
        downloadDocument: vi.fn(),
        createOrder: vi.fn(),
        createInvoiceFromOrder: vi.fn(),
        shipOrder: vi.fn(),
        deleteShipment: vi.fn(),
        classifyOrderDelivered: vi.fn(),
        updateObject: vi.fn(),
        addOrderLine: vi.fn(),
        updateOrderLine: vi.fn(),
        deleteOrderLine: vi.fn(),
    },
}));

const mockConfig = { apiUrl: 'http://test', apiKey: 'key' };

const setDefaultOrdersMock = () => {
    vi.mocked(useOrders).mockReturnValue({
        data: [defaultOrder],
        isRefetching: false,
        refetch: mockRefetch,
    } as any);
};

const renderComponent = (props?: Record<string, any>) =>
    render(
        <ConfirmProvider>
            <OrderList {...props} />
        </ConfirmProvider>
    );

// ─────────────────────────────────────────────
// 1. Projeto
// ─────────────────────────────────────────────
describe('OrderList — projeto (#608)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setDefaultOrdersMock();
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('exibe o nome do projeto no card quando project_id esta definido', async () => {
        renderComponent();
        const projectLabel = await screen.findByText('Projeto: Projeto Alpha');
        expect(projectLabel).toBeTruthy();
    });

    it('nao exibe texto de projeto quando project_id e nulo', async () => {
        vi.mocked(useOrders).mockReturnValue({
            data: [{ ...defaultOrder, id: 'ord2', ref: 'CO2501-0002', project_id: undefined, fk_user_author: undefined }],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        renderComponent();
        await screen.findByText('CO2501-0002');

        const projectLabels = screen.queryAllByText(/Projeto:/);
        expect(projectLabels.length).toBe(0);
    });

    it('exibe o projeto no header do detalhe quando project_id esta definido', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-0001');
        await user.click(card);

        await waitFor(() => {
            const projetoLinks = screen.getAllByText(/Projeto: Projeto Alpha/);
            expect(projetoLinks.length).toBeGreaterThan(0);
        });
    });
});

// ─────────────────────────────────────────────
// 2. Responsaveis
// ─────────────────────────────────────────────
describe('OrderList — Responsaveis (#608)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setDefaultOrdersMock();
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('exibe o nome do criador no detalhe quando fk_user_author esta definido', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-0001');
        await user.click(card);

        await waitFor(() => {
            expect(screen.getByText('João Silva')).toBeTruthy();
        });
    });

    it('exibe traco quando fk_user_author nao esta definido', async () => {
        vi.mocked(useOrders).mockReturnValue({
            data: [{ ...defaultOrder, id: 'ord3', ref: 'CO2501-0003', project_id: undefined, fk_user_author: undefined }],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-0003');
        await user.click(card);

        await waitFor(() => {
            const dashEls = screen.queryAllByText('-');
            expect(dashEls.length).toBeGreaterThan(0);
        });
    });

    it('nao exibe "User undefined" quando usuario nao resolvido', async () => {
        vi.mocked(useOrders).mockReturnValue({
            data: [{ ...defaultOrder, id: 'ord4', ref: 'CO2501-0004', fk_user_author: 'unknownUser' }],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-0004');
        await user.click(card);

        // Should NOT show "User undefined"
        await waitFor(() => {
            const undefEl = screen.queryByText('User undefined');
            expect(undefEl).toBeNull();
        });
    });
});

// ─────────────────────────────────────────────
// 3. Gerar Fatura real
// ─────────────────────────────────────────────
describe('OrderList — Gerar Fatura real (#608)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setDefaultOrdersMock();
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('chama createInvoiceFromOrder com o id do pedido e exibe toast.success', async () => {
        vi.mocked(DolibarrService.createInvoiceFromOrder).mockResolvedValue({ id: 'inv-new' } as any);
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-0001');
        await user.click(card);

        const invoicesTab = await screen.findByRole('button', { name: /Faturas/ });
        await user.click(invoicesTab);

        const gerarBtn = await screen.findByText('Gerar Fatura');
        await user.click(gerarBtn);

        await waitFor(() => {
            expect(DolibarrService.createInvoiceFromOrder).toHaveBeenCalledWith(
                mockConfig,
                'ord1'
            );
            expect(toastMock.success).toHaveBeenCalledWith(
                expect.stringContaining('Fatura criada com sucesso')
            );
        });
    });

    it('exibe toast.error quando createInvoiceFromOrder falha', async () => {
        vi.mocked(DolibarrService.createInvoiceFromOrder).mockRejectedValue(
            new Error('API Error')
        );
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-0001');
        await user.click(card);

        const invoicesTab = await screen.findByRole('button', { name: /Faturas/ });
        await user.click(invoicesTab);

        const gerarBtn = await screen.findByText('Gerar Fatura');
        await user.click(gerarBtn);

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith(
                expect.stringContaining('Falha ao gerar fatura')
            );
        });
        expect(toastMock.success).not.toHaveBeenCalled();
    });

    it('nao exibe o rotulo Simulacao no botao de fatura', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-0001');
        await user.click(card);

        const invoicesTab = await screen.findByRole('button', { name: /Faturas/ });
        await user.click(invoicesTab);

        await screen.findByText('Gerar Fatura');

        const simLabel = screen.queryByText(/Simulação/);
        expect(simLabel).toBeNull();
    });
});

// ─────────────────────────────────────────────
// 4. fetchOrders mapeia fk_user_author / fk_user_valid
// ─────────────────────────────────────────────
describe('OrderList — mapeamento fk_user_author e fk_user_valid (#608)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('fk_user_author e fk_user_valid populados exibem nome do usuario no detalhe', async () => {
        vi.mocked(useOrders).mockReturnValue({
            data: [
                {
                    ...defaultOrder,
                    id: 'ord-u',
                    ref: 'CO2501-USERS',
                    fk_user_author: 'user1',
                    fk_user_valid: 'user1',
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-USERS');
        await user.click(card);

        // Both author and validator should resolve to the user name
        await waitFor(() => {
            const names = screen.getAllByText('João Silva');
            expect(names.length).toBeGreaterThanOrEqual(1);
        });
    });
});

// ─────────────────────────────────────────────
// 5. Criar pedido (#552)
// ─────────────────────────────────────────────
describe('OrderList — Criar pedido (#552)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useOrders).mockReturnValue({ data: [], isRefetching: false, refetch: mockRefetch } as any);
    });

    it('abre o modal ao clicar em Novo', async () => {
        const user = userEvent.setup();
        renderComponent();

        const novoBtn = await screen.findByRole('button', { name: /Novo/i });
        await user.click(novoBtn);

        await waitFor(() => {
            expect(screen.getByText('Novo Pedido (Rascunho)')).toBeTruthy();
        });
    });

    it('chama createOrder com payload correto ao submeter', async () => {
        vi.mocked(DolibarrService.createOrder).mockResolvedValue({ id: 'new-ord' } as any);
        const user = userEvent.setup();
        renderComponent();

        const novoBtn = await screen.findByRole('button', { name: /Novo/i });
        await user.click(novoBtn);

        // Seleciona cliente — usa label para ser específico entre múltiplos combobox
        // O select de cliente é o que tem a option "Selecione o Cliente..."
        const allSelects = await screen.findAllByRole('combobox');
        const clienteSelect = allSelects.find(s => s.querySelector('option[value=""]')?.textContent?.includes('Selecione o Cliente'))!;
        await user.selectOptions(clienteSelect, 'cust1');

        // Adiciona item
        const addItemBtn = screen.getByRole('button', { name: /Adicionar Item/i });
        await user.click(addItemBtn);

        const descInputs = screen.getAllByPlaceholderText('Descrição do item');
        await user.clear(descInputs[0]);
        await user.type(descInputs[0], 'Produto Teste');

        // Submit
        const criarBtn = screen.getByRole('button', { name: /Criar Pedido/i });
        await user.click(criarBtn);

        await waitFor(() => {
            expect(DolibarrService.createOrder).toHaveBeenCalledWith(
                mockConfig,
                expect.objectContaining({ socid: 'cust1' })
            );
            expect(toastMock.success).toHaveBeenCalledWith('Pedido criado com sucesso');
        });
    });

    it('exibe toast.error e mantém modal aberto quando createOrder falha', async () => {
        vi.mocked(DolibarrService.createOrder).mockRejectedValue(new Error('API Error'));
        const user = userEvent.setup();
        renderComponent();

        const novoBtn = await screen.findByRole('button', { name: /Novo/i });
        await user.click(novoBtn);

        // O select de cliente é o que tem a option "Selecione o Cliente..."
        const allSelects = await screen.findAllByRole('combobox');
        const clienteSelect = allSelects.find(s => s.querySelector('option[value=""]')?.textContent?.includes('Selecione o Cliente'))!;
        await user.selectOptions(clienteSelect, 'cust1');

        const criarBtn = screen.getByRole('button', { name: /Criar Pedido/i });
        await user.click(criarBtn);

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith('Erro ao criar pedido');
        });
        // Modal ainda aberto
        expect(screen.getByText('Novo Pedido (Rascunho)')).toBeTruthy();
    });
});

// ─────────────────────────────────────────────
// 6. Editar pedido com itens (#552)
// ─────────────────────────────────────────────
describe('OrderList — Editar pedido com itens (#552)', () => {
    const draftOrderWithLines = {
        id: 'ord-draft',
        ref: 'CO2501-DRAFT',
        socid: 'cust1',
        date: 1700000000,
        total_ttc: 500,
        statut: '0' as const,
        project_id: undefined as string | undefined,
        fk_user_author: 'user1',
        fk_user_valid: undefined as string | undefined,
        lines: [
            { id: 'line1', desc: 'Item Existente', qty: 2, price: 100, subprice: 100 },
        ],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useOrders).mockReturnValue({
            data: [draftOrderWithLines],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
        vi.mocked(DolibarrService.updateObject).mockResolvedValue({} as any);
        vi.mocked(DolibarrService.addOrderLine).mockResolvedValue({ id: 'new-line' } as any);
        vi.mocked(DolibarrService.updateOrderLine).mockResolvedValue({} as any);
        vi.mocked(DolibarrService.deleteOrderLine).mockResolvedValue({} as any);
    });

    it('botão Editar visível em rascunho sem depender de xl breakpoint', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-DRAFT');
        await user.click(card);

        await waitFor(() => {
            const editarBtn = screen.getByRole('button', { name: /Editar/i });
            expect(editarBtn).toBeTruthy();
            // Não deve ter a classe hidden xl:flex
            expect(editarBtn.className).not.toContain('hidden');
        });
    });

    it('abre modal com linhas existentes ao clicar em Editar', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-DRAFT');
        await user.click(card);

        const editarBtn = await screen.findByRole('button', { name: /Editar/i });
        await user.click(editarBtn);

        await waitFor(() => {
            expect(screen.getByText('Editar Pedido')).toBeTruthy();
            const descInput = screen.getAllByPlaceholderText('Descrição do item')[0];
            expect((descInput as HTMLInputElement).value).toBe('Item Existente');
        });
    });

    it('chama addOrderLine ao adicionar nova linha e salvar', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-DRAFT');
        await user.click(card);

        const editarBtn = await screen.findByRole('button', { name: /Editar/i });
        await user.click(editarBtn);

        // Adicionar novo item
        const addItemBtn = await screen.findByRole('button', { name: /Adicionar Item/i });
        await user.click(addItemBtn);

        const descInputs = screen.getAllByPlaceholderText('Descrição do item');
        const newInput = descInputs[descInputs.length - 1];
        await user.clear(newInput);
        await user.type(newInput, 'Nova Linha');

        const salvarBtn = screen.getByRole('button', { name: /Salvar/i });
        await user.click(salvarBtn);

        await waitFor(() => {
            expect(DolibarrService.addOrderLine).toHaveBeenCalledWith(
                mockConfig,
                'ord-draft',
                expect.objectContaining({ desc: 'Nova Linha' })
            );
            expect(toastMock.success).toHaveBeenCalledWith('Pedido atualizado com sucesso');
        });
    });

    it('chama deleteOrderLine ao remover linha existente e salvar', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-DRAFT');
        await user.click(card);

        const editarBtn = await screen.findByRole('button', { name: /Editar/i });
        await user.click(editarBtn);

        await screen.findByText('Editar Pedido');

        // O input de descrição da linha existente deve estar presente
        const descInput = await screen.findByDisplayValue('Item Existente');
        // O botão de remoção (Trash2) está na mesma linha — subindo para o container e localizando o button
        const lineContainer = descInput.closest('.flex.gap-2') as HTMLElement;
        expect(lineContainer).toBeTruthy();
        const removeBtn = lineContainer.querySelector('button[type="button"]') as HTMLButtonElement;
        expect(removeBtn).toBeTruthy();
        await user.click(removeBtn);

        const salvarBtn = screen.getByRole('button', { name: /Salvar/i });
        await user.click(salvarBtn);

        await waitFor(() => {
            expect(DolibarrService.deleteOrderLine).toHaveBeenCalledWith(
                mockConfig,
                'ord-draft',
                'line1'
            );
        });
    });

    it('exibe toast.error e mantém modal aberto quando updateObject falha', async () => {
        vi.mocked(DolibarrService.updateObject).mockRejectedValue(new Error('API Error'));
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-DRAFT');
        await user.click(card);

        const editarBtn = await screen.findByRole('button', { name: /Editar/i });
        await user.click(editarBtn);

        const salvarBtn = await screen.findByRole('button', { name: /Salvar/i });
        await user.click(salvarBtn);

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith('Erro ao atualizar pedido');
        });
        // Modal deve permanecer aberto
        expect(screen.getByText('Editar Pedido')).toBeTruthy();
    });
});

// ─────────────────────────────────────────────
// 7. Excluir envio com confirmação (#855)
// ─────────────────────────────────────────────
describe('OrderList — Excluir envio com confirmação (#855)', () => {
    const shipmentFixture = {
        id: 'ship1',
        ref: 'EXP-0001',
        fk_commande: 'ord1',
        socid: 'cust1',
        status: '1',
        date_creation: 1700000000,
        tracking_number: undefined as string | undefined,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        setDefaultOrdersMock();
        vi.mocked(useShipments).mockReturnValue({ data: [shipmentFixture] } as any);
        vi.mocked(DolibarrService.deleteShipment).mockResolvedValue({} as any);
    });

    const openShipmentDelete = async (user: ReturnType<typeof userEvent.setup>) => {
        const card = await screen.findByText('CO2501-0001');
        await user.click(card);

        const enviosTab = await screen.findByRole('button', { name: /Envios/ });
        await user.click(enviosTab);

        // Botão de gatilho (aria-label="Excluir") — único antes de abrir o modal
        const deleteBtn = await screen.findByRole('button', { name: /Excluir/i });
        await user.click(deleteBtn);
    };

    it('abre modal de confirmação do design system ao clicar em excluir envio', async () => {
        const user = userEvent.setup();
        renderComponent();

        await openShipmentDelete(user);

        // Modal de confirmação do design system deve aparecer (mensagem inclui o ref do envio)
        await waitFor(() => {
            expect(screen.getByText(/Tem certeza que deseja excluir "EXP-0001"/)).toBeInTheDocument();
        });
        // A exclusão não deve ocorrer antes da confirmação
        expect(DolibarrService.deleteShipment).not.toHaveBeenCalled();
    });

    it('cancelar a confirmação aborta sem excluir o envio', async () => {
        const user = userEvent.setup();
        renderComponent();

        await openShipmentDelete(user);

        const cancelBtn = await screen.findByRole('button', { name: /Cancelar/i });
        await user.click(cancelBtn);

        expect(DolibarrService.deleteShipment).not.toHaveBeenCalled();
    });

    it('confirmar exclui o envio, mostra toast.success e atualiza a lista de shipments', async () => {
        const onRefresh = vi.fn();
        const user = userEvent.setup();
        renderComponent({ onRefresh });

        await openShipmentDelete(user);

        // Modal aberto: há agora 2 botões "Excluir" (gatilho + confirmar); clicar no último
        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /Excluir/i }).length).toBeGreaterThan(1);
        });
        const confirmButtons = screen.getAllByRole('button', { name: /Excluir/i });
        await user.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
            expect(DolibarrService.deleteShipment).toHaveBeenCalledWith(mockConfig, 'ship1');
            expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining('EXP-0001'));
            expect(onRefresh).toHaveBeenCalled();
        });
    });

    it('não utiliza window.confirm no fluxo de exclusão de envio', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => false);
        const user = userEvent.setup();
        renderComponent();

        await openShipmentDelete(user);

        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /Excluir/i }).length).toBeGreaterThan(1);
        });
        const confirmButtons = screen.getAllByRole('button', { name: /Excluir/i });
        await user.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
            expect(DolibarrService.deleteShipment).toHaveBeenCalled();
        });
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────
// 8. Envios isolados por pedido (#1085)
// ─────────────────────────────────────────────
describe('OrderList — Envios isolados por pedido (#1085)', () => {
    const orderFixture = {
        id: 'ord1',
        ref: 'CO2501-SHIP',
        socid: 'cust1',
        date: 1700000000,
        total_ttc: 1200,
        statut: '1' as const,
        project_id: undefined as string | undefined,
        fk_user_author: 'user1',
        fk_user_valid: undefined as string | undefined,
    };

    const ownShipment = {
        id: 'ship-own',
        ref: 'EXP-OWN',
        fk_commande: 'ord1',
        socid: 'cust1',
        status: '1',
        date_creation: 1700000000,
        tracking_number: undefined as string | undefined,
    };

    // Envio de OUTRO pedido do mesmo cliente — não deve aparecer
    const otherShipment = {
        id: 'ship-other',
        ref: 'EXP-OTHER',
        fk_commande: 'ord2',
        socid: 'cust1',
        status: '1',
        date_creation: 1700000000,
        tracking_number: undefined as string | undefined,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useOrders).mockReturnValue({
            data: [orderFixture],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
        vi.mocked(useShipments).mockReturnValue({ data: [ownShipment, otherShipment] } as any);
    });

    it('badge da aba Envios conta apenas os envios do pedido aberto', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-SHIP');
        await user.click(card);

        await waitFor(() => {
            const enviosTab = screen.getByRole('button', { name: /Envios/ });
            expect(enviosTab.textContent).toMatch(/Envios\s*\(1\)/);
        });
    });

    it('aba Envios lista apenas o envio do próprio pedido, não de outros pedidos do cliente', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-SHIP');
        await user.click(card);

        const enviosTab = await screen.findByRole('button', { name: /Envios/ });
        await user.click(enviosTab);

        // Envio do próprio pedido aparece
        await screen.findByText('EXP-OWN');
        // Envio de outro pedido do mesmo cliente NÃO aparece
        expect(screen.queryByText('EXP-OTHER')).toBeNull();
    });
});

// ─────────────────────────────────────────────
// 9. Total por linha correto para qty>1 (#1085)
// ─────────────────────────────────────────────
describe('OrderList — Total por linha para qty>1 (#1085)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('exibe o total da linha (total_ht) e não o preço unitário', async () => {
        vi.mocked(useOrders).mockReturnValue({
            data: [
                {
                    ...defaultOrder,
                    id: 'ord-line',
                    ref: 'CO2501-LINE',
                    total_ttc: 999,
                    lines: [{ id: 'l1', desc: 'Produto Q3', qty: 3, price: 50, subprice: 50, total_ht: 150 }],
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-LINE');
        await user.click(card);

        // Total da linha = 150 (3 x 50), não o unitário 50
        await screen.findByText('R$ 150,00');
        expect(screen.queryByText('R$ 50,00')).toBeNull();
    });

    it('calcula total como qty*price quando total_ht está ausente', async () => {
        vi.mocked(useOrders).mockReturnValue({
            data: [
                {
                    ...defaultOrder,
                    id: 'ord-line2',
                    ref: 'CO2501-LINE2',
                    total_ttc: 999,
                    lines: [{ id: 'l1', desc: 'Produto Q4', qty: 4, price: 25, subprice: 25 }],
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-LINE2');
        await user.click(card);

        // Total da linha = 100 (4 x 25), não o unitário 25
        await screen.findByText('R$ 100,00');
        expect(screen.queryByText('R$ 25,00')).toBeNull();
    });
});

// ─────────────────────────────────────────────
// 10. Botão Novo reseta estado de edição (#1085)
// ─────────────────────────────────────────────
describe('OrderList — Botão Novo reseta edição residual (#1085)', () => {
    const draftOrderWithLines = {
        id: 'ord-reset',
        ref: 'CO2501-RESET',
        socid: 'cust1',
        date: 1700000000,
        total_ttc: 500,
        statut: '0' as const,
        project_id: undefined as string | undefined,
        fk_user_author: 'user1',
        fk_user_valid: undefined as string | undefined,
        lines: [{ id: 'line1', desc: 'Item Existente', qty: 2, price: 100, subprice: 100 }],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useOrders).mockReturnValue({
            data: [draftOrderWithLines],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
    });

    it('clicar em Novo após editar reabre em modo criação com formulário limpo (não edição residual)', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('CO2501-RESET');
        await user.click(card);

        const editarBtn = await screen.findByRole('button', { name: /Editar/i });
        await user.click(editarBtn);

        // Modal aberto em modo edição com o item existente pré-carregado
        await screen.findByText('Editar Pedido');
        expect(screen.getByDisplayValue('Item Existente')).toBeTruthy();

        // Clicar em "Novo" deve resetar editOrderId/newOrder e reabrir em modo criação
        const novoBtn = screen.getByRole('button', { name: /^Novo$/i });
        await user.click(novoBtn);

        await waitFor(() => {
            expect(screen.getByText('Novo Pedido (Rascunho)')).toBeTruthy();
        });
        expect(screen.queryByText('Editar Pedido')).toBeNull();
        // Formulário limpo: nenhum item residual do pedido editado
        expect(screen.getByText('Nenhum item adicionado.')).toBeTruthy();
        expect(screen.queryByDisplayValue('Item Existente')).toBeNull();
    });
});
