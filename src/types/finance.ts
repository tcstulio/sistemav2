
export interface BankAccount {
    id: string;
    ref: string;
    label: string;
    bank?: string;
    number?: string;
    currency_code: string;
    solde: number;
    status: '0' | '1';
    date_modification?: number;
    array_options?: Record<string, any>;
}

export interface BankLine {
    id: string;
    date_operation: number;
    date_value?: number;
    label: string;
    amount: number;
    fk_bank: string;
    reconciled: boolean;
    fk_account: string;
    date_modification?: number;
}

export interface Payment {
    id: string;
    ref: string;
    date_payment: number;
    amount: number;
    fk_bank: string;
    fk_user_create?: string;
    date_creation?: number;
    date_modification?: number;
}

export interface SupplierPayment {
    id: string;
    ref: string;
    date_payment: number;
    amount: number;
    fk_bank: string;
    fk_user_create?: string;
    date_creation?: number;
    date_modification?: number;
}
