import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import InvoiceList from '../../components/InvoiceList';
import { cloneInvoice } from '../../services/api/commercial';
import { DolibarrService } from '../../services/dolibarrService';
import { useInvoices } from '../../hooks/dolibarr';
import { formatCurrency } from '../../utils/formatUtils';

const { toastMock } = vi.hoisted(() => ({
    toastMock: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

const { notifyErrorMock } = vi.hoisted(() => ({
    notifyErrorMock: vi.fn(),
}));
vi.mock('../../utils/notifyError', () => ({
    notifyError: notifyErrorMock,
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key' } })),
}));

const mockRefetch = vi.fn();
vi.mock('../../hooks/dolibarr', () => ({
    useInvoices: vi.fn(() => ({
        data: [
            {
                id: 'inv1',
                ref: 'FA2501-0001',
                socid: 'cust1',
                date: 1700000000,
                total_ttc: 1200,
                statut: '1',
                type: '0',
                project_id: null,
                order_id: null,
            },
        ],
        isRefetching: false,
        refetch: mockRefetch,
    })),
    useCustomers: vi.fn(() => ({ data: [{ id: 'cust1', name: 'Cliente Teste' }] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useProducts: vi.fn(() => ({ data: [] })),
    useShipments: vi.fn(() => ({ data: [] })),
    useInvoiceLines: vi.fn(() => ({ data: [], refetch: mockRefetch })),
    useUsers: vi.fn(() => ({ data: [] })),
    usePayments: vi.fn(() => ({ data: [] })),
    usePaymentInvoiceLinks: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../hooks/useDolibarrLink', () => ({
    useDolibarrLink: vi.fn(() => ({ openLink: vi.fn() })),
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => <div data-testid="linked-objects-mock" />,
}));

vi.mock('../../hooks/useMutations', () => ({
    useInvoiceMutations: vi.fn(() => ({
        createInvoice: { mutateAsync: vi.fn() },
    })),
}));

vi.mock('../../services/api/commercial', () => ({
    cloneInvoice: vi.fn(),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        deleteInvoice: vi.fn(),
        validateInvoice: vi.fn(),
        downloadDocument: vi.fn(),
    },
}));

vi.mock('../../utils/sanitizeHtml', () => ({
    sanitizeHtml: (html: string) => html,
}));

const mockConfig = { apiUrl: 'http://test', apiKey: 'key' };

const renderComponent = (props?: Record<string, any>) =>
    render(
        <ConfirmProvider>
            <InvoiceList {...props} />
        </ConfirmProvider>
    );

describe('InvoiceList — Duplicate button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('shows toast.success and refetches when duplicate succeeds', async () => {
        vi.mocked(cloneInvoice).mockResolvedValue('new-id');
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const confirmBtn = await screen.findByText('Confirmar');
        await user.click(confirmBtn);

        await waitFor(() => {
            expect(cloneInvoice).toHaveBeenCalledWith(mockConfig, 'inv1');
            expect(toastMock.success).toHaveBeenCalledWith('Fatura duplicada com sucesso');
            expect(mockRefetch).toHaveBeenCalled();
        });
        expect(window.confirm).not.toHaveBeenCalled();
    });

    it('calls notifyError with the real error when duplicate fails', async () => {
        const err = new Error('Dolibarr says no');
        vi.mocked(cloneInvoice).mockRejectedValue(err);
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const confirmBtn = await screen.findByText('Confirmar');
        await user.click(confirmBtn);

        await waitFor(() => {
            expect(cloneInvoice).toHaveBeenCalledWith(mockConfig, 'inv1');
            expect(notifyErrorMock).toHaveBeenCalledWith('Duplicar fatura', err);
            expect(toastMock.error).not.toHaveBeenCalledWith('Erro ao duplicar fatura');
        });
    });

    it('does NOT call cloneInvoice when user cancels confirmation', async () => {
        vi.mocked(cloneInvoice).mockResolvedValue('new-id');
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const cancelBtn = await screen.findByText('Cancelar');
        await user.click(cancelBtn);

        await waitFor(() => {
            expect(cloneInvoice).not.toHaveBeenCalled();
            expect(toastMock.success).not.toHaveBeenCalled();
        });
    });
});

describe('InvoiceList — Total bar (#486)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the total bar with the sum of all visible invoices as BRL', async () => {
        renderComponent();

        const totalBar = await screen.findByTestId('list-total-bar');
        expect(totalBar).toBeTruthy();

        const totalValue = screen.getByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(1200));
    });

    it('shows R$ 0,00 when there are no invoices', async () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        renderComponent();

        const totalValue = await screen.findByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(0));
    });

    it('updates the total when filtering by status tab', async () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                { id: 'inv1', ref: 'FA001', socid: 'cust1', date: 1700000000, total_ttc: 1200, statut: '1', type: '0', project_id: null, order_id: null },
                { id: 'inv2', ref: 'FA002', socid: 'cust1', date: 1700000001, total_ttc: 800, statut: '2', type: '0', project_id: null, order_id: null },
            ],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const totalValue = await screen.findByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(2000));

        await user.click(screen.getByText('Pagas'));

        await waitFor(() => {
            expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(800));
        });
    });
});

