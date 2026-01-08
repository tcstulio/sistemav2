
export interface ExpenseReport {
    id: string;
    ref: string;
    fk_user_author: string;
    fk_user_valid?: string;
    fk_user_approve?: string;
    project_id?: string; // ADDED
    date_debut: number;
    date_fin: number;
    date_paye?: number;
    total_ttc: number;
    statut: string;
    note_public?: string;
    array_options?: Record<string, any>;
    date_modification?: number;
    raw?: any;
}

export interface ExpenseReportLine {
    id: string;
    parent_id: string;
    type_id: string;
    type_code: string;
    type_label: string;
    project_id?: string;
    description?: string;
    qty: number;
    unit_price: number;
    total_ht: number;
    total_ttc: number;
    total_tva: number;
    date_expense: number;
    date_modification?: number;
}

export interface ExpenseType {
    id: string;
    code: string;
    label: string;
    active: '0' | '1';
    date_modification?: number;
}

export interface LeaveRequest {
    id: string;
    ref?: string;
    fk_user: string;
    date_debut: number; // timestamp
    date_fin: number;   // timestamp
    type?: string; // e.g. 'paid', 'sick', or ID
    statut: '1' | '2' | '3' | '4' | '5'; // 1=Draft, 2=Validated, 3=Approved, 4=Canceled, 5=Refused
    description?: string;
    duration?: number;
    date_modification?: number;
    date_create?: number;
    type_label?: string;
    user_label?: string;
    fk_user_valid?: string; // ADDED
}

export interface RecruitmentJobPosition {
    id: string;
    ref: string;
    label: string;
    qty: number;
    status: string;
    date_creation: number;
    description?: string;
    array_options?: Record<string, any>;
    date_modification?: number;
    rem_min?: number;
    rem_max?: number;
}

export interface Candidate {
    id: string;
    fk_job_position: string;
    firstname: string;
    lastname: string;
    email: string;
    phone?: string;
    status: string;
    date_c: number;
    cv_text?: string;
    rating?: number;
    ai_match_score?: number;
    note_public?: string;
    raw?: any;
    date_modification?: number;
    date_creation?: number;
    ref?: string;
    date_birth?: number;
}

export interface UserGroup {
    id: string;
    name: string;
    note?: string;
    datec?: number;
    tms?: number;
    date_modification?: number; // Added for hook compatibility
}

export interface GroupUser {
    id: string;
    fk_user: string;
    fk_usergroup: string;
    raw?: any;
    date_modification?: number; // Added for hook compatibility
}

export interface PermissionDefinition {
    id: string;
    libelle: string;
    module: string;
    perms: string;
    subperms: string;
    type: string;
    module_position?: number;
    family_position?: number;
    raw?: any;
    date_modification?: number; // Added for hook compatibility
}
