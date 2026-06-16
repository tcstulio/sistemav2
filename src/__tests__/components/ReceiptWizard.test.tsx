import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockAi = vi.hoisted(() => ({
    extractReceiptData: vi.fn(),
}));

const mockDolibarr = vi.hoisted(() => ({
    createProduct: vi.fn(),
}));

vi.mock('../../services/aiService', () => ({ AiService: mockAi }));
vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockDolibarr }));
vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: { url: 'http://test', key: 'test-key' } }),
}));
vi.mock('../../hooks/dolibarr', () => ({
    useSuppliers: () => ({ data: [] }),
    useProducts: () => ({ data: [] }),
}));
vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    },
}));

import { ReceiptWizard } from '../../components/Finance/ReceiptWizard';
import { ConfirmProvider } from '../../hooks/useConfirm';

class MockFileReader {
    result: string | null = 'data:image/png;base64,mock';
    onloadend: (() => void) | null = null;
    onerror: ((ev: ProgressEvent) => void) | null = null;
    readAsDataURL() {
        this.onloadend?.();
    }
}

const renderWithProvider = (ui: React.ReactElement) =>
    render(<ConfirmProvider>{ui}</ConfirmProvider>);

describe('ReceiptWizard - handleCreateProduct', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('FileReader', MockFileReader);
        mockAi.extractReceiptData.mockResolvedValue({
            vendor: 'Test Vendor',
            date: '2024-01-15',
            total: '100.00',
            items: [
                { description: 'Test Product', quantity: '2', unit_price: '40.00' },
            ],
        });
        mockDolibarr.createProduct.mockResolvedValue('new-prod-123');
    });

    async function navigateToItemsStep() {
        renderWithProvider(
            <ReceiptWizard onClose={vi.fn()} onInvoiceCreated={vi.fn()} />
        );

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['mock'], 'receipt.png', { type: 'image/png' });
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
            expect(screen.getByText('Próximo: Itens')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Próximo: Itens'));

        await waitFor(() => {
            expect(screen.getByText('Criar Produto')).toBeTruthy();
        });
    }

    it('creates product when user confirms', async () => {
        await navigateToItemsStep();

        fireEvent.click(screen.getByText('Criar Produto'));

        await waitFor(() => {
            expect(screen.getByText(/Deseja criar o produto/)).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Confirmar'));

        await waitFor(() => {
            expect(mockDolibarr.createProduct).toHaveBeenCalledTimes(1);
            expect(mockDolibarr.createProduct).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({ label: 'Test Product' })
            );
        });
    });

    it('does NOT create product when user cancels', async () => {
        await navigateToItemsStep();

        fireEvent.click(screen.getByText('Criar Produto'));

        await waitFor(() => {
            expect(screen.getByText(/Deseja criar o produto/)).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Cancelar'));

        await waitFor(() => {
            expect(mockDolibarr.createProduct).not.toHaveBeenCalled();
        });
    });
});
