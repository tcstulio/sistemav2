
export interface ManufacturingOrder {
    id: string;
    ref: string;
    label: string;
    project_id?: string;
    status: '0' | '1' | '2' | '3'; // Draft, Validated, In Progress, Produced
    date_start?: number;
    date_end?: number;
    product_to_produce_id: string;
    qty: number;
    array_options?: Record<string, any>;
    date_modification?: number;
}

export interface BOMLine {
    id: string;
    parent_id: string; // fk_bom - referência ao BOM pai
    fk_product: string; // The component ID
    qty: number;
    efficiency?: number; // 1 = 100%
    cost_price?: number; // Estimated cost per unit
    date_modification?: number;
}

export interface BOM {
    id: string;
    ref: string;
    label: string;
    status: string;
    duration?: number;
    efficiency?: number;
    qty: number;
    product_id?: string;
    lines?: BOMLine[]; // Added hierarchical lines
    date_creation?: number;
    date_modification?: number;
}
