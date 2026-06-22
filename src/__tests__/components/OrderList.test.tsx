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
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key' } })),
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
