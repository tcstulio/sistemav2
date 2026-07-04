
export interface DolibarrUser {
    id: string;
    login: string;
    firstname?: string;
    lastname?: string;
    email?: string;
    phone_mobile?: string;
    user_mobile?: string;
    office_phone?: string;
    fax?: string;
    photo?: string;
    statut: '0' | '1';
    job?: string;
    admin?: number | string | boolean; // 1 = Admin
    rights?: {
        [module: string]: {
            read?: string; // 1 or 0
            write?: string;
            delete?: string;
            [key: string]: any;
        };
    };
    array_options?: Record<string, any>;
    supervisor_id?: string;
    address?: string;
    zip?: string;
    town?: string;
    state_id?: string;
    country_id?: string;
    note_public?: string;
    note_private?: string;
    color?: string;
    date_modification?: number;
}

export interface DolibarrConfig {
    apiUrl: string;
    apiKey: string;
    themeColor: string;
    darkMode: boolean;
    showDebugTools?: boolean;
    apiLimit?: number;

    autoSyncInterval?: number; // Minutes, 0 = Manual
    currentUser?: DolibarrUser; // Added stored user profile
    WHATSAPP_API_URL?: string; // Added WhatsApp API URL
}

export interface DolibarrModule {
    id: string;
    name: string;
    active: '0' | '1';
}

export interface DolibarrDocument {
    name: string;
    level1name?: string;
    relativename?: string;
    date?: number;
    size?: number;
}

export interface DolibarrDictionary {
    id: string;
    code: string;
    label: string;
    active?: string;
}

export type AppView = 'dashboard' | 'reports' | 'agenda' | 'tickets' | 'customers' | 'suppliers' | 'projects' | 'proposals' | 'supplier_proposals' | 'orders' | 'invoices' | 'supplier_invoices' | 'pending_payments' | 'payments' | 'contracts' | 'interventions' | 'products' | 'services' | 'categories' | 'inventory' | 'bank_accounts' | 'hr' | 'settings' | 'development' | 'manufacturing' | 'shipments' | 'whatsapp' | 'tasks' | 'monitor' | 'activity' | 'tax_payments' | 'salary_payments' | 'expense_report_payments' | 'supplier_payments' | 'email' | 'venues';

export interface AppNotification {
    id: string;
    event?: string;
    type: 'stock' | 'invoice' | 'ticket' | 'info' | 'whatsapp' | 'email' | 'agent' | 'task';
    title: string;
    message: string;
    date: number;
    priority: 'low' | 'medium' | 'high';
    read: boolean;
    linkTo?: { view: AppView; id: string };
    senderName?: string;
    channels?: string[];
    /** ID do destinatário (usuario logado = pessoal; 'team'/'all'/undefined = sistema) */
    recipient?: string;
    /** Escopo derivado pelo backend: 'personal' quando recipient === userId logado, 'system' nos demais */
    scope?: 'personal' | 'system';
}


export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    isError?: boolean;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface Link {
    id: string;
    sourcetype: string;
    sourceid: string;
    targettype: string;
    targetid: string;
    date_modification?: number;
}
