import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConsumeModal } from '../../components/Manufacturing/modals/ConsumeModal';
import { DolibarrConfig, Product, Warehouse } from '../../types';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createStockCorrection: vi.fn().mockResolvedValue({ id: '1' }),
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

const mockWarehouses: Warehouse[] = [
    { id: '1', label: 'Armazém Principal', description: '' },
    { id: '2', label: 'Armazém Secundário', description: '' },
];

describe('ConsumeModal', () => {
    const mockOnClose = vi.fn();
    const mockOnNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <ConsumeModal
                isOpen={false}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                warehouses={mockWarehouses}
                selectedMORef="MO001"
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.queryByText('Consumir Material')).not.toBeInTheDocument();
    });

    it('renders modal when isOpen is true', () => {
        render(
            <ConsumeModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                warehouses={mockWarehouses}
                selectedMORef="MO001"
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Consumir Material')).toBeInTheDocument();
    });

    it('renders product dropdown with options', () => {
        render(
            <ConsumeModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                warehouses={mockWarehouses}
                selectedMORef="MO001"
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Selecionar Matéria Prima...')).toBeInTheDocument();
        expect(screen.getByText('Produto A')).toBeInTheDocument();
        expect(screen.getByText('Produto B')).toBeInTheDocument();
    });

    it('renders warehouse dropdown with options', () => {
        render(
            <ConsumeModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                warehouses={mockWarehouses}
                selectedMORef="MO001"
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Selecionar Armazém...')).toBeInTheDocument();
        expect(screen.getByText('Armazém Principal')).toBeInTheDocument();
        expect(screen.getByText('Armazém Secundário')).toBeInTheDocument();
    });

    it('renders quantity input', () => {
        render(
            <ConsumeModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                warehouses={mockWarehouses}
                selectedMORef="MO001"
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Quantidade')).toBeInTheDocument();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <ConsumeModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                warehouses={mockWarehouses}
                selectedMORef="MO001"
                onNavigate={mockOnNavigate}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('updates quantity when typing', () => {
        render(
            <ConsumeModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                warehouses={mockWarehouses}
                selectedMORef="MO001"
                onNavigate={mockOnNavigate}
            />
        );
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '5' } });
        expect(input.value).toBe('5');
    });

    it('shows Confirmar button text', () => {
        render(
            <ConsumeModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                warehouses={mockWarehouses}
                selectedMORef="MO001"
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Confirmar')).toBeInTheDocument();
    });
});
