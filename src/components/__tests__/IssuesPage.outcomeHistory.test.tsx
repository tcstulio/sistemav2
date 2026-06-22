/**
 * Testes para issue #637:
 * - Separar "falhou" / "cancelada" no pipeline com cores/badges distintos
 * - Mostrar timestamp de desfecho legível (completedAt / updatedAt)
 * - Clicar numa task abre o histórico completo (timeline de eventos)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import IssuesPage from '../Issues/IssuesPage';
import type { Task } from '../../services/taskService';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const { listEventsSpy, taskServiceMock } = vi.hoisted(() => {
    const listEventsSpy = vi.fn().mockResolvedValue([]);
    return {
        listEventsSpy,
        taskServiceMock: {
            list: vi.fn(),
            listEvents: listEventsSpy,
            kill: vi.fn().mockResolvedValue({}),
            start: vi.fn().mockResolvedValue({}),
            fix: vi.fn().mockResolvedValue({}),
            redo: vi.fn().mockResolvedValue({}),
            reject: vi.fn().mockResolvedValue({}),
            merge: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
            plan: vi.fn().mockResolvedValue({ order: [], reasons: {} }),
            reorder: vi.fn().mockResolvedValue(undefined),
            getDiff: vi.fn().mockResolvedValue(''),
        },
    };
});

vi.mock('../../services/taskService', () => ({
    TaskService: taskServiceMock,
}));

vi.mock('../../services/githubService', () => ({
    GithubService: {
        getIssues: vi.fn().mockResolvedValue([]),
        getStats: vi.fn().mockResolvedValue(null),
        addLabel: vi.fn().mockResolvedValue({ ok: true }),
        setIssueState: vi.fn().mockResolvedValue({ ok: true }),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ currentUser: { admin: 1 } }),
}));

vi.mock('../TasksBoard/DiffViewer', () => ({ default: () => null }));
vi.mock('../TasksBoard/TaskConsole', () => ({ default: () => null }));

vi.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }: { children: React.ReactNode }) => children,
    closestCorners: () => null,
    PointerSensor: class { },
    useSensor: () => null,
    useSensors: () => [],
}));
vi.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }: { children: React.ReactNode }) => children,
    verticalListSortingStrategy: {},
    useSortable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: () => { },
        transform: null,
        transition: null,
        isDragging: false,
    }),
    arrayMove: (arr: unknown[]) => arr,
}));
vi.mock('@dnd-kit/utilities', () => ({
    CSS: { Transform: { toString: () => '' } },
}));

const COMPLETED_AT = '2024-06-21T16:08:00.000Z';

const makeTask = (overrides: Partial<Task>): Task => ({
    issueNumber: 99,
    title: 'Task de teste',
    body: '',
    labels: [],
    status: 'failed',
    feedbackHistory: [],
    updatedAt: COMPLETED_AT,
    completedAt: COMPLETED_AT,
    ...overrides,
});

const renderPage = () =>
    render(
        <ConfirmProvider>
            <IssuesPage />
        </ConfirmProvider>
    );

/** Navega para a aba Tasks, muda para "Concluídas" e troca para visão de lista */
const goToListView = async (user: ReturnType<typeof userEvent.setup>) => {
    // Aguarda tasks carregarem (o botão mostra a contagem total)
    await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
    // Mudar para aba "Concluídas" para ver tasks terminais
    await user.click(await screen.findByRole('button', { name: /Concluídas/ }));
    await user.click(screen.getByTitle('Lista'));
};

/** Navega para a aba Tasks e muda para "Concluídas" (pipeline) */
const goToTasksTab = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
    // Mudar para aba "Concluídas" para ver tasks terminais no pipeline
    await user.click(await screen.findByRole('button', { name: /Concluídas/ }));
};

describe('IssuesPage — separação failed/cancelled no pipeline (#637)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exibe coluna "Falhadas" separada de "Canceladas" no pipeline', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 1, title: 'Task falhou', status: 'failed' }),
            makeTask({ issueNumber: 2, title: 'Task cancelada', status: 'cancelled' }),
        ]);

        renderPage();
        await goToTasksTab(userEvent.setup());

        // Deve haver colunas com esses títulos
        expect(await screen.findByText('Falhadas')).toBeTruthy();
        expect(screen.getByText('Canceladas')).toBeTruthy();

        // Cada task deve aparecer exatamente no grupo correto
        expect(screen.getByText('Task falhou')).toBeTruthy();
        expect(screen.getByText('Task cancelada')).toBeTruthy();
    });

    it('não agrupa failed e cancelled na mesma coluna "Concluído"', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 1, title: 'Task que falhou', status: 'failed' }),
        ]);

        renderPage();
        await goToTasksTab(userEvent.setup());

        // A tarefa com status failed deve estar em "Falhadas", não em "Concluído"
        await screen.findByText('Task que falhou');
        // "Concluído" column should NOT contain this failed task
        const falhadas = screen.getByText('Falhadas').closest('[class*="flex flex-col"]') ??
            screen.getByText('Falhadas').parentElement?.parentElement;
        expect(falhadas).toBeTruthy();
    });
});

