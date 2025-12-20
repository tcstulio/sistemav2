
export interface ThirdParty {
    id: string;
    name: string;
    name_alias?: string;
    address?: string;
    zip?: string;
    town?: string;
    email?: string;
    phone?: string;
    status: '0' | '1'; // 0=inactive, 1=active
    client: string; // '0'|'1'|'2'|'3'
    fournisseur: string; // '0'|'1'
    code_client?: string;
    state_id?: string;
    country_id?: string;
    tva_intra?: string;
    date_creation?: number;
    date_modification?: number;
    outstanding_balance?: number;
    array_options?: Record<string, any>;
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
