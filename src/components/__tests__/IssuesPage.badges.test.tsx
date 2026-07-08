/**
 * Testes de COMPONENTE (RTL) para o issue #1175 — Pacote A da UI do task manager.
 *
 * Cobrem os 3 comportamentos visíveis no kanban:
 *  1. Coluna "Aguardando você" separa reviewing de approved-com-hold (visual distinto) e
 *     approved transitório vira chip "mergeando...".
 *  2. Cor do score deriva do piso REAL da config (GET /api/ui-config), com tooltip do piso.
 *  3. Fase visível no chip das tasks running/fixing ("exploração 2/3", "síntese", "julgando").
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

// getUiConfig controlável por teste (default null → fallback dos defaults 8/9).
const { getUiConfigMock, taskServiceMock } = vi.hoisted(() => ({
    getUiConfigMock: vi.fn(),
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
        // #1167: quota-status do backend (alimenta o banner). Default: nada ativo.
        getQuotaStatus: vi.fn().mockResolvedValue({ exhausted: false, since: null, reason: '', peakHold: false }),
        // #1189: orçamento diário (alimenta o BoardHeader).
        getStatus: vi.fn().mockResolvedValue({ dailyRoundsUsed: 0, dailyRoundBudget: 200 }),
    },
}));

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
    issueNumber: 1,
    title: 'Task de teste',
    body: '',
    labels: [],
    status: 'running',
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

/** Clica na aba Tasks (pipeline é o viewMode default; "Ativas" é o taskTab default). */
const goToTasksPipeline = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /Tasks \(\d+\)/ }));
};

describe('IssuesPage — #1175: "Aguardando você" separa reviewing de approved retido', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ taskAutomation: { minMergeScore: 9, minApproveScore: 9 } });
    });

    it('exibe o cabeçalho de coluna "Aguardando você"', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 1, status: 'reviewing', title: 'Task em revisão' }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        expect(await screen.findByText('Aguardando você')).toBeTruthy();
    });

    it('approved COM mergeHoldReason mostra chip "Aguardando você" (distinto de reviewing)', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 10, status: 'reviewing', title: 'Revisão humana do código' }),
            makeTask({ issueNumber: 11, status: 'approved', title: 'Aprovado retido pelo piso', mergeHoldReason: 'Score 8/10 abaixo do piso de merge (9).' }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        await screen.findByText('Aprovado retido pelo piso');
        // Chip distinto: "Aguardando você" (approved+hold) vs "Em Revisão" (reviewing)
        const chipHold = screen.getByTestId('task-status-chip-11');
        const chipReview = screen.getByTestId('task-status-chip-10');
        expect(chipHold.textContent).toContain('Aguardando você');
        expect(chipHold.textContent).not.toContain('Em Revisão');
        expect(chipReview.textContent).toContain('Em Revisão');
        // O motivo do hold aparece sob o título
        expect(screen.getByTestId('task-hold-11').textContent).toContain('piso de merge');
    });

    it('approved SEM mergeHoldReason mostra chip "mergeando..." (transitório)', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 12, status: 'approved', title: 'Aprovado mergeando', judgeScore: 9 }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        await screen.findByText('Aprovado mergeando');
        expect(screen.getByTestId('task-status-chip-12').textContent).toContain('mergeando...');
    });
});

describe('IssuesPage — #1175: cor do score deriva do piso REAL da config', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Config de produção: piso de merge = 9 (score 8 NÃO pode mergear).
        getUiConfigMock.mockResolvedValue({ taskAutomation: { minMergeScore: 9, minApproveScore: 9 } });
    });

    it('score 9 é verde (>= piso 9) e score 8 é âmbar (abaixo do piso)', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 20, status: 'reviewing', title: 'Score no piso', judgeScore: 9 }),
            makeTask({ issueNumber: 21, status: 'reviewing', title: 'Score abaixo do piso', judgeScore: 8 }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        const green = await screen.findByTestId('task-score-20');
        const amber = screen.getByTestId('task-score-21');
        expect(green.className).toContain('text-green-600');
        expect(amber.className).toContain('text-amber-600');
        expect(amber.className).not.toContain('text-green-600');
    });

    it('tooltip do score mostra o piso real: "8/10 — piso de merge: 9"', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 22, status: 'reviewing', title: 'Tooltip do piso', judgeScore: 8 }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        const score = await screen.findByTestId('task-score-22');
        expect(score.getAttribute('title')).toBe('8/10 — piso de merge: 9');
    });

    it('fallback sensato (config não carrega) ainda coloreia: 8 verde, 6 vermelho', async () => {
        getUiConfigMock.mockResolvedValue(null);
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 23, status: 'reviewing', title: 'Default verde', judgeScore: 8 }),
            makeTask({ issueNumber: 24, status: 'reviewing', title: 'Default vermelho', judgeScore: 6 }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        const green = await screen.findByTestId('task-score-23');
        const red = screen.getByTestId('task-score-24');
        // defaults: minMergeScore=8 → score 8 verde; score 6 < minApproveScore-1(8) → vermelho
        expect(green.className).toContain('text-green-600');
        expect(red.className).toContain('text-red-600');
    });
});

