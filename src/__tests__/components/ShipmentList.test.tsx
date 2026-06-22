import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ShipmentList from '../../components/ShipmentList';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { DolibarrService } from '../../services/dolibarrService';

// --- Mock sonner so we can assert toast calls ---
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
        validateShipment: vi.fn(),
        deleteShipment: vi.fn(),
        createInvoiceFromOrder: vi.fn(),
        downloadDocument: vi.fn(),
        getShipment: vi.fn(),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { baseUrl: 'http://test', apiKey: 'key', currentUser: { id: '1' } },
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useShipments: vi.fn(() => ({ data: [], refetch: vi.fn() })),
    useCustomers: vi.fn(() => ({ data: [] })),
    useOrders: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

const { useShipments, useCustomers, useOrders, useUsers, useProjects } =
    await import('../../hooks/dolibarr');

// ---- Fixtures ----

const shipmentDraft = {
    id: '1',
    ref: 'EXP-0001',
    socid: '10',
    status: '0',
    date_creation: 1700000000,
    fk_commande: '5',
    project_id: '42',
    tracking_number: undefined,
    lines: [
        { id: 'l1', parent_id: '1', product_id: 'p1', label: 'Produto A', description: '', qty: 3 },
    ],
};

const shipmentValidated = {
    id: '2',
    ref: 'EXP-0002',
    socid: '20',
    status: '1',
    date_creation: 1700010000,
    lines: [],
};

const shipmentDelivered = {
    id: '3',
    ref: 'EXP-0003',
    socid: '10',
    status: '2',
    date_creation: 1700020000,
    fk_commande: '7',
    lines: [],
};

const customersMock = [
    { id: '10', name: 'Cliente Alpha' },
    { id: '20', name: 'Cliente Beta' },
];

const projectsMock = [
    { id: '42', ref: 'PROJ-01', title: 'Projeto Alfa' },
];

const setupMocks = (shipments = [shipmentDraft, shipmentValidated, shipmentDelivered]) => {
    const refetch = vi.fn();
    vi.mocked(useShipments).mockReturnValue({ data: shipments, refetch } as any);
    vi.mocked(useCustomers).mockReturnValue({ data: customersMock } as any);
    vi.mocked(useOrders).mockReturnValue({ data: [] } as any);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as any);
    vi.mocked(useProjects).mockReturnValue({ data: projectsMock } as any);
    // getShipment returns the same fixture (already has lines)
    vi.mocked(DolibarrService.getShipment).mockResolvedValue(shipmentDraft as any);
    return { refetch };
};

const renderList = (props?: { onNavigate?: (view: string, id: string) => void }) =>
    render(
        <MemoryRouter>
            <ConfirmProvider>
                <ShipmentList {...(props as any)} />
            </ConfirmProvider>
        </MemoryRouter>
    );

// ---- Tests ----

