/**
 * Testes de COMPONENTE (RTL) para o issue #1176 — modal de feedback estruturado.
 *
 * Cobrem os critérios de aceite:
 *  - Modal abre nos status reviewing/approved (pipeline 💬 e lista "Corrigir"); envio funciona,
 *    fecha e mostra toast de confirmação.
 *  - judgeReview visível dentro do modal; "Usar os pontos do Judge" insere o rascunho.
 *  - Histórico de feedbacks listado quando existe (durableFeedback e fallback feedback_received).
 *  - Cancelar fecha sem enviar.
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

const { fixSpy, getUiConfigMock, taskServiceMock } = vi.hoisted(() => {
    const fixSpy = vi.fn().mockResolvedValue({});
    return {
        fixSpy,
        getUiConfigMock: vi.fn(),
        taskServiceMock: {
            list: vi.fn(),
            listEvents: vi.fn().mockResolvedValue([]),
            kill: vi.fn().mockResolvedValue({}),
            start: vi.fn().mockResolvedValue({}),
            fix: fixSpy,
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

vi.mock('../../services/taskService', () => ({ TaskService: taskServiceMock }));

vi.mock('../../services/githubService', () => ({
    GithubService: {
        getIssues: vi.fn().mockResolvedValue([]),
        getStats: vi.fn().mockResolvedValue(null),
        addLabel: vi.fn().mockResolvedValue({ ok: true }),
        setIssueState: vi.fn().mockResolvedValue({ ok: true }),
    },
}));

vi.mock('../../services/uiConfigService', () => ({ getUiConfig: getUiConfigMock }));

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
    issueNumber: 50,
    title: 'Task em revisão',
    body: '',
    labels: [],
    status: 'reviewing',
    feedbackHistory: [],
    updatedAt: '2024-06-21T16:08:00.000Z',
    ...overrides,
});

const renderPage = () =>
    render(
        <ConfirmProvider>
            <IssuesPage />
        </ConfirmProvider>
    );

const goToTasksPipeline = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
};

/** Vai para a aba Tasks na visão de lista (onde o botão se chama "Corrigir"). */
const goToListView = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
    await user.click(screen.getByTitle('Lista'));
};

describe('IssuesPage — #1176: modal de feedback abre nos status reviewing/approved', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ taskAutomation: { minMergeScore: 9, minApproveScore: 9 } });
    });

    it('abre o modal pelo botão 💬 no pipeline (reviewing)', async () => {
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'reviewing' })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        expect(await screen.findByTestId('task-feedback-modal')).toBeTruthy();
        expect(screen.getByTestId('feedback-textarea')).toBeTruthy();
    });

    it('abre o modal pelo botão "Corrigir" na lista (approved)', async () => {
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'approved' })]);
        const user = userEvent.setup();
        renderPage();
        await goToListView(user);

        await user.click(await screen.findByRole('button', { name: 'Corrigir' }));

        expect(await screen.findByTestId('task-feedback-modal')).toBeTruthy();
    });
});

describe('IssuesPage — #1176: aviso de reabertura com minApproveScore da config', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ taskAutomation: { minMergeScore: 9, minApproveScore: 8 } });
    });

    it('mostra o aviso fixo citando o piso real (≥ 8)', async () => {
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'reviewing' })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);
        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        const warning = await screen.findByTestId('feedback-reopen-warning');
        expect(warning.textContent).toContain('REABRE o ciclo');
        expect(warning.textContent).toContain('≥ 8');
    });
});

