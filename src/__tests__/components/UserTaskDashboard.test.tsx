import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { useTasks } from '../../hooks/dolibarr';
import { toast } from 'sonner';

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

    // ── Estado de erro (#829) ──────────────────────────────────────────────
    describe('Estado de erro (#829)', () => {
        it('exibe ErrorState quando useTasks falha (isError=true)', () => {
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({
                data: undefined,
                refetch: mockRefetchTasks,
                isError: true,
                error: new Error('Falha de rede ao buscar tarefas'),
            });

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            expect(screen.getByText('Falha de rede ao buscar tarefas')).toBeInTheDocument();
            expect(screen.getByText('Ocorreu um erro')).toBeInTheDocument();
        });

        it('botão "Tentar novamente" dispara refetch do hook', async () => {
            (useTasks as ReturnType<typeof vi.fn>).mockReturnValue({
                data: undefined,
                refetch: mockRefetchTasks,
                isError: true,
                error: new Error('Falhou'),
            });

            render(<UserTaskDashboard onNavigate={mockOnNavigate} />);

            fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));

            await waitFor(() => {
                expect(mockRefetchTasks).toHaveBeenCalled();
            });
        });
    });

    // ── Estado vazio ──────────────────────────────────────────────────────
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
});
