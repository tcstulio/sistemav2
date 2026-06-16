import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskConsole from '../../components/TasksBoard/TaskConsole';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { TaskService } from '../../services/taskService';

// --- Capture socket `on` handlers so tests can emit events ---
let socketHandlers: Record<string, (...args: any[]) => void> = {};

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => ({
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
            socketHandlers[event] = handler;
        }),
        disconnect: vi.fn(),
    })),
    Socket: {} as any,
}));

vi.mock('../../services/taskService', () => ({
    TaskService: {
        listEvents: vi.fn().mockResolvedValue([]),
        getMetrics: vi.fn().mockResolvedValue({ metricsAvailable: false }),
        kill: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ currentUser: { admin: 1 } })),
}));

const renderWithProvider = (props?: Partial<React.ComponentProps<typeof TaskConsole>>) =>
    render(
        <ConfirmProvider>
            <TaskConsole issueNumber={123} onClose={vi.fn()} {...props} />
        </ConfirmProvider>
    );

const emitStatus = (status: string) => {
    const handler = socketHandlers['task:123:status'];
    if (handler) handler({ status, updatedAt: new Date().toISOString() });
};

describe('TaskConsole', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        socketHandlers = {};
        vi.mocked(TaskService.kill).mockResolvedValue({} as any);
    });

    it('renders console with task number', async () => {
        renderWithProvider();
        expect(screen.getByText(/Task #123/)).toBeTruthy();
    });

    it('shows in-app confirm dialog (not native) when clicking Matar task', async () => {
        const user = userEvent.setup();
        const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
        renderWithProvider();

        await waitFor(() => {
            expect(screen.getByText(/histórico carregado/i)).toBeTruthy();
        });

        emitStatus('running');

        const killBtn = await screen.findByTitle(/Matar o processo/i);
        await user.click(killBtn);

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Matar a task #123/i)).toBeTruthy();
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('calls TaskService.kill when user confirms', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        await waitFor(() => {
            expect(screen.getByText(/histórico carregado/i)).toBeTruthy();
        });

        emitStatus('running');

        const killBtn = await screen.findByTitle(/Matar o processo/i);
        await user.click(killBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Matar'));

        await waitFor(() => {
            expect(TaskService.kill).toHaveBeenCalledWith(123, 'user kill from TaskConsole');
        });
    });

    it('does NOT call TaskService.kill when user cancels', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        await waitFor(() => {
            expect(screen.getByText(/histórico carregado/i)).toBeTruthy();
        });

        emitStatus('running');

        const killBtn = await screen.findByTitle(/Matar o processo/i);
        await user.click(killBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(TaskService.kill).not.toHaveBeenCalled();
        });
    });

    it('survives kill failure without native alert (uses notifyError)', async () => {
        vi.mocked(TaskService.kill).mockRejectedValueOnce(new Error('Network error'));

        const user = userEvent.setup();
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        renderWithProvider();

        await waitFor(() => {
            expect(screen.getByText(/histórico carregado/i)).toBeTruthy();
        });

        emitStatus('running');

        const killBtn = await screen.findByTitle(/Matar o processo/i);
        await user.click(killBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Matar'));

        await waitFor(() => {
            expect(TaskService.kill).toHaveBeenCalled();
        });

        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });
});
