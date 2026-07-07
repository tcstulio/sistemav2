/**
 * Testes do fluxo de revisão (DiffViewer) — issue #1179:
 * A listagem (GET /api/tasks) vem ENXUTA: judgeReview truncado (~300) e sem `events`. A revisão
 * precisa do judgeReview COMPLETO, então ao abrir a revisão buscamos a task CHEIA on-demand
 * (GET /:issueNumber, não-projetado). Aqui garantimos que esse fetch acontece e que o DiffViewer
 * recebe o judgeReview completo (não o truncado da listagem).
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

const { getSpy, getDiffSpy, taskServiceMock, lastDiffViewerProps } = vi.hoisted(() => {
    const getSpy = vi.fn();
    const getDiffSpy = vi.fn().mockResolvedValue('diff de exemplo');
    return {
        getSpy,
        getDiffSpy,
        taskServiceMock: {
            list: vi.fn(),
            listEvents: vi.fn().mockResolvedValue([]),
            get: getSpy,
            getDiff: getDiffSpy,
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
        },
        // captura os props repassados ao DiffViewer mockado
        lastDiffViewerProps: { current: null as any },
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

// DiffViewer mockado registra seus props para podermos afirmar sobre judgeReview/issueNumber.
vi.mock('../TasksBoard/DiffViewer', () => ({
    default: (props: any) => {
        lastDiffViewerProps.current = props;
        return (
            <div data-testid="diff-viewer-mock">
                <p data-testid="dv-judge-review">{props.judgeReview ?? ''}</p>
                <p data-testid="dv-issue">{props.issueNumber}</p>
            </div>
        );
    },
}));
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

const FULL_REVIEW = 'r'.repeat(1200); // bem maior que o limite de listagem (300)
const TRUNCATED_SUFFIX = '…';
const LIST_REVIEW = 'r'.repeat(300) + TRUNCATED_SUFFIX; // como viria na listagem enxuta

const makeTask = (overrides: Partial<Task>): Task => ({
    issueNumber: 77,
    title: 'Task em revisão',
    body: '',
    labels: [],
    status: 'reviewing',
    feedbackHistory: [],
    updatedAt: '2024-07-07T10:00:00.000Z',
    ...overrides,
});

const renderPage = () =>
    render(
        <ConfirmProvider>
            <IssuesPage />
        </ConfirmProvider>
    );

describe('IssuesPage — revisão busca task CHEIA on-demand (#1179)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        lastDiffViewerProps.current = null;
        getDiffSpy.mockResolvedValue('diff de exemplo');
        // A listagem vem ENXUTA: judgeReview truncado em 300 (+ …).
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 77, judgeReview: LIST_REVIEW, judgeScore: 8, prNumber: 1077 }),
        ]);
        // GET /:issueNumber devolve a task CHEIA (judgeReview completo, sem truncar).
        getSpy.mockResolvedValue(
            makeTask({ issueNumber: 77, judgeReview: FULL_REVIEW, judgeScore: 8, prNumber: 1077 })
        );
    });

    it('chama TaskService.get (task cheia) ao abrir a revisão — não usa só o item da listagem', async () => {
        const user = userEvent.setup();
        renderPage();

        // vai pra aba Tasks (ativa, padrão) e visão de lista
        await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
        await user.click(screen.getByTitle('Lista'));

        // clica em "Revisar" na task reviewing
        const reviewBtn = await screen.findByRole('button', { name: /^Revisar$/ });
        await user.click(reviewBtn);

        // O DiffViewer aparece e o fetch da task cheia foi disparado
        expect(await screen.findByTestId('diff-viewer-mock')).toBeTruthy();
        expect(getSpy).toHaveBeenCalledWith(77);
        expect(getDiffSpy).toHaveBeenCalledWith(77);
    });

    it('repassa o judgeReview COMPLETO (da task cheia) ao DiffViewer — não o truncado da listagem', async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
        await user.click(screen.getByTitle('Lista'));
        await user.click(await screen.findByRole('button', { name: /^Revisar$/ }));

        const dv = await screen.findByTestId('diff-viewer-mock');
        expect(dv).toBeTruthy();

        // O DiffViewer recebeu o review completo (1200 chars), NÃO o truncado (301).
        const rendered = screen.getByTestId('dv-judge-review').textContent || '';
        expect(rendered.length).toBe(FULL_REVIEW.length);
        expect(rendered.endsWith(TRUNCATED_SUFFIX)).toBe(false);
    });

    it('mesmo se TaskService.get falhar, abre a revisão com o item da listagem (fallback resiliente)', async () => {
        getSpy.mockRejectedValue(new Error('network'));
        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
        await user.click(screen.getByTitle('Lista'));
        await user.click(await screen.findByRole('button', { name: /^Revisar$/ }));

        // O DiffViewer ainda abre (fallback pro item enxuto da listagem).
        expect(await screen.findByTestId('diff-viewer-mock')).toBeTruthy();
        expect(lastDiffViewerProps.current).not.toBeNull();
        expect(lastDiffViewerProps.current.issueNumber).toBe(77);
    });
});
