import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '../../hooks/useConfirm';
import SupplierProposalList from '../../components/SupplierProposalList';
import { DolibarrService } from '../../services/dolibarrService';
import { formatCurrency } from '../../utils/formatUtils';

// --- Mock sonner so we can assert toast calls instead of native alert ---
const { toastMock } = vi.hoisted(() => ({
    toastMock: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

// --- Mock DolibarrContext ---
vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { baseUrl: 'http://test', apiKey: 'key' }, canAccess: () => true, canDo: () => true })),
}));

// --- Mock dolibarr hooks ---
const mockRefetch = vi.fn();
vi.mock('../../hooks/dolibarr', () => ({
    useSupplierProposals: vi.fn(() => ({ data: [], isRefetching: false, refetch: mockRefetch })),
    useSuppliers: vi.fn(() => ({ data: [{ id: 'sup1', name: 'Fornecedor Teste' }] })),
    useProducts: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useSupplierProposalLines: vi.fn(() => ({ data: [], refetch: mockRefetch })),
    useUsers: vi.fn(() => ({ data: [] })),
}));

// --- Mock usePrefill ---
vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

// --- Mock DolibarrService ---
vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createSupplierProposal: vi.fn(),
        updateSupplierProposal: vi.fn(),
        deleteSupplierProposalLine: vi.fn(),
        updateSupplierProposalLine: vi.fn(),
        addSupplierProposalLine: vi.fn(),
        closeSupplierProposal: vi.fn(),
        deleteSupplierProposal: vi.fn(),
        validateSupplierProposal: vi.fn(),
    },
}));

// --- Mock virtualization (jsdom has no layout) ---
vi.mock('react-virtualized-auto-sizer', () => ({
    default: ({ children }: any) => children({ height: 600, width: 800 }),
}));

vi.mock('react-window', () => ({
    FixedSizeList: ({ children, itemCount }: any) => (
        <>
            {Array.from({ length: itemCount }, (_, index) =>
                children({ index, style: {} })
            )}
        </>
    ),
}));

// --- Mock sanitizeHtml (DOMPurify can be flaky in jsdom) ---
vi.mock('../../utils/sanitizeHtml', () => ({
    sanitizeHtml: (html: string) => html,
}));

const mockConfig = { baseUrl: 'http://test', apiKey: 'key' };

const renderComponent = (props?: Record<string, any>) =>
    render(
        <MemoryRouter>
            <ConfirmProvider>
                <SupplierProposalList {...props} />
            </ConfirmProvider>
        </MemoryRouter>
    );

