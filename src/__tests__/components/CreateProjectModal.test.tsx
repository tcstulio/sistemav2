import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateProjectModal } from '../../components/Projects/modals/CreateProjectModal';
import { ThirdParty } from '../../types/crm';

describe('CreateProjectModal', () => {
    const mockOnClose = vi.fn();
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockCustomer = (id: string, name: string): ThirdParty => ({
        id,
        name,
        status: '1',
        client: '1',
        fournisseur: '0',
        email: undefined,
        phone: undefined,
        phone_mobile: undefined
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <CreateProjectModal
                isOpen={false}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={[]}
                isSubmitting={false}
            />
        );
        expect(screen.queryByText('Novo Projeto')).not.toBeInTheDocument();
    });

    it('renders modal when isOpen is true', () => {
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={[]}
                isSubmitting={false}
            />
        );
        expect(screen.getByText('Novo Projeto')).toBeInTheDocument();
    });

    it('renders form fields', () => {
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={[]}
                isSubmitting={false}
            />
        );
        expect(screen.getByText('Referência')).toBeInTheDocument();
        expect(screen.getByText('Título')).toBeInTheDocument();
        expect(screen.getByText('Cliente (SocID)')).toBeInTheDocument();
        expect(screen.getByText('Descrição')).toBeInTheDocument();
        expect(screen.getByText('Orçamento (R$)')).toBeInTheDocument();
    });

    it('calls onClose when X button is clicked', () => {
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={[]}
                isSubmitting={false}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: '' }));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={[]}
                isSubmitting={false}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onSubmit with form data including new fields when submitting', async () => {
        const customers = [createMockCustomer('1', 'Empresa Teste')];
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={customers}
                isSubmitting={false}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('PROJ-2024-001'), { target: { value: 'TEST-001' } });
        fireEvent.change(screen.getByPlaceholderText('Nome do projeto'), { target: { value: 'Meu Projeto' } });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
        fireEvent.change(screen.getByPlaceholderText('Descrição do projeto (opcional)'), { target: { value: 'Minha descrição' } });
        fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '10000' } });

        fireEvent.click(screen.getByText('Criar Projeto'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
            ref: 'TEST-001',
            title: 'Meu Projeto',
            socid: '1',
            description: 'Minha descrição',
            budget_amount: '10000'
        }));
    });

    it('calls onSubmit with basic fields when no optional fields filled', async () => {
        const customers = [createMockCustomer('1', 'Empresa Teste')];
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={customers}
                isSubmitting={false}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('PROJ-2024-001'), { target: { value: 'TEST-001' } });
        fireEvent.change(screen.getByPlaceholderText('Nome do projeto'), { target: { value: 'Meu Projeto' } });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });

        fireEvent.click(screen.getByText('Criar Projeto'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
            ref: 'TEST-001',
            title: 'Meu Projeto',
            socid: '1'
        }));
    });

    it('auto-uppercases reference input', () => {
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={[]}
                isSubmitting={false}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('PROJ-2024-001'), { target: { value: 'test-001' } });
        expect(screen.getByPlaceholderText('PROJ-2024-001')).toHaveValue('TEST-001');
    });

    it('shows creating text when isSubmitting is true', () => {
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={[]}
                isSubmitting={true}
            />
        );
        expect(screen.getByText('Criando...')).toBeInTheDocument();
    });

    it('disables submit button when isSubmitting is true', () => {
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={[]}
                isSubmitting={true}
            />
        );
        const submitButton = screen.getByRole('button', { name: 'Criando...' });
        expect(submitButton).toBeDisabled();
    });

    it('renders customer options', () => {
        const customers = [
            createMockCustomer('1', 'Empresa A'),
            createMockCustomer('2', 'Empresa B')
        ];
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={customers}
                isSubmitting={false}
            />
        );
        expect(screen.getByText('Empresa A')).toBeInTheDocument();
        expect(screen.getByText('Empresa B')).toBeInTheDocument();
    });

    it('renders date start and date end fields', () => {
        render(
            <CreateProjectModal
                isOpen={true}
                onClose={mockOnClose}
                onSubmit={mockOnSubmit}
                customers={[]}
                isSubmitting={false}
            />
        );
        expect(screen.getByText('Data Início')).toBeInTheDocument();
        expect(screen.getByText('Data Fim')).toBeInTheDocument();
    });
});
