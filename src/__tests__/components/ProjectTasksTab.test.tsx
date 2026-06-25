import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTasksTab } from '../../components/Projects/tabs/ProjectTasksTab';
import type { Task } from '../../types/projects';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

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

describe('ProjectTasksTab — confirmação ao excluir tarefa (#854)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
