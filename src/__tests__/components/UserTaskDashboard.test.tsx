import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';


// ── hoisted mocks ──────────────────────────────────────────────────────────
const mockRefetchTasks = vi.fn().mockResolvedValue(undefined);
const mockRefetchProjects = vi.fn().mockResolvedValue(undefined);
const mockRefetchContacts = vi.fn().mockResolvedValue(undefined);
const mockRefetchTimeLogs = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/dolibarr', () => ({
    useTasks: vi.fn(() => ({ data: [], refetch: mockRefetchTasks })),
    useProjects: vi.fn(() => ({ data: [], refetch: mockRefetchProjects })),
    useUsers: vi.fn(() => ({ data: [], refetch: vi.fn() })),
    useTaskContacts: vi.fn(() => ({ data: [], refetch: mockRefetchContacts })),
    useProjectContacts: vi.fn(() => ({ data: [], refetch: vi.fn() })),
    useTaskTimeLogs: vi.fn(() => ({ data: [], refetch: mockRefetchTimeLogs })),
}));

const mockCreateTask = vi.fn().mockResolvedValue({ id: 'new-task-123' });
const mockDeleteTask = vi.fn().mockResolvedValue({});

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createTask: (...args: any[]) => mockCreateTask(...args),
        deleteTask: (...args: any[]) => mockDeleteTask(...args),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test', apiKey: 'key' },
        currentUser: { id: 'user1', login: 'testuser', firstname: 'Test' },
    })),
}));

vi.mock('../../components/TaskDetail', () => ({
    default: ({ onDeleted }: { onDeleted?: () => void }) => (
        <div data-testid="task-detail">
            <button onClick={onDeleted}>Excluir (mock)</button>
        </div>
    ),
}));

vi.mock('../../components/Tasks/TaskTimeDialog', () => ({
    TaskTimeDialog: () => <div>TaskTimeDialog</div>,
}));
vi.mock('../../components/Tasks/TimeAnalysisDashboard', () => ({
    TimeAnalysisDashboard: () => <div>TimeAnalysis</div>,
}));
vi.mock('../../components/Tasks/TaskAssistantModal', () => ({
    TaskAssistantModal: () => <div>TaskAssistant</div>,
}));
vi.mock('../../components/Projects/modals/TaskModal', () => ({
    TaskModal: ({ isOpen, onClose, onSubmit, form, setForm, isSubmitting, isEditing }: any) => {
        if (!isOpen) return null;
        return (
            <div>
                <h3>{isEditing ? 'Editar Tarefa' : 'Nova Tarefa'}</h3>
                <form onSubmit={onSubmit}>
                    <label htmlFor="task-label">Título</label>
                    <input
                        id="task-label"
                        type="text"
                        value={form.label}
                        onChange={(e) => setForm({ ...form, label: e.target.value })}
                        required
                    />
                    <button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? 'Salvando...' : (isEditing ? 'Atualizar' : 'Criar')}
                    </button>
                    <button type="button" onClick={onClose}>Cancelar</button>
                </form>
            </div>
        );
    },
}));
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

// ── import after mocks ─────────────────────────────────────────────────────
import UserTaskDashboard from '../../components/Tasks/UserTaskDashboard';
import { useTasks, useProjects, useUsers, useTaskContacts, useProjectContacts, useTaskTimeLogs } from '../../hooks/dolibarr';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const mockOnNavigate = vi.fn();