describe('InvoiceList — Currency standardization (#639)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders invoice values in BRL via formatCurrency (no USD $ prefix)', async () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                { id: 'invX', ref: 'FAX1', socid: 'cust1', date: 1700000000, total_ttc: 1234.56, statut: '1', type: '0', project_id: null, order_id: null },
            ],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        const { container } = renderComponent();
        await screen.findByTestId('list-total-bar');

        const formatted = formatCurrency(1234.56);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        // The list card value AND the total bar both render the BRL value
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });
});

describe('InvoiceList — Final currency sweep (#643)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders monetary values as R$ with 2 decimals and no isolated dollar sign', async () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                { id: 'invSweep', ref: 'FA-SWEEP', socid: 'cust1', date: 1700000000, total_ttc: 1234.56, statut: '1', type: '0', project_id: null, order_id: null },
            ],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        const { container } = renderComponent();
        await screen.findByTestId('list-total-bar');

        const text = container.textContent || '';

        // BRL marker present
        expect(text).toContain('R$');
        // Value rendered through formatCurrency (same formatter used in production)
        expect(text).toContain(formatCurrency(1234.56));
        // No isolated "$" — every "$" must be part of "R$"
        expect(text.match(/(?<!R)\$/g)).toBeNull();
        // Exactly 2 decimal places (pt-BR format: ",dd")
        expect(formatCurrency(1234.56)).toMatch(/^R\$\s[\d.]+,\d{2}$/);
    });
});

describe('InvoiceList — alvos de clique e exclusão (#553)', () => {
    const defaultInvoice = {
        id: 'inv1',
        ref: 'FA2501-0001',
        socid: 'cust1',
        date: 1700000000,
        total_ttc: 1200,
        statut: '1',
        type: '0',
        project_id: null,
        order_id: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Garante estado isolado: clearAllMocks não reseta mockReturnValue de
        // describes anteriores, então redefinimos a lista padrão aqui.
        vi.mocked(useInvoices).mockReturnValue({
            data: [defaultInvoice],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
    });

    it('renderiza a lista de faturas reutilizando os mocks de useInvoices/useCustomers', async () => {
        renderComponent();

        // ref da fatura aparece como área "abrir fatura"
        expect(await screen.findByRole('button', { name: 'Abrir fatura FA2501-0001' })).toBeTruthy();
        // nome do cliente aparece como alvo "abrir cliente"
        expect(screen.getByRole('button', { name: 'Abrir cliente Cliente Teste' })).toBeTruthy();
    });

    it('clicar na área principal do card (abrir fatura) abre o detalhe e NÃO navega para o cliente', async () => {
        const onNavigate = vi.fn();
        const user = userEvent.setup();
        renderComponent({ onNavigate });

        // Detalhe ainda não está visível
        expect(screen.queryByText('Valor da Fatura')).toBeNull();

        await user.click(await screen.findByRole('button', { name: 'Abrir fatura FA2501-0001' }));

        // Detalhe da fatura aparece
        await waitFor(() => {
            expect(screen.getByText('Valor da Fatura')).toBeTruthy();
        });
        // Não navegou para o cliente
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('clicar no nome do cliente chama onNavigate("customers", socid) e NÃO abre o detalhe da fatura', async () => {
        const onNavigate = vi.fn();
        const user = userEvent.setup();
        renderComponent({ onNavigate });

        await user.click(screen.getByRole('button', { name: 'Abrir cliente Cliente Teste' }));

        expect(onNavigate).toHaveBeenCalledWith('customers', 'cust1');
        expect(onNavigate).toHaveBeenCalledTimes(1);
        // Detalhe da fatura não abre
        expect(screen.queryByText('Valor da Fatura')).toBeNull();
    });

    it('exibe o botão de excluir DESABILITADO com título explicativo para fatura não-rascunho', async () => {
        renderComponent();

        const btn = await screen.findByRole('button', { name: 'Excluir indisponível' });
        expect((btn as HTMLButtonElement).disabled).toBe(true);
        expect(btn.getAttribute('title')).toContain('rascunho');
    });

    it('exclui fatura em rascunho: confirma no modal, chama deleteInvoice e refaz a lista', async () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                { id: 'invDraft', ref: 'FA-DRAFT', socid: 'cust1', date: 1700000000, total_ttc: 500, statut: '0', type: '0', project_id: null, order_id: null },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
        vi.mocked(DolibarrService.deleteInvoice).mockResolvedValue(true as any);

        const user = userEvent.setup();
        renderComponent();

        // Abre a confirmação do botão de excluir (rascunho -> habilitado)
        const trash = await screen.findByRole('button', { name: 'Excluir' });
        await user.click(trash);

        // Confirma no modal (dialog) -> botão "Excluir"
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Excluir' }));

        await waitFor(() => {
            expect(DolibarrService.deleteInvoice).toHaveBeenCalledWith(mockConfig, 'invDraft');
            expect(mockRefetch).toHaveBeenCalled();
        });
    });
});

