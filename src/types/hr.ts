
export interface ExpenseReport {
    id: string;
    ref: string;
    fk_user_author: string;
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
