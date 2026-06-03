import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProduceModal } from '../../components/Manufacturing/modals/ProduceModal';
import { DolibarrConfig, Warehouse, ManufacturingOrder } from '../../types';

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

const mockWarehouses: Warehouse[] = [
    { id: '1', label: 'Armazém Principal', description: '', statut: '1' },
    { id: '2', label: 'Armazém Secundário', description: '', statut: '1' },
];

const mockMO: ManufacturingOrder = {
    id: '1',
    ref: 'MO001',
    label: 'Ordem de Produção',
    product_to_produce_id: '1',
    qty: 10,
    status: '1'
};

describe('ProduceModal', () => {
    const mockOnClose = vi.fn();
    const mockOnNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <ProduceModal
                isOpen={false}
                onClose={mockOnClose}
                config={mockConfig}
                warehouses={mockWarehouses}
                selectedMO={mockMO}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.queryByText('Produzir Saída')).not.toBeInTheDocument();
    });

    it('renders modal when isOpen is true', () => {
        render(
            <ProduceModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                warehouses={mockWarehouses}
                selectedMO={mockMO}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Produzir Saída')).toBeInTheDocument();
    });

    it('renders warehouse dropdown with options', () => {
        render(
            <ProduceModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                warehouses={mockWarehouses}
                selectedMO={mockMO}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Selecionar Armazém...')).toBeInTheDocument();
        expect(screen.getByText('Armazém Principal')).toBeInTheDocument();
        expect(screen.getByText('Armazém Secundário')).toBeInTheDocument();
    });

    it('renders quantity input', () => {
        render(
            <ProduceModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                warehouses={mockWarehouses}
                selectedMO={mockMO}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Quantidade')).toBeInTheDocument();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <ProduceModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                warehouses={mockWarehouses}
                selectedMO={mockMO}
                onNavigate={mockOnNavigate}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('updates quantity when typing', () => {
        render(
            <ProduceModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                warehouses={mockWarehouses}
                selectedMO={mockMO}
                onNavigate={mockOnNavigate}
            />
        );
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '5' } });
        expect(input.value).toBe('5');
    });

    it('shows "Confirmar" button text', () => {
        render(
            <ProduceModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                warehouses={mockWarehouses}
                selectedMO={mockMO}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Confirmar')).toBeInTheDocument();
    });
});
