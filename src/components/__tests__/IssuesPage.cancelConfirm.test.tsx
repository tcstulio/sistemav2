import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import IssuesPage from '../Issues/IssuesPage';
import type { Task } from '../../services/taskService';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const { killSpy, taskServiceMock } = vi.hoisted(() => {
    const killSpy = vi.fn().mockResolvedValue({});
    return {
        killSpy,
        taskServiceMock: {
            list: vi.fn(),
            kill: killSpy,
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
    useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => { }, transform: null, transition: null, isDragging: false }),
    arrayMove: (arr: unknown[]) => arr,
}));
vi.mock('@dnd-kit/utilities', () => ({
    CSS: { Transform: { toString: () => '' } },
}));

const makeTask = (overrides: Partial<Task>): Task => ({
    issueNumber: 42,
    title: 'Task em execução',
    body: '',
    labels: [],
    status: 'running',
    feedbackHistory: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
});

const renderPage = () =>
    render(
        <ConfirmProvider>
            <IssuesPage />
        </ConfirmProvider>
    );

// Navega até a aba Tasks em visão de lista (onde o botão de cancelar tem o texto "Cancelar").
const goToListView = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
    await user.click(screen.getByTitle('Lista'));
};

describe('IssuesPage — confirmação ao cancelar task em execução (#636)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('não dispara kill ao clicar em Cancelar; dispara apenas após confirmar', async () => {
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'running' })]);
        const user = userEvent.setup();
        renderPage();

        await goToListView(user);

        await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

        // O diálogo de confirmação aparece e o kill ainda NÃO foi chamado.
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeTruthy();
        expect(screen.getByText(/O trabalho em andamento será perdido/i)).toBeTruthy();
        expect(killSpy).not.toHaveBeenCalled();

        // Confirma -> agora o kill é disparado.
        await user.click(within(dialog).getByRole('button', { name: /Sim, cancelar/i }));

        await vi.waitFor(() => expect(killSpy).toHaveBeenCalledTimes(1));
        expect(killSpy).toHaveBeenCalledWith(42);
    });

    it('não dispara kill quando o usuário cancela a confirmação', async () => {
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'running' })]);
        const user = userEvent.setup();
        renderPage();

        await goToListView(user);

        await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /Manter executando/i }));

        expect(killSpy).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('o controle de cancelar só aparece para tasks realmente em execução (running/fixing)', async () => {
        // status "cancelling" já está sendo cancelada: o botão não deve aparecer.
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'cancelling' })]);
        const user = userEvent.setup();
        renderPage();

        await goToListView(user);

        // aguarda o card renderizar
        expect(await screen.findByText(/Task em execução/i)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    });
});
