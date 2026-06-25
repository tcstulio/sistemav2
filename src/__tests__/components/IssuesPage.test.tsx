import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ currentUser: { admin: 1 } }),
}));

vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/githubService', () => ({
    GithubService: {
        getIssues: vi.fn().mockResolvedValue([]),
        getStats: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../services/taskService', () => ({
    TaskService: {
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../components/TasksBoard/DiffViewer', () => ({
    default: () => null,
}));

vi.mock('../../components/TasksBoard/TaskConsole', () => ({
    default: () => null,
}));

import { toast } from 'sonner';
import { GithubService } from '../../services/githubService';
import { TaskService, Task } from '../../services/taskService';
import IssuesPage from '../../components/Issues/IssuesPage';

const mockGithubService = GithubService as unknown as {
    getIssues: ReturnType<typeof vi.fn>;
    getStats: ReturnType<typeof vi.fn>;
};
const mockTaskService = TaskService as unknown as {
    list: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
};

const makeTask = (overrides: Partial<Task> = {}): Task => ({
    issueNumber: 123,
    title: 'Task de teste',
    body: 'descrição',
    labels: ['opencode-task'],
    status: 'pending',
    feedbackHistory: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
});

const goToTasksTab = async () => {
    // A aba padrão é "issues"; clica na aba "Tasks".
    await userEvent.click(screen.getByRole('button', { name: /^Tasks\s*\(/ }));
    // Aguarda a task aparecer no board (pipeline view).
    await waitFor(() => screen.getByText('Task de teste'));
};

const openDeleteModal = async (issueNumber = 123) => {
    await userEvent.click(screen.getByRole('button', { name: `Excluir task #${issueNumber}` }));
    await waitFor(() => screen.getByText(new RegExp(`Deletar Task #${issueNumber}`)));
};

beforeEach(() => {
    vi.clearAllMocks();
    mockGithubService.getIssues.mockResolvedValue([]);
    mockGithubService.getStats.mockResolvedValue(null);
    mockTaskService.list.mockResolvedValue([makeTask()]);
    mockTaskService.delete.mockResolvedValue(undefined);
});

describe('IssuesPage - exclusão de task (#830)', () => {
    it('deleta a task com sucesso, fecha o modal e recarrega a lista', async () => {
        render(<IssuesPage />);

        await goToTasksTab();
        await openDeleteModal();

        await userEvent.click(screen.getByRole('button', { name: 'Deletar' }));

        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deletada'));
        // Modal fecha (não fica preso)
        await waitFor(() =>
            expect(screen.queryByText(/Deletar Task #123/)).toBeNull()
        );
        // Lista recarregada: TaskService.list chamado novamente após o delete.
        expect(mockTaskService.delete).toHaveBeenCalledWith(123);
        expect(mockTaskService.list).toHaveBeenCalled();
    });

    it('em caso de erro mostra toast de erro e não deixa o modal preso', async () => {
        mockTaskService.delete.mockRejectedValue({
            response: { data: { error: 'Não permitido' } },
        });

        render(<IssuesPage />);

        await goToTasksTab();
        await openDeleteModal();

        const deleteBtn = screen.getByRole('button', { name: 'Deletar' });
        await userEvent.click(deleteBtn);

        // Toast de erro exibido com a mensagem vinda da API.
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Não permitido'));
        // Modal fecha mesmo falhando → estado não fica preso.
        await waitFor(() =>
            expect(screen.queryByText(/Deletar Task #123/)).toBeNull()
        );
    });

    it('desabilita o botão de deletar durante a operação (sem duplo-clique)', async () => {
        let resolveDelete!: () => void;
        mockTaskService.delete.mockReturnValue(
            new Promise<void>((r) => { resolveDelete = r; })
        );

        render(<IssuesPage />);

        await goToTasksTab();
        await openDeleteModal();

        await userEvent.click(screen.getByRole('button', { name: 'Deletar' }));

        // Durante a operação: botão vira "Deletando..." e fica desabilitado,
        // assim como o "Cancelar".
        const deletingBtn = await waitFor(() =>
            screen.getByRole('button', { name: /Deletando/i })
        );
        expect(deletingBtn).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();

        // Conclui a operação.
        resolveDelete();
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deletada'));
        // Modal fecha ao finalizar.
        await waitFor(() =>
            expect(screen.queryByText(/Deletar Task #123/)).toBeNull()
        );
    });
});