describe('SupplierProposalList — toast/notifyError (no native alert/confirm)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('shows toast.error (not native alert) when saving without a supplier', async () => {
        const user = userEvent.setup();
        renderComponent();

        await user.click(screen.getAllByText('Nova Solicitação')[0]);

        const submitBtn = await screen.findByText('Criar Solicitação');
        await user.click(submitBtn);

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith('Selecione um fornecedor.');
        });
        expect(DolibarrService.createSupplierProposal).not.toHaveBeenCalled();
        expect(window.alert).not.toHaveBeenCalled();
    });

    it('shows toast.success on successful creation', async () => {
        vi.mocked(DolibarrService.createSupplierProposal).mockResolvedValue({} as any);
        const user = userEvent.setup();
        renderComponent();

        await user.click(screen.getAllByText('Nova Solicitação')[0]);

        await screen.findByText('Criar Solicitação');

        // Select a supplier via the searchable select
        await user.click(screen.getByText('Selecione o Fornecedor...'));
        await user.click(screen.getByText('Fornecedor Teste'));

        // Submit
        await user.click(screen.getByText('Criar Solicitação'));

        await waitFor(() => {
            expect(DolibarrService.createSupplierProposal).toHaveBeenCalledWith(
                mockConfig,
                expect.objectContaining({ socid: 'sup1' })
            );
            expect(toastMock.success).toHaveBeenCalledWith('Solicitação Criada!');
        });
        expect(window.alert).not.toHaveBeenCalled();
    });

    it('shows toast.error via notifyError when creation fails', async () => {
        vi.mocked(DolibarrService.createSupplierProposal).mockRejectedValue(
            new Error('Network error')
        );
        const user = userEvent.setup();
        renderComponent();

        await user.click(screen.getAllByText('Nova Solicitação')[0]);
        await screen.findByText('Criar Solicitação');

        await user.click(screen.getByText('Selecione o Fornecedor...'));
        await user.click(screen.getByText('Fornecedor Teste'));

        await user.click(screen.getByText('Criar Solicitação'));

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith(
                'Salvar solicitação falhou.',
                expect.objectContaining({ description: expect.stringContaining('Network error') })
            );
        });
        expect(window.alert).not.toHaveBeenCalled();
    });

    it('shows toast.success when signing an open proposal', async () => {
        // Provide proposals with an open status so the approval bar renders
        const { useSupplierProposals } = await import('../../hooks/dolibarr');
        vi.mocked(useSupplierProposals).mockReturnValue({
            data: [
                {
                    id: 'prop1',
                    ref: 'SP2501-0001',
                    socid: 'sup1',
                    datec: 1700000000,
                    total_ht: 1500,
                    statut: '1',
                    project_id: null,
                    fk_user_author: null,
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        vi.mocked(DolibarrService.closeSupplierProposal).mockResolvedValue({} as any);

        const user = userEvent.setup();
        renderComponent();

        // Wait for the proposal to appear, then click it
        const proposalCard = await screen.findByText('SP2501-0001');
        await user.click(proposalCard);

        // Click the "Assinar / Aceitar" button
        const signBtn = await screen.findByText('Assinar / Aceitar');
        await user.click(signBtn);

        await waitFor(() => {
            expect(DolibarrService.closeSupplierProposal).toHaveBeenCalledWith(
                mockConfig,
                'prop1',
                2
            );
            expect(toastMock.success).toHaveBeenCalledWith('Solicitação Assinada!');
        });
        expect(window.alert).not.toHaveBeenCalled();
    });

    it('shows toast.error via notifyError when closing a proposal fails', async () => {
        const { useSupplierProposals } = await import('../../hooks/dolibarr');
        vi.mocked(useSupplierProposals).mockReturnValue({
            data: [
                {
                    id: 'prop2',
                    ref: 'SP2501-0002',
                    socid: 'sup1',
                    datec: 1700000000,
                    total_ht: 500,
                    statut: '1',
                    project_id: null,
                    fk_user_author: null,
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        vi.mocked(DolibarrService.closeSupplierProposal).mockRejectedValue(
            new Error('Server error')
        );

        const user = userEvent.setup();
        renderComponent();

        const proposalCard = await screen.findByText('SP2501-0002');
        await user.click(proposalCard);

        const declineBtn = await screen.findByText('Recusar');
        await user.click(declineBtn);

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith(
                'Fechar solicitação falhou.',
                expect.objectContaining({ description: expect.stringContaining('Server error') })
            );
        });
        expect(window.alert).not.toHaveBeenCalled();
    });
});

describe('SupplierProposalList — Total bar (#486)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('renders the total bar with the sum of all visible proposals as BRL', async () => {
        const { useSupplierProposals } = await import('../../hooks/dolibarr');
        vi.mocked(useSupplierProposals).mockReturnValue({
            data: [
                { id: 'prop1', ref: 'SP001', socid: 'sup1', datec: 1700000000, total_ht: 1500, statut: '1', project_id: null, fk_user_author: null },
                { id: 'prop2', ref: 'SP002', socid: 'sup1', datec: 1700000001, total_ht: 500, statut: '0', project_id: null, fk_user_author: null },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        renderComponent();

        const totalBar = await screen.findByTestId('list-total-bar');
        expect(totalBar).toBeTruthy();

        const totalValue = screen.getByTestId('list-total-value');
        // 1500 + 500 = 2000
        expect(totalValue.textContent).toBe(formatCurrency(2000));
    });

    it('shows R$ 0,00 when there are no proposals', async () => {
        const { useSupplierProposals } = await import('../../hooks/dolibarr');
        vi.mocked(useSupplierProposals).mockReturnValue({
            data: [],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        renderComponent();

        const totalValue = await screen.findByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(0));
    });

    it('updates the total when filtering by status tab', async () => {
        const { useSupplierProposals } = await import('../../hooks/dolibarr');
        vi.mocked(useSupplierProposals).mockReturnValue({
            data: [
                { id: 'prop1', ref: 'SP001', socid: 'sup1', datec: 1700000000, total_ht: 1500, statut: '1', project_id: null, fk_user_author: null },
                { id: 'prop2', ref: 'SP002', socid: 'sup1', datec: 1700000001, total_ht: 500, statut: '0', project_id: null, fk_user_author: null },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        // Initially shows sum of all (1500 + 500 = 2000)
        const totalValue = await screen.findByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(2000));

        // Filter to "Rascunhos" (statut = '0')
        await user.click(screen.getByText('Rascunhos'));

        await waitFor(() => {
            expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(500));
        });
    });
});

describe('SupplierProposalList — issue #589 fixes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('sends note_public in the create payload', async () => {
        vi.mocked(DolibarrService.createSupplierProposal).mockResolvedValue({} as any);
        const user = userEvent.setup();
        renderComponent();

        await user.click(screen.getAllByText('Nova Solicitação')[0]);
        await screen.findByText('Criar Solicitação');

        // Select a supplier — modal may show "Fornecedor Teste" multiple times; pick first visible dropdown trigger
        await user.click(screen.getByText('Selecione o Fornecedor...'));
        // getAllByText returns all; the last one is the dropdown option that just appeared
        const opts = screen.getAllByText('Fornecedor Teste');
        await user.click(opts[opts.length - 1]);

        // Fill in the public note field
        const noteField = screen.getByPlaceholderText('Observações...');
        await user.clear(noteField);
        await user.type(noteField, 'Nota de teste');

        await user.click(screen.getByText('Criar Solicitação'));

        await waitFor(() => {
            expect(DolibarrService.createSupplierProposal).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ note_public: 'Nota de teste' })
            );
        });
    });

    it('loads note_public from existing proposal when opening edit', async () => {
        const { useSupplierProposals } = await import('../../hooks/dolibarr');
        vi.mocked(useSupplierProposals).mockReturnValue({
            data: [
                {
                    id: 'prop-edit',
                    ref: 'SP2501-0099',
                    socid: 'sup1',
                    datec: 1700000000,
                    total_ht: 300,
                    statut: '0',
                    project_id: null,
                    fk_user_author: null,
                    note_public: 'Nota já salva',
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        // Click proposal to open detail
        const card = await screen.findByText('SP2501-0099');
        await user.click(card);

        // Click Editar
        const editBtn = await screen.findByText('Editar');
        await user.click(editBtn);

        // The note field should show the saved value
        await waitFor(() => {
            const noteField = screen.getByPlaceholderText('Observações...');
            expect((noteField as HTMLTextAreaElement).value).toBe('Nota já salva');
        });
    });

    it('does not render the SHOW DEBUG button', async () => {
        const { useSupplierProposals } = await import('../../hooks/dolibarr');
        vi.mocked(useSupplierProposals).mockReturnValue({
            data: [
                {
                    id: 'prop-debug',
                    ref: 'SP2501-0003',
                    socid: 'sup1',
                    datec: 1700000000,
                    total_ht: 100,
                    statut: '1',
                    project_id: null,
                    fk_user_author: null,
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('SP2501-0003');
        await user.click(card);

        // Detail panel should open — verify SHOW DEBUG is absent
        await screen.findByText('Assinar / Aceitar');
        expect(screen.queryByText('SHOW DEBUG')).toBeNull();
    });

    it('renders monetary values using formatCurrency (R$) not literal $', async () => {
        const { useSupplierProposals, useSupplierProposalLines } = await import('../../hooks/dolibarr');
        vi.mocked(useSupplierProposals).mockReturnValue({
            data: [
                {
                    id: 'prop-currency',
                    ref: 'SP2501-0004',
                    socid: 'sup1',
                    datec: 1700000000,
                    total_ht: 1234.56,
                    statut: '1',
                    project_id: null,
                    fk_user_author: null,
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
        vi.mocked(useSupplierProposalLines).mockReturnValue({
            data: [
                {
                    id: 'line1',
                    parent_id: 'prop-currency',
                    product_id: null,
                    description: 'Item A',
                    qty: 2,
                    subprice: 617.28,
                    total_ht: 1234.56,
                },
            ],
            refetch: mockRefetch,
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('SP2501-0004');
        await user.click(card);

        // Wait for detail to render the line item price
        await waitFor(() => {
            // formatCurrency produces "R$" locale string, never bare "$"
            const allText = document.body.textContent ?? '';
            // Should contain R$ somewhere
            expect(allText).toContain('R$');
            // Should not contain a bare $ followed by digits (USD-style)
            expect(allText).not.toMatch(/\$\d/);
        });
    });

    it('shows Validar button for draft proposal and calls validateSupplierProposal on click', async () => {
        const { useSupplierProposals } = await import('../../hooks/dolibarr');
        vi.mocked(useSupplierProposals).mockReturnValue({
            data: [
                {
                    id: 'prop-draft',
                    ref: 'SP2501-0005',
                    socid: 'sup1',
                    datec: 1700000000,
                    total_ht: 200,
                    statut: '0',
                    project_id: null,
                    fk_user_author: null,
                },
            ],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);

        vi.mocked(DolibarrService.validateSupplierProposal).mockResolvedValue({} as any);

        const user = userEvent.setup();
        renderComponent();

        const card = await screen.findByText('SP2501-0005');
        await user.click(card);

        // The validate button should be present for draft
        const validateBtn = await screen.findByText('Validar / Enviar ao Fornecedor');
        expect(validateBtn).toBeTruthy();

        await user.click(validateBtn);

        await waitFor(() => {
            expect(DolibarrService.validateSupplierProposal).toHaveBeenCalledWith(
                expect.anything(),
                'prop-draft'
            );
            expect(toastMock.success).toHaveBeenCalledWith('Solicitação validada e enviada ao fornecedor!');
        });
    });
});
