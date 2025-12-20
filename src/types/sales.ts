
export interface Invoice {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    order_id?: string; // Linked Sales Order
    contract_id?: string; // Linked Contract
    type?: '0' | '1' | '2'; // 0=Standard, 1=Replacement, 2=Credit Note
    date: number; // timestamp
    date_payment?: number;
    total_ttc: number;
    paye: '0' | '1';
    statut: '0' | '1' | '2'; // 0=draft, 1=unpaid, 2=paid
    date_lim_reglement?: number;
    date_modification?: number; // Added for Delta Sync
    array_options?: Record<string, any>;
}

export interface SupplierInvoice {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    label?: string;
    date: number;
    total_ttc: number;
    paye: '0' | '1';
    statut: '0' | '1' | '2';
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface Proposal {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    date: number;
    total_ttc: number;
    statut: '0' | '1' | '2' | '3' | '4'; // 0=draft, 1=open, 2=signed, 3=declined, 4=billed
    lines?: any[];
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface Order {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    date: number;
    total_ttc: number;
    statut: '0' | '1' | '2' | '3'; // 0=draft, 1=validated, 2=in process, 3=delivered
    lines?: any[];
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface ContractLine {
    id: string;
    desc: string;
    qty: number;
    price: number;
    date_start?: number;
    date_end?: number;
}

export interface Contract {
    id: string;
    ref: string;
    socid: string;
    project_id?: string; // ADDED
    date_contrat: number; // Start Date
    date_fin_validite?: number; // End Date
    date_modification?: number; // Added for Delta Sync
    statut: '0' | '1' | '2'; // 0=Draft, 1=Active, 2=Closed
    note_public?: string;
    lines?: ContractLine[];
    array_options?: Record<string, any>;
}

export interface SupplierOrder {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    date_creation: number;
    date_livraison?: number;
    total_ttc: number;
    statut: string;
    lines?: any[];
    date_modification?: number;
    array_options?: Record<string, any>;
}
