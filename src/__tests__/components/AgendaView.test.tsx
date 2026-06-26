import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
const mockCreateEvent = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockGetEventTypes = vi.hoisted(() =>
    vi.fn().mockResolvedValue([
        { code: 'AC_RDV', label: 'Reunião' },
        { code: 'AC_TEL', label: 'Chamada' },
    ])
);
vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createEvent: (...args: any[]) => mockCreateEvent(...args),
        getEventTypes: (...args: any[]) => mockGetEventTypes(...args),
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

// ---------------------------------------------------------------------------
// #546 — List mode layout: full-width, no half-screen placeholder
// ---------------------------------------------------------------------------
describe('AgendaView — #546: List mode full-width layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });
        vi.mocked(useEvents).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useTasks).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useInterventions).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useProjects).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: [] } as any);
    });

    const renderAgendaView = () => render(<AgendaView onNavigate={vi.fn()} />);

    it('renders full-width list container (data-testid=agenda-list-container) when no item selected', () => {
        renderAgendaView();
        expect(screen.getByTestId('agenda-list-container')).toBeInTheDocument();
    });

    it('full-width container has overflow-y-auto class for proper scrolling', () => {
        renderAgendaView();
        const container = screen.getByTestId('agenda-list-container');
        expect(container.className).toContain('overflow-y-auto');
    });

    it('placeholder "Selecione um item para ver detalhes" is NOT shown when no item is selected', () => {
        renderAgendaView();
        expect(screen.queryByText(/selecione um item para ver detalhes/i)).not.toBeInTheDocument();
    });

    it('list view toggle button renders in active state', () => {
        renderAgendaView();
        const listBtn = screen.getByTitle('Visualização em Lista');
        expect(listBtn).toBeInTheDocument();
    });

    it('switching to calendar hides the full-width list container', () => {
        renderAgendaView();
        fireEvent.click(screen.getByTitle('Visualização em Calendário'));
        expect(screen.queryByTestId('agenda-list-container')).not.toBeInTheDocument();
    });

    it('switching back to list restores the full-width list container', () => {
        renderAgendaView();
        fireEvent.click(screen.getByTitle('Visualização em Calendário'));
        fireEvent.click(screen.getByTitle('Visualização em Lista'));
        expect(screen.getByTestId('agenda-list-container')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// #550 — New event: types from Dolibarr, extra fields
// ---------------------------------------------------------------------------
describe('AgendaView — #550: New event modal with Dolibarr types', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });
        vi.mocked(useEvents).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useTasks).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useInterventions).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useProjects).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: [] } as any);
        mockGetEventTypes.mockResolvedValue([
            { code: 'AC_RDV', label: 'Reunião' },
            { code: 'AC_TEL', label: 'Chamada' },
        ]);
        mockCreateEvent.mockResolvedValue({});
    });

    const renderAgendaView = () => render(<AgendaView onNavigate={vi.fn()} />);

    it('renders the "Novo Evento" button', () => {
        renderAgendaView();
        expect(screen.getByTitle('Visualização em Lista')).toBeInTheDocument();
        // The "Novo Evento" button should exist
        const btn = screen.getAllByRole('button').find(b => b.textContent?.match(/novo/i));
        expect(btn).toBeTruthy();
    });

    it('populates type select with options from getEventTypes on modal open', async () => {
        renderAgendaView();
        const newBtn = screen.getAllByRole('button').find(b => b.textContent?.match(/novo/i));
        fireEvent.click(newBtn!);

        await waitFor(() => {
            expect(screen.getByTestId('event-type-select')).toBeInTheDocument();
        });

        await waitFor(() => {
            const select = screen.getByTestId('event-type-select') as HTMLSelectElement;
            const options = Array.from(select.options).map(o => o.text);
            expect(options).toContain('Reunião');
            expect(options).toContain('Chamada');
        });
    });

    it('falls back gracefully when getEventTypes rejects (modal still opens)', async () => {
        mockGetEventTypes.mockRejectedValueOnce(new Error('Network error'));
        renderAgendaView();
        const newBtn = screen.getAllByRole('button').find(b => b.textContent?.match(/novo/i));
        fireEvent.click(newBtn!);

        await waitFor(() => {
            expect(screen.getByTestId('event-type-select')).toBeInTheDocument();
        });

        // Form should still work even with fallback types
        const select = screen.getByTestId('event-type-select') as HTMLSelectElement;
        expect(select.options.length).toBeGreaterThan(0);
    });

    it('calls createEvent with type_code from select and extra fields', async () => {
        renderAgendaView();
        const newBtn = screen.getAllByRole('button').find(b => b.textContent?.match(/novo/i));
        fireEvent.click(newBtn!);

        await waitFor(() => expect(screen.getByTestId('event-type-select')).toBeInTheDocument());

        // Fill required fields
        const subjectInput = screen.getByPlaceholderText(/título da reunião/i);
        fireEvent.change(subjectInput, { target: { value: 'Kick-off' } });
        const startInput = screen.getByLabelText(/início/i);
        fireEvent.change(startInput, { target: { value: '2026-06-22T10:00' } });

        // Select type
        await waitFor(() => {
            const select = screen.getByTestId('event-type-select') as HTMLSelectElement;
            expect(Array.from(select.options).some(o => o.value === 'AC_TEL')).toBe(true);
        });
        fireEvent.change(screen.getByTestId('event-type-select'), { target: { value: 'AC_TEL' } });

        // Fill location
        fireEvent.change(screen.getByPlaceholderText(/endereço ou link/i), { target: { value: 'Sala A' } });

        // Click create — use the last matching button (modal footer) to avoid ambiguity with EmptyState button
        const createBtns = screen.getAllByRole('button', { name: /criar evento/i });
        fireEvent.click(createBtns[createBtns.length - 1]);

        await waitFor(() => {
            expect(mockCreateEvent).toHaveBeenCalledWith(
                expect.objectContaining({ apiUrl: 'http://test' }),
                expect.objectContaining({
                    label: 'Kick-off',
                    type_code: 'AC_TEL',
                    location: 'Sala A',
                })
            );
        });
    });

    it('includes fulldayevent=1 when checkbox is checked', async () => {
        renderAgendaView();
        const newBtn = screen.getAllByRole('button').find(b => b.textContent?.match(/novo/i));
        fireEvent.click(newBtn!);

        await waitFor(() => expect(screen.getByTestId('fulldayevent-checkbox')).toBeInTheDocument());

        fireEvent.change(screen.getByPlaceholderText(/título da reunião/i), { target: { value: 'Feriado' } });
        fireEvent.change(screen.getByLabelText(/início/i), { target: { value: '2026-06-22T00:00' } });
        fireEvent.click(screen.getByTestId('fulldayevent-checkbox'));

        // Click create — use the last matching button (modal footer)
        const createBtns = screen.getAllByRole('button', { name: /criar evento/i });
        fireEvent.click(createBtns[createBtns.length - 1]);

        await waitFor(() => {
            expect(mockCreateEvent).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ fulldayevent: 1 })
            );
        });
    });
});

