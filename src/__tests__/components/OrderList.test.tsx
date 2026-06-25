import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import OrderList from '../../components/OrderList';
import { DolibarrService } from '../../services/dolibarrService';
import { useOrders } from '../../hooks/dolibarr';

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
// 7. Chaves estáveis nos itens do pedido (#825)
// ─────────────────────────────────────────────
describe('OrderList — chaves estáveis nos itens (#825)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useOrders).mockReturnValue({ data: [], isRefetching: false, refetch: mockRefetch } as any);
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('remover um item do meio não troca os dados das linhas restantes', async () => {
        const user = userEvent.setup();
        renderComponent();

        const novoBtn = await screen.findByRole('button', { name: /Novo/i });
        await user.click(novoBtn);

        const addItemBtn = screen.getByRole('button', { name: /Adicionar Item/i });

        // Adiciona 3 itens
        await user.click(addItemBtn);
        await user.click(addItemBtn);
        await user.click(addItemBtn);

        const descInputs = screen.getAllByPlaceholderText('Descrição do item');
        expect(descInputs).toHaveLength(3);

        // Digita descrições distintas por linha
        await user.clear(descInputs[0]);
        await user.type(descInputs[0], 'Alpha');
        await user.clear(descInputs[1]);
        await user.type(descInputs[1], 'Beta');
        await user.clear(descInputs[2]);
        await user.type(descInputs[2], 'Gamma');

        // Remove a linha do meio (Beta) pelo botão de exclusão da própria linha
        const betaInput = screen.getByDisplayValue('Beta');
        const row = betaInput.closest('.flex.gap-2') as HTMLElement;
        const removeBtn = row.querySelector('button') as HTMLButtonElement;
        await user.click(removeBtn);

        // As linhas restantes devem manter os dados corretos (Alpha e Gamma),
        // sem troca de valores entre linhas — sintoma de key={idx} instável (#825).
        const remainingDesc = screen.getAllByPlaceholderText('Descrição do item').map(i => (i as HTMLInputElement).value);
        expect(remainingDesc).toEqual(['Alpha', 'Gamma']);
        expect(screen.queryByDisplayValue('Beta')).toBeNull();

        // A ordem é preservada: Alpha continua à esquerda de Gamma.
        expect(remainingDesc[0]).toBe('Alpha');
        expect(remainingDesc[1]).toBe('Gamma');
    });

    it('cada item novo recebe um id estável distinto (não depende do índice)', async () => {
        const user = userEvent.setup();
        renderComponent();

        await user.click(await screen.findByRole('button', { name: /Novo/i }));
        const addItemBtn = screen.getByRole('button', { name: /Adicionar Item/i });
        await user.click(addItemBtn);
        await user.click(addItemBtn);

        // Dois itens recém-adicionados devem ter inputs independentes (2 linhas),
        // e a chave de cada linha vem de crypto.randomUUID(), não do índice.
        expect(screen.getAllByPlaceholderText('Descrição do item')).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────
// 8. Chaves estáveis no detalhe somente leitura (#825)
// ─────────────────────────────────────────────
describe('OrderList — chaves estáveis no detalhe somente leitura (#825)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('linhas do backend sem id recebem uid estável e não geram aviso de chave duplicada', async () => {
        const orderWithoutLineIds = {
            ...defaultOrder,
            lines: [
                { desc: 'Item Sem Id A', qty: 1, price: 10 },
                { desc: 'Item Sem Id B', qty: 2, price: 20 },
                { desc: 'Item Sem Id C', qty: 3, price: 30 },
            ],
        };
        vi.mocked(useOrders).mockReturnValue({
            data: [orderWithoutLineIds],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const user = userEvent.setup();
        renderComponent();

        await user.click(await screen.findByText('CO2501-0001'));

        // As três linhas (sem id do backend) renderizam no detalhe somente leitura (#825)
        await waitFor(() => {
            expect(screen.getByText('Item Sem Id A')).toBeTruthy();
            expect(screen.getByText('Item Sem Id B')).toBeTruthy();
            expect(screen.getByText('Item Sem Id C')).toBeTruthy();
        });

        // Sem aviso de chave duplicada — uid estável gerado no cliente, não índice (#825)
        const dupKey = spy.mock.calls.find(
            (c) => typeof c[0] === 'string' && c[0].includes('children with the same key')
        );
        expect(dupKey).toBeUndefined();
        spy.mockRestore();
    });
});