describe('UserTaskDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset to empty data
        (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], refetch: mockRefetchTasks });
    });

    // ── Refresh ──────────────────────────────────────────────────────────
    describe('Botão Atualizar (refresh real)', () => {
        it('deve chamar refetch dos hooks ao clicar em Atualizar', async () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            const refreshBtn = screen.getByTitle('Atualizar');
            fireEvent.click(refreshBtn);

            await waitFor(() => {
                expect(mockRefetchTasks).toHaveBeenCalled();
            });
        });

        it('deve chamar refetch de múltiplos hooks ao atualizar', async () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            fireEvent.click(screen.getByTitle('Atualizar'));

            await waitFor(() => {
                expect(mockRefetchProjects).toHaveBeenCalled();
                expect(mockRefetchContacts).toHaveBeenCalled();
                expect(mockRefetchTimeLogs).toHaveBeenCalled();
            });
        });

        it('não deve ficar travado em spinner se refetch rejeitar', async () => {
            mockRefetchTasks.mockRejectedValueOnce(new Error('network error'));

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);
            fireEvent.click(screen.getByTitle('Atualizar'));

            await waitFor(() => {
                const btn = screen.getByTitle('Atualizar');
                expect(btn).not.toBeDisabled();
            });
        });
    });

    // ── Nova Tarefa ──────────────────────────────────────────────────────
    describe('Botão Nova Tarefa (criação)', () => {
        it('deve renderizar botão "Nova Tarefa" no header', () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);
            expect(screen.getByTitle('Nova Tarefa')).toBeInTheDocument();
        });

        it('deve abrir TaskModal ao clicar em Nova Tarefa', async () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            fireEvent.click(screen.getByTitle('Nova Tarefa'));

            await waitFor(() => {
                expect(screen.getByText('Nova Tarefa', { selector: 'h3' })).toBeInTheDocument();
            });
        });

        it('deve chamar createTask com o label correto ao submeter o form', async () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            // Open modal
            fireEvent.click(screen.getByTitle('Nova Tarefa'));

            await waitFor(() => {
                expect(screen.getByText('Nova Tarefa', { selector: 'h3' })).toBeInTheDocument();
            });

            // Fill title
            const titleInput = screen.getByRole('textbox', { name: /título/i });
            fireEvent.change(titleInput, { target: { value: 'Minha Nova Tarefa' } });

            // Submit
            fireEvent.click(screen.getByText('Criar'));

            await waitFor(() => {
                expect(mockCreateTask).toHaveBeenCalledWith(
                    expect.objectContaining({ apiUrl: 'http://test' }),
                    expect.objectContaining({ label: 'Minha Nova Tarefa' })
                );
            });
        });

        it('deve mostrar toast de sucesso e chamar refetch após criação', async () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            fireEvent.click(screen.getByTitle('Nova Tarefa'));
            await waitFor(() => screen.getByText('Nova Tarefa', { selector: 'h3' }));

            const titleInput = screen.getByRole('textbox', { name: /título/i });
            fireEvent.change(titleInput, { target: { value: 'Tarefa X' } });
            fireEvent.click(screen.getByText('Criar'));

            await waitFor(() => {
                expect(toast.success).toHaveBeenCalledWith('Tarefa criada com sucesso!');
                expect(mockRefetchTasks).toHaveBeenCalled();
            });
        });

        it('deve fechar o modal após criação bem-sucedida', async () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            fireEvent.click(screen.getByTitle('Nova Tarefa'));
            await waitFor(() => screen.getByText('Nova Tarefa', { selector: 'h3' }));

            const titleInput = screen.getByRole('textbox', { name: /título/i });
            fireEvent.change(titleInput, { target: { value: 'Tarefa Fechando' } });
            fireEvent.click(screen.getByText('Criar'));

            await waitFor(() => {
                expect(screen.queryByText('Nova Tarefa', { selector: 'h3' })).not.toBeInTheDocument();
            });
        });

        it('deve mostrar toast de erro quando createTask falhar', async () => {
            mockCreateTask.mockRejectedValueOnce(new Error('API down'));

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            fireEvent.click(screen.getByTitle('Nova Tarefa'));
            await waitFor(() => screen.getByText('Nova Tarefa', { selector: 'h3' }));

            const titleInput = screen.getByRole('textbox', { name: /título/i });
            fireEvent.change(titleInput, { target: { value: 'Tarefa Erro' } });
            fireEvent.click(screen.getByText('Criar'));

            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Erro ao criar tarefa'));
            });
        });
    });

    // ── Empty state ──────────────────────────────────────────────────────
    describe('Estado vazio', () => {
        it('deve exibir botão Nova Tarefa no header e no empty state', () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);
            // With empty tasks and 'open' filter, both header button and empty state button show
            const allBtns = screen.getAllByRole('button', { name: /nova tarefa/i });
            // At minimum the header button is present
            expect(allBtns.length).toBeGreaterThanOrEqual(1);
        });

        it('botão no empty state deve abrir o modal de criação', async () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);
            // With empty data, empty state shows a "Nova Tarefa" button
            const allBtns = screen.getAllByRole('button', { name: /nova tarefa/i });
            // Click the last one (empty state button)
            fireEvent.click(allBtns[allBtns.length - 1]);
            await waitFor(() => {
                expect(screen.getByText('Nova Tarefa', { selector: 'h3' })).toBeInTheDocument();
            });
        });
    });

    // ── Exclusão via TaskDetail ──────────────────────────────────────────
    describe('Exclusão de tarefa', () => {
        it('ao selecionar uma tarefa e chamar onDeleted, deve limpar seleção e refetch', async () => {
            const task = {
                id: '42',
                ref: 'TASK-42',
                label: 'Tarefa para excluir',
                project_id: '1',
                progress: 0,
                status: 0,
                fk_user_assign: 'user1',
            };
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ data: [task], refetch: mockRefetchTasks });

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            // Click on the task to select it
            const taskTitle = screen.getByText('Tarefa para excluir');
            fireEvent.click(taskTitle);

            // TaskDetail mock should appear
            await waitFor(() => {
                expect(screen.getByTestId('task-detail')).toBeInTheDocument();
            });

            // Trigger delete via mock callback
            fireEvent.click(screen.getByText('Excluir (mock)'));

            await waitFor(() => {
                expect(mockRefetchTasks).toHaveBeenCalled();
                // Task detail should be gone (selectedTaskId cleared)
                expect(screen.queryByTestId('task-detail')).not.toBeInTheDocument();
            });
        });
    });

    // ── #829 — Estado de erro ───────────────────────────────────────────
    describe('#829: Estado de erro (ErrorState)', () => {
        const setError = (hook: ReturnType<typeof vi.fn>) => {
            (hook as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isError: true, refetch: vi.fn() });
        };

        beforeEach(() => {
            vi.clearAllMocks();
            // Reset todos os hooks tratados para estado "sem erro / sem dados".
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, refetch: mockRefetchTasks });
            (useProjects as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, refetch: mockRefetchProjects });
            (useUsers as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, refetch: vi.fn() });
            (useTaskContacts as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, refetch: mockRefetchContacts });
        });

        it('exibe ErrorState quando useTasks falha', () => {
            setError(useTasks as ReturnType<typeof vi.fn>);

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByTestId('user-tasks-error')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
        });

        it('exibe ErrorState quando useProjects falha', () => {
            setError(useProjects as ReturnType<typeof vi.fn>);

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByTestId('user-tasks-error')).toBeInTheDocument();
        });

        it('exibe ErrorState quando useUsers falha', () => {
            setError(useUsers as ReturnType<typeof vi.fn>);

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByTestId('user-tasks-error')).toBeInTheDocument();
        });

        it('exibe ErrorState quando useTaskContacts falha', () => {
            setError(useTaskContacts as ReturnType<typeof vi.fn>);

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByTestId('user-tasks-error')).toBeInTheDocument();
        });

        it('o retry dispara refetch de useTasks, useProjects, useUsers e useTaskContacts', async () => {
            const refetchUsers = vi.fn().mockResolvedValue(undefined);
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isError: true, refetch: mockRefetchTasks });
            (useProjects as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, refetch: mockRefetchProjects });
            (useUsers as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, refetch: refetchUsers });
            (useTaskContacts as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, refetch: mockRefetchContacts });

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));

            await waitFor(() => {
                expect(mockRefetchTasks).toHaveBeenCalled();
                expect(mockRefetchProjects).toHaveBeenCalled();
                expect(refetchUsers).toHaveBeenCalled();
                expect(mockRefetchContacts).toHaveBeenCalled();
            });
        });

        it('sem erro e sem dados → mantém estado vazio legítimo (não ErrorState)', () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.queryByTestId('user-tasks-error')).not.toBeInTheDocument();
        });
    });

    // ── #858 — Mensagem real do erro (desestruturação de `error`) ─────────
    describe('#858: mensagem de erro derivada do hook (error)', () => {
        const setErrorWithValue = (
            hook: ReturnType<typeof vi.fn>,
            error: unknown,
        ) => {
            (hook as ReturnType<typeof vi.fn>).mockReturnValue({
                data: undefined,
                isError: true,
                error,
                refetch: vi.fn(),
            });
        };

        beforeEach(() => {
            vi.clearAllMocks();
            // Reset todos os hooks tratados para estado "sem erro / sem dados".
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, error: undefined, refetch: mockRefetchTasks });
            (useProjects as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, error: undefined, refetch: mockRefetchProjects });
            (useUsers as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, error: undefined, refetch: vi.fn() });
            (useTaskContacts as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isError: false, error: undefined, refetch: mockRefetchContacts });
        });

        it('exibe a message do Error retornado por useTasks no ErrorState', () => {
            setErrorWithValue(useTasks as ReturnType<typeof vi.fn>, new Error('Falha de rede ao buscar tarefas'));

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByTestId('user-tasks-error')).toBeInTheDocument();
            expect(screen.getByText('Falha de rede ao buscar tarefas')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
        });

        it('exibe a message do Error retornado por useProjects no ErrorState', () => {
            setErrorWithValue(useProjects as ReturnType<typeof vi.fn>, new Error('Projetos indisponíveis'));

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByText('Projetos indisponíveis')).toBeInTheDocument();
        });

        it('exibe a message do Error retornado por useUsers no ErrorState', () => {
            setErrorWithValue(useUsers as ReturnType<typeof vi.fn>, new Error('Usuários indisponíveis'));

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByText('Usuários indisponíveis')).toBeInTheDocument();
        });

        it('exibe a message do Error retornado por useTaskContacts no ErrorState', () => {
            setErrorWithValue(useTaskContacts as ReturnType<typeof vi.fn>, new Error('Contatos indisponíveis'));

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByText('Contatos indisponíveis')).toBeInTheDocument();
        });

        it('converte um erro não-Error para string no ErrorState', () => {
            setErrorWithValue(useTasks as ReturnType<typeof vi.fn>, 'string-error-503');

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByText('string-error-503')).toBeInTheDocument();
        });

        it('usa a mensagem padrão quando isError é true mas error é indefinido', () => {
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({
                data: undefined,
                isError: true,
                error: undefined,
                refetch: mockRefetchTasks,
            });

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByTestId('user-tasks-error')).toBeInTheDocument();
            expect(screen.getByText(/não foi possível carregar suas tarefas/i)).toBeInTheDocument();
        });

        it('prioriza o primeiro erro disponível (tasks antes de projects)', () => {
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({
                data: undefined,
                isError: true,
                error: new Error('ERRO_TAREFAS'),
                refetch: mockRefetchTasks,
            });
            (useProjects as ReturnType<typeof vi.fn>).mockReturnValue({
                data: [],
                isError: true,
                error: new Error('ERRO_PROJETOS'),
                refetch: mockRefetchProjects,
            });

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByText('ERRO_TAREFAS')).toBeInTheDocument();
            expect(screen.queryByText('ERRO_PROJETOS')).not.toBeInTheDocument();
        });
    });

    // ── #1099 — Classes Tailwind literais nos filtros Me-mode ──────────
    describe('#1099: filtros Me-mode com classes Tailwind literais (sem interpolação)', () => {
        const openMeFilterModal = () => {
            // viewMode default = 'me'; abre o modal de filtros pelo toggle mobile.
            fireEvent.click(screen.getByText('Filtros'));
        };

        const getFilterButton = (label: string) =>
            screen.getByText(label).closest('button') as HTMLButtonElement;

        const getCircle = (btn: HTMLElement) =>
            btn.querySelector('.w-6') as HTMLElement | null;

        it('aplica classes literais azuis no filtro "Atribuído diretamente" ativo', () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);
            openMeFilterModal();

            const btn = getFilterButton('Atribuído diretamente');
            expect(btn.className).toContain('bg-blue-50');
            expect(btn.className).toContain('border-blue-200');
            expect(btn.className).toContain('text-blue-700');
            expect(btn.className).toContain('dark:bg-blue-900/20');
            const circle = getCircle(btn);
            expect(circle?.className).toContain('bg-blue-500');
        });

        it('aplica classes literais âmbar no filtro "Membro da Equipe do Projeto" ativo', () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);
            openMeFilterModal();

            const btn = getFilterButton('Membro da Equipe do Projeto');
            expect(btn.className).toContain('bg-amber-50');
            expect(btn.className).toContain('border-amber-200');
            expect(btn.className).toContain('text-amber-700');
            expect(btn.className).toContain('dark:border-amber-800');
            const circle = getCircle(btn);
            expect(circle?.className).toContain('bg-amber-500');
        });

        it('aplica classes literais roxas no filtro "Participante convidado" ativo', () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);
            openMeFilterModal();

            const btn = getFilterButton('Participante convidado');
            expect(btn.className).toContain('bg-purple-50');
            expect(btn.className).toContain('border-purple-200');
            expect(btn.className).toContain('text-purple-700');
            expect(btn.className).toContain('ring-purple-200');
            const circle = getCircle(btn);
            expect(circle?.className).toContain('bg-purple-500');
        });

        it('não renderiza classes interpoladas (sem "${" nem "undefined")', () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);
            openMeFilterModal();

            const btn = getFilterButton('Atribuído diretamente');
            expect(btn.className).not.toContain('${');
            expect(btn.className).not.toContain('undefined');
            const circle = getCircle(btn);
            expect(circle?.className).not.toContain('${');
            expect(circle?.className).not.toContain('undefined');
        });

        it('ao desativar o filtro, troca para classes neutras (sem cor de tema)', () => {
            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);
            openMeFilterModal();

            const btn = getFilterButton('Atribuído diretamente');
            expect(btn.className).toContain('bg-blue-50');

            fireEvent.click(btn);

            expect(btn.className).not.toContain('bg-blue-50');
            expect(btn.className).not.toContain('text-blue-700');
            expect(btn.className).toContain('bg-white');
            const circle = getCircle(btn);
            expect(circle?.className).not.toContain('bg-blue-500');
            expect(circle?.className).toContain('border-2');
        });
    });

    // ── #1083 — unidade de data do prazo (ms x segundos) ─────────────────
    describe('#1083: prazo da tarefa — data correta e status de atraso (ms)', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
            // Limpa TODOS os hooks de dados (isError/error persistem entre suites
            // pois vi.clearAllMocks() não remove implementações de mockReturnValue).
            const clean = { data: [], isError: false, error: undefined, refetch: vi.fn() };
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ ...clean, refetch: mockRefetchTasks });
            (useProjects as ReturnType<typeof vi.fn>).mockReturnValue(clean);
            (useUsers as ReturnType<typeof vi.fn>).mockReturnValue(clean);
            (useTaskContacts as ReturnType<typeof vi.fn>).mockReturnValue(clean);
            (useProjectContacts as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], refetch: vi.fn() });
            (useTaskTimeLogs as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], refetch: vi.fn() });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        const makeTask = (over: Record<string, unknown> = {}) => ({
            id: 't1',
            ref: 'TK-1',
            label: 'Tarefa com prazo',
            project_id: '1',
            progress: 0,
            status: 0,
            fk_user_assign: 'user1',
            ...over,
        });

        it('exibe a data correta do prazo (ms, sem multiplicar por 1000)', () => {
            const dueMs = new Date('2024-06-20T12:00:00Z').getTime();
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ data: [makeTask({ date_end: dueMs })], refetch: mockRefetchTasks });

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            // Antes do fix: new Date(dueMs * 1000) => ano ~50.000 (texto diferente)
            const expected = format(new Date(dueMs), "d 'de' MMM", { locale: ptBR });
            expect(screen.getByText(expected)).toBeInTheDocument();
        });

        it('marca como atrasado (vermelho) quando date_end (ms) já passou', () => {
            const pastMs = new Date('2024-06-10T12:00:00Z').getTime(); // antes de "agora" (06-15)
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ data: [makeTask({ id: 't2', date_end: pastMs })], refetch: mockRefetchTasks });

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            const expected = format(new Date(pastMs), "d 'de' MMM", { locale: ptBR });
            const dateEl = screen.getByText(expected);
            // A classe de atraso é aplicada no container do prazo (ancestral do span)
            expect(dateEl.closest('[class*="text-red-600"]')).toBeTruthy();
        });

        it('marca como "vencendo breve" (laranja) quando o prazo está a 1 dia', () => {
            const soonMs = new Date('2024-06-16T12:00:00Z').getTime(); // +1 dia (< 2 dias)
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ data: [makeTask({ id: 't3', date_end: soonMs })], refetch: mockRefetchTasks });

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            const expected = format(new Date(soonMs), "d 'de' MMM", { locale: ptBR });
            const dateEl = screen.getByText(expected);
            expect(dateEl.closest('[class*="text-orange-600"]')).toBeTruthy();
        });

        it('não marca como atrasado quando o prazo está distante no futuro', () => {
            const futureMs = new Date('2024-07-20T12:00:00Z').getTime(); // > 2 dias
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({ data: [makeTask({ id: 't4', date_end: futureMs })], refetch: mockRefetchTasks });

            const { container } = render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            // O span do prazo existe e NÃO carrega classe de atraso
            const expected = format(new Date(futureMs), "d 'de' MMM", { locale: ptBR });
            const dateEl = screen.getByText(expected);
            expect(dateEl.closest('[class*="text-red-600"]')).toBeNull();
            expect(dateEl.closest('[class*="text-orange-600"]')).toBeNull();
            // sanity: o container segue renderizado
            expect(container).toBeTruthy();
        });
    });
});
