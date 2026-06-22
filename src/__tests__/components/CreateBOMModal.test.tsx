import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateBOMModal } from '../../components/Manufacturing/modals/CreateBOMModal';
import { DolibarrConfig, Product } from '../../types';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createBOM: vi.fn().mockResolvedValue('42'),
        updateObject: vi.fn().mockResolvedValue({}),
        addBOMLine: vi.fn().mockResolvedValue({}),
        updateBOMLine: vi.fn().mockResolvedValue({}),
        deleteBOMLine: vi.fn().mockResolvedValue({}),
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

describe('CreateBOMModal — BOM Line Editing (#585)', () => {
    const mockOnClose = vi.fn();
    const mockOnSuccess = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows "Adicionar componente" button', () => {
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        expect(screen.getByTestId('bom-add-line-btn')).toBeInTheDocument();
    });

    it('adds a new component line when "Adicionar componente" is clicked', () => {
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        // Initially no lines
        expect(screen.queryByTestId('bom-line-0')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('bom-add-line-btn'));

        expect(screen.getByTestId('bom-line-0')).toBeInTheDocument();
    });

    it('removes a component line when the trash button is clicked', () => {
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
            />
        );
        fireEvent.click(screen.getByTestId('bom-add-line-btn'));
        expect(screen.getByTestId('bom-line-0')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('bom-remove-line-0'));
        expect(screen.queryByTestId('bom-line-0')).not.toBeInTheDocument();
    });

    it('seeds existing lines in edit mode', () => {
        const existingLines = [
            { id: 'l1', parent_id: 'bom1', fk_product: '1', qty: 3, efficiency: 1 },
        ];
        render(
            <CreateBOMModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                products={mockProducts}
                onSuccess={mockOnSuccess}
                editId="bom1"
                initialLines={existingLines}
                initialForm={{ label: 'Teste', product_id: '1', qty: '1', duration: '3600' }}
            />
        );
        expect(screen.getByTestId('bom-line-0')).toBeInTheDocument();
    });
});

describe('CreateBOMModal — Service API URLs (#585)', () => {
    it('calls addBOMLine with correct bomId after create', async () => {
        const { DolibarrService } = await import('../../services/dolibarrService');
        (DolibarrService.createBOM as ReturnType<typeof vi.fn>).mockResolvedValue('99');

        const { container } = render(
            <CreateBOMModal
                isOpen={true}
                onClose={vi.fn()}
                config={mockConfig}
                products={mockProducts}
                onSuccess={vi.fn()}
            />
        );

        // Select a product
        const selects = container.querySelectorAll('select');
        fireEvent.change(selects[0], { target: { value: '1' } });

        // Add a line
        fireEvent.click(screen.getByTestId('bom-add-line-btn'));
        const lineSelects = container.querySelectorAll('select');
        // last select is the new line product
        fireEvent.change(lineSelects[lineSelects.length - 1], { target: { value: '2' } });

        // Submit
        fireEvent.click(screen.getByText('Criar'));

        // wait microtasks
        await new Promise(r => setTimeout(r, 0));

        expect(DolibarrService.createBOM).toHaveBeenCalled();
        expect(DolibarrService.addBOMLine).toHaveBeenCalledWith(
            mockConfig,
            '99',
            expect.objectContaining({ fk_product: '2' })
        );
    });
});
