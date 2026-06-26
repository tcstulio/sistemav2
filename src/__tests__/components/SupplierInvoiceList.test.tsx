import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SupplierInvoiceList from '../../components/SupplierInvoiceList';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { DolibarrService } from '../../services/dolibarrService';
import { useDolibarr } from '../../context/DolibarrContext';
import { useSupplierInvoices, useSuppliers, useSupplierInvoiceLines, useSupplierPayments, useSupplierPaymentInvoiceLinks } from '../../hooks/dolibarr';
import { canDoAction } from '../../utils/writePermissions';
import type { WriteAction, WriteIdentity } from '../../utils/writePermissions';
import type { SupplierInvoice } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        validateSupplierInvoice: vi.fn().mockResolvedValue({}),
        setSupplierInvoiceToDraft: vi.fn().mockResolvedValue({}),
        deleteSupplierInvoice: vi.fn().mockResolvedValue({}),
        fetchDocuments: vi.fn().mockResolvedValue([]),
        uploadDocument: vi.fn().mockResolvedValue({}),
        deleteDocument: vi.fn().mockResolvedValue({}),
        downloadDocument: vi.fn().mockResolvedValue({}),
        createSupplierInvoice: vi.fn().mockResolvedValue({}),
        updateSupplierInvoice: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test', apiKey: 'key', themeColor: 'indigo', darkMode: false },
        refreshData: vi.fn(),
        canAccess: () => true,
        canDo: () => true,
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useSupplierInvoices: vi.fn(() => ({ data: [], refetch: vi.fn() })),
    useSuppliers: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useSupplierInvoiceLines: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
    useSupplierPayments: vi.fn(() => ({ data: [] })),
    useSupplierPaymentInvoiceLinks: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/useDolibarrLink', () => ({
    useDolibarrLink: vi.fn(() => ({ openLink: vi.fn() })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('./../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

vi.mock('./../../components/Finance/ReceiptWizard', () => ({
    ReceiptWizard: () => null,
}));

vi.mock('./../../components/common/RichTextEditor', () => ({
    RichTextEditor: () => null,
}));

vi.mock('./../../components/Modals/SupplierPaymentModal', () => ({
    SupplierPaymentModal: () => null,
}));

const mockDraftInvoice: SupplierInvoice = {
    id: 'inv1',
    ref: 'FA-DRAFT-001',
    socid: 'sup1',
    type: '0',
    date: Math.floor(new Date('2024-06-01').getTime() / 1000),
    total_ttc: 1500,
    paye: '0',
    statut: '0',
};

const mockUnpaidInvoice: SupplierInvoice = {
    id: 'inv2',
    ref: 'FA-UNPAID-001',
    socid: 'sup1',
    type: '0',
    date: Math.floor(new Date('2024-06-02').getTime() / 1000),
    total_ttc: 2500,
    paye: '0',
    statut: '1',
};

const mockPaidInvoice: SupplierInvoice = {
    id: 'inv3',
    ref: 'FA-PAID-001',
    socid: 'sup1',
    type: '0',
    date: Math.floor(new Date('2024-06-03').getTime() / 1000),
    total_ttc: 800,
    paye: '1',
    statut: '2',
};

const renderWithProvider = (invoices: SupplierInvoice[] = []) => {
    vi.mocked(useSupplierInvoices).mockReturnValue({ data: invoices, refetch: vi.fn() } as any);
    vi.mocked(useSuppliers).mockReturnValue({
        data: [{ id: 'sup1', name: 'Fornecedor Alpha' }],
    } as any);

    return render(
        <ConfirmProvider>
            <SupplierInvoiceList />
        </ConfirmProvider>
    );
};

describe('SupplierInvoiceList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the page header', () => {
        renderWithProvider();
        expect(screen.getByText('Faturas de Fornecedor')).toBeTruthy();
    });

    it('renders empty state when no invoices', () => {
        renderWithProvider();
        expect(screen.getByText('Nenhuma fatura encontrada')).toBeTruthy();
    });

    it('#559: monta a tela sem lancar erro e exibe o cabecalho', () => {
        // Smoke: ao abrir "Faturas de Fornecedor" a tela deve renderizar o titulo
        // em vez de quebrar com 404. Hooks sao mockados para simular o caminho
        // pos-correcao (fallback REST populando a lista / empty state).
        renderWithProvider();
        expect(screen.getByText('Faturas de Fornecedor')).toBeTruthy();
    });

    it('#559: lista faturas vindas do caminho de fallback (REST supplierinvoices)', () => {
        // Simula o cenario real: custom_sync 404 -> fallbackFetch (fetchSupplierInvoices)
        // devolve as faturas via REST, e a tela as lista no DOM.
        renderWithProvider([mockUnpaidInvoice, mockPaidInvoice]);
        expect(screen.getByText('FA-UNPAID-001')).toBeTruthy();
        expect(screen.getByText('FA-PAID-001')).toBeTruthy();
    });

    it('renders invoice refs in the list', () => {
        renderWithProvider([mockDraftInvoice, mockUnpaidInvoice, mockPaidInvoice]);
        expect(screen.getByText('FA-DRAFT-001')).toBeTruthy();
        expect(screen.getByText('FA-UNPAID-001')).toBeTruthy();
        expect(screen.getByText('FA-PAID-001')).toBeTruthy();
    });

    it('shows supplier name for invoices', () => {
        renderWithProvider([mockDraftInvoice]);
        expect(screen.getByText('Fornecedor Alpha')).toBeTruthy();
    });

    it('shows Validar button when a draft invoice is selected', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });
    });

    it('opens in-app confirm dialog (not native confirm) when clicking Validar', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });

        await user.click(screen.getByText('Validar'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Confirma a validação desta fatura?')).toBeTruthy();
    });

    it('validates invoice when user confirms the dialog', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });

        await user.click(screen.getByText('Validar'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(DolibarrService.validateSupplierInvoice).toHaveBeenCalledWith(
                expect.anything(),
                'inv1'
            );
        });
    });

    it('does NOT validate invoice when user cancels the dialog', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });

        await user.click(screen.getByText('Validar'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(DolibarrService.validateSupplierInvoice).not.toHaveBeenCalled();
        });
    });

    it('shows Reabrir button for paid invoices and opens confirm dialog', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockPaidInvoice]);

        await user.click(screen.getByText('FA-PAID-001'));

        await waitFor(() => {
            expect(screen.getByText('Reabrir')).toBeTruthy();
        });

        await user.click(screen.getByText('Reabrir'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Reabrir fatura de fornecedor (voltar para rascunho)?')).toBeTruthy();
    });

    it('does not use native window.confirm', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        const alertSpy = vi.spyOn(window, 'alert');
        const user = userEvent.setup();

        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });

        await user.click(screen.getByText('Validar'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(DolibarrService.validateSupplierInvoice).toHaveBeenCalled();
        });

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();

        confirmSpy.mockRestore();
        alertSpy.mockRestore();
    });
});

