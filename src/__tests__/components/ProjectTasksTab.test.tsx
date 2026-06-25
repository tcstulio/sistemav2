import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTasksTab } from '../../components/Projects/tabs/ProjectTasksTab';
import type { Task } from '../../types/projects';

// ConfirmDeleteButton (usado no fluxo de exclusão) dispara toasts via sonner.
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// --- Cobertura base de render/props/navegação (restaurada do original; #854 a havia removido) ---
describe('ProjectTasksTab — render & props base', () => {
    const mockOnNavigate = vi.fn();
    const mockOnCreateTask = vi.fn();
    const mockOnEditTask = vi.fn();
    const mockOnDeleteTask = vi.fn().mockResolvedValue(undefined);
    const mockOnOpenWizard = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockTask = (id: string, overrides: Partial<Task> = {}): Task => ({
        id,
        ref: `TASK-${id}`,
        label: `Task ${id}`,
        project_id: '1',
        progress: 0,
        planned_workload: 3600,
        duration_effective: 0,
        ...overrides
    });

    it('renders empty state when no tasks', () => {
        render(
            <ProjectTasksTab
                tasks={[]}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        expect(screen.getByText('Nenhuma tarefa encontrada.')).toBeInTheDocument();
    });

    it('renders task label and ref', () => {
        const tasks = [createMockTask('1', { label: 'Bug no sistema' })];
        render(
            <ProjectTasksTab
                tasks={tasks}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        expect(screen.getByText('Bug no sistema')).toBeInTheDocument();
        expect(screen.getByText(/TASK-1/)).toBeInTheDocument();
    });

    it('renders multiple tasks', () => {
        const tasks = [
            createMockTask('1', { label: 'Task 1' }),
            createMockTask('2', { label: 'Task 2' })
        ];
        render(
            <ProjectTasksTab
                tasks={tasks}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        expect(screen.getByText('Task 1')).toBeInTheDocument();
        expect(screen.getByText('Task 2')).toBeInTheDocument();
    });

    it('renders progress percentage', () => {
        const tasks = [createMockTask('1', { progress: 75 })];
        render(
            <ProjectTasksTab
                tasks={tasks}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        expect(screen.getByText(/75%/)).toBeInTheDocument();
    });

    it('renders workload hours', () => {
        const tasks = [createMockTask('1', { planned_workload: 7200, duration_effective: 3600 })];
        render(
            <ProjectTasksTab
                tasks={tasks}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        expect(screen.getByText(/Planejado: 2h/)).toBeInTheDocument();
        expect(screen.getByText(/Gasto: 1h/)).toBeInTheDocument();
    });

    it('calls onCreateTask when clicking Nova Tarefa', () => {
        render(
            <ProjectTasksTab
                tasks={[]}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        fireEvent.click(screen.getByText('Nova Tarefa'));
        expect(mockOnCreateTask).toHaveBeenCalled();
    });

    it('calls onOpenWizard when clicking Wizard', () => {
        render(
            <ProjectTasksTab
                tasks={[]}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        fireEvent.click(screen.getByText('Wizard'));
        expect(mockOnOpenWizard).toHaveBeenCalled();
    });

    it('calls onNavigate when clicking task', () => {
        const tasks = [createMockTask('1')];
        render(
            <ProjectTasksTab
                tasks={tasks}
                onNavigate={mockOnNavigate}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        fireEvent.click(screen.getByText('Task 1'));
        expect(mockOnNavigate).toHaveBeenCalledWith('tasks', '1');
    });

    it('renders header Tarefas do Projeto', () => {
        render(
            <ProjectTasksTab
                tasks={[]}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        expect(screen.getByText('Tarefas do Projeto')).toBeInTheDocument();
    });

    it('does not call onNavigate when onNavigate is not provided', () => {
        const tasks = [createMockTask('1')];
        render(
            <ProjectTasksTab
                tasks={tasks}
                onCreateTask={mockOnCreateTask}
                onEditTask={mockOnEditTask}
                onDeleteTask={mockOnDeleteTask}
                onOpenWizard={mockOnOpenWizard}
            />
        );
        fireEvent.click(screen.getByText('Task 1'));
        expect(mockOnNavigate).not.toHaveBeenCalled();
    });
});

// --- Fluxo de confirmação de exclusão (#854) ---
describe('ProjectTasksTab — confirmação ao excluir tarefa (#854)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const makeTask = (overrides: Partial<Task> = {}): Task => ({
        id: 'task-1',
        ref: 'TK001',
        label: 'Minha Tarefa',
        project_id: 'p1',
        progress: 50,
        planned_workload: 3600,
        duration_effective: 1800,
        ...overrides,
    });

    it('abre modal de confirmação ao clicar em excluir (sem excluir imediatamente)', async () => {
        const onDeleteTask = vi.fn().mockResolvedValue(undefined);
        const user = userEvent.setup();
        render(
            <ProjectTasksTab
                tasks={[makeTask()]}
                onCreateTask={vi.fn()}
                onEditTask={vi.fn()}
                onDeleteTask={onDeleteTask}
                onOpenWizard={vi.fn()}
                refreshData={vi.fn()}
            />
        );

        await user.click(screen.getByLabelText('Excluir'));

        expect(await screen.findByRole('dialog')).toBeTruthy();
        expect(onDeleteTask).not.toHaveBeenCalled();
    });

    it('cancela a exclusão sem efeito colateral', async () => {
        const onDeleteTask = vi.fn().mockResolvedValue(undefined);
        const refreshData = vi.fn();
        const user = userEvent.setup();
        render(
            <ProjectTasksTab
                tasks={[makeTask()]}
                onCreateTask={vi.fn()}
                onEditTask={vi.fn()}
                onDeleteTask={onDeleteTask}
                onOpenWizard={vi.fn()}
                refreshData={refreshData}
            />
        );

        await user.click(screen.getByLabelText('Excluir'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(onDeleteTask).not.toHaveBeenCalled();
        expect(refreshData).not.toHaveBeenCalled();
    });

    it('exclui a tarefa e atualiza a lista ao confirmar', async () => {
        const onDeleteTask = vi.fn().mockResolvedValue(undefined);
        const refreshData = vi.fn();
        const user = userEvent.setup();
        render(
            <ProjectTasksTab
                tasks={[makeTask({ id: 'task-9', ref: 'TK009' })]}
                onCreateTask={vi.fn()}
                onEditTask={vi.fn()}
                onDeleteTask={onDeleteTask}
                onOpenWizard={vi.fn()}
                refreshData={refreshData}
            />
        );

        await user.click(screen.getByLabelText('Excluir'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Excluir' }));

        await vi.waitFor(() => expect(onDeleteTask).toHaveBeenCalledTimes(1));
        expect(onDeleteTask).toHaveBeenCalledWith('task-9');
        expect(refreshData).toHaveBeenCalledTimes(1);
    });
});
