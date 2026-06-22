
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
    fk_user_author?: string; // ADDED
    fk_user_valid?: string; // ADDED
    date_modification?: number; // Added for Delta Sync
    soc_name?: string; // Joined customer name
    array_options?: Record<string, any>;
}

export interface SupplierInvoiceLine {
    id: string;
    parent_id: string;
    label: string;
    description: string;
    qty: number;
    vat_rate: number;
    subprice: number;
    total_ht: number;
    total_ttc: number;
    product_id?: string;
    product_ref?: string;
    product_label?: string;
    date_modification?: number;
}

export interface SupplierInvoice {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    type?: '0' | '1' | '2';
    label?: string;
    date: number;
    total_ttc: number;
    paye: '0' | '1';
    statut: '0' | '1' | '2'; // Status: 0=draft, 1=unpaid, 2=paid
    soc_name?: string; // Joined supplier name
    date_lim_reglement?: number;
    lines?: SupplierInvoiceLine[];
    fk_user_author?: string;
    fk_user_valid?: string;
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface Proposal {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    date: number;
    datec?: number; // Alias: creation date (same as date)
    date_creation?: number; // Alias
    total_ht: number;
    total_ttc: number;
    total_tva: number;
    statut: '0' | '1' | '2' | '3' | '4'; // 0=draft, 1=open, 2=signed, 3=declined, 4=billed
    lines?: ProposalLine[];
    fk_user_author?: string; // ADDED
    fk_user_valid?: string; // ADDED
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface ProposalLine {
    id: string;
    parent_id: string;
    label: string;
    description: string;
    type?: number;
    qty: number;
    vat_rate: number;
    subprice: number;
    total_ht: number;
    total_ttc: number;
    total_tva: number;
    product_id?: string;
    rang?: number;
    remise_percent?: number; // ADDED
    date_modification?: number;
}

export interface Order {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    date: number;
    date_commande?: number; // Alias: order date (same as date)
    datec?: number; // Alias: creation date
    total_ttc: number;
    statut: '0' | '1' | '2' | '3'; // 0=draft, 1=validated, 2=in process, 3=delivered
    lines?: OrderLine[];
    fk_user_author?: string; // ADDED
    fk_user_valid?: string; // ADDED
    date_modification?: number;
    array_options?: Record<string, any>;
    soc_name?: string; // Joined customer name
}

export interface OrderLine {
    id: string;
    parent_id: string;
    label: string;
    description: string;
    desc?: string; // Alias for compatibility
    type?: number;
    qty: number;
    vat_rate: number;
    subprice: number;
    price?: number; // Alias for compatibility
    total_ht: number;
    total_ttc: number;
    total_tva: number;
    product_id?: string;
    fk_product?: string; // Alias for compatibility
    rang?: number;
    date_modification?: number;
}

export interface InvoiceLine {
    id: string;
    parent_id: string;
    label: string;
    description: string;
    type?: number;
    qty: number;
    vat_rate: number;
    subprice: number;
    total_ht: number;
    total_ttc: number;
    total_tva: number;
    product_id?: string;
    product_ref?: string;
    product_label?: string;
    rang?: number;
    remise_percent?: number;
    date_modification?: number;
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

export interface SupplierOrderLine {
    id: string;
    parent_id: string;
    label: string;
    description: string;
    qty: number;
    vat_rate: number;
    subprice: number;
    total_ht: number;
    total_ttc: number;
    product_id?: string;
    fk_product?: string; // Alias for compatibility
    date_modification?: number;
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
    lines?: SupplierOrderLine[];
    fk_user_author?: string; // ADDED
    fk_user_approve?: string; // ADDED
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface SupplierProposalLine {
    id: string;
    parent_id: string;
    description: string;
    qty: number;
    subprice: number;
    vat_rate: number;
    total_ht: number;
    total_ttc: number;
    total_tva: number;
    product_id?: string;
    rang?: number;
    date_modification?: number;
}

export interface SupplierProposal {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    datec: number;
    date_valid?: number;
    date_delivery?: number;
    total_ht: number;
    total_ttc: number;
    total_tva: number;
    statut: '0' | '1' | '2' | '3' | '4'; // 0=Draft, 1=Validated, 2=Approved, 3=Refused, 4=Ordered
    lines?: SupplierProposalLine[];
    fk_user_author?: string;
    fk_user_valid?: string;
    date_modification?: number;
    array_options?: Record<string, any>;
}
