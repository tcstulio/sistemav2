/**
 * Testes para issue #983: filtros de período na página de Issues/Tasks.
 * - Botões de período (Hoje / N dias / Tudo) com padrão "Hoje"
 * - Tasks concluídas fora do período são ocultas; ativas sempre aparecem
 * - Issues filtradas server-side (getIssues recebe param period)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import IssuesPage from '../Issues/IssuesPage';
import type { Task } from '../../services/taskService';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const { getIssuesSpy, taskServiceMock } = vi.hoisted(() => {
    const getIssuesSpy = vi.fn().mockResolvedValue([]);
    return {
        getIssuesSpy,
        taskServiceMock: {
            list: vi.fn(),
            listEvents: vi.fn().mockResolvedValue([]),
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
        getIssues: getIssuesSpy,
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

const DAY = 24 * 60 * 60 * 1000;

const makeTask = (overrides: Partial<Task>): Task => ({
    issueNumber: 1,
    title: 'Task de teste',
    body: '',
    labels: [],
    status: 'merged',
    feedbackHistory: [],
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
});

const renderPage = () =>
    render(
        <ConfirmProvider>
            <IssuesPage />
        </ConfirmProvider>
    );

/** Vai para a aba Tasks e clica em "Concluídas" + visão lista. */
const goToDoneListView = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
    await user.click(await screen.findByRole('button', { name: /Concluídas/ }));
    await user.click(screen.getByTitle('Lista'));
};

describe('IssuesPage — filtro de período (#983)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getIssuesSpy.mockResolvedValue([]);
        taskServiceMock.list.mockResolvedValue([]);
    });

    it('renderiza os botões de período com "Hoje" ativo por padrão', async () => {
        renderPage();
        const group = await screen.findByTestId('period-filter');
        const hojeBtn = within(group).getByRole('button', { name: 'Hoje' });
        expect(hojeBtn).toHaveAttribute('aria-pressed', 'true');
        // "1 dia" é distinto de "Hoje" (issue #983 / Judge P1): janela móvel de 24h
        // vs dia de calendário. Deve existir como botão próprio, desativado por padrão.
        const umDiaBtn = within(group).getByRole('button', { name: '1 dia' });
        expect(umDiaBtn).toHaveAttribute('aria-pressed', 'false');
        // Demais opções presentes
        expect(within(group).getByRole('button', { name: '5 dias' })).toBeTruthy();
        expect(within(group).getByRole('button', { name: '7 dias' })).toBeTruthy();
        expect(within(group).getByRole('button', { name: '30 dias' })).toBeTruthy();
        expect(within(group).getByRole('button', { name: 'Tudo' })).toBeTruthy();
    });

    it('envia period=today para getIssues no carregamento inicial', async () => {
        renderPage();
        await screen.findByTestId('period-filter');
        // O primeiro getIssues deve ter recebido period 'today' (padrão)
        const lastCall = getIssuesSpy.mock.calls[getIssuesSpy.mock.calls.length - 1];
        expect(lastCall?.[0]).toMatchObject({ period: 'today' });
    });

    it('re-busca issues com o novo período ao clicar em "30 dias"', async () => {
        const user = userEvent.setup();
        renderPage();
        const group = await screen.findByTestId('period-filter');
        await user.click(within(group).getByRole('button', { name: '30 dias' }));
        const lastCall = getIssuesSpy.mock.calls[getIssuesSpy.mock.calls.length - 1];
        expect(lastCall?.[0]).toMatchObject({ period: '30' });
    });

    it('mostra dica de período quando período !== "Tudo"', async () => {
        renderPage();
        await screen.findByTestId('period-filter');
        // Padrão = hoje → dica deve aparecer na aba issues
        expect(await screen.findByTestId('period-hint-issues')).toBeTruthy();
    });

    it('oculta dica de período quando período = "Tudo"', async () => {
        const user = userEvent.setup();
        renderPage();
        const group = await screen.findByTestId('period-filter');
        await user.click(within(group).getByRole('button', { name: 'Tudo' }));
        expect(screen.queryByTestId('period-hint-issues')).toBeNull();
    });
});

describe('IssuesPage — tasks concluídas escopadas pelo período (#983)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getIssuesSpy.mockResolvedValue([]);
    });

    it('oculta task concluída antiga por padrão (Hoje) e mantém ativa visível', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 1, title: 'Task merged hoje', status: 'merged', completedAt: new Date().toISOString() }),
            makeTask({ issueNumber: 2, title: 'Task merged antiga', status: 'merged', completedAt: new Date(Date.now() - 40 * DAY).toISOString() }),
            makeTask({ issueNumber: 3, title: 'Task em execução', status: 'running' }),
        ]);

        const user = userEvent.setup();
        renderPage();
        await goToDoneListView(user);

        // merged hoje → visível; antiga → oculta
        expect(await screen.findByText('Task merged hoje')).toBeTruthy();
        expect(screen.queryByText('Task merged antiga')).toBeNull();
    });

    it('mostra task concluída antiga ao trocar para "Tudo"', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 2, title: 'Task merged antiga', status: 'merged', completedAt: new Date(Date.now() - 40 * DAY).toISOString() }),
        ]);

        const user = userEvent.setup();
        renderPage();
        const group = await screen.findByTestId('period-filter');
        await user.click(within(group).getByRole('button', { name: 'Tudo' }));
        await goToDoneListView(user);

        expect(await screen.findByText('Task merged antiga')).toBeTruthy();
    });

    it('task ativa (running) aparece mesmo com período "Hoje"', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 3, title: 'Task em execução agora', status: 'running' }),
        ]);

        const user = userEvent.setup();
        renderPage();
        await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
        // Aba ativas é a padrão; muda para lista
        await user.click(screen.getByTitle('Lista'));

        expect(await screen.findByText('Task em execução agora')).toBeTruthy();
    });

    it('mostra task concluída dentro de 7 dias ao trocar para "7 dias"', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 4, title: 'Task de 3 dias atrás', status: 'merged', completedAt: new Date(Date.now() - 3 * DAY).toISOString() }),
            makeTask({ issueNumber: 5, title: 'Task de 20 dias atrás', status: 'merged', completedAt: new Date(Date.now() - 20 * DAY).toISOString() }),
        ]);

        const user = userEvent.setup();
        renderPage();
        const group = await screen.findByTestId('period-filter');
        await user.click(within(group).getByRole('button', { name: '7 dias' }));
        await goToDoneListView(user);

        expect(await screen.findByText('Task de 3 dias atrás')).toBeTruthy();
        expect(screen.queryByText('Task de 20 dias atrás')).toBeNull();
    });
});

