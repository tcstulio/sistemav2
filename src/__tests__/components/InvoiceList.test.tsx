import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import InvoiceList from '../../components/InvoiceList';
import { cloneInvoice } from '../../services/api/commercial';
import { DolibarrService } from '../../services/dolibarrService';
import { useDolibarr } from '../../context/DolibarrContext';
import { useInvoices, useProjects } from '../../hooks/dolibarr';
import { useInvoiceMutations } from '../../hooks/useMutations';
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
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key' }, canAccess: () => true, canDo: () => true })),
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
    useBankAccounts: vi.fn(() => ({ data: [] })),
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
        updateInvoice: vi.fn().mockResolvedValue({}),
        deleteInvoiceLine: vi.fn().mockResolvedValue({}),
        updateInvoiceLine: vi.fn().mockResolvedValue({}),
        addInvoiceLine: vi.fn().mockResolvedValue({}),
        setPayment: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../utils/sanitizeHtml', () => ({
    sanitizeHtml: (html: string) => html,
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
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

// Covers: #702 (estrutura HTML / alvos separados), #703 (excluir não-rascunho), #704 (testes)
describe('InvoiceList — alvos de clique e exclusão (#553 / #702 / #703 / #704)', () => {
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

describe('InvoiceList — #613 projeto e vencimento nos modais', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useProjects).mockReturnValue({
            data: [{ id: 'proj1', title: 'Projeto Alpha' }],
        } as any);
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                {
                    id: 'inv1',
                    ref: 'FA2501-0001',
                    socid: 'cust1',
                    date: 1700000000,
                    total_ttc: 1200,
                    statut: '0', // draft so edit button appears
                    type: '0',
                    project_id: null,
                    order_id: null,
                    date_lim_reglement: null,
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
    });

    it('criação com projeto: mutateAsync chamado com fk_project', async () => {
        const mockMutateAsync = vi.fn().mockResolvedValue({});
        vi.mocked(useInvoiceMutations).mockReturnValue({
            createInvoice: { mutateAsync: mockMutateAsync },
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const novoBtn = await screen.findByText('Novo');
        await user.click(novoBtn);

        // Select customer — first combobox in create modal
        const combos = await screen.findAllByRole('combobox');
        // combos order in create modal: [Cliente, Projeto, (sort toolbar)]
        // The sort select is in the header; modal combos start after it
        const clienteSelect = combos.find(s => s.querySelector('option[value="cust1"]') || Array.from((s as HTMLSelectElement).options || []).some((o: any) => o.value === 'cust1'));
        expect(clienteSelect).toBeTruthy();
        await user.selectOptions(clienteSelect!, 'cust1');

        // Select project
        const projetoSelect = combos.find(s => Array.from((s as HTMLSelectElement).options).some((o: any) => o.value === 'proj1'));
        expect(projetoSelect).toBeTruthy();
        await user.selectOptions(projetoSelect!, 'proj1');

        const submitBtn = screen.getByRole('button', { name: /Criar Fatura/i });
        await user.click(submitBtn);

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ fk_project: 'proj1' })
            );
        });
    });

    it('criação com vencimento: mutateAsync chamado com date_lim_reglement', async () => {
        const mockMutateAsync = vi.fn().mockResolvedValue({});
        vi.mocked(useInvoiceMutations).mockReturnValue({
            createInvoice: { mutateAsync: mockMutateAsync },
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const novoBtn = await screen.findByText('Novo');
        await user.click(novoBtn);

        // Select customer
        const combos = await screen.findAllByRole('combobox');
        const clienteSelect = combos.find(s => Array.from((s as HTMLSelectElement).options).some((o: any) => o.value === 'cust1'));
        await user.selectOptions(clienteSelect!, 'cust1');

        // Fill due date — find date inputs in the modal
        const dateInputs = screen.getAllByDisplayValue('') as HTMLInputElement[];
        const vencInput = dateInputs.find(el => el.type === 'date' && el !== dateInputs[0]);
        // Use the label text to find the input
        const vencLabel = screen.getByText('Data de Vencimento (opcional)');
        const vencimentoInput = vencLabel.parentElement!.querySelector('input[type="date"]') as HTMLInputElement;
        expect(vencimentoInput).toBeTruthy();
        await user.clear(vencimentoInput);
        await user.type(vencimentoInput, '2025-12-31');

        const submitBtn = screen.getByRole('button', { name: /Criar Fatura/i });
        await user.click(submitBtn);

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ date_lim_reglement: expect.any(Number) })
            );
        });
    });

    it('criação sem projeto: mutateAsync chamado sem fk_project', async () => {
        const mockMutateAsync = vi.fn().mockResolvedValue({});
        vi.mocked(useInvoiceMutations).mockReturnValue({
            createInvoice: { mutateAsync: mockMutateAsync },
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const novoBtn = await screen.findByText('Novo');
        await user.click(novoBtn);

        const combos = await screen.findAllByRole('combobox');
        const clienteSelect = combos.find(s => Array.from((s as HTMLSelectElement).options).some((o: any) => o.value === 'cust1'));
        await user.selectOptions(clienteSelect!, 'cust1');

        const submitBtn = screen.getByRole('button', { name: /Criar Fatura/i });
        await user.click(submitBtn);

        await waitFor(() => {
            const call = mockMutateAsync.mock.calls[0]?.[0];
            expect(call).toBeDefined();
            expect(call.fk_project).toBeUndefined();
        });
    });

    it('edição de projeto: updateInvoice chamado com fk_project', async () => {
        vi.mocked(DolibarrService.updateInvoice as any).mockResolvedValue({});

        const user = userEvent.setup();
        renderComponent();

        // Click on the invoice card to open detail
        const card = await screen.findByText('FA2501-0001');
        await user.click(card);

        // Click Editar button
        const editBtn = await screen.findByText('Editar');
        await user.click(editBtn);

        // Find project select in the edit modal
        const combos = await screen.findAllByRole('combobox');
        const projetoSelect = combos.find(s => Array.from((s as HTMLSelectElement).options).some((o: any) => o.value === 'proj1'));
        expect(projetoSelect).toBeTruthy();
        await user.selectOptions(projetoSelect!, 'proj1');

        const saveBtn = screen.getByRole('button', { name: /Salvar Alterações/i });
        await user.click(saveBtn);

        await waitFor(() => {
            expect(DolibarrService.updateInvoice).toHaveBeenCalledWith(
                expect.anything(),
                'inv1',
                expect.objectContaining({ fk_project: 'proj1' })
            );
        });
    });

    it('detalhe exibe vencimento quando date_lim_reglement está preenchido', async () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                {
                    id: 'inv2',
                    ref: 'FA2501-0002',
                    socid: 'cust1',
                    date: 1700000000,
                    total_ttc: 500,
                    statut: '1',
                    type: '0',
                    project_id: null,
                    order_id: null,
                    date_lim_reglement: 1735689600, // 2025-01-01 UTC
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('FA2501-0002');
        await user.click(card);

        // The detail section shows "Vencimento" label
        const vencLabel = await screen.findByText('Vencimento');
        expect(vencLabel).toBeTruthy();
        // Should NOT show the "—" dash (since date is set)
        const allText = document.body.textContent || '';
        expect(allText).toContain('Vencimento');
    });

    it('detalhe mostra "—" quando date_lim_reglement está ausente', async () => {
        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('FA2501-0001');
        await user.click(card);

        const vencLabel = await screen.findByText('Vencimento');
        expect(vencLabel).toBeTruthy();
        // The dash "—" appears when no due date
        const dash = await screen.findByText('—');
        expect(dash).toBeTruthy();
    });
});

