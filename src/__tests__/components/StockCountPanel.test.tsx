import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSvc = vi.hoisted(() => ({
    getDelegation: vi.fn(),
    setDelegationTemplate: vi.fn().mockResolvedValue({ success: true }),
    createStockMovement: vi.fn().mockResolvedValue({}),
    updateTask: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockSvc }));
vi.mock('../../utils/logger', () => ({ logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

import { StockCountPanel } from '../../components/Tasks/StockCountPanel';

const config = { apiUrl: '', apiKey: '' } as any;
const products = [
    { id: 'a', label: 'Cerveja', stock: 10 },
    { id: 'b', label: 'Refri', stock: 5 },
];
const warehouses = [{ id: '1', label: 'Central' }];

describe('StockCountPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getDelegation.mockResolvedValue(null);
    });

    it('sem template: oferece iniciar a contagem escolhendo o armazém', async () => {
        render(<StockCountPanel config={config} taskId="50" products={products} warehouses={warehouses} />);
        await screen.findByText('Iniciar contagem');
        fireEvent.change(screen.getByLabelText('Armazém'), { target: { value: '1' } });
        fireEvent.click(screen.getByText('Iniciar contagem'));
        await waitFor(() => expect(mockSvc.setDelegationTemplate).toHaveBeenCalledWith(config, '50', 'contagem_de_estoque', { warehouseId: '1' }));
    });

    it('com template: registra só os itens que mudaram e conclui a tarefa', async () => {
        mockSvc.getDelegation.mockResolvedValue({ taskId: '50', template: 'contagem_de_estoque', templateConfig: { warehouseId: '1' } });
        render(<StockCountPanel config={config} taskId="50" products={products} warehouses={warehouses} />);
        await screen.findByText('Registrar contagem');
        fireEvent.change(screen.getByLabelText('Contagem Cerveja'), { target: { value: '8' } });  // 10 -> 8 (delta -2)
        fireEvent.change(screen.getByLabelText('Contagem Refri'), { target: { value: '5' } });    // sem mudança
        fireEvent.click(screen.getByText('Registrar contagem'));
        await waitFor(() => {
            expect(mockSvc.createStockMovement).toHaveBeenCalledTimes(1);
            expect(mockSvc.createStockMovement).toHaveBeenCalledWith(config, expect.objectContaining({ product_id: 'a', warehouse_id: '1', qty: -2 }));
            expect(mockSvc.updateTask).toHaveBeenCalledWith(config, '50', { progress: 100 });
        });
    });

    it('contagem incompleta não registra nada', async () => {
        mockSvc.getDelegation.mockResolvedValue({ taskId: '50', template: 'contagem_de_estoque', templateConfig: { warehouseId: '1' } });
        render(<StockCountPanel config={config} taskId="50" products={products} warehouses={warehouses} />);
        await screen.findByText('Registrar contagem');
        fireEvent.change(screen.getByLabelText('Contagem Cerveja'), { target: { value: '8' } }); // Refri fica vazio
        fireEvent.click(screen.getByText('Registrar contagem'));
        await waitFor(() => expect(mockSvc.createStockMovement).not.toHaveBeenCalled());
        expect(mockSvc.updateTask).not.toHaveBeenCalled();
    });
});