describe('SupplierInvoiceList — Total bar (#486)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the total bar with the sum of all visible invoices as BRL', () => {
        renderWithProvider([mockDraftInvoice, mockUnpaidInvoice, mockPaidInvoice]);

        const totalBar = screen.getByTestId('list-total-bar');
        expect(totalBar).toBeTruthy();

        const totalValue = screen.getByTestId('list-total-value');
        // 1500 + 2500 + 800 = 4800
        expect(totalValue.textContent).toBe(formatCurrency(4800));
    });

    it('shows R$ 0,00 when there are no invoices', () => {
        renderWithProvider([]);

        const totalValue = screen.getByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(0));
    });

    it('updates the total when filtering by status tab', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice, mockUnpaidInvoice, mockPaidInvoice]);

        // Initially shows sum of all (1500 + 2500 + 800 = 4800)
        expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(4800));

        // Filter to "Pagas" (statut = '2')
        await user.click(screen.getByText('Pagas'));

        await waitFor(() => {
            expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(800));
        });
    });
});

describe('SupplierInvoiceList — Currency standardization (#689)', () => {
    // Strict text match (avoids getByText whitespace-normalization of the NBSP
    // inside the BRL string "R$\u00A0X,XX"). Same approach as the InvoiceList #639 test.
    const findAllWithText = (container: HTMLElement, text: string) =>
        Array.from(container.querySelectorAll('*')).filter((el) => el.textContent === text);

    beforeEach(() => {
        vi.clearAllMocks();
        // Defaults: no lines/payments/links (isolate each test from prior overrides)
        vi.mocked(useSupplierInvoiceLines).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierPayments).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierPaymentInvoiceLinks).mockReturnValue({ data: [] } as any);
    });

    it('renders the list card total in BRL via formatCurrency (no USD $ prefix)', () => {
        const { container } = renderWithProvider([mockUnpaidInvoice]); // total_ttc 2500

        const formatted = formatCurrency(2500);
        const matches = findAllWithText(container, formatted);
        // List card value + list total bar both render the BRL value
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('renders the detail "Valor Total" in BRL via formatCurrency', async () => {
        const user = userEvent.setup();
        const { container } = renderWithProvider([mockUnpaidInvoice]);

        await user.click(screen.getByText('FA-UNPAID-001'));

        await waitFor(() => {
            expect(screen.getByText('Valor Total')).toBeTruthy();
        });
        expect(findAllWithText(container, formatCurrency(2500)).length).toBeGreaterThanOrEqual(1);
    });

    it('renders the items table "Total Geral" footer in BRL via formatCurrency', async () => {
        const user = userEvent.setup();
        vi.mocked(useSupplierInvoiceLines).mockReturnValue({
            data: [
                { id: 'l1', parent_id: 'inv2', label: 'Item', description: '', qty: 1, vat_rate: 0, subprice: 2500, total_ht: 2500, total_ttc: 2500 },
            ],
        } as any);

        const { container } = renderWithProvider([mockUnpaidInvoice]);
        await user.click(screen.getByText('FA-UNPAID-001'));

        await waitFor(() => {
            expect(screen.getByText('Total Geral')).toBeTruthy();
        });
        expect(findAllWithText(container, formatCurrency(2500)).length).toBeGreaterThanOrEqual(1);
    });

    it('renders each linked payment amount in BRL via formatCurrency', async () => {
        const user = userEvent.setup();
        vi.mocked(useSupplierPayments).mockReturnValue({
            data: [{ id: 99, ref: 'PAY-001', date_payment: '2024-06-10', amount: 1000 }],
        } as any);
        vi.mocked(useSupplierPaymentInvoiceLinks).mockReturnValue({
            data: [{ id: 'lnk1', fk_paiementfourn: '99', fk_facturefourn: 'inv2', amount: 1000 }],
        } as any);

        const { container } = renderWithProvider([mockUnpaidInvoice]);
        await user.click(screen.getByText('FA-UNPAID-001'));

        await waitFor(() => {
            expect(screen.getByText('Saldo Restante')).toBeTruthy();
        });
        // Payment value renders as BRL (R$ 1.000,00)
        expect(findAllWithText(container, formatCurrency(1000)).length).toBeGreaterThanOrEqual(1);
    });

    it('renders the "Saldo Restante" in BRL via formatCurrency', async () => {
        const user = userEvent.setup();
        // total 2500, paid 1000 => remaining 1500
        vi.mocked(useSupplierPayments).mockReturnValue({
            data: [{ id: 99, ref: 'PAY-001', date_payment: '2024-06-10', amount: 1000 }],
        } as any);
        vi.mocked(useSupplierPaymentInvoiceLinks).mockReturnValue({
            data: [{ id: 'lnk1', fk_paiementfourn: '99', fk_facturefourn: 'inv2', amount: 1000 }],
        } as any);

        const { container } = renderWithProvider([mockUnpaidInvoice]);
        await user.click(screen.getByText('FA-UNPAID-001'));

        await waitFor(() => {
            expect(screen.getByText('Saldo Restante')).toBeTruthy();
        });
        expect(findAllWithText(container, formatCurrency(1500)).length).toBeGreaterThanOrEqual(1);
    });

    it('renders the "Saldo Restante" as BRL R$ 0,00 when fully paid (no bare 0.00)', async () => {
        const user = userEvent.setup();
        // total 2500, paid 2500 => remaining 0
        vi.mocked(useSupplierPayments).mockReturnValue({
            data: [{ id: 99, ref: 'PAY-001', date_payment: '2024-06-10', amount: 2500 }],
        } as any);
        vi.mocked(useSupplierPaymentInvoiceLinks).mockReturnValue({
            data: [{ id: 'lnk1', fk_paiementfourn: '99', fk_facturefourn: 'inv2', amount: 2500 }],
        } as any);

        const { container } = renderWithProvider([mockUnpaidInvoice]);
        await user.click(screen.getByText('FA-UNPAID-001'));

        await waitFor(() => {
            expect(screen.getByText('Saldo Restante')).toBeTruthy();
        });
        expect(findAllWithText(container, formatCurrency(0)).length).toBeGreaterThanOrEqual(1);
    });

    it('never renders a raw "$" dollar prefix for any monetary value', async () => {
        const user = userEvent.setup();
        vi.mocked(useSupplierInvoiceLines).mockReturnValue({
            data: [
                { id: 'l1', parent_id: 'inv2', label: 'Item', description: '', qty: 1, vat_rate: 0, subprice: 2500, total_ht: 2500, total_ttc: 2500 },
            ],
        } as any);

        const { container } = renderWithProvider([mockUnpaidInvoice]);
        await user.click(screen.getByText('FA-UNPAID-001'));

        await waitFor(() => {
            expect(screen.getByText('Valor Total')).toBeTruthy();
        });

        // No element should expose a bare "$<digit>" dollar-style currency string
        const dollarMatches = Array.from(container.querySelectorAll('*')).filter((el) =>
            /\$\d/.test(el.textContent || '')
        );
        expect(dollarMatches).toHaveLength(0);
    });
});