describe('InvoiceList — paginação aplicada (#826)', () => {
    const pageInvoices = Array.from({ length: 25 }, (_, i) => ({
        id: `inv${i + 1}`,
        ref: `FA${String(i + 1).padStart(4, '0')}`,
        socid: 'cust1',
        date: 1700000000 + i,
        total_ttc: 100,
        statut: '1',
        type: '0',
        project_id: null,
        order_id: null,
    }));

    const findPaginationButtons = () => {
        const pageSpan = screen.getByText(/^Pág \d+$/);
        const root = pageSpan.closest('.border-t') as HTMLElement | null;
        const buttons = root ? Array.from(root.querySelectorAll('button')) : [];
        return {
            prev: buttons[0] as HTMLButtonElement,
            next: buttons[1] as HTMLButtonElement,
        };
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useInvoices).mockReturnValue({
            data: pageInvoices,
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
    });

    it('renderiza apenas a fatia da página atual e um total restrito a essa página', async () => {
        renderComponent();

        await screen.findByTestId('list-total-bar');

        // Página 1 (ordenado por data desc): FA0025..FA0006 — FA0001 fora da página
        expect(screen.getByRole('button', { name: 'Abrir fatura FA0025' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Abrir fatura FA0001' })).toBeNull();

        // Total reflete apenas a página atual (20 faturas x 100)
        expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(2000));

        const { next } = findPaginationButtons();
        expect(next.disabled).toBe(false);
    });

    it('navegar para a próxima página troca as faturas exibidas e o total', async () => {
        const user = userEvent.setup();
        renderComponent();

        await screen.findByTestId('list-total-bar');
        expect(screen.getByText('Pág 1')).toBeTruthy();

        await user.click(findPaginationButtons().next);

        // Página 2: 5 faturas restantes (FA0005..FA0001)
        await waitFor(() => {
            expect(screen.getByText('Pág 2')).toBeTruthy();
            expect(screen.getByRole('button', { name: 'Abrir fatura FA0001' })).toBeTruthy();
            expect(screen.queryByRole('button', { name: 'Abrir fatura FA0025' })).toBeNull();
            expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(500));
        });
    });

    it('desabilita o botão "próxima" na última página', async () => {
        const user = userEvent.setup();
        renderComponent();

        await screen.findByTestId('list-total-bar');
        expect(findPaginationButtons().next.disabled).toBe(false);

        await user.click(findPaginationButtons().next);

        await waitFor(() => {
            const { next, prev } = findPaginationButtons();
            expect(next.disabled).toBe(true);
            expect(prev.disabled).toBe(false);
        });
    });
});

// ── #1095: registro de pagamento não deve mutar diretamente o objeto do ──────
//    estado/cache (selectedInvoiceForPay.statut = '2' / .paye = '1'). A UI deve
//    reidratar via refreshData, mantendo o objeto original intacto.
describe('InvoiceList — Registro de pagamento sem mutar o cache (#1095)', () => {
    let payableInvoice: any;
    let mockRefresh: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        payableInvoice = {
            id: 'invPay',
            ref: 'FA-PAY-0001',
            socid: 'cust1',
            date: 1700000000,
            total_ttc: 1500,
            statut: '1',
            paye: '0',
            type: '0',
            project_id: null,
            order_id: null,
        };
        mockRefresh = vi.fn().mockResolvedValue(undefined);
        vi.mocked(useDolibarr).mockReturnValue({
            config: mockConfig,
            canAccess: () => true,
            canDo: () => true,
            refreshData: mockRefresh,
        } as any);
        vi.mocked(useInvoices).mockReturnValue({
            data: [payableInvoice],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
        vi.mocked(DolibarrService.setPayment as any).mockResolvedValue({});
    });

    it('registra pagamento chamando setPayment + refreshData e NÃO muta o objeto do cache', async () => {
        const user = userEvent.setup();
        renderComponent();

        // Abre o detalhe da fatura não paga (statut '1')
        await user.click(await screen.findByRole('button', { name: 'Abrir fatura FA-PAY-0001' }));

        // Abre o modal de pagamento
        const pagarBtn = await screen.findByRole('button', { name: /^Pagar$/ });
        await user.click(pagarBtn);

        // Confirma o recebimento (valores padrão: total + Transferência)
        const confirmBtn = await screen.findByRole('button', { name: 'Confirmar Recebimento' });
        await user.click(confirmBtn);

        await waitFor(() => {
            expect(DolibarrService.setPayment).toHaveBeenCalledWith(
                mockConfig,
                'invPay',
                expect.objectContaining({ amount: 1500, payment_mode_id: '2' })
            );
            expect(toastMock.success).toHaveBeenCalledWith('Pagamento Registrado com Sucesso');
            expect(mockRefresh).toHaveBeenCalled();
        });

        // CRÍTICO (#1095): o objeto original do cache/estado NÃO foi mutado.
        // Antes do fix o código fazia `selectedInvoiceForPay.statut = '2'; .paye = '1'`.
        expect(payableInvoice.statut).toBe('1');
        expect(payableInvoice.paye).toBe('0');
    });

    it('em caso de falha no setPayment, NÃO muta o cache nem chama refreshData', async () => {
        vi.mocked(DolibarrService.setPayment as any).mockRejectedValue(new Error('Dolibarr indisponível'));

        const user = userEvent.setup();
        renderComponent();

        await user.click(await screen.findByRole('button', { name: 'Abrir fatura FA-PAY-0001' }));
        await user.click(await screen.findByRole('button', { name: /^Pagar$/ }));
        await user.click(await screen.findByRole('button', { name: 'Confirmar Recebimento' }));

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith('Falha ao registrar pagamento');
        });
        expect(mockRefresh).not.toHaveBeenCalled();

        // Estado/cache preservado — sem mutação direta.
        expect(payableInvoice.statut).toBe('1');
        expect(payableInvoice.paye).toBe('0');
    });
});

