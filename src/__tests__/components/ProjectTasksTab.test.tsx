import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectTasksTab } from '../../components/Projects/tabs/ProjectTasksTab';
import { Task } from '../../types/projects';

describe('ProjectTasksTab', () => {
    const mockOnNavigate = vi.fn();
    const mockOnCreateTask = vi.fn();
    const mockOnEditTask = vi.fn();
    const mockOnDeleteTask = vi.fn();
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