describe('SupplierInvoiceList — Alvo de clique não-ambíguo (#690) + moeda BRL no card (#691)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useSupplierInvoiceLines).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierPayments).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierPaymentInvoiceLinks).mockReturnValue({ data: [] } as any);
    });

    it('card total_ttc contém R$ e não contém $ isolado', () => {
        const { container } = renderWithProvider([mockUnpaidInvoice]); // total_ttc: 2500

        const formatted = formatCurrency(2500);
        // deve conter R$
        expect(formatted).toMatch(/R\$/);
        // algum elemento renderiza o valor formatado
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);

        // nenhum elemento com "$<dígito>" sem o R antes
        const bareDollar = Array.from(container.querySelectorAll('*')).filter((el) =>
            /(?<!R)\$\d/.test(el.textContent || '')
        );
        expect(bareDollar).toHaveLength(0);
    });

    it('clicar no nome do fornecedor chama onNavigate com suppliers e não abre o detalhe', async () => {
        const user = userEvent.setup();
        const onNavigate = vi.fn();

        vi.mocked(useSupplierInvoices).mockReturnValue({ data: [mockUnpaidInvoice], refetch: vi.fn() } as any);
        vi.mocked(useSuppliers).mockReturnValue({
            data: [{ id: 'sup1', name: 'Fornecedor Alpha' }],
        } as any);

        render(
            <ConfirmProvider>
                <SupplierInvoiceList onNavigate={onNavigate} />
            </ConfirmProvider>
        );

        const supplierBtn = screen.getByRole('button', { name: 'Fornecedor Alpha' });
        await user.click(supplierBtn);

        expect(onNavigate).toHaveBeenCalledWith('suppliers', 'sup1');
        // detalhe NÃO deve abrir (ref da fatura não aparece no painel de detalhe)
        expect(screen.queryByText('Valor Total')).toBeNull();
    });

    it('clicar na área do card (fora do nome do fornecedor) abre o detalhe', async () => {
        const user = userEvent.setup();
        const onNavigate = vi.fn();

        vi.mocked(useSupplierInvoices).mockReturnValue({ data: [mockUnpaidInvoice], refetch: vi.fn() } as any);
        vi.mocked(useSuppliers).mockReturnValue({
            data: [{ id: 'sup1', name: 'Fornecedor Alpha' }],
        } as any);

        render(
            <ConfirmProvider>
                <SupplierInvoiceList onNavigate={onNavigate} />
            </ConfirmProvider>
        );

        // Clica na ref da fatura (área do card, fora do nome do fornecedor)
        await user.click(screen.getByText('FA-UNPAID-001'));

        await waitFor(() => {
            expect(screen.getByText('Valor Total')).toBeTruthy();
        });

        // onNavigate não deve ter sido chamado para suppliers
        expect(onNavigate).not.toHaveBeenCalledWith('suppliers', expect.anything());
    });

    it('nome do fornecedor tem aparência de link (classe text-indigo-600)', () => {
        renderWithProvider([mockUnpaidInvoice]);

        const supplierBtn = screen.getByRole('button', { name: 'Fornecedor Alpha' });
        expect(supplierBtn.className).toMatch(/text-indigo-600/);
    });
});

