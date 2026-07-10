import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProjectList from '../../components/ProjectList';
import { ConfirmProvider } from '../../hooks/useConfirm';

// --- Mock sonner so toast calls are no-ops ---
const { toastMock } = vi.hoisted(() => ({
    toastMock: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        fetchDocuments: vi.fn(),
        uploadDocument: vi.fn(),
        deleteDocument: vi.fn(),
        validateProject: vi.fn(),
        deleteProject: vi.fn(),
        createTask: vi.fn(),
        updateTask: vi.fn(),
        deleteTask: vi.fn(),
        setTaskContact: vi.fn(),
        setDelegationDoc: vi.fn(),
        requestDelegationAcceptance: vi.fn(),
        createTicket: vi.fn(),
        updateTicket: vi.fn(),
        deleteTicket: vi.fn(),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { baseUrl: 'http://test', apiKey: 'key', currentUser: { id: '1' } },
        refreshData: vi.fn(),
        canDo: () => true,
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useProjects: vi.fn(() => ({ data: [] })),
    useCustomers: vi.fn(() => ({ data: [] })),
    useTasks: vi.fn(() => ({ data: [] })),
    useInvoices: vi.fn(() => ({ data: [] })),
    useSupplierInvoices: vi.fn(() => ({ data: [] })),
    useInterventions: vi.fn(() => ({ data: [] })),
    useExpenseReports: vi.fn(() => ({ data: [] })),
    useManufacturingOrders: vi.fn(() => ({ data: [] })),
    useContracts: vi.fn(() => ({ data: [] })),
    useTickets: vi.fn(() => ({ data: [] })),
    useEvents: vi.fn(() => ({ data: [] })),
    useLinks: vi.fn(() => ({ data: [] })),
    useProposals: vi.fn(() => ({ data: [] })),
    useOrders: vi.fn(() => ({ data: [] })),
    useShipments: vi.fn(() => ({ data: [] })),
    useSupplierOrders: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
    useProjectContacts: vi.fn(() => ({ data: [] })),
    useContacts: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

const {
    useProjects, useCustomers, useInvoices, useSupplierInvoices, useExpenseReports,
} = await import('../../hooks/dolibarr');

const baseProject = {
    id: '5',
    ref: 'PRJ-005',
    title: 'Projeto Omega',
    socid: '10',
    statut: '1' as const,
    progress: 0,
    date_start: Date.now(),
    date_creation: Date.now(),
};

const customerMock = [{ id: '10', name: 'Cliente Alpha' }];

const renderList = () =>
    render(
        <MemoryRouter>
            <ConfirmProvider>
                <ProjectList />
            </ConfirmProvider>
        </MemoryRouter>
    );

describe('ProjectList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useProjects).mockReturnValue({ data: [baseProject] } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: customerMock } as any);
        vi.mocked(useInvoices).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierInvoices).mockReturnValue({ data: [] } as any);
        vi.mocked(useExpenseReports).mockReturnValue({ data: [] } as any);
    });

    it('renders the project list', async () => {
        renderList();
        await waitFor(() => {
            expect(screen.getByText('PRJ-005')).toBeInTheDocument();
        });
    });

    describe('Project detail - NaN guard on overview totals (#1107)', () => {
        it('renders valid totals (no NaN) when invoice/expense total_ttc is missing/null/NaN', async () => {
            const user = userEvent.setup();
            vi.mocked(useInvoices).mockReturnValue({
                data: [
                    { id: 'i1', project_id: '5', total_ttc: undefined },
                    { id: 'i2', project_id: '5', total_ttc: null },
                    { id: 'i3', project_id: '5', total_ttc: NaN },
                    { id: 'i4', project_id: '5', total_ttc: 500 },
                ],
            } as any);
            vi.mocked(useSupplierInvoices).mockReturnValue({
                data: [
                    { id: 's1', project_id: '5', total_ttc: undefined },
                    { id: 's2', project_id: '5', total_ttc: 200 },
                ],
            } as any);
            vi.mocked(useExpenseReports).mockReturnValue({
                data: [
                    { id: 'e1', project_id: '5', total_ttc: NaN },
                    { id: 'e2', project_id: '5', total_ttc: 100 },
                ],
            } as any);

            renderList();

            await waitFor(() => screen.getByText('PRJ-005'));
            await user.click(screen.getByText('PRJ-005'));

            await waitFor(() => {
                expect(screen.getByText('Resumo Financeiro')).toBeInTheDocument();
            });

            // Without the guard, `acc + undefined` => NaN and formatCurrency(NaN)
            // renders "R$ NaN". Invalid entries must contribute 0, so:
            //   Faturado = 500, Custos = 200 + 100 = 300, Margem = 500 - 300 = 200.
            expect(screen.queryByText(/NaN/)).toBeNull();
            expect(screen.getByText(/500,00/)).toBeInTheDocument();
            expect(screen.getByText(/300,00/)).toBeInTheDocument();
            expect(screen.getByText(/200,00/)).toBeInTheDocument();
        });

        it('renders R$ 0,00 totals when every total_ttc is missing', async () => {
            const user = userEvent.setup();
            vi.mocked(useInvoices).mockReturnValue({
                data: [
                    { id: 'i1', project_id: '5', total_ttc: undefined },
                    { id: 'i2', project_id: '5', total_ttc: null },
                ],
            } as any);
            vi.mocked(useSupplierInvoices).mockReturnValue({
                data: [{ id: 's1', project_id: '5', total_ttc: undefined }],
            } as any);
            vi.mocked(useExpenseReports).mockReturnValue({
                data: [{ id: 'e1', project_id: '5', total_ttc: null }],
            } as any);

            renderList();

            await waitFor(() => screen.getByText('PRJ-005'));
            await user.click(screen.getByText('PRJ-005'));

            await waitFor(() => {
                expect(screen.getByText('Resumo Financeiro')).toBeInTheDocument();
            });

            expect(screen.queryByText(/NaN/)).toBeNull();
            // All three aggregates (Faturado, Custos, Margem) collapse to 0.
            const zeros = screen.getAllByText(/0,00/);
            expect(zeros.length).toBeGreaterThanOrEqual(3);
        });

        it('guards the totals reduce against literal NaN total_ttc', async () => {
            const user = userEvent.setup();
            vi.mocked(useInvoices).mockReturnValue({
                data: [
                    { id: 'i1', project_id: '5', total_ttc: NaN },
                    { id: 'i2', project_id: '5', total_ttc: 400 },
                ],
            } as any);

            renderList();

            await waitFor(() => screen.getByText('PRJ-005'));
            await user.click(screen.getByText('PRJ-005'));

            await waitFor(() => {
                expect(screen.getByText('Resumo Financeiro')).toBeInTheDocument();
            });

            // With the guard, the NaN entry contributes 0 so Faturado = 400,
            // never NaN. Scope to the "Faturado" row: Custos = 0 and Margem = 400
            // too, so an unscoped /400,00/ query would match multiple elements.
            expect(screen.queryByText(/NaN/)).toBeNull();
            const faturadoRow = screen.getByText('Faturado').parentElement?.parentElement;
            expect(faturadoRow).toHaveTextContent(/400,00/);
        });
    });
});
