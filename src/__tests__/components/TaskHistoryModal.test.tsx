/**
 * Testes dedicados do TaskHistoryModal (#1179, critério de aceite #4: "componente do modal
 * com fetch mockado"). O modal foi extraído de IssuesPage.tsx justamente para ser testado de
 * forma ISOLADA: mockamos TaskService.listEvents e verificamos o estado de loading (spinner),
 * a renderização da timeline on-demand, o estado vazio e o tratamento de erro — sem montar a
 * página inteira nem depender de events embutidos na listagem (que agora vem enxuta).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskHistoryModal from '../../components/Issues/TaskHistoryModal';
import { TaskService } from '../../services/taskService';
import type { Task } from '../../services/taskService';

vi.mock('../../services/taskService', () => ({
    TaskService: {
        listEvents: vi.fn(),
    },
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
    issueNumber: 4242,
    title: 'Task do modal',
    body: '',
    labels: [],
    status: 'failed',
    feedbackHistory: [],
    updatedAt: '2024-06-21T16:00:00.000Z',
    completedAt: '2024-06-21T16:08:00.000Z',
    ...overrides,
});

describe('TaskHistoryModal — timeline on-demand (#1179)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('mostra o spinner de loading ao montar e chama listEvents(issueNumber)', () => {
        // Promise pendente: trava no estado de loading p/ podermos afirma-lo de forma estável.
        vi.mocked(TaskService.listEvents).mockReturnValue(new Promise<never>(() => {}));
        render(<TaskHistoryModal task={makeTask({ eventsCount: 7 })} onClose={vi.fn()} />);

        expect(screen.getByTestId('history-loading')).toBeInTheDocument();
        expect(screen.getByText('Histórico de eventos')).toBeInTheDocument();
        // a timeline é buscada on-demand (não lê events embutidos da listagem)
        expect(TaskService.listEvents).toHaveBeenCalledWith(4242);
        expect(TaskService.listEvents).toHaveBeenCalledTimes(1);
    });

    it('enquanto carrega, exibe o eventsCount vindo da listagem enxuta', () => {
        vi.mocked(TaskService.listEvents).mockReturnValue(new Promise<never>(() => {}));
        render(<TaskHistoryModal task={makeTask({ eventsCount: 9 })} onClose={vi.fn()} />);
        // badge de contagem mostra eventsCount (9) durante o loading
        expect(screen.getByText('9')).toBeInTheDocument();
    });

    it('renderiza a timeline retornada por listEvents após resolver', async () => {
        const events = [
            { ts: '2024-06-21T15:00:00.000Z', type: 'start', message: 'Task iniciada' },
            { ts: '2024-06-21T15:30:00.000Z', type: 'error', message: 'Erro fatal' },
        ];
        vi.mocked(TaskService.listEvents).mockResolvedValue(events);

        render(<TaskHistoryModal task={makeTask()} onClose={vi.fn()} />);

        expect(await screen.findByText('Task iniciada')).toBeInTheDocument();
        expect(screen.getByText('Erro fatal')).toBeInTheDocument();
        expect(screen.getByText('start')).toBeInTheDocument();
        expect(screen.getByText('error')).toBeInTheDocument();
        // spinner já sumiu depois do fetch on-demand
        expect(screen.queryByTestId('history-loading')).not.toBeInTheDocument();
    });

    it('exibe estado vazio quando não há eventos', async () => {
        vi.mocked(TaskService.listEvents).mockResolvedValue([]);
        render(<TaskHistoryModal task={makeTask()} onClose={vi.fn()} />);
        expect(await screen.findByText('Nenhum evento registrado')).toBeInTheDocument();
        expect(screen.queryByTestId('history-loading')).not.toBeInTheDocument();
    });

    it('não quebra se listEvents falhar — encerra o loading sem travar a UI', async () => {
        vi.mocked(TaskService.listEvents).mockRejectedValue(new Error('network'));
        render(<TaskHistoryModal task={makeTask()} onClose={vi.fn()} />);
        // o catch encerra o loading; a UI cai no estado vazio (resiliente, não trava)
        expect(await screen.findByText('Nenhum evento registrado')).toBeInTheDocument();
        expect(screen.queryByTestId('history-loading')).not.toBeInTheDocument();
    });

    it('chama onClose ao clicar no botão fechar', () => {
        vi.mocked(TaskService.listEvents).mockResolvedValue([]);
        const onClose = vi.fn();
        render(<TaskHistoryModal task={makeTask()} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Fechar histórico' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('chama onClose ao clicar no backdrop (overlay externo)', () => {
        vi.mocked(TaskService.listEvents).mockResolvedValue([]);
        const onClose = vi.fn();
        render(<TaskHistoryModal task={makeTask()} onClose={onClose} />);
        // o overlay é o próprio elemento com data-testid="task-history-modal"
        fireEvent.click(screen.getByTestId('task-history-modal'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
