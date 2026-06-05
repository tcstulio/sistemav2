import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskModal } from '../../components/Projects/modals/TaskModal';

describe('TaskModal', () => {
    const mockOnClose = vi.fn();
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined);
    const mockSetForm = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultForm = {
        label: 'Tarefa Teste',
        description: '',
        planned_workload: 8,
        date_start: '2024-01-01',
        date_end: '2024-01-31',
        fk_user_assign: ''
    };

    it('renders nothing when isOpen is false', () => {
        render(
            <TaskModal
                isOpen={false}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        expect(screen.queryByText('Nova Tarefa')).not.toBeInTheDocument();
    });

    it('renders "Nova Tarefa" when isEditing is false', () => {
        render(
            <TaskModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        expect(screen.getByText('Nova Tarefa')).toBeInTheDocument();
    });

    it('renders "Editar Tarefa" when isEditing is true', () => {
        render(
            <TaskModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={true}
            />
        );
        expect(screen.getByText('Editar Tarefa')).toBeInTheDocument();
    });

    it('renders form with current values', () => {
        render(
            <TaskModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        expect(screen.getByDisplayValue('Tarefa Teste')).toBeInTheDocument();
    });

    it('calls onClose when X button is clicked', () => {
        render(
            <TaskModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: '' }));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <TaskModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls setForm when label changes', () => {
        render(
            <TaskModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        fireEvent.change(screen.getByDisplayValue('Tarefa Teste'), { target: { value: 'Novo Label' } });
        expect(mockSetForm).toHaveBeenCalled();
    });

    it('calls onSubmit when form is submitted', () => {
        render(
            <TaskModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        fireEvent.click(screen.getByText('Criar'));
        expect(mockOnSubmit).toHaveBeenCalled();
    });

    it('shows saving text when isSubmitting is true', () => {
        render(
            <TaskModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={true}
                isEditing={false}
            />
        );
        expect(screen.getByText('Salvando...')).toBeInTheDocument();
    });
});