describe('IssuesPage — opção "1 dia" distinta de "Hoje" (#983, Judge P1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getIssuesSpy.mockResolvedValue([]);
        taskServiceMock.list.mockResolvedValue([]);
    });

    it('re-busca issues com period=1 ao clicar em "1 dia"', async () => {
        const user = userEvent.setup();
        renderPage();
        const group = await screen.findByTestId('period-filter');
        await user.click(within(group).getByRole('button', { name: '1 dia' }));
        const lastCall = getIssuesSpy.mock.calls[getIssuesSpy.mock.calls.length - 1];
        expect(lastCall?.[0]).toMatchObject({ period: '1' });
    });

    it('"1 dia" (24h) exibe task de 23h atrás que "Hoje" omitiria perto da virada da meia-noite', async () => {
        // Construímos datas relativas à "agora": 23h atrás cai no dia de calendário anterior
        // quando faltam < 1h para a meia-noite; em qualquer caso, 23h atrás está dentro da
        // janela móvel de 24h ("1 dia") e deve aparecer.
        const vinteETresHorasAtras = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 10, title: 'Task de 23h atrás', status: 'merged', completedAt: vinteETresHorasAtras }),
        ]);

        const user = userEvent.setup();
        renderPage();
        const group = await screen.findByTestId('period-filter');
        await user.click(within(group).getByRole('button', { name: '1 dia' }));
        await goToDoneListView(user);

        expect(await screen.findByText('Task de 23h atrás')).toBeTruthy();
    });
});

describe('IssuesPage — fallback completedAt→updatedAt (#983, Judge P3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getIssuesSpy.mockResolvedValue([]);
    });

    it('task terminal SEM completedAt mas com updatedAt no período permanece visível (não some)', async () => {
        // failed antiga sem completedAt — sem o fallback (updatedAt) sumiria indevidamente.
        taskServiceMock.list.mockResolvedValue([
            makeTask({
                issueNumber: 20,
                title: 'Task failed sem completedAt (updatedAt hoje)',
                status: 'failed',
                completedAt: undefined,
                updatedAt: new Date().toISOString(),
            }),
        ]);

        const user = userEvent.setup();
        renderPage();
        await goToDoneListView(user);

        expect(await screen.findByText('Task failed sem completedAt (updatedAt hoje)')).toBeTruthy();
    });

    it('task terminal SEM completedAt e updatedAt antigo é ocultada pelo período (Hoje)', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({
                issueNumber: 21,
                title: 'Task failed antiga sem completedAt',
                status: 'failed',
                completedAt: undefined,
                updatedAt: new Date(Date.now() - 40 * DAY).toISOString(),
            }),
        ]);

        const user = userEvent.setup();
        renderPage();
        // Período padrão = Hoje → updatedAt fora do período → oculta
        await goToDoneListView(user);

        expect(screen.queryByText('Task failed antiga sem completedAt')).toBeNull();
    });

    it('task terminal SEM completedAt e updatedAt antigo aparece ao trocar para "Tudo"', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({
                issueNumber: 21,
                title: 'Task failed antiga sem completedAt',
                status: 'failed',
                completedAt: undefined,
                updatedAt: new Date(Date.now() - 40 * DAY).toISOString(),
            }),
        ]);

        const user = userEvent.setup();
        renderPage();
        const group = await screen.findByTestId('period-filter');
        await user.click(within(group).getByRole('button', { name: 'Tudo' }));
        await goToDoneListView(user);

        expect(await screen.findByText('Task failed antiga sem completedAt')).toBeTruthy();
    });

    it('task terminal sem nenhuma data (completedAt e updatedAt ausentes) é ocultada em período não-"Tudo"', async () => {
        // Caso defensivo: não há como datar o item → fora de qualquer recorte temporal.
        taskServiceMock.list.mockResolvedValue([
            makeTask({
                issueNumber: 22,
                title: 'Task sem data nenhuma',
                status: 'failed',
                completedAt: undefined,
                updatedAt: undefined as unknown as string,
            }),
        ]);

        const user = userEvent.setup();
        renderPage();
        await goToDoneListView(user);

        expect(screen.queryByText('Task sem data nenhuma')).toBeNull();
    });
});
