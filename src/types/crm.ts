
export interface ThirdParty {
    id: string;
    name: string;
    name_alias?: string;
    address?: string;
    zip?: string;
    town?: string;
    email?: string;
    phone?: string;
    phone_mobile?: string;
    fax?: string;
    url?: string;
    idprof1?: string; // CNPJ (PJ) ou CPF (PF)
    idprof2?: string;
    typent_id?: string; // tipo entidade: distingue PF (=8) de PJ
    socialnetworks?: Record<string, string>;
    status: '0' | '1'; // 0=inactive, 1=active
    client: string; // '0'|'1'|'2'|'3'
    fournisseur: string; // '0'|'1'

    code_client?: string;
    code_fournisseur?: string;
    state_id?: string;
    country_id?: string;
    tva_intra?: string;
    date_creation?: number;
    date_modification?: number;
    outstanding_balance?: number;
    array_options?: Record<string, any>;
    category_ids?: string[];
}

export interface Contact {
    id: string;
    socid: string;
    lastname: string;
    firstname: string;
    email?: string;
    phone_mobile?: string;
    poste?: string;
    statut: '0' | '1';
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface Ticket {
    id: string;
    ref: string;
    track_id: string;
    subject: string;
    message: string;
    type_code: string;
    category_code: string;
    severity_code: string;
    statut: string; // 0=Read, 1=Unread? Need to check Dolibarr constants. 
    progress: string;
    socid?: string; // Linked Customer
    project_id?: string; // Linked Project
    fk_user_assign?: string;
    fk_user_create?: string;
    fk_user_close?: string; // ADDED
    origin_email?: string;
    datec: number;
    date_c?: number; // Alias for datec, for backward compatibility
    tms: number;
    date_modification?: number; // Added for Delta Sync
    // Inferred/Joined fields
    linked_objects?: any;
    messages?: any[];
    array_options?: Record<string, any>;
}