describe('IssuesPage — #1175: fase visível no chip das tasks running/fixing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue(null);
    });

    it('chip de running mostra "Executando — exploração 2/3" a partir de phase + attempts', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({
                issueNumber: 30, status: 'running', title: 'Em exploração', phase: 'exploring',
                attempts: [{ index: 1, phase: 'exploring', diff: '', typecheckOk: true, filesChanged: [] }],
            }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        const chip = await screen.findByTestId('task-status-chip-30');
        expect(chip.textContent).toContain('Executando — exploração 2/3');
    });

    it('chip mostra "síntese" e "julgando" nas fases correspondentes', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 31, status: 'running', title: 'Em síntese', phase: 'synthesizing', synthesisAttempt: 2 }),
            makeTask({ issueNumber: 32, status: 'running', title: 'Julgando', phase: 'judging' }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        expect((await screen.findByTestId('task-status-chip-31')).textContent).toContain('síntese 2/3');
        expect(screen.getByTestId('task-status-chip-32').textContent).toContain('julgando');
    });
});

describe('IssuesPage — #1167: contador "aguardando sua decisão"', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue(null);
        taskServiceMock.getQuotaStatus.mockResolvedValue({ exhausted: false, since: null, reason: '', peakHold: false });
    });

    it('mostra "N aguardando sua decisão" = reviewing + approved-retido', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 40, status: 'reviewing', title: 'Revisão humana' }),
            makeTask({ issueNumber: 41, status: 'approved', title: 'Retido pelo piso', mergeHoldReason: 'Score 8/10 abaixo do piso.' }),
            makeTask({ issueNumber: 42, status: 'approved', title: 'Retido autoMergeOff', mergeHoldReason: 'Auto-merge off.' }),
            makeTask({ issueNumber: 43, status: 'approved', title: 'Mergeando transitório' }), // sem hold — não conta
            makeTask({ issueNumber: 44, status: 'running', title: 'Executando' }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        // O contador vive no BoardHeader (topo do board, cross-tab). Após carregar as tasks,
        // decisionCount = reviewing(1) + approved-retido(2) = 3.
        const counter = await screen.findByTestId('decision-counter');
        expect(counter.textContent).toContain('3');
        expect(counter.textContent).toContain('aguardando sua decisão');
    });

    it('NÃO mostra o contador quando não há tasks aguardando decisão', async () => {
        taskServiceMock.list.mockResolvedValue([
            makeTask({ issueNumber: 50, status: 'approved', title: 'Mergeando' }), // sem hold
            makeTask({ issueNumber: 51, status: 'pending', title: 'Na fila' }),
        ]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        // Aguarda um card aparecer para garantir que a aba renderizou e o decisionCount
        // foi recomputado (BoardHeader monta junto com o PageHeader).
        await screen.findByText('Mergeando');
        expect(screen.queryByTestId('decision-counter')).toBeNull();
    });
});

describe('IssuesPage — #1167: banner de quota-hold / peak-hold', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue(null);
    });

    it('NÃO mostra o banner quando nada está ativo (quota ok + sem pico)', async () => {
        taskServiceMock.getQuotaStatus.mockResolvedValue({ exhausted: false, since: null, reason: '', peakHold: false });
        taskServiceMock.list.mockResolvedValue([makeTask({ issueNumber: 60, status: 'pending', title: 'Na fila' })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        await screen.findByText('Na fila');
        expect(screen.queryByTestId('quota-hold-banner')).toBeNull();
    });

    it('mostra banner de quota esgotada (com motivo) quando exhausted=true', async () => {
        taskServiceMock.getQuotaStatus.mockResolvedValue({ exhausted: true, since: Date.now() - 60_000, reason: 'HTTP 429 rate limit', peakHold: false });
        taskServiceMock.list.mockResolvedValue([makeTask({ issueNumber: 61, status: 'pending', title: 'Na fila' })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        const banner = await screen.findByTestId('quota-hold-banner');
        expect(banner).toHaveAttribute('data-exhausted', 'true');
        expect(screen.getByTestId('quota-exhausted-row').textContent).toContain('Cota de LLM esgotada');
        expect(screen.getByTestId('quota-exhausted-row').textContent).toContain('429');
        expect(screen.queryByTestId('peak-hold-row')).toBeNull();
    });

    it('mostra banner de peak-hold quando peakHold=true', async () => {
        taskServiceMock.getQuotaStatus.mockResolvedValue({ exhausted: false, since: null, reason: '', peakHold: true });
        taskServiceMock.list.mockResolvedValue([makeTask({ issueNumber: 62, status: 'pending', title: 'Na fila' })]);
        const user = userEvent.setup();
        renderPage();
        await goToTasksPipeline(user);

        const banner = await screen.findByTestId('quota-hold-banner');
        expect(banner).toHaveAttribute('data-peak-hold', 'true');
        expect(screen.getByTestId('peak-hold-row').textContent).toContain('Hold de pico');
    });
});