describe('ShipmentList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders list of shipments', async () => {
        setupMocks();
        renderList();
        await waitFor(() => {
            expect(screen.getByText('EXP-0001')).toBeInTheDocument();
            expect(screen.getByText('EXP-0002')).toBeInTheDocument();
            expect(screen.getByText('EXP-0003')).toBeInTheDocument();
        });
    });

    // ---- Empty state ----

    it('shows "nenhum envio cadastrado" when list is empty and no search active', async () => {
        setupMocks([]);
        renderList();
        await waitFor(() => {
            expect(screen.getByText('Nenhum envio cadastrado')).toBeInTheDocument();
        });
    });

    // ---- Validar button visibility ----

    it('shows Validar button only for Rascunho (status 0)', async () => {
        const user = userEvent.setup();
        setupMocks();
        renderList();

        // Click draft shipment
        await waitFor(() => screen.getByText('EXP-0001'));
        await user.click(screen.getByText('EXP-0001'));

        // Validar should appear
        expect(await screen.findByRole('button', { name: /Validar/i })).toBeInTheDocument();
    });

    it('does NOT show Validar button for status Validado (1)', async () => {
        const user = userEvent.setup();
        setupMocks();
        renderList();

        await waitFor(() => screen.getByText('EXP-0002'));
        await user.click(screen.getByText('EXP-0002'));

        // Wait for detail panel header to show ref
        await waitFor(() => {
            // Detail panel renders the ref again inside PageHeader
            const headings = screen.getAllByText('EXP-0002');
            expect(headings.length).toBeGreaterThan(0);
        });

        // No Validar button
        expect(screen.queryByRole('button', { name: /Validar/i })).toBeNull();
    });

    it('does NOT show Validar button for status Entregue (2)', async () => {
        const user = userEvent.setup();
        setupMocks();
        renderList();

        await waitFor(() => screen.getByText('EXP-0003'));
        await user.click(screen.getByText('EXP-0003'));

        await waitFor(() => {
            const headings = screen.getAllByText('EXP-0003');
            expect(headings.length).toBeGreaterThan(0);
        });

        expect(screen.queryByRole('button', { name: /Validar/i })).toBeNull();
    });

    // ---- Validar action ----

    it('calls DolibarrService.validateShipment and shows success toast when Validar clicked', async () => {
        const user = userEvent.setup();
        const { refetch } = setupMocks();
        vi.mocked(DolibarrService.validateShipment).mockResolvedValue({} as any);

        renderList();

        await waitFor(() => screen.getByText('EXP-0001'));
        await user.click(screen.getByText('EXP-0001'));

        const validateBtn = await screen.findByRole('button', { name: /Validar/i });
        await user.click(validateBtn);

        await waitFor(() => {
            expect(DolibarrService.validateShipment).toHaveBeenCalledWith(
                expect.objectContaining({ apiKey: 'key' }),
                '1'
            );
            expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining('EXP-0001'));
        });

        expect(refetch).toHaveBeenCalled();
    });

    it('shows toast.error when validateShipment throws', async () => {
        const user = userEvent.setup();
        setupMocks();
        vi.mocked(DolibarrService.validateShipment).mockRejectedValue(new Error('API error'));

        renderList();

        await waitFor(() => screen.getByText('EXP-0001'));
        await user.click(screen.getByText('EXP-0001'));

        const validateBtn = await screen.findByRole('button', { name: /Validar/i });
        await user.click(validateBtn);

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalled();
        });
    });

    // ---- Projeto ----

    it('shows project name in card when project_id present', async () => {
        setupMocks();
        renderList();

        await waitFor(() => {
            expect(screen.getByText('Projeto Alfa')).toBeInTheDocument();
        });
    });

    it('clicking project name in card calls onNavigate with projects view', async () => {
        const user = userEvent.setup();
        const onNavigate = vi.fn();
        setupMocks();

        renderList({ onNavigate });

        await waitFor(() => screen.getByText('Projeto Alfa'));

        const projectLink = screen.getByText('Projeto Alfa');
        await user.click(projectLink);

        expect(onNavigate).toHaveBeenCalledWith('projects', '42');
    });

    it('shows project in detail panel when project_id present', async () => {
        const user = userEvent.setup();
        const onNavigate = vi.fn();
        setupMocks();

        renderList({ onNavigate });

        await waitFor(() => screen.getByText('EXP-0001'));
        await user.click(screen.getByText('EXP-0001'));

        // Detail panel should show "Projeto" label and "Projeto Alfa"
        await waitFor(() => {
            expect(screen.getAllByText('Projeto Alfa').length).toBeGreaterThan(0);
        });
    });

    it('clicking project link in detail calls onNavigate', async () => {
        const user = userEvent.setup();
        const onNavigate = vi.fn();
        setupMocks();

        renderList({ onNavigate });

        await waitFor(() => screen.getByText('EXP-0001'));
        await user.click(screen.getByText('EXP-0001'));

        // Get all "Projeto Alfa" links — first may be in card, second in detail
        await waitFor(() => screen.getAllByText('Projeto Alfa'));
        const links = screen.getAllByText('Projeto Alfa');
        // Click the last one (detail panel)
        await user.click(links[links.length - 1]);

        expect(onNavigate).toHaveBeenCalledWith('projects', '42');
    });

    // ---- Linhas / itens ----

    it('fetches detail via getShipment and renders lines when shipment has no pre-loaded lines', async () => {
        const user = userEvent.setup();
        // Fixture without lines (simulating list response without lines)
        const { lines: _lines, ...rest } = shipmentDraft;
        const shipmentNoLines = rest as typeof shipmentDraft;
        setupMocks([shipmentNoLines]);
        // getShipment returns the full shipment with lines
        vi.mocked(DolibarrService.getShipment).mockResolvedValue(shipmentDraft as any);

        renderList();

        await waitFor(() => screen.getByText('EXP-0001'));
        await user.click(screen.getByText('EXP-0001'));

        // getShipment is called to fetch detail with lines
        await waitFor(() => {
            expect(DolibarrService.getShipment).toHaveBeenCalledWith(
                expect.any(Object),
                '1'
            );
        });

        // Line label should appear
        await waitFor(() => {
            expect(screen.getByText('Produto A')).toBeInTheDocument();
            expect(screen.getByText('3 un.')).toBeInTheDocument();
        });
    });

    it('renders lines directly when shipment already has lines pre-loaded', async () => {
        const user = userEvent.setup();
        // Fixture WITH lines pre-loaded
        setupMocks([shipmentDraft]);

        renderList();

        await waitFor(() => screen.getByText('EXP-0001'));
        await user.click(screen.getByText('EXP-0001'));

        // Lines rendered from existing data, no getShipment call needed
        await waitFor(() => {
            expect(screen.getByText('Produto A')).toBeInTheDocument();
            expect(screen.getByText('3 un.')).toBeInTheDocument();
        });
    });

    it('shows empty state for lines when shipment has no lines', async () => {
        const user = userEvent.setup();
        const emptyLineShipment = { ...shipmentDraft, lines: [] };
        setupMocks([emptyLineShipment]);
        vi.mocked(DolibarrService.getShipment).mockResolvedValue(emptyLineShipment as any);

        renderList();

        await waitFor(() => screen.getByText('EXP-0001'));
        await user.click(screen.getByText('EXP-0001'));

        await waitFor(() => {
            expect(screen.getByText('Nenhum item encontrado para este envio.')).toBeInTheDocument();
        });
    });
});
