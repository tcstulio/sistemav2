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

// #1178: agrupamento épica→subtasks com progresso agregado.
describe('IssuesPage - agrupamento épica/subtasks (#1178)', () => {
    const epicTask = (): Task => makeTask({
        issueNumber: 100,
        title: 'Épica de pagamentos',
        kind: 'epic',
        subTasks: [1, 2, 3],
        status: 'pending',
    });
    const subMerged = (): Task => makeTask({
        issueNumber: 1, title: 'Subtask merged', status: 'merged',
        parentEpic: 100, completedAt: new Date().toISOString(),
    });
    const subRunning = (): Task => makeTask({
        issueNumber: 2, title: 'Subtask rodando', status: 'running', parentEpic: 100,
    });
    const subPending = (): Task => makeTask({
        issueNumber: 3, title: 'Subtask na fila', status: 'pending', parentEpic: 100,
    });

    const goToTasks = async () => {
        await userEvent.click(screen.getByRole('button', { name: /^Tasks\s*\(/ }));
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGithubService.getIssues.mockResolvedValue([]);
        mockGithubService.getStats.mockResolvedValue(null);
        mockTaskService.delete.mockResolvedValue(undefined);
    });

    it('visão kanban: épica mostra barra de progresso agregado e badge', async () => {
        mockTaskService.list.mockResolvedValue([epicTask(), subMerged(), subRunning(), subPending()]);

        render(<IssuesPage />);
        await goToTasks();

        // A épica aparece como mini-card na coluna "Fila" com badge + barra de progresso.
        await waitFor(() => expect(screen.getByTestId('epic-card-100')).toBeInTheDocument());
        expect(screen.getByTestId('epic-badge-100')).toHaveTextContent('Épica');
        // Progresso agregado: 1 de 3 merged (33%).
        expect(screen.getByTestId('epic-progress-100')).toBeInTheDocument();
    });

    it('visão kanban: subtask mostra chip "↳ #100" clicável que rola/destaca a épica', async () => {
        mockTaskService.list.mockResolvedValue([epicTask(), subMerged(), subRunning(), subPending()]);

        const scrollSpy = vi.fn();
        const fakeEl = { scrollIntoView: scrollSpy } as unknown as HTMLElement;
        const getByIdSpy = vi.spyOn(document, 'getElementById').mockReturnValue(fakeEl);

        render(<IssuesPage />);
        await goToTasks();

        // Subtask running (#2) carrega o chip de referência à épica (sempre visível na aba "Ativas").
        const chip = await waitFor(() => screen.getByTestId('task-epic-link-2'));
        expect(chip).toHaveTextContent('↳ #100');

        await userEvent.click(chip);

        // Clicar rola até o card da épica (id epic-card-100).
        expect(getByIdSpy).toHaveBeenCalledWith('epic-card-100');
        expect(scrollSpy).toHaveBeenCalled();
        // E aplica o destaque (anel) na épica.
        expect(screen.getByTestId('epic-card-100').className).toContain('ring-indigo-400');

        getByIdSpy.mockRestore();
    });

    it('visão lista: épica é seção expansível com subtasks (status) ao expandir', async () => {
        mockTaskService.list.mockResolvedValue([epicTask(), subMerged(), subRunning(), subPending()]);

        render(<IssuesPage />);
        await goToTasks();

        // Troca para a visão de lista (toggle com title="Lista").
        await userEvent.click(screen.getByTitle('Lista'));

        // Épica renderizada como EpicListCard com progresso agregado correto.
        await waitFor(() => expect(screen.getByTestId('epic-card-100')).toBeInTheDocument());
        expect(screen.getByTestId('epic-progress-text-100')).toHaveTextContent('1/3 merged · 33%');

        // Inicialmente recolhida: subtasks da épica não aparecem.
        expect(screen.queryByTestId('epic-subtasks-100')).toBeNull();

        // Expande.
        await userEvent.click(screen.getByTestId('epic-toggle-100'));

        // Lista as 3 subtasks com seus status e identificação.
        const rows = screen.getByTestId('epic-subtasks-100');
        expect(rows.querySelector('[data-testid="epic-subtask-100-1"]')).toBeTruthy();
        expect(rows.querySelector('[data-testid="epic-subtask-100-2"]')).toBeTruthy();
        expect(rows.querySelector('[data-testid="epic-subtask-100-3"]')).toBeTruthy();
        // Cada linha mostra o título da subtask.
        expect(rows).toHaveTextContent('Subtask merged');
        expect(rows).toHaveTextContent('Subtask rodando');
    });

    it('visão lista: subtask comum mostra chip "↳ épica #100"', async () => {
        mockTaskService.list.mockResolvedValue([epicTask(), subMerged(), subRunning(), subPending()]);

        render(<IssuesPage />);
        await goToTasks();
        await userEvent.click(screen.getByTitle('Lista'));

        // A subtask running (#2) aparece como card próprio (fora da expansão) com o chip de épica.
        await waitFor(() => expect(screen.getByTestId('task-epic-link-2')).toBeInTheDocument());
        expect(screen.getByTestId('task-epic-link-2')).toHaveTextContent('↳ épica #100');
    });
});