describe('IssuesPage — #1176: judgeReview visível e "usar os pontos do Judge" preenche o rascunho', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ taskAutomation: { minMergeScore: 9, minApproveScore: 9 } });
    });

    it('mostra a crítica do Judge e insere os negativos no textarea ao clicar', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({
                status: 'reviewing',
                judgeReview: 'Aceitável.\n- Faltou tratar lista vazia\n- Sem teste de regressão',
            }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);
        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        const review = await screen.findByTestId('feedback-judge-review');
        expect(review.textContent).toContain('Faltou tratar lista vazia');

        const textarea = screen.getByTestId('feedback-textarea') as HTMLTextAreaElement;
        expect(textarea.value).toBe('');

        await user.click(screen.getByTestId('use-judge-points'));

        expect(textarea.value).toBe('Faltou tratar lista vazia\nSem teste de regressão');
    });

    it('sem judgeReview, não renderiza o painel nem o botão "usar pontos"', async () => {
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'reviewing', judgeReview: undefined })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);
        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        expect(await screen.findByTestId('task-feedback-modal')).toBeTruthy();
        expect(screen.queryByTestId('feedback-judge-review')).toBeNull();
        expect(screen.queryByTestId('use-judge-points')).toBeNull();
    });
});

describe('IssuesPage — #1176: histórico de feedbacks anteriores', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ taskAutomation: { minMergeScore: 9, minApproveScore: 9 } });
    });

    it('lista o durableFeedback (mais recente primeiro)', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ status: 'reviewing', durableFeedback: ['primeiro fb', 'segundo fb'] }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);
        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        const history = await screen.findByTestId('feedback-history');
        const items = history.querySelectorAll('li');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain('segundo fb');
        expect(items[1].textContent).toContain('primeiro fb');
    });

    it('recua para os eventos feedback_received quando durableFeedback ausente', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({
                status: 'reviewing',
                events: [
                    { ts: '2024-06-21T15:00:00.000Z', type: 'feedback_received', message: 'Feedback recebido: corrija X' },
                    { ts: '2024-06-21T15:30:00.000Z', type: 'feedback_received', message: 'Feedback recebido: corrija Y' },
                ],
            }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);
        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        const history = await screen.findByTestId('feedback-history');
        const items = history.querySelectorAll('li');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain('corrija Y');
        expect(items[1].textContent).toContain('corrija X');
    });

    it('sem histórico, não renderiza a seção', async () => {
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'reviewing' })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);
        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        expect(await screen.findByTestId('task-feedback-modal')).toBeTruthy();
        expect(screen.queryByTestId('feedback-history')).toBeNull();
    });
});

describe('IssuesPage — #1176: enviar/cancelar o modal de feedback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ taskAutomation: { minMergeScore: 9, minApproveScore: 9 } });
    });

    it('envia o feedback (POST /fix), fecha o modal e mostra toast de confirmação', async () => {
        const { toast } = await import('sonner');
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'reviewing' })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);
        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        const textarea = await screen.findByTestId('feedback-textarea');
        await user.type(textarea, 'Corrija o tratamento de lista vazia');

        await user.click(screen.getByTestId('feedback-submit'));

        await vi.waitFor(() => expect(fixSpy).toHaveBeenCalledTimes(1));
        expect(fixSpy).toHaveBeenCalledWith(50, 'Corrija o tratamento de lista vazia');
        // Modal fecha após o envio.
        await vi.waitFor(() => expect(screen.queryByTestId('task-feedback-modal')).toBeNull());
        // Toast de confirmação (sucesso) emitido.
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Feedback enviado'));
    });

    it('botão de envio fica desabilitado com feedback vazio', async () => {
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'reviewing' })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);
        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        const submit = await screen.findByTestId('feedback-submit');
        expect((submit as HTMLButtonElement).disabled).toBe(true);
    });

    it('cancelar fecha o modal sem chamar o endpoint', async () => {
        taskServiceMock.list.mockResolvedValue([makeTask({ status: 'reviewing' })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);
        await user.click(await screen.findByRole('button', { name: /Feedback da task #50/i }));

        const textarea = await screen.findByTestId('feedback-textarea');
        await user.type(textarea, 'rascunho descartado');

        await user.click(screen.getByRole('button', { name: 'Cancelar' }));

        await vi.waitFor(() => expect(screen.queryByTestId('task-feedback-modal')).toBeNull());
        expect(fixSpy).not.toHaveBeenCalled();
    });
});
