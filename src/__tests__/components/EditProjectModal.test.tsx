import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditProjectModal } from '../../components/Projects/modals/EditProjectModal';

describe('EditProjectModal', () => {
    const mockOnClose = vi.fn();
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined);
    const mockSetForm = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultForm = {
        title: 'Projeto Teste',
        status: '1',
        date_start: '2024-01-01',
        date_end: '2024-12-31',
        description: ''
    };

    it('renders nothing when isOpen is false', () => {
        render(
            <EditProjectModal
                isOpen={false}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
            />
        );
        expect(screen.queryByText('Editar Projeto')).not.toBeInTheDocument();
    });

    it('renders modal when isOpen is true', () => {
        render(
            <EditProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
            />
        );
        expect(screen.getByText('Editar Projeto')).toBeInTheDocument();
    });

    it('renders form with current values', () => {
        render(
            <EditProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
            />
        );
        expect(screen.getByDisplayValue('Projeto Teste')).toBeInTheDocument();
    });

    it('calls onClose when X button is clicked', () => {
        render(
            <EditProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: '' }));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <EditProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls setForm when title changes', () => {
        render(
            <EditProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
            />
        );
        fireEvent.change(screen.getByDisplayValue('Projeto Teste'), { target: { value: 'Novo Título' } });
        expect(mockSetForm).toHaveBeenCalled();
    });

    it('renders all status options', () => {
        render(
            <EditProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
            />
        );
        expect(screen.getByText('Rascunho')).toBeInTheDocument();
        expect(screen.getByText('Aberto')).toBeInTheDocument();
        expect(screen.getByText('Fechado')).toBeInTheDocument();
    });

    it('calls onSubmit when form is submitted', () => {
        render(
            <EditProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
            />
        );
        fireEvent.click(screen.getByText('Salvar Alterações'));
        expect(mockOnSubmit).toHaveBeenCalled();
    });

    it('shows saving text when isSubmitting is true', () => {
        render(
            <EditProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={true}
            />
        );
        expect(screen.getByText('Salvando...')).toBeInTheDocument();
    });
});