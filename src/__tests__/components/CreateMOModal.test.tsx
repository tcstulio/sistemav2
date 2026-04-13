import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateMOModal } from '../../components/Manufacturing/modals/CreateMOModal';
import { DolibarrConfig, Product, Project } from '../../types';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createManufacturingOrder: vi.fn().mockResolvedValue({ id: '1' }),
    }
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any
};

const mockProducts: Product[] = [
    { id: '1', label: 'Produto A', price: 100, type: '0' as any },
    { id: '2', label: 'Produto B', price: 200, type: '0' as any },
];

const mockProjects: Project[] = [
    { id: '1', ref: 'PRJ001', title: 'Projeto A', socid: '1', statut: '1' as any, progress: 0 },
    { id: '2', ref: 'PRJ002', title: 'Projeto B', socid: '1', statut: '1' as any, progress: 0 },
];

describe('CreateMOModal', () => {
    const mockOnClose = vi.fn();
    const mockOnSuccess = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <CreateMOModal
                isOpen={false}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                projects={mockProjects}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.queryByText('Nova Ordem de Produção')).not.toBeInTheDocument();
    });

    it('renders modal when isOpen is true', () => {
        render(
            <CreateMOModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                projects={mockProjects}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByText('Nova Ordem de Produção')).toBeInTheDocument();
    });

    it('renders form inputs', () => {
        render(
            <CreateMOModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                projects={mockProjects}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByPlaceholderText('Produção Lote #1')).toBeInTheDocument();
        expect(screen.getByText('Produto a Produzir')).toBeInTheDocument();
        expect(screen.getByText('Quantidade')).toBeInTheDocument();
        expect(screen.getByText('Data Início')).toBeInTheDocument();
        expect(screen.getByText('Projeto')).toBeInTheDocument();
    });

    it('renders product dropdown with options', () => {
        render(
            <CreateMOModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                projects={mockProjects}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByText('Selecionar...')).toBeInTheDocument();
        expect(screen.getByText('Produto A')).toBeInTheDocument();
        expect(screen.getByText('Produto B')).toBeInTheDocument();
    });

    it('renders project dropdown with options', () => {
        render(
            <CreateMOModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                projects={mockProjects}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByText('Nenhum')).toBeInTheDocument();
        expect(screen.getByText('Projeto A')).toBeInTheDocument();
        expect(screen.getByText('Projeto B')).toBeInTheDocument();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <CreateMOModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                projects={mockProjects}
                onSuccess={mockOnSuccess}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('updates label when typing', () => {
        render(
            <CreateMOModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                projects={mockProjects}
                onSuccess={mockOnSuccess}
            />
        );
        const input = screen.getByPlaceholderText('Produção Lote #1') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Novo Lote' } });
        expect(input.value).toBe('Novo Lote');
    });

    it('shows "Criar" button text', () => {
        render(
            <CreateMOModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                projects={mockProjects}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByText('Criar')).toBeInTheDocument();
    });
});
