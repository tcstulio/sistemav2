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
        description: '',
        budget_amount: ''
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

    // --- #624: new fields ---

    it('renders description textarea field', () => {
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
        expect(screen.getByText('Descrição')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Descrição do projeto (opcional)')).toBeInTheDocument();
    });

    it('calls setForm with updated description when description changes', () => {
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
        const textarea = screen.getByPlaceholderText('Descrição do projeto (opcional)');
        fireEvent.change(textarea, { target: { value: 'Nova descrição do projeto' } });
        expect(mockSetForm).toHaveBeenCalledWith(expect.objectContaining({ description: 'Nova descrição do projeto' }));
    });

    it('renders existing description when form has description', () => {
        const formWithDescription = { ...defaultForm, description: 'Descrição existente' };
        render(
            <EditProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={formWithDescription}
                setForm={mockSetForm}
                isSubmitting={false}
            />
        );
        expect(screen.getByDisplayValue('Descrição existente')).toBeInTheDocument();
    });

    it('renders budget_amount field', () => {
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
        expect(screen.getByText('Orçamento (R$)')).toBeInTheDocument();
    });

    it('calls setForm with updated budget_amount when budget changes', () => {
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
        const budgetInput = screen.getByPlaceholderText('0,00');
        fireEvent.change(budgetInput, { target: { value: '5000' } });
        expect(mockSetForm).toHaveBeenCalledWith(expect.objectContaining({ budget_amount: '5000' }));
    });
});
