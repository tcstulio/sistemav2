
export interface Project {
    id: string;
    ref: string;
    title: string;
    socid: string;
    date_start?: number;
    date_end?: number;
    statut: '0' | '1' | '2'; // 0=draft, 1=open, 2=closed
    progress: number;
    array_options?: Record<string, any>;
    date_creation?: number;
    date_modification?: number;
    budget_amount?: number;
}

export interface Task {
    id: string;
    ref: string;
    label: string;
    project_id: string;
    description?: string;
    date_start?: number;
    date_end?: number;
    progress: number;
    planned_workload?: number; // seconds
    duration_effective?: number; // seconds
    fk_user_assign?: string;
    fk_user_creat?: string; // Creator ID
    array_options?: Record<string, any>;
    raw?: any;
    date_creation?: number;
    date_modification?: number;
}

export interface InterventionLine {
    id: string;
    desc: string;
    date: number;
    duration: number; // seconds
    qty?: number;
}

export interface Intervention {
    id: string;
    ref: string;
    socid: string;
    project_id?: string;
    date: number;
    date_creation: number;
    description?: string;
    statut: '0' | '1' | '2'; // 0=draft, 1=validated, 2=done
    fk_user_author?: string;
    lines?: InterventionLine[];
    duration?: number;
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface Ticket {
    id: string;
    ref: string;
    track_id: string;
    socid: string;
    project_id?: string;
    subject: string;
    message: string;
    type_code: string;
    category_code?: string;
    severity_code: string;
    statut: string; // '1'=New, '5'=In Progress, '8'=Closed/Resolved
    progress?: number; // 0-100 from JSON
    date_c: number;
    fk_user_assign?: string;
    origin_email?: string;
    array_options?: {
        options_resumo_da_conversa?: string;
        options_resumo_vaga?: string;
        options_cf_session_id?: string;
        options_quantidade_publico_evento?: string;
        options_valor_budget?: string;
        [key: string]: any;
    };
    date_modification?: number;
}

export interface AgendaEvent {
    id: string;
    ref: string;
    label: string;
    date_start: number;
    date_end: number;
    type_code: string;
    percentage: number;
    socid?: string;
    project_id?: string;
    description?: string;
    user_assigned?: string;
    location?: string;
    elementtype?: string; // Linked object type (e.g., 'ticket', 'propal')
    fk_element?: string; // Linked object ID
    date_c?: number; // Creation date

    // New Fields
    fulldayevent?: boolean; // 1 or 0
    priority?: number;
    fk_user_author?: string; // Creator/Owner
    transparency?: number;
    date_modification?: number;
}