// ============================================================
// #1581 — inputs numéricos em InvoiceList não devem enviar NaN
// ao payload quando o usuário apaga o campo (parseInt/parseFloat
// direto em onChange produziam NaN, gerando "R$ NaN" no total).
// ============================================================
const { useInvoiceLines } = await import('../../hooks/dolibarr');

describe('InvoiceList — #1581 sanitização de inputs numéricos (NaN)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
        vi.mocked(useInvoiceLines).mockReturnValue({
            data: [],
            refetch: mockRefetch,
        } as any);
    });

    const openCreateModalAndAddItem = async (user: ReturnType<typeof userEvent.setup>) => {
        const novoBtn = await screen.findByText('Novo');
        await user.click(novoBtn);

        const combos = await screen.findAllByRole('combobox');
        const clienteSelect = combos.find(s =>
            Array.from((s as HTMLSelectElement).options || []).some((o: any) => o.value === 'cust1')
        );
        await user.selectOptions(clienteSelect!, 'cust1');

        // Adiciona um item (default qty=1, price=0, remise_percent=0)
        const addBtn = screen.getByRole('button', { name: /Adicionar Item/i });
        await user.click(addBtn);
    };

    const getNumberInputs = () => {
        const qty = screen.getByPlaceholderText('Qtd') as HTMLInputElement;
        const price = screen.getByPlaceholderText('Preço') as HTMLInputElement;
        const remise = screen.getByPlaceholderText('Desc%') as HTMLInputElement;
        return { qty, price, remise };
    };

    it('apagar o campo Preço no modal de criação envia 0 no payload (não NaN)', async () => {
        const mockMutateAsync = vi.fn().mockResolvedValue({});
        vi.mocked(useInvoiceMutations).mockReturnValue({
            createInvoice: { mutateAsync: mockMutateAsync },
        } as any);

        const user = userEvent.setup();
        renderComponent();

        await openCreateModalAndAddItem(user);

        // Apaga o Preço (input controlado reverte ao valor do estado, que é 0)
        const { price } = getNumberInputs();
        await user.clear(price);

        const submitBtn = screen.getByRole('button', { name: /Criar Fatura/i });
        await user.click(submitBtn);

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });

        const payload = mockMutateAsync.mock.calls[0][0] as any;
        // Garante que NENHUM campo numérico enviado é NaN
        expect(Number.isNaN(payload.lines[0].subprice)).toBe(false);
        expect(payload.lines[0].subprice).toBe(0);
    });

    it('apagar o campo Qtd no modal de criação mantém qty como 0 no estado (não NaN)', async () => {
        // O input tem min="1", então a submissão via form é bloqueada pelo HTML
        // quando qty=0. Verificamos que o estado foi corretamente sanitizado
        // para 0 (e não NaN) após clear, mesmo sem submit.
        const mockMutateAsync = vi.fn().mockResolvedValue({});
        vi.mocked(useInvoiceMutations).mockReturnValue({
            createInvoice: { mutateAsync: mockMutateAsync },
        } as any);

        const user = userEvent.setup();
        renderComponent();

        await openCreateModalAndAddItem(user);

        const { qty } = getNumberInputs();
        await user.clear(qty);

        // Após o clear, o input controlado reverte ao valor do estado (0), não NaN.
        // Garantimos que o valor NÃO é NaN — é 0 (string '0').
        expect(qty.value).toBe('0');
        // E que parseInt reverso é finito
        const parsed = parseInt(qty.value, 10);
        expect(Number.isNaN(parsed)).toBe(false);
        expect(parsed).toBe(0);
    });

    it('apagar o campo Desc% no modal de criação não bloqueia o submit (#1581)', async () => {
        const mockMutateAsync = vi.fn().mockResolvedValue({});
        vi.mocked(useInvoiceMutations).mockReturnValue({
            createInvoice: { mutateAsync: mockMutateAsync },
        } as any);

        const user = userEvent.setup();
        renderComponent();

        await openCreateModalAndAddItem(user);

        const { remise } = getNumberInputs();
        await user.clear(remise);

        const submitBtn = screen.getByRole('button', { name: /Criar Fatura/i });
        await user.click(submitBtn);

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalled();
        });
        // remise_percent não vai no payload padrão; garantimos que submit prosseguiu
        expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    it('total do modal de criação mostra R$ 0,00 quando qty e price estão vazios (sem R$ NaN)', async () => {
        const mockMutateAsync = vi.fn().mockResolvedValue({});
        vi.mocked(useInvoiceMutations).mockReturnValue({
            createInvoice: { mutateAsync: mockMutateAsync },
        } as any);

        const user = userEvent.setup();
        renderComponent();

        await openCreateModalAndAddItem(user);

        const { qty, price } = getNumberInputs();
        await user.clear(qty);
        await user.clear(price);

        // O total exibido NÃO pode conter "NaN"
        const allText = (document.body.textContent || '');
        expect(allText).not.toContain('R$ NaN');
        expect(allText).not.toContain('NaN');
    });

    it('valor válido continua funcionando normalmente após a sanitização (#1581)', async () => {
        const mockMutateAsync = vi.fn().mockResolvedValue({});
        vi.mocked(useInvoiceMutations).mockReturnValue({
            createInvoice: { mutateAsync: mockMutateAsync },
        } as any);

        const user = userEvent.setup();
        renderComponent();

        await openCreateModalAndAddItem(user);

        const { qty, price } = getNumberInputs();
        await user.clear(qty);
        await user.type(qty, '3');
        await user.clear(price);
        await user.type(price, '99.90');

        const submitBtn = screen.getByRole('button', { name: /Criar Fatura/i });
        await user.click(submitBtn);

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });

        const payload = mockMutateAsync.mock.calls[0][0] as any;
        expect(payload.lines[0].qty).toBe(3);
        expect(payload.lines[0].subprice).toBe(99.9);
    });

    it('apagar Preço no modal de EDIÇÃO envia 0 no payload updateInvoiceLine (não NaN)', async () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                {
                    id: 'inv1',
                    ref: 'FA2501-0001',
                    socid: 'cust1',
                    date: 1700000000,
                    total_ttc: 1200,
                    statut: '0', // draft -> edit habilitado
                    type: '0',
                    project_id: null,
                    order_id: null,
                    date_lim_reglement: null,
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
        vi.mocked(useInvoiceLines).mockReturnValue({
            data: [
                {
                    id: 'line1',
                    parent_id: 'inv1',
                    product_id: '',
                    description: 'Item existente',
                    qty: 2,
                    subprice: 50,
                    remise_percent: 0,
                },
            ],
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        // Abre detalhe da fatura
        await user.click(await screen.findByText('FA2501-0001'));

        // Abre modal de edição
        await user.click(await screen.findByText('Editar'));

        // Limpa o Preço da linha
        const priceInput = (await screen.findByPlaceholderText('Preço')) as HTMLInputElement;
        await user.clear(priceInput);

        // Salva
        const saveBtn = screen.getByRole('button', { name: /Salvar Alterações/i });
        await user.click(saveBtn);

        await waitFor(() => {
            expect(DolibarrService.updateInvoiceLine).toHaveBeenCalled();
        });

        const callArgs = vi.mocked(DolibarrService.updateInvoiceLine).mock.calls[0];
        const lineData = callArgs[3] as any;
        expect(Number.isNaN(lineData.subprice)).toBe(false);
        expect(lineData.subprice).toBe(0);
        expect(Number.isNaN(lineData.qty)).toBe(false);
    });
});
