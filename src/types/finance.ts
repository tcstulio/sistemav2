
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
    id: number;
    ref: string;
    date_payment: string; // ISO date string
    amount: number;
    fk_bank?: number;
    transaction_id?: number; // The fk_bank in Dolibarr mostly points to llx_bank rowid
    bank_account_id?: number; // The resolved real bank account ID
    num_paiement?: string;
    note?: string;
    mode_id?: number;
    user_author_id?: number;
    date_creation?: number; // Creation timestamp
    date_modification?: number;
    // Cliente e evento: não enviados pelo custom_sync.php payments (apenas via fatura vinculada).
    // Presentes caso uma versão futura do SQL os inclua.
    fk_soc?: number;
    socid?: number;       // alias compatível
    project_id?: number;
    fk_projet?: number;   // alias compatível
}

export interface SupplierPayment {
    id: number;
    ref: string;
    date_payment: string; // ISO date string
    amount: number;
    fk_bank?: number;
    transaction_id?: number;
    bank_account_id?: number;
    num_paiement?: string;
    note?: string;
    mode_id?: number;
    user_author_id?: number;
    date_modification?: number;
    socid?: string;
    soc_name?: string; // Joined supplier name
}

export interface PaymentInvoiceLink {
    id: string;
    fk_paiement: string;
    fk_facture: string;
    amount: number;
    date_modification?: number; // Needed for sync even if not present in DB (will use ID or Parent TMS)
}

export interface SupplierPaymentInvoiceLink {
    id: string;
    fk_paiementfourn: string;
    fk_facturefourn: string; // or fk_facture_fourn depending on key naming? Custom Sync returns fk_facturefourn
    amount: number;
    date_modification?: number;
}

// === Expense Report Payments ===
export interface ExpenseReportPayment {
    id: string;
    ref: string;
    num_paiement?: string; // Payment number/reference
    fk_expensereport: string;
    date_payment: number;
    amount: number;
    fk_bank: string;
    transaction_id?: string;
    bank_account_id?: string;
    fk_user_creat: string;
    date_modification?: number;
}

export interface ExpenseReportPaymentLink {
    id: string;
    fk_payment: string;
    fk_expensereport: string;
    amount: number;
    date_modification?: number;
}

// === VAT Payments ===
export interface VATPayment {
    id: string;
    ref: string;
    fk_tva: string;
    date_payment: number;
    amount: number;
    fk_bank: string;
    /** Número do comprovante/documento de pagamento (llx_tva_payment.num_payment) */
    num_payment?: string;
    /** Período de início da apuração do IVA (llx_tva.date_debut via raw) */
    periodo_inicio?: number;
    /** Período de fim da apuração do IVA (llx_tva.date_fin via raw) */
    periodo_fim?: number;
    date_modification?: number;
}

// === Salaries (llx_salary) ===
/** Registro de salário de um colaborador (tabela pai de SalaryPayment via fk_salary) */
export interface Salary {
    id: string;
    ref: string;
    fk_user: string;
    amount: number;
    date_modification?: number;
}

// === Salary Payments ===
export interface SalaryPayment {
    id: string;
    ref: string;
    num_payment?: string;
    fk_user: string;
    /** ID do registro de salário pai (llx_salary.rowid).
     *  Necessário para resolver fk_user quando o custom_sync.php ainda não envia
     *  fk_user diretamente. Será preenchido quando o SQL de salary_payments
     *  incluir fk_salary no SELECT (ver issue #568 para correção no Dolibarr). */
    fk_salary?: string;
    date_payment: number;
    amount: number;
    salary: number; // Gross salary?
    fk_bank: string;
    fk_typepayment?: string; // Tipo/meio de pagamento (Dolibarr llx_payment_salary.fk_typepayment)
    date_modification?: number;
}

// === Social Contribution Payments ===
export interface SocialContributionPayment {
    id: string;
    ref: string;
    fk_charge: string;
    fk_tva?: string; // For compatibility with VATPayment
    date_payment: number;
    amount: number;
    fk_bank: string;
    /** Número do comprovante/documento de pagamento (llx_paiementcharge.num_payment) */
    num_payment?: string;
    /** Rótulo/tipo do encargo social (llx_chargesociales.libelle via raw) */
    label_origem?: string;
    /** Período de início do encargo social (llx_chargesociales.date_debut via raw) */
    periodo_inicio?: number;
    /** Período de fim do encargo social (llx_chargesociales.date_fin via raw) */
    periodo_fim?: number;
    date_modification?: number;
}

// === Loan Payments ===
export interface LoanPayment {
    id: string;
    ref: string;
    fk_loan: string;
    date_payment: number;
    amount_capital: number;
    amount_insurance: number;
    amount_interest: number;
    fk_bank: string;
    date_modification?: number;
}

// === Various Payments ===
export interface VariousPayment {
    id: string;
    ref: string;
    num_payment?: string;
    label: string;
    date_payment: number;
    amount: number;
    fk_bank: string;
    date_modification?: number;
}

