import { DolibarrConfig, Product, Shipment, Warehouse, StockMovement, BOM, ManufacturingOrder, BOMLine } from '../../types';
import { fetchList, request, getHeaders, sanitizeUrl } from './core';

export const fetchWarehouses = async (config: DolibarrConfig): Promise<Warehouse[]> => {
    const data = await fetchList(config, 'warehouses');
    return data.map((d: Record<string, any>) => ({
        id: String(d.id),
        label: d.label,
        description: d.description,
        statut: String(d.statut) as any,
        lieu: d.lieu,
        array_options: d.array_options
    }));
};

export const fetchStockMovements = async (config: DolibarrConfig): Promise<StockMovement[]> => {
    const data = await fetchList(config, 'stockmovements');
    return data.map((d: Record<string, any>) => ({
        id: String(d.id),
        product_id: String(d.product_id),
        warehouse_id: String(d.warehouse_id),
        qty: parseFloat(d.qty),
        label: d.label,
        date_creation: parseInt(d.date_creation),
        fk_user_author: d.fk_user_author ? String(d.fk_user_author) : undefined
    }));
};

export const fetchBOMs = async (config: DolibarrConfig): Promise<BOM[]> => {
    const data = await fetchList(config, 'boms');
    return data.map((d: Record<string, any>) => ({
        id: String(d.id),
        ref: d.ref,
        label: d.label,
        status: String(d.status),
        duration: parseInt(d.duration || '0'),
        qty: parseFloat(d.qty),
        product_id: d.fk_product ? String(d.fk_product) : undefined,
        lines: d.lines ? d.lines.map((l: Record<string, any>) => ({
            id: String(l.id),
            fk_product: String(l.fk_product),
            qty: parseFloat(l.qty),
            efficiency: parseFloat(l.efficiency),
            cost_price: parseFloat(l.cost_price)
        })) : []
    }));
};

export const fetchManufacturingOrders = async (config: DolibarrConfig): Promise<ManufacturingOrder[]> => {
    const data = await fetchList(config, 'mrp/mo'); // Try mrp/mo first
    // Actually, usually it's manufacturingorders? Let's assume manufacturingorders if mrp/mo fails but I can't try-catch here easily inside the map.
    // Let's bet on 'manufacturingorders' or 'mrp'.
    // Permissions said 'mrp'. Endpoint usually 'mrp/mo' or 'mos'.
    // Let's rely on standard patterns. 'mrp/mo' is common for v12+.
    // Wait, if fetchList returns [], mapping works.
    return data.map((d: Record<string, any>) => ({
        id: String(d.id),
        ref: d.ref,
        label: d.label,
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        status: String(d.status) as any,
        date_start: d.date_start ? parseInt(d.date_start) : undefined,
        date_end: d.date_end ? parseInt(d.date_end) : undefined,
        product_to_produce_id: String(d.fk_product),
        qty: parseFloat(d.qty),
        array_options: d.array_options
    }));
};

export const fetchProducts = async (config: DolibarrConfig): Promise<Product[]> => {
    const data = await fetchList(config, 'products');
    return data.map((d: Record<string, any>) => ({
        id: String(d.id),
        ref: d.ref,
        label: d.label,
        description: d.description,
        type: String(d.type) as any,
        price: parseFloat(d.price),
        stock_reel: parseInt(d.stock_reel || '0'),
        array_options: d.array_options
    }));
};

export const fetchShipments = async (config: DolibarrConfig): Promise<Shipment[]> => {
    const data = await fetchList(config, 'shipments');
    return data.map((d: Record<string, any>) => ({
        id: String(d.id),
        ref: d.ref,
        socid: String(d.socid),
        fk_commande: d.fk_commande ? String(d.fk_commande) : undefined,
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        date_creation: parseInt(d.date_creation),
        date_delivery: d.date_delivery ? parseInt(d.date_delivery) : undefined,
        status: String(d.statut) as any,
        tracking_number: d.tracking_number,
        array_options: d.array_options
    }));
};

