
export interface Product {
    id: string;
    ref: string;
    label: string;
    description?: string;
    type: '0' | '1'; // 0=product, 1=service
    price: number;
    price_ttc?: number;
    vat_rate?: number;
    stock_reel?: number;
    stock?: number; // Alias for stock_reel
    stock_details?: { warehouse: string; qty: number }[];
    seuil_stock_alerte?: number;

    // Status
    tosell?: '0' | '1';
    tobuy?: '0' | '1';
    finished?: '0' | '1'; // Manufacturing status

    // Service specific
    duration?: string;

    date_creation?: number;
    date_modification?: number;
    array_options?: Record<string, any>;
    category_ids?: string[]; // IDs das categorias vinculadas
}

export interface Category {
    id: string;
    label: string;
    type: string;
    description?: string;
    date_modification?: number;
    // Note: Parent ID or other fields might be needed
    parent_id?: string;
}

export interface Warehouse {
    id: string;
    ref?: string;
    label: string;
    description?: string;
    statut: '0' | '1';
    lieu?: string;
    address?: string;
    zip?: string;
    town?: string;
    phone?: string;
    fax?: string;
    date_modification?: number;
    array_options?: Record<string, any>;
    /** ID do armazém-pai (Dolibarr fk_parent); undefined = armazém raiz */
    fk_parent?: string;
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

export interface ShipmentLine {
    id: string;
    parent_id: string;
    product_id: string;
    label: string;
    description: string;
    qty: number;
    date_modification?: number;
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
    lines?: ShipmentLine[];
    fk_user_author?: string; // ADDED
    fk_user_valid?: string; // ADDED
    date_modification?: number;
    array_options?: Record<string, any>;
}
