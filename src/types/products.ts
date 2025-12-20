
export interface Product {
    id: string;
    ref: string;
    label: string;
    description?: string;
    type: '0' | '1'; // 0=product, 1=service
    price: number;
    stock_reel?: number;
    stock_details?: { warehouse: string; qty: number }[];
    seuil_stock_alerte?: number;
    date_creation?: number;
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface Category {
    id: string;
    label: string;
    type: string;
    description?: string;
    date_modification?: number;
    // Note: Parent ID or other fields might be needed
}

export interface Warehouse {
    id: string;
    ref?: string;
    label: string;
    description?: string;
    statut: '0' | '1';
    lieu?: string;
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface StockMovement {
    id: string;
    product_id: string;
    warehouse_id: string;
    qty: number;
    label: string;
    date_creation: number;
    fk_user_author?: string;
    date_modification?: number;
    type?: string;
    price?: number;
}

export interface Shipment {
    id: string;
    ref: string;
    socid: string;
    fk_commande?: string;
    project_id?: string;
    date_creation: number;
    date_delivery?: number;
    status: string; // '0','1','2'
    tracking_number?: string;
    date_modification?: number;
    array_options?: Record<string, any>;
}