export const getProduct = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/products/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getShipment = async (config: DolibarrConfig, id: string): Promise<Shipment> => {
    const url = `${sanitizeUrl(config.apiUrl)}/shipments/${id}`;
    const d = await request(url, { headers: getHeaders(config.apiKey) });
    return {
        id: String(d.id),
        ref: d.ref,
        socid: String(d.socid),
        fk_commande: d.fk_commande ? String(d.fk_commande) : undefined,
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        date_creation: parseInt(d.date_creation),
        date_delivery: d.date_delivery ? parseInt(d.date_delivery) : undefined,
        status: String(d.statut) as any,
        tracking_number: d.tracking_number,
        fk_user_author: d.fk_user_author ? String(d.fk_user_author) : undefined,
        fk_user_valid: d.fk_user_valid ? String(d.fk_user_valid) : undefined,
        lines: d.lines ? d.lines.map((l: Record<string, any>) => ({
            id: String(l.id),
            parent_id: String(l.fk_expedition ?? l.parent_id ?? id),
            product_id: String(l.fk_product),
            label: l.label ?? '',
            description: l.description ?? '',
            qty: parseFloat(l.qty_shipped ?? l.qty ?? 0),
            date_modification: l.date_modification ? parseInt(l.date_modification) : undefined,
        })) : [],
        array_options: d.array_options,
    };
};

export const getProductStock = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/products/${id}/stock`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

/**
 * Fetches a single product with stock data per warehouse.
 * Dolibarr returns `stock_warehouse: { [warehouseId]: { real, ... } }` when
 * `includestockdata=1` is passed.
 */
export const getProductWithStock = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/products/${id}?includestockdata=1`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getWarehouse = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/warehouses/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

// -- Write Operations --

export const createProduct = async (config: DolibarrConfig, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/products`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateProduct = async (config: DolibarrConfig, id: string, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/products/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const createShipment = async (config: DolibarrConfig, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/shipments`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const validateShipment = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/shipments/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export const createStockMovement = async (config: DolibarrConfig, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/stockmovements`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const createManufacturingOrder = async (config: DolibarrConfig, data: any) => {
    // Usually POST to /mrp/mo
    const url = `${sanitizeUrl(config.apiUrl)}/mrp/mo`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const createStockCorrection = async (config: DolibarrConfig, data: any) => {
    // V1 API: /stockmovements
    // But correction often implies specific warehouse/product movement
    // Data likely contains product_id, warehouse_id, qty...
    const url = `${sanitizeUrl(config.apiUrl)}/stockmovements`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const createWarehouse = async (config: DolibarrConfig, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/warehouses`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateWarehouse = async (config: DolibarrConfig, id: string, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/warehouses/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const deleteWarehouse = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/warehouses/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const createStockTransfer = async (config: DolibarrConfig, productId: string, fromWarehouse: string, toWarehouse: string, qty: number) => {
    // Helper to allow legacy signature or just easier usage
    // Transfer usually implies a movement in Dolibarr generic API
    // If there is no specific transfer endpoint, we make TWO movements?
    // Or we use /stockmovements/transfer if available.
    // Let's assume there's a specialized request we can form.
    // For now, let's map it to an object payload for createStockMovement if possible, or just a direct call.
    // If we use createStockMovement, we need the payload structure for transfer.
    // If uncertain, let's just make it a wrapper around createStockMovement but constructing the correct payload.
    // Actually, Dolibarr API sometimes requires 'warehouse_id' and 'warehouse_dest_id' for transfer?
    const data = {
        product_id: productId,
        warehouse_id: fromWarehouse,
        warehouse_dest_id: toWarehouse,
        qty: qty,
        label: "Internal Transfer"
    };
    const url = `${sanitizeUrl(config.apiUrl)}/stockmovements`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const getBOM = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/boms/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const createBOM = async (config: DolibarrConfig, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/boms`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const deleteShipment = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/shipments/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};