describe('SupplierInvoiceList — Chaves estáveis (#848)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useSupplierInvoiceLines).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierPayments).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierPaymentInvoiceLinks).mockReturnValue({ data: [] } as any);
    });

    it('documentos usam chave estável (doc.name) e são listados corretamente', async () => {
        const user = userEvent.setup();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(DolibarrService.fetchDocuments).mockResolvedValue([
            { name: 'fatura1.pdf', date: 1700000000, size: 1024 },
            { name: 'fatura2.pdf', date: 1700000001, size: 2048 },
        ] as any);

        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));
        await user.click(screen.getByText('Documentos'));

        await waitFor(() => {
            expect(screen.getByText('fatura1.pdf')).toBeTruthy();
            expect(screen.getByText('fatura2.pdf')).toBeTruthy();
        });

        const keyWarnings = errorSpy.mock.calls.filter(
            ([msg]) => typeof msg === 'string' && msg.includes('Encountered two children with the same key')
        );
        expect(keyWarnings).toHaveLength(0);
        errorSpy.mockRestore();
    });

    it('itens do form de edição carregam linhas existentes com valores corretos', async () => {
        const user = userEvent.setup();
        vi.mocked(useSupplierInvoiceLines).mockReturnValue({
            data: [
                { id: 'line-1', parent_id: 'inv1', description: 'Item A', qty: 2, subprice: 100, remise_percent: 0 },
                { id: 'line-2', parent_id: 'inv1', description: 'Item B', qty: 5, subprice: 200, remise_percent: 10 },
            ],
        } as any);

        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));
        await user.click(await screen.findByText('Editar'));

        const qtyInputs = screen.getAllByPlaceholderText('Qtd');
        expect(qtyInputs).toHaveLength(2);
        expect((qtyInputs[0] as HTMLInputElement).value).toBe('2');
        expect((qtyInputs[1] as HTMLInputElement).value).toBe('5');
    });

    it('adicionar itens via "Adicionar Item" gera _rowId estáveis (sem warning de key)', async () => {
        const user = userEvent.setup();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));
        await user.click(await screen.findByText('Editar'));

        expect(screen.getByText('Nenhum item.')).toBeTruthy();

        await user.click(screen.getByText('Adicionar Item'));
        await user.click(screen.getByText('Adicionar Item'));

        const qtyInputs = screen.getAllByPlaceholderText('Qtd');
        expect(qtyInputs).toHaveLength(2);

        const keyWarnings = errorSpy.mock.calls.filter(
            ([msg]) => typeof msg === 'string' && msg.includes('Encountered two children with the same key')
        );
        expect(keyWarnings).toHaveLength(0);
        errorSpy.mockRestore();
    });

    it('remover um item preserva os valores do item irmão (chave estável evita troca de dados)', async () => {
        const user = userEvent.setup();
        vi.mocked(useSupplierInvoiceLines).mockReturnValue({
            data: [
                { id: 'line-1', parent_id: 'inv1', description: 'Item A', qty: 2, subprice: 100, remise_percent: 0 },
                { id: 'line-2', parent_id: 'inv1', description: 'Item B', qty: 7, subprice: 200, remise_percent: 0 },
            ],
        } as any);

        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));
        await user.click(await screen.findByText('Editar'));

        let qtyInputs = screen.getAllByPlaceholderText('Qtd');
        expect(qtyInputs).toHaveLength(2);
        expect((qtyInputs[1] as HTMLInputElement).value).toBe('7');

        const removeButtons = screen.getAllByLabelText('Remover item');
        expect(removeButtons).toHaveLength(2);
        await user.click(removeButtons[0]);

        qtyInputs = screen.getAllByPlaceholderText('Qtd');
        expect(qtyInputs).toHaveLength(1);
        expect((qtyInputs[0] as HTMLInputElement).value).toBe('7');
    });
});

