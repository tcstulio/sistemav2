import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgendaView from '../../components/AgendaView';

// --- Mock sonner ---
const mockToast = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: mockToast }));

// --- Mock DolibarrContext ---
vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test', apiKey: 'key', currentUser: { id: '1' } },
        refreshData: vi.fn(),
    })),
}));

// --- Mock hooks/dolibarr ---
vi.mock('../../hooks/dolibarr', () => ({
    useEvents: vi.fn(() => ({ data: [], isLoading: false })),
    useTasks: vi.fn(() => ({ data: [], isLoading: false })),
    useInterventions: vi.fn(() => ({ data: [], isLoading: false })),
    useProjects: vi.fn(() => ({ data: [], isLoading: false })),
    useCustomers: vi.fn(() => ({ data: [] })),
}));

// --- Mock usePrefill ---
vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

// --- Mock DolibarrService ---
vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createEvent: vi.fn(),
    },
}));

// --- Mock AgendaEntryDetail (complex child; not the SUT) ---
vi.mock('../../components/AgendaEntryDetail', () => ({
    default: () => <div data-testid="agenda-entry-detail" />,
}));

// --- Mock MasterDetailLayout to simply render list ---
vi.mock('../../components/ui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../components/ui')>();
    return {
        ...actual,
        MasterDetailLayout: ({ list }: { list: React.ReactNode; detail?: React.ReactNode }) => (
            <div data-testid="master-detail">{list}</div>
        ),
    };
});

// Re-import mocked hooks so we can override their return values per test
const { useEvents, useTasks, useInterventions, useProjects, useCustomers } =
    await import('../../hooks/dolibarr');

// ---------------------------------------------------------------------------
// Shared data fixtures
// ---------------------------------------------------------------------------

const PROJECT_ALFA = { id: '7', ref: 'PROJ-7', title: 'Projeto Alfa', socid: '1', statut: '1' as const, progress: 50 };
const PROJECT_BETA = { id: '8', ref: 'PROJ-8', title: 'Projeto Beta', socid: '2', statut: '1' as const, progress: 0 };
const CUSTOMER_ACME = { id: '42', name: 'ACME Ltda', status: '1' as const, client: '1', fournisseur: '0' };

// Timestamps in the future so items appear in the visible window
const FUTURE_TS = Date.now() + 86_400_000; // +1 day (ms)

const TASK_WITH_PROJECT = {
    id: 't1',
    ref: 'TASK-001',
    label: 'Implementar feature X',
    project_id: '7',
    progress: 0,
    date_start: FUTURE_TS,
};

const TASK_UNKNOWN_PROJECT = {
    id: 't2',
    ref: 'TASK-002',
    label: 'Tarefa sem projeto',
    project_id: '999', // not in mock projects list
    progress: 0,
    date_start: FUTURE_TS + 3_600_000,
};

const EVENT_WITH_PROJECT_AND_CUSTOMER = {
    id: 'e1',
    ref: 'EV-001',
    label: 'Reunião de kickoff',
    date_start: FUTURE_TS + 7_200_000,
    date_end: FUTURE_TS + 10_800_000,
    type_code: 'AC_RDV',
    percentage: 0,
    project_id: '8',
    socid: '42',
};

const INTERVENTION_WITH_PROJECT = {
    id: 'i1',
    ref: 'INT-001',
    socid: '1',
    project_id: '7',
    date: FUTURE_TS + 14_400_000,
    date_creation: FUTURE_TS,
    statut: '0' as const,
};

// ---------------------------------------------------------------------------

describe('AgendaView — exibição de projeto/cliente nos itens (#600)', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Force list view: AgendaView defaults to 'list' when innerWidth < 768.
        // JSDOM defaults to 1024; override so the list DOM is rendered in tests.
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });

        // Default: empty data
        vi.mocked(useEvents).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useTasks).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useInterventions).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useProjects).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: [] } as any);
    });

    const renderAgendaView = () =>
        render(<AgendaView onNavigate={vi.fn()} />);

    // -------------------------------------------------------------------------
    // Tarefa com projeto resolvido
    // -------------------------------------------------------------------------
    it('task card shows resolved project name, not raw ID', () => {
        vi.mocked(useTasks).mockReturnValue({ data: [TASK_WITH_PROJECT], isLoading: false } as any);
        vi.mocked(useProjects).mockReturnValue({ data: [PROJECT_ALFA], isLoading: false } as any);

        renderAgendaView();

        // The project name should be visible
        expect(screen.getByText('Projeto Alfa')).toBeInTheDocument();

        // The raw "Projeto 7" format must NOT appear
        expect(screen.queryByText('Projeto 7')).not.toBeInTheDocument();
        expect(screen.queryByText(/^Projeto \d+$/)).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------------
    // Evento com projeto e cliente
    // -------------------------------------------------------------------------
    it('event card shows project and customer name', () => {
        vi.mocked(useEvents).mockReturnValue({ data: [EVENT_WITH_PROJECT_AND_CUSTOMER], isLoading: false } as any);
        vi.mocked(useProjects).mockReturnValue({ data: [PROJECT_BETA], isLoading: false } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: [CUSTOMER_ACME] } as any);

        renderAgendaView();

        // Both project and customer must appear in the parentRef chip
        const chip = screen.getByTitle(/Projeto Beta/);
        expect(chip).toBeInTheDocument();
        expect(chip.textContent).toContain('ACME Ltda');
    });

    // -------------------------------------------------------------------------
    // Fallback: project_id desconhecido não renderiza "undefined"
    // -------------------------------------------------------------------------
    it('task with unknown project_id does not render "undefined" or "Projeto undefined"', () => {
        vi.mocked(useTasks).mockReturnValue({ data: [TASK_UNKNOWN_PROJECT], isLoading: false } as any);
        vi.mocked(useProjects).mockReturnValue({ data: [PROJECT_ALFA], isLoading: false } as any);

        renderAgendaView();

        // The task should be rendered but without exposing raw ID or "undefined"
        expect(screen.getByText('Tarefa sem projeto')).toBeInTheDocument();
        expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
        expect(screen.queryByText('Projeto 999')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------------
    // Intervenção com projeto resolvido
    // -------------------------------------------------------------------------
    it('intervention card shows resolved project name', () => {
        vi.mocked(useInterventions).mockReturnValue({ data: [INTERVENTION_WITH_PROJECT], isLoading: false } as any);
        vi.mocked(useProjects).mockReturnValue({ data: [PROJECT_ALFA], isLoading: false } as any);

        renderAgendaView();

        // The intervention row should show the project name chip
        expect(screen.getByText('Projeto Alfa')).toBeInTheDocument();
        expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
    });
});
