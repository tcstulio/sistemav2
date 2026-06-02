import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateBOMModal } from '../../components/Manufacturing/modals/CreateBOMModal';
import { DolibarrConfig, Product } from '../../types';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createBOM: vi.fn().mockResolvedValue({ id: '1' }),
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
    { id: '1', ref: 'PROD-1', label: 'Produto A', price: 100, type: '0' as any },
    { id: '2', ref: 'PROD-2', label: 'Produto B', price: 200, type: '0' as any },
];

describe('CreateBOMModal', () => {
    const mockOnClose = vi.fn();
    const mockOnSuccess = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <CreateBOMModal
                isOpen={false}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.queryByText('Nova Lista de Materiais (BOM)')).not.toBeInTheDocument();
    });

    it('renders modal when isOpen is true', () => {
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByText('Nova Lista de Materiais (BOM)')).toBeInTheDocument();
    });

    it('renders form inputs', () => {
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByPlaceholderText('BOM Padrão')).toBeInTheDocument();
        expect(screen.getByText('Produto')).toBeInTheDocument();
        expect(screen.getByText('Qtd Produzida')).toBeInTheDocument();
        expect(screen.getByText('Duração (seg)')).toBeInTheDocument();
    });

    it('renders product dropdown with options', () => {
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByText('Selecionar...')).toBeInTheDocument();
        expect(screen.getByText('Produto A')).toBeInTheDocument();
        expect(screen.getByText('Produto B')).toBeInTheDocument();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('updates label when typing', () => {
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        const input = screen.getByPlaceholderText('BOM Padrão') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Nova BOM' } });
        expect(input.value).toBe('Nova BOM');
    });

    it('shows "Criar" button text', () => {
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByText('Criar')).toBeInTheDocument();
    });
});