describe('SupplierInvoiceList — Gating canDo nos botões de mutação (#851)', () => {
    // Wrapper: canDo resolvido via canDoAction (writePermissions) p/ espelhar o comportamento
    // real do DolibarrContext. Assim o teste valida a integração component + mapa de permissões.
    const canDoFor = (ident: WriteIdentity) => (action: WriteAction, screen: string) =>
        canDoAction(ident, screen, action);

    const renderWith = (ident: any, invoices: SupplierInvoice[]) => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: { apiUrl: 'http://test', apiKey: 'key', themeColor: 'indigo', darkMode: false },
            refreshData: vi.fn(),
            canAccess: () => true,
            canDo: canDoFor(ident),
        } as any);
        vi.mocked(useSupplierInvoices).mockReturnValue({ data: invoices, refetch: vi.fn() } as any);
        vi.mocked(useSuppliers).mockReturnValue({
            data: [{ id: 'sup1', name: 'Fornecedor Alpha' }],
        } as any);
        vi.mocked(useSupplierInvoiceLines).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierPayments).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierPaymentInvoiceLinks).mockReturnValue({ data: [] } as any);

        return render(
            <ConfirmProvider>
                <SupplierInvoiceList />
            </ConfirmProvider>
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('usuário sem permissão NÃO vê os botões de Validar, Pagar e Reabrir', async () => {
        const user = userEvent.setup();
        const semPerm = { admin: 0, rights: { fournisseur: { facture: {} } } };
        renderWith(semPerm, [mockDraftInvoice, mockUnpaidInvoice]);

        // Draft → Validar oculto
        await user.click(screen.getByText('FA-DRAFT-001'));
        await waitFor(() => expect(screen.getByText('Valor Total')).toBeTruthy());
        expect(screen.queryByText('Validar')).toBeNull();

        // Unpaid → Pagar e Reabrir ocultos
        await user.click(screen.getByText('FA-UNPAID-001'));
        await waitFor(() => expect(screen.getByText('Valor Total')).toBeTruthy());
        expect(screen.queryByText('Pagar')).toBeNull();
        expect(screen.queryByText('Reabrir')).toBeNull();
    });

    it('admin vê e pode executar Validar, Pagar e Reabrir', async () => {
        const user = userEvent.setup();
        renderWith({ admin: 1 }, [mockDraftInvoice, mockUnpaidInvoice]);

        // Draft → Validar visível
        await user.click(screen.getByText('FA-DRAFT-001'));
        await waitFor(() => expect(screen.getByText('Validar')).toBeTruthy());

        // Unpaid → Pagar e Reabrir visíveis
        await user.click(screen.getByText('FA-UNPAID-001'));
        await waitFor(() => expect(screen.getByText('Valor Total')).toBeTruthy());
        expect(screen.getByText('Pagar')).toBeTruthy();
        expect(screen.getByText('Reabrir')).toBeTruthy();
    });

    it('usuário com apenas facture.paiement vê apenas Pagar (Validar/Reabrir ocultos)', async () => {
        const user = userEvent.setup();
        const payOnly = { admin: 0, rights: { fournisseur: { facture: { paiement: 1 } } } };
        renderWith(payOnly, [mockDraftInvoice, mockUnpaidInvoice]);

        // Draft → Validar oculto (sem facture.valider)
        await user.click(screen.getByText('FA-DRAFT-001'));
        await waitFor(() => expect(screen.getByText('Valor Total')).toBeTruthy());
        expect(screen.queryByText('Validar')).toBeNull();

        // Unpaid → Pagar visível, Reabrir oculto (reopen usa facture.valider)
        await user.click(screen.getByText('FA-UNPAID-001'));
        await waitFor(() => expect(screen.getByText('Valor Total')).toBeTruthy());
        expect(screen.getByText('Pagar')).toBeTruthy();
        expect(screen.queryByText('Reabrir')).toBeNull();
    });

    // Critério 2 (execução): admin não só vê como EXECUTA Validar e Reabrir.
    it('admin valida a fatura ao confirmar o diálogo (executa validateSupplierInvoice)', async () => {
        const user = userEvent.setup();
        renderWith({ admin: 1 }, [mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));
        await user.click(await screen.findByRole('button', { name: 'Validar' }));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(DolibarrService.validateSupplierInvoice).toHaveBeenCalledWith(expect.anything(), 'inv1');
        });
    });

    it('admin reabre uma fatura paga (statut 2) ao confirmar (executa setSupplierInvoiceToDraft)', async () => {
        const user = userEvent.setup();
        renderWith({ admin: 1 }, [mockPaidInvoice]);

        await user.click(screen.getByText('FA-PAID-001'));
        await user.click(await screen.findByRole('button', { name: 'Reabrir' }));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(DolibarrService.setSupplierInvoiceToDraft).toHaveBeenCalledWith(expect.anything(), 'inv3');
        });
    });
});