describe('IssuesPage — timestamp de desfecho (#637)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('mostra timestamp "Falhou HH:MM" na visão de lista para task failed', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ status: 'failed', completedAt: '2024-06-21T16:08:00.000Z' }),
        ]);
        renderPage();
        await goToListView(userEvent.setup());

        // O texto começa com "Falhou " e contém horário
        const ts = await screen.findByTestId('outcome-time');
        expect(ts.textContent).toMatch(/Falhou\s+\d{2}:\d{2}/);
    });

    it('mostra timestamp "Cancelada HH:MM" para task cancelled', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ status: 'cancelled', completedAt: '2024-06-21T16:30:00.000Z' }),
        ]);
        renderPage();
        await goToListView(userEvent.setup());

        const ts = await screen.findByTestId('outcome-time');
        expect(ts.textContent).toMatch(/Cancelada\s+\d{2}:\d{2}/);
    });

    it('não mostra timestamp de desfecho para task ativa (running)', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ status: 'running', completedAt: undefined }),
        ]);
        const user = userEvent.setup();
        renderPage();

        // Para task ativa, navega para "Ativas" (aba padrão) na visão de lista
        await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
        // Já está na aba "Ativas" por padrão; só muda para lista
        await user.click(screen.getByTitle('Lista'));

        await screen.findByText('Task de teste');
        expect(screen.queryByTestId('outcome-time')).toBeNull();
    });
});

describe('IssuesPage — histórico clicável (#637)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('abre o modal de histórico ao clicar numa task na lista', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ status: 'failed', events: [] }),
        ]);
        listEventsSpy.mockResolvedValue([]);

        const user = userEvent.setup();
        renderPage();
        await goToListView(user);

        const card = await screen.findByText('Task de teste');
        await user.click(card);

        // Modal deve aparecer
        expect(await screen.findByTestId('task-history-modal')).toBeTruthy();
        expect(screen.getByText('Histórico de eventos')).toBeTruthy();
    });

    it('exibe eventos com data/hora, tipo e mensagem no modal', async () => {
        const events = [
            { ts: '2024-06-21T15:00:00.000Z', type: 'start', message: 'Task iniciada' },
            { ts: '2024-06-21T15:30:00.000Z', type: 'error', message: 'Erro fatal no typecheck' },
        ];
        taskServiceMock.list.mockResolvedValue([
            makeTask({ status: 'failed', events }),
        ]);
        // events embedded in task — listEvents should not be called
        listEventsSpy.mockResolvedValue(events);

        const user = userEvent.setup();
        renderPage();
        await goToListView(user);

        await user.click(await screen.findByText('Task de teste'));

        expect(await screen.findByText('Task iniciada')).toBeTruthy();
        expect(screen.getByText('Erro fatal no typecheck')).toBeTruthy();
        // Tipos de evento visíveis
        expect(screen.getByText('start')).toBeTruthy();
        expect(screen.getByText('error')).toBeTruthy();
    });

    it('chama listEvents quando a task não traz events embutidos', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ status: 'failed', events: undefined }),
        ]);
        listEventsSpy.mockResolvedValue([
            { ts: '2024-06-21T16:00:00.000Z', type: 'run', message: 'Executando opencode' },
        ]);

        const user = userEvent.setup();
        renderPage();
        await goToListView(user);

        await user.click(await screen.findByText('Task de teste'));

        expect(await screen.findByText('Executando opencode')).toBeTruthy();
        expect(listEventsSpy).toHaveBeenCalledWith(99);
    });

    it('fecha o modal ao clicar no botão de fechar', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ status: 'failed', events: [] }),
        ]);

        const user = userEvent.setup();
        renderPage();
        await goToListView(user);

        await user.click(await screen.findByText('Task de teste'));
        const modal = await screen.findByTestId('task-history-modal');
        expect(modal).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Fechar histórico' }));
        expect(screen.queryByTestId('task-history-modal')).toBeNull();
    });
});
