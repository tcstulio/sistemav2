import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));

const mockRequest = vi.fn();
vi.mock('../../services/api/core', () => ({
    fetchList: vi.fn(),
    request: (...args: any[]) => mockRequest(...args),
    getHeaders: (key: string) => ({ DOLAPIKEY: key }),
    sanitizeUrl: () => '',
}));

import {
    deleteManufacturingOrder,
    deleteBOM,
    validateManufacturingOrder,
    cancelManufacturingOrder,
    addBOMLine,
    updateBOMLine,
    deleteBOMLine,
} from '../../services/api/inventory';

const config = { apiUrl: 'http://x', apiKey: 'k' } as any;

describe('inventory.ts — #585 new API methods', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRequest.mockResolvedValue({});
    });

    it('deleteManufacturingOrder sends DELETE to /mrp/mo/:id', async () => {
        await deleteManufacturingOrder(config, '42');
        expect(mockRequest).toHaveBeenCalledWith(
            '/mrp/mo/42',
            expect.objectContaining({ method: 'DELETE' })
        );
    });

    it('deleteBOM sends DELETE to /boms/:id', async () => {
        await deleteBOM(config, '7');
        expect(mockRequest).toHaveBeenCalledWith(
            '/boms/7',
            expect.objectContaining({ method: 'DELETE' })
        );
    });

    it('validateManufacturingOrder sends POST to /mrp/mo/:id/validate', async () => {
        await validateManufacturingOrder(config, '5');
        expect(mockRequest).toHaveBeenCalledWith(
            '/mrp/mo/5/validate',
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('cancelManufacturingOrder sends POST to /mrp/mo/:id/cancel', async () => {
        await cancelManufacturingOrder(config, '5');
        expect(mockRequest).toHaveBeenCalledWith(
            '/mrp/mo/5/cancel',
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('addBOMLine sends POST to /boms/:bomId/lines', async () => {
        await addBOMLine(config, 'bom1', { fk_product: '2', qty: 3, efficiency: 1 });
        expect(mockRequest).toHaveBeenCalledWith(
            '/boms/bom1/lines',
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('updateBOMLine sends PUT to /boms/:bomId/lines/:lineId', async () => {
        await updateBOMLine(config, 'bom1', 'line9', { qty: 2 });
        expect(mockRequest).toHaveBeenCalledWith(
            '/boms/bom1/lines/line9',
            expect.objectContaining({ method: 'PUT' })
        );
    });

    it('deleteBOMLine sends DELETE to /boms/:bomId/lines/:lineId', async () => {
        await deleteBOMLine(config, 'bom1', 'line9');
        expect(mockRequest).toHaveBeenCalledWith(
            '/boms/bom1/lines/line9',
            expect.objectContaining({ method: 'DELETE' })
        );
    });
});