// ---------------------------------------------------------------------------
// #825 — Chaves estáveis nas células do calendário (key=cell.dateStr)
// Cada célula do grid é keyada por cell.dateStr (ISO do dia), e os itens da
// célula por item.id. Garantir chaves estáveis evita que itens apareçam na
// célula errada após reordenar/filtrar/remover.
// ---------------------------------------------------------------------------
describe('AgendaView — #825: chaves estáveis nas células do calendário', () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const taskDay5 = {
        id: 'cal-5',
        ref: 'TSK-CAL-5',
        label: 'Tarefa Dia Cinco',
        project_id: '',
        progress: 0,
        date_start: new Date(year, month, 5, 9, 0, 0).getTime(),
    };
    const taskDay15 = {
        id: 'cal-15',
        ref: 'TSK-CAL-15',
        label: 'Tarefa Dia Quinze',
        project_id: '',
        progress: 0,
        date_start: new Date(year, month, 15, 9, 0, 0).getTime(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Largura >= 768 faz a view padrão ser 'calendar'
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
        vi.mocked(useEvents).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useTasks).mockReturnValue({ data: [taskDay5, taskDay15], isLoading: false } as any);
        vi.mocked(useInterventions).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useProjects).mockReturnValue({ data: [], isLoading: false } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: [] } as any);
    });

    const renderAgendaView = () => render(<AgendaView onNavigate={vi.fn()} />);

    it('renderiza cada tarefa na célula do seu dia (sem troca entre células)', () => {
        renderAgendaView();
        // Garante o modo calendário (já é o padrão em innerWidth >= 768)
        fireEvent.click(screen.getByTitle('Visualização em Calendário'));

        // O <span> com o número do dia é filho direto da célula (via Fragment).
        const cell5 = screen.getByText('5').parentElement!;
        const cell15 = screen.getByText('15').parentElement!;

        // Cada título aparece na célula do seu próprio dia...
        expect(within(cell5).getByText('Tarefa Dia Cinco')).toBeInTheDocument();
        expect(within(cell15).getByText('Tarefa Dia Quinze')).toBeInTheDocument();
        // ...e NÃO na célula do outro dia (sem troca de itens entre células).
        expect(within(cell5).queryByText('Tarefa Dia Quinze')).not.toBeInTheDocument();
        expect(within(cell15).queryByText('Tarefa Dia Cinco')).not.toBeInTheDocument();
    });
});
