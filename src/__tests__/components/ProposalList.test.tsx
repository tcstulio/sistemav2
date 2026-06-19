import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import ProposalList from '../../components/ProposalList';
import { DolibarrService } from '../../services/dolibarrService';
import { useProposals } from '../../hooks/dolibarr';
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
    useProposals: vi.fn(() => ({
        data: [
            {
                id: 'prop1',
                ref: 'PR2501-0001',
                socid: 'cust1',
                date: 1700000000,
                total_ht: 1000,
                total_ttc: 1200,
                statut: '1',
                project_id: null,
                fk_user_author: null,
            },
        ],
        isRefetching: false,
        refetch: mockRefetch,
    })),
    useCustomers: vi.fn(() => ({ data: [{ id: 'cust1', name: 'Cliente Teste' }] })),
    useProducts: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useProposalLines: vi.fn(() => ({ data: [], refetch: mockRefetch })),
    useUsers: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../hooks/useDolibarrLink', () => ({
    useDolibarrLink: vi.fn(() => ({ openLink: vi.fn() })),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        cloneProposal: vi.fn(),
        deleteProposal: vi.fn(),
        downloadDocument: vi.fn(),
        createProposal: vi.fn(),
        updateProposal: vi.fn(),
    },
}));

vi.mock('../../services/aiService', () => ({
    AiService: {
        auditProposal: vi.fn(),
    },
}));

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

vi.mock('../../utils/sanitizeHtml', () => ({
    sanitizeHtml: (html: string) => html,
}));

const mockConfig = { apiUrl: 'http://test', apiKey: 'key' };

const renderComponent = (props?: Record<string, any>) =>
    render(
        <ConfirmProvider>
            <ProposalList {...props} />
        </ConfirmProvider>
    );

describe('ProposalList — Duplicate button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('shows toast.success and refetches when duplicate succeeds', async () => {
        vi.mocked(DolibarrService.cloneProposal).mockResolvedValue('new-id' as any);
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const confirmBtn = await screen.findByText('Confirmar');
        await user.click(confirmBtn);

        await waitFor(() => {
            expect(DolibarrService.cloneProposal).toHaveBeenCalledWith(mockConfig, 'prop1');
            expect(toastMock.success).toHaveBeenCalledWith('Proposta duplicada com sucesso');
            expect(mockRefetch).toHaveBeenCalled();
        });
        expect(window.confirm).not.toHaveBeenCalled();
    });

    it('calls notifyError with the real error when duplicate fails', async () => {
        const err = new Error('Dolibarr says no');
        vi.mocked(DolibarrService.cloneProposal).mockRejectedValue(err);
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const confirmBtn = await screen.findByText('Confirmar');
        await user.click(confirmBtn);

        await waitFor(() => {
            expect(DolibarrService.cloneProposal).toHaveBeenCalledWith(mockConfig, 'prop1');
            expect(notifyErrorMock).toHaveBeenCalledWith('Duplicar proposta', err);
            expect(toastMock.error).not.toHaveBeenCalledWith('Erro ao duplicar proposta');
        });
    });

    it('does NOT call cloneProposal when user cancels confirmation', async () => {
        vi.mocked(DolibarrService.cloneProposal).mockResolvedValue('new-id' as any);
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const cancelBtn = await screen.findByText('Cancelar');
        await user.click(cancelBtn);

        await waitFor(() => {
            expect(DolibarrService.cloneProposal).not.toHaveBeenCalled();
            expect(toastMock.success).not.toHaveBeenCalled();
        });
    });
});

describe('ProposalList — Total bar (#486)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the total bar with the sum of all visible proposals as BRL', async () => {
        renderComponent();

        const totalBar = await screen.findByTestId('list-total-bar');
        expect(totalBar).toBeTruthy();

        const totalValue = screen.getByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(1200));
    });

    it('shows R$ 0,00 when there are no proposals', async () => {
        vi.mocked(useProposals).mockReturnValue({
            data: [],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        renderComponent();

        const totalValue = await screen.findByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(0));
    });

    it('updates the total when filtering by status tab', async () => {
        vi.mocked(useProposals).mockReturnValue({
            data: [
                { id: 'prop1', ref: 'PR001', socid: 'cust1', date: 1700000000, total_ht: 1000, total_ttc: 1200, statut: '1', project_id: null, fk_user_author: null },
                { id: 'prop2', ref: 'PR002', socid: 'cust1', date: 1700000001, total_ht: 500, total_ttc: 600, statut: '2', project_id: null, fk_user_author: null },
            ],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const totalValue = await screen.findByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(1800));

        await user.click(screen.getByText('Assinadas'));

        await waitFor(() => {
            expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(600));
        });
    });
});

describe('ProposalList — Currency standardization (#639)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders proposal values in BRL via formatCurrency (no USD $ prefix)', async () => {
        vi.mocked(useProposals).mockReturnValue({
            data: [
                { id: 'propX', ref: 'PRX1', socid: 'cust1', date: 1700000000, total_ht: 1000, total_ttc: 2345.67, statut: '1', project_id: null, fk_user_author: null },
            ],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        const { container } = renderComponent();
        await screen.findByTestId('list-total-bar');

        const formatted = formatCurrency(2345.67);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        // The row total AND the total bar both render the BRL value
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });
});
