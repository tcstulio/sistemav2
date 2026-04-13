import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskTimeDialog } from '../../components/Tasks/TaskTimeDialog';
import { Task } from '../../types/projects';

vi.mock('../../services/dbService', () => ({
    dbService: {
        add: vi.fn().mockResolvedValue({ id: '1' }),
    }
}));

const mockTask: Task = {
    id: '1',
    ref: 'TASK001',
    label: 'Tarefa de Teste',
    project_id: '1',
    progress: 0
};

describe('TaskTimeDialog', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <TaskTimeDialog
                task={mockTask}
                isOpen={false}
                onClose={mockOnClose}
            />
        );
        expect(screen.queryByText('Registrar Tempo')).not.toBeInTheDocument();
    });

    it('renders modal when isOpen is true', () => {
        render(
            <TaskTimeDialog
                task={mockTask}
                isOpen={true}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Registrar Tempo')).toBeInTheDocument();
    });

    it('displays task label', () => {
        render(
            <TaskTimeDialog
                task={mockTask}
                isOpen={true}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Tarefa de Teste')).toBeInTheDocument();
    });

    it('renders form inputs', () => {
        render(
            <TaskTimeDialog
                task={mockTask}
                isOpen={true}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Data')).toBeInTheDocument();
        expect(screen.getByText('Início (Opcional)')).toBeInTheDocument();
        expect(screen.getByText('Duração (horas)')).toBeInTheDocument();
        expect(screen.getByText('Nota (Opcional)')).toBeInTheDocument();
    });

    it('renders duration placeholder', () => {
        render(
            <TaskTimeDialog
                task={mockTask}
                isOpen={true}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByPlaceholderText('ex: 1.5 ou 1:30')).toBeInTheDocument();
    });

    it('calls onClose when X button is clicked', () => {
        render(
            <TaskTimeDialog
                task={mockTask}
                isOpen={true}
                onClose={mockOnClose}
            />
        );
        const closeButton = screen.getAllByRole('button')[0];
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <TaskTimeDialog
                task={mockTask}
                isOpen={true}
                onClose={mockOnClose}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('updates duration when typing', () => {
        render(
            <TaskTimeDialog
                task={mockTask}
                isOpen={true}
                onClose={mockOnClose}
            />
        );
        const input = screen.getByPlaceholderText('ex: 1.5 ou 1:30') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '2.5' } });
        expect(input.value).toBe('2.5');
    });

    it('shows "Registrar" button text', () => {
        render(
            <TaskTimeDialog
                task={mockTask}
                isOpen={true}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Registrar')).toBeInTheDocument();
    });
});
