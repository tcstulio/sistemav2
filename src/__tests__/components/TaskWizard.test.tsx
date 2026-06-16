import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: vi.fn(),
}));

const mockAi = vi.hoisted(() => ({
    generateProjectTasks: vi.fn(),
}));

const mockDolibarr = vi.hoisted(() => ({
    createTask: vi.fn(),
    setTaskContact: vi.fn(),
}));

vi.mock('../../services/aiService', () => ({ AiService: mockAi }));
vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockDolibarr }));
vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    },
}));

import { TaskWizard } from '../../components/Projects/TaskWizard';
import { notifyError } from '../../utils/notifyError';
import type { Project, DolibarrConfig, DolibarrUser } from '../../types';

const mockProject: Project = {
    id: 'proj-1',
    ref: 'PROJ001',
    title: 'Test Project',
    socid: '1',
    statut: '1',
    progress: 0,
};

const mockConfig: DolibarrConfig = {
    apiUrl: 'http://test',
    apiKey: 'test-key',
    themeColor: '#000',
    darkMode: false,
};

const mockUsers: DolibarrUser[] = [
    { id: 'u1', login: 'jdoe', firstname: 'John', lastname: 'Doe', statut: '1' },
];

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    project: mockProject,
    config: mockConfig,
    users: mockUsers,
    allProjects: [],
    allTasks: [],
    onSuccess: vi.fn(),
};

describe('TaskWizard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDolibarr.createTask.mockResolvedValue({ id: 'task-1' });
        mockDolibarr.setTaskContact.mockResolvedValue(undefined);
        mockAi.generateProjectTasks.mockResolvedValue([]);
    });

    it('shows toast.error when submitting without any task title', async () => {
        render(<TaskWizard {...defaultProps} />);

        const submitBtn = screen.getByText('Confirmar Criação');
        expect(submitBtn).toBeDisabled();

        expect(toast.error).not.toHaveBeenCalled();
    });

    it('creates tasks and calls onSuccess on valid submit', async () => {
        const onSuccess = vi.fn();
        const onClose = vi.fn();
        render(<TaskWizard {...defaultProps} onSuccess={onSuccess} onClose={onClose} />);

        const titleInput = screen.getByPlaceholderText('Título da tarefa...') as HTMLInputElement;
        await userEvent.type(titleInput, 'Minha Tarefa');

        const submitBtn = screen.getByText('Confirmar Criação');
        expect(submitBtn).not.toBeDisabled();
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(mockDolibarr.createTask).toHaveBeenCalledTimes(1);
        });

        await waitFor(() => {
            expect(onSuccess).toHaveBeenCalledTimes(1);
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    it('uses notifyError when createTask fails', async () => {
        const error = new Error('Network error');
        mockDolibarr.createTask.mockRejectedValue(error);

        const onSuccess = vi.fn();
        render(<TaskWizard {...defaultProps} onSuccess={onSuccess} />);

        const titleInput = screen.getByPlaceholderText('Título da tarefa...') as HTMLInputElement;
        await userEvent.type(titleInput, 'Tarefa Falha');

        fireEvent.click(screen.getByText('Confirmar Criação'));

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Criar tarefas', error);
        });
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('uses notifyError when AI generation fails', async () => {
        const error = new Error('AI unavailable');
        mockAi.generateProjectTasks.mockRejectedValue(error);

        render(<TaskWizard {...defaultProps} />);

        fireEvent.click(screen.getByText('Magic Fill (IA)'));

        const generateBtn = await screen.findByText('Gerar Tarefas');
        fireEvent.click(generateBtn);

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Gerar sugestões com IA', error);
        });
    });

    it('shows toast.error when importing from project with no tasks', async () => {
        render(
            <TaskWizard
                {...defaultProps}
                allProjects={[{ ...mockProject, id: 'proj-2', ref: 'OTHER', title: 'Other' }]}
                allTasks={[]}
            />
        );

        fireEvent.click(screen.getByText('Importar de Projeto...'));

        const otherProject = await screen.findByText('OTHER');
        fireEvent.click(otherProject);

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Projeto selecionado não possui tarefas.');
        });
    });

    it('imports tasks from another project', async () => {
        render(
            <TaskWizard
                {...defaultProps}
                allProjects={[{ ...mockProject, id: 'proj-2', ref: 'OTHER', title: 'Other' }]}
                allTasks={[
                    { id: 't1', ref: 'T1', label: 'Imported Task', project_id: 'proj-2', progress: 0, planned_workload: 3600 },
                ]}
            />
        );

        fireEvent.click(screen.getByText('Importar de Projeto...'));

        const otherProject = await screen.findByText('OTHER');
        fireEvent.click(otherProject);

        await waitFor(() => {
            expect(screen.getByDisplayValue('Imported Task')).toBeTruthy();
        });
    });
});
