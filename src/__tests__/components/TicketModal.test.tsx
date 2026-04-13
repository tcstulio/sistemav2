import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TicketModal } from '../../components/Projects/modals/TicketModal';

describe('TicketModal', () => {
    const mockOnClose = vi.fn();
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined);
    const mockSetForm = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultForm = {
        subject: 'Problema no Sistema',
        message: 'Descrição do problema',
        type_code: 'ISSUE',
        severity_code: 'NORMAL'
    };

    it('renders nothing when isOpen is false', () => {
        render(
            <TicketModal
                isOpen={false}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        expect(screen.queryByText('Novo Chamado')).not.toBeInTheDocument();
    });

    it('renders "Novo Chamado" when isEditing is false', () => {
        render(
            <TicketModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        expect(screen.getByText('Novo Chamado')).toBeInTheDocument();
    });

    it('renders "Editar Chamado" when isEditing is true', () => {
        render(
            <TicketModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={true}
            />
        );
        expect(screen.getByText('Editar Chamado')).toBeInTheDocument();
    });

    it('renders form with current values', () => {
        render(
            <TicketModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        expect(screen.getByDisplayValue('Problema no Sistema')).toBeInTheDocument();
    });

    it('calls onClose when X button is clicked', () => {
        render(
            <TicketModal
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
            <TicketModal
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

    it('renders type and severity options', () => {
        render(
            <TicketModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                form={defaultForm}
                setForm={mockSetForm}
                isSubmitting={false}
                isEditing={false}
            />
        );
        expect(screen.getByText('Incidente')).toBeInTheDocument();
        expect(screen.getByText('Requisição')).toBeInTheDocument();
        expect(screen.getByText('Baixa')).toBeInTheDocument();
        expect(screen.getByText('Normal')).toBeInTheDocument();
        expect(screen.getByText('Alta')).toBeInTheDocument();
    });

    it('calls onSubmit when form is submitted', () => {
        render(
            <TicketModal
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
            <TicketModal
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