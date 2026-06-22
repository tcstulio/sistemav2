/**
 * Dolibarr Entity Mappers
 * 
 * Centralized mapping functions to convert raw API/Database data
 * to typed TypeScript entities.
 * 
 * Benefits:
 * - Single source of truth for data transformation
 * - Easy to update when API changes
 * - Reusable across hooks and services
 */

import {
    ThirdParty,
    Invoice,
    SupplierInvoice,
    Order,
    SupplierOrder,
    Project,
    Task,
    Proposal,
    Ticket,
    Payment,
    Contract,
    Intervention,
    BankAccount,
    BankLine,
    Product,
    Category,
    AgendaEvent,
    Shipment,
    Contact,
    Warehouse,
    StockMovement,
    DolibarrUser,
    ExpenseReport,
    LeaveRequest,
    Candidate,
    RecruitmentJobPosition,
    SupplierPayment,
    ManufacturingOrder,
    BOM,
    SystemLog,
    Link,
    ShipmentLine,
    SupplierOrderLine,
    SupplierInvoiceLine,
    InterventionLine,
    BOMLine,
    ProposalLine,
    OrderLine,
    InvoiceLine,
    PaymentInvoiceLink,
    SupplierPaymentInvoiceLink,
    ExpenseReportPayment,
    ExpenseReportPaymentLink,
    VATPayment,
    SalaryPayment,
    SocialContributionPayment,
    LoanPayment,
    VariousPayment,
    TaskTimeLog,
    TaskContact,
    ProjectContact,
    ExpenseReportLine,
    ExpenseType,
    SupplierProposal,
    SupplierProposalLine,
    UserGroup,
    GroupUser,
    PermissionDefinition,
} from '../../types';

// ============ Types ============

/**
 * Raw record from Dolibarr API/IndexedDB.
 * This is the single boundary type for untyped API data.
 * All mappers convert from this type to strongly-typed entities.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawDolibarrRecord = Record<string, any>;

// ============ Helper Functions ============

/** Safely parse a date value to timestamp */
export const toTimestamp = (value: unknown): number => {
    if (!value) return 0;

    // Handle numeric strings (e.g. "1700000000" from PHP/MySQL drivers)
    if (typeof value === 'string' && !isNaN(Number(value)) && /^\d+$/.test(value)) {
        const num = Number(value);
        return num < 100000000000 ? num * 1000 : num;
    }

    if (typeof value === 'number') {
        // If value is small (< 100 billion), assume seconds and convert to ms
        if (value < 100000000000) {
            return value * 1000;
        }
        return value;
    }

    if (typeof value === 'string') {
        const date = new Date(value);
        return isNaN(date.getTime()) ? 0 : date.getTime();
    }

    return 0;
};

/** Safely convert to string */
export const toString = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value);
};

/** Safely convert to number */
export const toNumber = (value: unknown): number => {
    const num = Number(value);
    return isNaN(num) ? 0 : num;
};

// ============ Entity Mappers ============

/**
 * Map raw supplier data (alias for mapThirdParty with supplier-specific handling)
 */
export const mapSupplier = (raw: RawDolibarrRecord): ThirdParty => ({
    id: toString(raw.id),
    name: raw.name || '',
    name_alias: raw.name_alias,
    code_client: raw.code_client,
    email: raw.email,
    phone: raw.phone,
    address: raw.address || '',
    zip: raw.zip || '',
    town: raw.town || '',
    client: toString(raw.client),
    status: raw.status,
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
    fournisseur: toString(raw.fournisseur) || '1',
});

/**
 * Map raw third party data to ThirdParty entity
 */
export const mapThirdParty = (raw: RawDolibarrRecord): ThirdParty => ({
    id: toString(raw.id),
    name: raw.name || '',
    name_alias: raw.name_alias,
    code_client: raw.code_client,
    email: raw.email,
    phone: raw.phone,
    address: raw.address || '',
    zip: raw.zip || '',
    town: raw.town || '',
    client: toString(raw.client),
    status: raw.status,
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
    fournisseur: toString(raw.fournisseur) || '0',
});

/**
 * Map raw invoice data to Invoice entity
 */
export const mapInvoice = (raw: RawDolibarrRecord): Invoice => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    total_ttc: toNumber(raw.total_ttc),
    date: toTimestamp(raw.date_invoice || raw.datec),
    statut: toString(raw.statut) as '0' | '1' | '2',
    socid: raw.fk_soc ? toString(raw.fk_soc) : '',
    paye: toString(raw.paye) as '0' | '1',
    date_lim_reglement: raw.date_lim_reglement ? toTimestamp(raw.date_lim_reglement) : undefined,
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw supplier invoice data to SupplierInvoice entity
 */
export const mapSupplierInvoice = (raw: RawDolibarrRecord): SupplierInvoice => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    socid: raw.fk_soc ? toString(raw.fk_soc) : '',
    label: raw.label,
    type: toString(raw.type) as '0' | '1' | '2',
    date: toTimestamp(raw.datec),
    total_ttc: toNumber(raw.total_ttc),
    paye: toString(raw.paye) as '0' | '1',
    statut: toString(raw.statut) as '0' | '1' | '2',
    date_lim_reglement: raw.date_lim_reglement ? toTimestamp(raw.date_lim_reglement) : undefined,
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw order data to Order entity
 */
export const mapOrder = (raw: RawDolibarrRecord): Order => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    total_ttc: toNumber(raw.total_ttc),
    statut: toString(raw.statut) as any,
    date: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
    socid: raw.fk_soc ? toString(raw.fk_soc) : '',
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    fk_user_author: raw.fk_user_author ? toString(raw.fk_user_author) : undefined, // ADDED
    fk_user_valid: raw.fk_user_valid ? toString(raw.fk_user_valid) : undefined, // ADDED
});

/**
 * Map raw supplier order data to SupplierOrder entity
 */
export const mapSupplierOrder = (raw: RawDolibarrRecord): SupplierOrder => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    socid: raw.fk_soc ? toString(raw.fk_soc) : '',
    // Backend returns 'date_creation', legacy might use 'datec'
    date_creation: toTimestamp(raw.date_creation || raw.datec),
    date_livraison: raw.date_livraison ? toTimestamp(raw.date_livraison) : undefined,
    total_ttc: toNumber(raw.total_ttc),
    statut: toString(raw.statut),
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    fk_user_author: raw.fk_user_author ? toString(raw.fk_user_author) : undefined, // ADDED
    fk_user_approve: raw.fk_user_approve ? toString(raw.fk_user_approve) : undefined, // ADDED
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw project data to Project entity
 */
export const mapProject = (raw: RawDolibarrRecord): Project => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    title: raw.title || '',
    statut: toString(raw.statut) as '0' | '1' | '2',
    progress: toNumber(raw.progress),
    socid: raw.socid ? toString(raw.socid) : '',
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
    date_start: raw.date_start ? toTimestamp(raw.date_start) : 0,
    date_end: raw.date_end ? toTimestamp(raw.date_end) : 0,
    budget_amount: toNumber(raw.budget_amount),
    parent_id: raw.parent_id ? toString(raw.parent_id) : undefined,
    fk_user_creat: raw.fk_user_creat ? toString(raw.fk_user_creat) : undefined,
    fk_user_modif: raw.fk_user_modif ? toString(raw.fk_user_modif) : undefined,
});

/**
 * Map raw task data to Task entity
 */
export const mapTask = (raw: RawDolibarrRecord): Task => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    label: raw.label || '',
    description: raw.description,
    project_id: raw.project_id ? toString(raw.project_id) : '',
    date_start: raw.date_start ? toTimestamp(raw.date_start) : 0,
    date_end: toTimestamp(raw.date_end || raw.datee),
    progress: toNumber(raw.progress),
    priority: toNumber(raw.priority),
    status: toNumber(raw.status), // or fk_statut from generic response if easier
    planned_workload: toNumber(raw.planned_workload),
    duration_effective: toNumber(raw.duration_effective),
    fk_user_assign: raw.fk_user_assign ? toString(raw.fk_user_assign) : undefined,
    fk_user_creat: raw.fk_user_creat ? toString(raw.fk_user_creat) : undefined,
    fk_parent: (raw.fk_parent ?? raw.fk_task_parent) ? toString(raw.fk_parent ?? raw.fk_task_parent) : undefined,
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
    project_ref: raw.project_ref || undefined,
    project_title: raw.project_title || undefined,
});

/**
 * Map raw proposal data to Proposal entity
 */
export const mapProposal = (raw: RawDolibarrRecord): Proposal => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    socid: raw.fk_soc ? toString(raw.fk_soc) : '',
    date: toTimestamp(raw.datep || raw.datec),
    total_ht: toNumber(raw.total_ht),
    total_ttc: toNumber(raw.total_ttc),
    total_tva: toNumber(raw.total_tva),
    statut: toString(raw.statut) as '0' | '1' | '2' | '3' | '4',
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    fk_user_author: raw.fk_user_author ? toString(raw.fk_user_author) : undefined, // ADDED
    fk_user_valid: raw.fk_user_valid ? toString(raw.fk_user_valid) : undefined, // ADDED
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw supplier proposal data
 */
export const mapSupplierProposal = (raw: RawDolibarrRecord): SupplierProposal => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    socid: raw.socid ? toString(raw.socid) : '',
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    datec: toTimestamp(raw.datec),
    date_valid: raw.date_valid ? toTimestamp(raw.date_valid) : undefined,
    date_delivery: raw.date_delivery ? toTimestamp(raw.date_delivery) : undefined,
    total_ht: toNumber(raw.total_ht),
    total_ttc: toNumber(raw.total_ttc),
    total_tva: toNumber(raw.total_tva),
    statut: toString(raw.statut) as '0' | '1' | '2' | '3' | '4',
    fk_user_author: raw.fk_user_author ? toString(raw.fk_user_author) : undefined,
    fk_user_valid: raw.fk_user_valid ? toString(raw.fk_user_valid) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw ticket data to Ticket entity
 */
export const mapTicket = (raw: RawDolibarrRecord): Ticket => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    track_id: raw.track_id || '',
    socid: raw.fk_soc ? toString(raw.fk_soc) : '',
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    subject: raw.subject || '',
    message: raw.message || '',
    type_code: raw.type_code || '',
    category_code: raw.category_code,
    severity_code: raw.severity_code || '',
    statut: toString(raw.fk_statut || raw.statut),
    progress: raw.progress ? toString(raw.progress) : '0',
    datec: toTimestamp(raw.datec),
    fk_user_assign: raw.fk_user_assign ? toString(raw.fk_user_assign) : undefined,
    fk_user_create: raw.fk_user_create ? toString(raw.fk_user_create) : undefined,
    fk_user_close: raw.fk_user_close ? toString(raw.fk_user_close) : undefined,
    origin_email: raw.origin_email,
    tms: toTimestamp(raw.tms),
    date_modification: toTimestamp(raw.tms), // Added for compatibility
    array_options: Object.keys(raw).reduce((acc, key) => {
        if (key.startsWith('options_')) {
            acc[key] = raw[key];
        }
        return acc;
    }, {} as Record<string, any>),
});

/**
 * Map raw payment data to Payment entity
 */
export const mapPayment = (data: any): Payment => ({
    id: Number(data.id),
    ref: data.ref || `PAY-${data.id}`,
    date_payment: new Date(toTimestamp(data.date_payment)).toISOString(),
    amount: Number(data.amount || 0),
    fk_bank: data.fk_bank ? Number(data.fk_bank) : undefined,
    transaction_id: data.transaction_id ? Number(data.transaction_id) : (data.fk_bank ? Number(data.fk_bank) : undefined),
    bank_account_id: data.bank_account_id ? Number(data.bank_account_id) : undefined,
    num_paiement: data.num_paiement,
    note: data.note,
    mode_id: data.mode_id ? Number(data.mode_id) : undefined,
    user_author_id: data.user_author_id ? Number(data.user_author_id) : undefined,
    date_modification: toTimestamp(data.tms),
});

export const mapSupplierPayment = (data: any): SupplierPayment => ({
    id: Number(data.id),
    ref: data.ref || `SPAY-${data.id}`,
    date_payment: new Date(toTimestamp(data.date_payment)).toISOString(),
    amount: Number(data.amount || 0),
    fk_bank: data.fk_bank ? Number(data.fk_bank) : undefined,
    transaction_id: data.transaction_id ? Number(data.transaction_id) : (data.fk_bank ? Number(data.fk_bank) : undefined),
    bank_account_id: data.bank_account_id ? Number(data.bank_account_id) : undefined,
    num_paiement: data.num_paiement,
    note: data.note,
    mode_id: data.mode_id ? Number(data.mode_id) : undefined,
    user_author_id: data.user_author_id ? Number(data.user_author_id) : undefined,
    date_modification: toTimestamp(data.tms),
});

/**
 * Map raw contract data to Contract entity
 */
export const mapContract = (raw: RawDolibarrRecord): Contract => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    socid: raw.fk_soc ? toString(raw.fk_soc) : '',
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    date_contrat: toTimestamp(raw.date_contrat),
    date_fin_validite: raw.date_fin_validite ? toTimestamp(raw.date_fin_validite) : undefined,
    statut: toString(raw.statut) as '0' | '1' | '2',
    note_public: raw.note_public,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw intervention data to Intervention entity
 */
export const mapIntervention = (raw: RawDolibarrRecord): Intervention => {
    return {
        id: toString(raw.id),
        ref: raw.ref || '',
        socid: raw.socid ? toString(raw.socid) : (raw.fk_soc ? toString(raw.fk_soc) : ''),
        project_id: raw.project_id ? toString(raw.project_id) : (raw.fk_project ? toString(raw.fk_project) : undefined),
        date: toTimestamp(raw.date_creation || raw.datei || raw.datec),
        // Backend returns 'date_creation', legacy might use 'datec'
        date_creation: toTimestamp(raw.date_creation || raw.datec),
        description: raw.description,
        statut: toString(raw.statut) as '0' | '1' | '2',
        fk_user_author: raw.fk_user_author ? toString(raw.fk_user_author) : undefined,
        duration: raw.duration ? toNumber(raw.duration) : undefined,
        date_modification: toTimestamp(raw.tms),
    };
};

/**
 * Map raw bank account data to BankAccount entity
 */
export const mapBankAccount = (raw: RawDolibarrRecord): BankAccount => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    label: raw.label || '',
    bank: raw.bank,
    number: raw.number,
    currency_code: raw.currency_code || 'BRL',
    solde: toNumber(raw.solde),
    status: toString(raw.status) as '0' | '1',
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw bank line data to BankLine entity
 */
export const mapBankLine = (raw: RawDolibarrRecord): BankLine => ({
    id: toString(raw.id),
    // Backend returns 'date_operation', legacy might use 'dateo'
    date_operation: toTimestamp(raw.date_operation || raw.dateo),
    // Backend returns 'date_value', legacy might use 'datev'
    date_value: raw.date_value ? toTimestamp(raw.date_value) : (raw.datev ? toTimestamp(raw.datev) : undefined),
    label: raw.label || '',
    amount: toNumber(raw.amount),
    fk_bank: toString(raw.fk_bank || raw.id),
    reconciled: raw.rappro === '1' || raw.rappro === 1,
    fk_account: toString(raw.fk_account),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw product data to Product entity
 */
export const mapProduct = (raw: RawDolibarrRecord): Product => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    label: raw.label || '',
    description: raw.description,
    price: toNumber(raw.price),

    seuil_stock_alerte: raw.seuil_stock_alerte ? toNumber(raw.seuil_stock_alerte) : undefined,
    type: toString(raw.type) as '0' | '1',
    price_ttc: toNumber(raw.price_ttc),
    vat_rate: toNumber(raw.vat_rate || raw.tva_tx),
    stock_reel: toNumber(raw.stock_reel || raw.stock), // Fallback to 'stock' if stock_reel missing

    // Status
    tosell: toString(raw.tosell) as '0' | '1',
    tobuy: toString(raw.tobuy) as '0' | '1',
    finished: toString(raw.finished) as '0' | '1',

    // Info
    duration: raw.duration,

    date_modification: toTimestamp(raw.tms),
    category_ids: raw.category_ids ? String(raw.category_ids).split(',') : undefined,
});

/**
 * Map raw category data to Category entity
 */
export const mapCategory = (raw: RawDolibarrRecord): Category => ({
    id: toString(raw.id),
    label: raw.label || '',
    type: raw.type || '',
    description: raw.description,
    date_modification: toTimestamp(raw.tms),
    parent_id: raw.parent_id ? toString(raw.parent_id) : undefined,
});

export const mapUserRight = (raw: RawDolibarrRecord): { id: string, fk_user: string, fk_id: string, date_modification?: number } => {
    return {
        id: String(raw.id || raw.rowid || ''),
        fk_user: String(raw.fk_user || raw.user_id || ''),
        fk_id: String(raw.fk_id || raw.right_id || ''),
        date_modification: toTimestamp(raw.tms)
    };
};

/**
 * Map raw agenda event data to AgendaEvent entity
 */
export const mapAgendaEvent = (raw: RawDolibarrRecord): AgendaEvent => {
    const pct = toNumber(raw.percentage);
    return {
        id: toString(raw.id),
        ref: raw.ref || '',
        label: raw.label || '',
        // Backend SQL: UNIX_TIMESTAMP(datep) as date_start
        date_start: toTimestamp(raw.date_start || raw.datep),
        // Backend SQL: UNIX_TIMESTAMP(datep2) as date_end
        date_end: toTimestamp(raw.date_end || raw.datep2 || raw.datef),
        type_code: raw.type_code || raw.code || '',
        percentage: pct < 0 ? 0 : pct,
        socid: raw.socid ? toString(raw.socid) : undefined,
        project_id: raw.project_id ? toString(raw.project_id) : (raw.fk_project ? toString(raw.fk_project) : undefined),
        description: raw.description || raw.note, // Supports both 'description' (sync) and 'note' (legacy)
        user_assigned: raw.userassigned ? toString(Object.keys(raw.userassigned)[0] || '') : undefined,
        location: raw.location,
        elementtype: raw.elementtype,
        fk_element: raw.fk_element ? toString(raw.fk_element) : undefined,
        date_c: toTimestamp(raw.datec),
        fulldayevent: raw.fulldayevent === '1' || raw.fulldayevent === 1,
        priority: raw.priority ? toNumber(raw.priority) : undefined,
        fk_user_author: raw.fk_user_author ? toString(raw.fk_user_author) : undefined,
        user_author_name: raw.user_author_firstname ? `${raw.user_author_firstname} ${raw.user_author_lastname || ''}`.trim() : (raw.user_author_login || undefined),
        transparency: raw.transparency ? toNumber(raw.transparency) : undefined,
        date_modification: toTimestamp(raw.tms),
    };
};

/**
 * Map raw shipment data to Shipment entity
 */
export const mapShipment = (raw: RawDolibarrRecord): Shipment => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    socid: raw.fk_soc ? toString(raw.fk_soc) : '',
    fk_commande: raw.fk_commande ? toString(raw.fk_commande) : (raw.origin_id ? toString(raw.origin_id) : undefined),
    // Backend returns 'date_creation', legacy might use 'datec'
    date_creation: toTimestamp(raw.date_creation || raw.datec),
    date_delivery: raw.date_delivery ? toTimestamp(raw.date_delivery) : undefined,
    status: toString(raw.status || raw.statut),
    tracking_number: raw.tracking_number,
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    fk_user_author: raw.fk_user_author ? toString(raw.fk_user_author) : undefined,
    fk_user_valid: raw.fk_user_valid ? toString(raw.fk_user_valid) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw contact data to Contact entity
 */
export const mapContact = (raw: RawDolibarrRecord): Contact => ({
    id: toString(raw.id),
    firstname: raw.firstname || '',
    lastname: raw.lastname || '',
    email: raw.email,
    phone_mobile: raw.phone_mobile || raw.phone_pro,
    socid: raw.fk_soc ? toString(raw.fk_soc) : '',
    poste: raw.poste,
    statut: toString(raw.statut) as '0' | '1',
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw warehouse data to Warehouse entity
 */
export const mapWarehouse = (raw: RawDolibarrRecord): Warehouse => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    label: raw.label || raw.lieu || '',
    description: raw.description,
    lieu: raw.lieu || '',
    statut: toString(raw.statut) as '0' | '1',
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw stock movement data to StockMovement entity
 */
export const mapStockMovement = (raw: RawDolibarrRecord): StockMovement => ({
    id: toString(raw.id),
    product_id: toString(raw.fk_product),
    warehouse_id: toString(raw.fk_entrepot),
    qty: toNumber(raw.value), // Backend retorna 'value', não 'qty'
    type: toString(raw.type_mouvement), // Backend retorna 'type_mouvement'
    label: raw.label || '',
    date_creation: toTimestamp(raw.datem),
    fk_user_author: raw.fk_user_author ? toString(raw.fk_user_author) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw user data to DolibarrUser entity
 */
export const mapUser = (raw: RawDolibarrRecord): DolibarrUser => ({
    id: toString(raw.id),
    login: raw.login || '',
    firstname: raw.firstname,
    lastname: raw.lastname,
    email: raw.email,
    phone_mobile: raw.phone_mobile,
    photo: raw.photo,
    statut: toString(raw.statut) as '0' | '1',
    job: raw.job,
    admin: raw.admin,
    rights: raw.rights,
    supervisor_id: raw.supervisor_id ? toString(raw.supervisor_id) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw expense report data to ExpenseReport entity
 */
export const mapExpenseReport = (raw: RawDolibarrRecord): ExpenseReport => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    fk_user_author: toString(raw.fk_user_author),
    date_debut: toTimestamp(raw.date_debut),
    date_fin: toTimestamp(raw.date_fin),
    total_ttc: toNumber(raw.total_ttc),
    statut: toString(raw.statut),
    fk_user_valid: raw.fk_user_valid ? toString(raw.fk_user_valid) : undefined,
    fk_user_approve: raw.fk_user_approve ? toString(raw.fk_user_approve) : undefined,
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw leave request data to LeaveRequest entity
 */
export const mapLeaveRequest = (raw: RawDolibarrRecord): LeaveRequest => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    fk_user: toString(raw.fk_user),
    date_debut: toTimestamp(raw.date_debut),
    date_fin: toTimestamp(raw.date_fin),
    type: toString(raw.fk_type),
    statut: toString(raw.statut) as '1' | '2' | '3' | '4' | '5',
    description: raw.description,
    fk_user_valid: raw.fk_user_valid ? toString(raw.fk_user_valid) : undefined, // ADDED
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw candidate data to Candidate entity
 */
export const mapCandidate = (raw: RawDolibarrRecord): Candidate => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    email: raw.email || '',
    lastname: raw.lastname || '',
    firstname: raw.firstname || '',
    phone: raw.phone || undefined,
    status: toString(raw.status || raw.statut),
    fk_job_position: raw.fk_recruitmentjobposition ? toString(raw.fk_recruitmentjobposition) : '',
    date_c: toTimestamp(raw.datec),
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw job position data to RecruitmentJobPosition entity
 */
export const mapJobPosition = (raw: RawDolibarrRecord): RecruitmentJobPosition => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    label: raw.label || '',
    description: raw.description,
    qty: toNumber(raw.qty) || 1,
    status: toString(raw.status || raw.statut),
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw manufacturing order data to ManufacturingOrder entity
 */
export const mapManufacturingOrder = (raw: RawDolibarrRecord): ManufacturingOrder => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    label: raw.label || '',
    product_to_produce_id: toString(raw.product_to_produce_id || raw.fk_product),
    qty: toNumber(raw.qty),
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    status: toString(raw.status || raw.statut) as '0' | '1' | '2' | '3',
    date_start: raw.date_start ? toTimestamp(raw.date_start) : undefined,
    date_end: raw.date_end ? toTimestamp(raw.date_end) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw BOM data to BOM entity
 */
export const mapBOM = (raw: RawDolibarrRecord): BOM => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    label: raw.label || '',
    product_id: raw.fk_product ? toString(raw.fk_product) : undefined,
    qty: toNumber(raw.qty),
    status: toString(raw.status || raw.statut),
});

/**
 * Map raw BOM line data
 */
export const mapBOMLine = (raw: RawDolibarrRecord): BOMLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id), // fk_bom retornado como parent_id
    fk_product: toString(raw.product_id), // Sync returns product_id, type expects fk_product
    qty: toNumber(raw.qty),
    efficiency: toNumber(raw.efficiency),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw system log data to SystemLog entity
 */
export const mapSystemLog = (raw: RawDolibarrRecord): SystemLog => ({
    id: toString(raw.id),
    ref: raw.ref || undefined,
    label: raw.label || '',
    description: raw.description || undefined,
    type_code: raw.type_code || 'UNKNOWN',
    date_action: toTimestamp(raw.date_action || raw.datep),
    fk_user_author: raw.fk_user_author ? toString(raw.fk_user_author) : undefined,
    socid: raw.socid ? toString(raw.socid) : undefined,
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    elementtype: raw.elementtype || undefined,
    fk_element: raw.fk_element ? toString(raw.fk_element) : undefined,
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw link data to Link entity
 */
export const mapLink = (raw: RawDolibarrRecord): Link => ({
    id: toString(raw.id),
    sourcetype: raw.sourcetype || '',
    sourceid: toString(raw.sourceid),
    targettype: raw.targettype || '',
    targetid: toString(raw.targetid),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw shipment line data
 */
export const mapShipmentLine = (raw: RawDolibarrRecord): ShipmentLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id),
    product_id: toString(raw.product_id),
    label: raw.label || '',
    description: raw.description || '',
    qty: toNumber(raw.qty),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw supplier invoice line data
 */
export const mapSupplierInvoiceLine = (raw: RawDolibarrRecord): SupplierInvoiceLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id),
    label: raw.label || '',
    description: raw.description || '',
    qty: toNumber(raw.qty),
    vat_rate: toNumber(raw.vat_rate || raw.tva_tx),
    subprice: toNumber(raw.subprice || raw.pu_ht),
    total_ht: toNumber(raw.total_ht),
    total_ttc: toNumber(raw.total_ttc),
    product_id: raw.fk_product ? toString(raw.fk_product) : (raw.product_id ? toString(raw.product_id) : undefined),
    product_ref: raw.product_ref || undefined,
    product_label: raw.product_label || undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw supplier order line data
 */
export const mapSupplierOrderLine = (raw: RawDolibarrRecord): SupplierOrderLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id),
    label: raw.label || '',
    description: raw.description || '',
    qty: toNumber(raw.qty),
    vat_rate: toNumber(raw.vat_rate),
    subprice: toNumber(raw.subprice),
    total_ht: toNumber(raw.total_ht),
    total_ttc: toNumber(raw.total_ttc),
    product_id: raw.product_id ? toString(raw.product_id) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw intervention line data
 */
export const mapInterventionLine = (raw: RawDolibarrRecord): InterventionLine => {
    return {
        id: toString(raw.id),
        parent_id: toString(raw.parent_id),
        desc: raw.description || '',
        qty: toNumber(raw.qty),
        date: toTimestamp(raw.tms),
        duration: raw.duration ? toNumber(raw.duration) : 0,
        date_modification: toTimestamp(raw.tms),
    };
};

/**
 * Map raw proposal line data
 */
export const mapProposalLine = (raw: RawDolibarrRecord): ProposalLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id),
    label: raw.label || '',
    description: raw.description || '',
    type: raw.type,
    qty: toNumber(raw.qty),
    vat_rate: toNumber(raw.vat_rate),
    subprice: toNumber(raw.subprice),
    total_ht: toNumber(raw.total_ht),
    total_ttc: toNumber(raw.total_ttc),
    total_tva: toNumber(raw.total_tva),
    product_id: raw.product_id ? toString(raw.product_id) : undefined,
    rang: toNumber(raw.rang),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw User Group data
 */
export const mapUserGroup = (raw: RawDolibarrRecord): UserGroup => ({
    id: toString(raw.id),
    name: raw.name || '',
    note: raw.note,
    datec: toTimestamp(raw.datec),
    tms: toTimestamp(raw.tms),
});

/**
 * Map raw Group User Link data
 */
export const mapGroupUser = (raw: RawDolibarrRecord): GroupUser => {
    return {
        id: String(raw.id || raw.rowid || ''),
        fk_user: String(raw.fk_user || raw.user_id || ''),
        fk_usergroup: String(raw.fk_usergroup || raw.group_id || ''),
        date_modification: toTimestamp(raw.tms),
        raw: raw
    };
};

export const mapPermission = (raw: RawDolibarrRecord): PermissionDefinition => {
    return {
        id: String(raw.id || raw.rowid || ''),
        libelle: raw.libelle || '',
        module: raw.module || '',
        perms: raw.perms || '',
        subperms: raw.subperms || '',
        type: raw.type || '',
        module_position: raw.module_position ? parseInt(raw.module_position) : undefined,
        family_position: raw.family_position ? parseInt(raw.family_position) : undefined,
        date_modification: toTimestamp(raw.tms),
        raw: raw
    };
};

export const mapGroupRight = (raw: RawDolibarrRecord): { id: string, fk_usergroup: string, fk_id: string, date_modification?: number } => {
    return {
        id: String(raw.id || raw.rowid || ''),
        fk_usergroup: String(raw.fk_usergroup || raw.group_id || ''),
        fk_id: String(raw.fk_id || raw.right_id || ''),
        date_modification: toTimestamp(raw.tms)
    };
};

/**
 * Map raw order line data
 */
export const mapOrderLine = (raw: RawDolibarrRecord): OrderLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id),
    label: raw.label || '',
    description: raw.description || '',
    type: raw.type,
    qty: toNumber(raw.qty),
    vat_rate: toNumber(raw.vat_rate),
    subprice: toNumber(raw.subprice),
    total_ht: toNumber(raw.total_ht),
    total_ttc: toNumber(raw.total_ttc),
    total_tva: toNumber(raw.total_tva),
    product_id: raw.product_id ? toString(raw.product_id) : undefined,
    rang: toNumber(raw.rang),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw invoice line data
 */
export const mapInvoiceLine = (raw: RawDolibarrRecord): InvoiceLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id),
    label: raw.label || '',
    description: raw.description || '',
    type: toNumber(raw.type),
    qty: toNumber(raw.qty),
    vat_rate: toNumber(raw.vat_rate || raw.tva_tx),
    subprice: toNumber(raw.subprice),
    total_ht: toNumber(raw.total_ht),
    total_ttc: toNumber(raw.total_ttc),
    total_tva: toNumber(raw.total_tva),
    product_id: raw.fk_product ? toString(raw.fk_product) : (raw.product_id ? toString(raw.product_id) : undefined),
    product_ref: raw.product_ref || undefined,
    product_label: raw.product_label || undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw task time log data
 */
export const mapTaskTimeLog = (raw: RawDolibarrRecord): TaskTimeLog => ({
    id: toString(raw.id),
    task_id: toString(raw.task_id),
    date: toTimestamp(raw.date),
    date_start: raw.date_start ? toTimestamp(raw.date_start) : undefined, // Map precise start time
    duration: toNumber(raw.duration),
    user_id: raw.user_id ? toString(raw.user_id) : undefined,
    note: raw.note,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw task contact data
 */
export const mapTaskContact = (raw: RawDolibarrRecord): TaskContact => ({
    id: toString(raw.id),
    task_id: toString(raw.task_id),
    contact_id: raw.contact_id ? toString(raw.contact_id) : undefined,
    user_id: raw.user_id ? toString(raw.user_id) : undefined,
    type_id: toString(raw.type_id),
    date_modification: toTimestamp(raw.tms), // Added for delta sync
});

/**
 * Map raw project contact data
 */
export const mapProjectContact = (raw: RawDolibarrRecord): ProjectContact => ({
    id: toString(raw.id),
    project_id: toString(raw.project_id),
    contact_id: raw.contact_id ? toString(raw.contact_id) : undefined,
    user_id: raw.user_id ? toString(raw.user_id) : undefined,
    type_id: toString(raw.type_id),
    date_modification: toTimestamp(raw.tms), // Updated to use TMS for delta sync
});
/**
 * Map raw payment invoice link data
 */
export const mapPaymentInvoiceLink = (raw: RawDolibarrRecord): PaymentInvoiceLink => ({
    id: toString(raw.id),
    fk_paiement: toString(raw.fk_paiement),
    fk_facture: toString(raw.fk_facture),
    amount: toNumber(raw.amount),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw supplier payment invoice link data
 */
export const mapSupplierPaymentInvoiceLink = (raw: RawDolibarrRecord): SupplierPaymentInvoiceLink => ({
    id: toString(raw.id),
    fk_paiementfourn: toString(raw.fk_paiementfourn),
    fk_facturefourn: toString(raw.fk_facturefourn),
    amount: toNumber(raw.amount),
    date_modification: toTimestamp(raw.tms),
});



/**
 * Map raw expense report line data
 */
export const mapExpenseReportLine = (raw: RawDolibarrRecord): ExpenseReportLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id),
    type_id: toString(raw.type_id),
    type_code: raw.type_code || '',
    type_label: raw.type_label || '',
    project_id: raw.project_id ? toString(raw.project_id) : undefined,
    description: raw.description,
    qty: toNumber(raw.qty),
    unit_price: toNumber(raw.unit_price),
    total_ht: toNumber(raw.total_ht),
    total_ttc: toNumber(raw.total_ttc),
    total_tva: toNumber(raw.total_tva),
    date_expense: toTimestamp(raw.date_expense),
    date_modification: toTimestamp(raw.tms), // Uses parent TMS from custom_sync
});

/**
 * Map raw expense type data
 */
export const mapExpenseType = (raw: RawDolibarrRecord): ExpenseType => ({
    id: toString(raw.id),
    code: raw.code || '',
    label: raw.label || '',
    active: toString(raw.active) as '0' | '1',
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw expense report payment data
 */
export const mapExpenseReportPayment = (raw: RawDolibarrRecord): ExpenseReportPayment => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    fk_expensereport: toString(raw.fk_expensereport),
    date_payment: toTimestamp(raw.date_payment || raw.datep),
    amount: toNumber(raw.amount),
    fk_bank: toString(raw.fk_bank),
    transaction_id: raw.transaction_id ? toString(raw.transaction_id) : (raw.fk_bank ? toString(raw.fk_bank) : undefined),
    bank_account_id: raw.bank_account_id ? toString(raw.bank_account_id) : undefined,
    fk_user_creat: toString(raw.fk_user_creat),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw expense report payment link data
 */
export const mapExpenseReportPaymentLink = (raw: RawDolibarrRecord): ExpenseReportPaymentLink => ({
    id: toString(raw.id),
    fk_payment: toString(raw.fk_payment),
    fk_expensereport: toString(raw.fk_expensereport),
    amount: toNumber(raw.amount),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw VAT payment data
 */
export const mapVATPayment = (raw: RawDolibarrRecord): VATPayment => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    fk_tva: toString(raw.fk_tva),
    date_payment: toTimestamp(raw.date_payment || raw.datep),
    amount: toNumber(raw.amount),
    fk_bank: toString(raw.fk_bank),
    num_payment: raw.num_payment ? String(raw.num_payment) : undefined,
    // Período de apuração do IVA (inline quando o Dolibarr retorna os campos da tva)
    periodo_inicio: raw.date_debut ? toTimestamp(raw.date_debut) : undefined,
    periodo_fim: raw.date_fin ? toTimestamp(raw.date_fin) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw Salary payment data
 */
export const mapSalaryPayment = (raw: RawDolibarrRecord): SalaryPayment => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    num_payment: raw.num_payment || undefined,
    fk_user: toString(raw.fk_user),
    date_payment: toTimestamp(raw.date_payment || raw.datep),
    amount: toNumber(raw.amount),
    salary: toNumber(raw.salary),
    fk_bank: toString(raw.fk_bank),
    fk_typepayment: raw.fk_typepayment || undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw Social Contribution payment data
 */
export const mapSocialContributionPayment = (raw: RawDolibarrRecord): SocialContributionPayment => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    fk_charge: toString(raw.fk_charge),
    date_payment: toTimestamp(raw.date_payment || raw.datep),
    amount: toNumber(raw.amount),
    fk_bank: toString(raw.fk_bank),
    num_payment: raw.num_payment ? String(raw.num_payment) : undefined,
    // Rótulo do encargo social (inline quando Dolibarr retorna libelle da chargesociales)
    label_origem: raw.libelle ? String(raw.libelle) : undefined,
    // Período do encargo social (inline quando Dolibarr retorna date_debut/date_fin)
    periodo_inicio: raw.date_debut ? toTimestamp(raw.date_debut) : undefined,
    periodo_fim: raw.date_fin ? toTimestamp(raw.date_fin) : undefined,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw Loan payment data
 */
export const mapLoanPayment = (raw: RawDolibarrRecord): LoanPayment => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    fk_loan: toString(raw.fk_loan),
    date_payment: toTimestamp(raw.date_payment || raw.datep),
    amount_capital: toNumber(raw.amount_capital),
    amount_insurance: toNumber(raw.amount_insurance),
    amount_interest: toNumber(raw.amount_interest),
    fk_bank: toString(raw.fk_bank),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw Various payment data
 */
export const mapVariousPayment = (raw: RawDolibarrRecord): VariousPayment => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    num_payment: raw.num_payment || undefined,
    label: raw.label || '',
    date_payment: toTimestamp(raw.date_payment || raw.datep),
    amount: toNumber(raw.amount),
    fk_bank: toString(raw.fk_bank),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw supplier proposal line data
 */
export const mapSupplierProposalLine = (raw: RawDolibarrRecord): SupplierProposalLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id),
    description: raw.description || '',
    qty: toNumber(raw.qty),
    vat_rate: toNumber(raw.vat_rate),
    subprice: toNumber(raw.subprice),
    total_ht: toNumber(raw.total_ht),
    total_ttc: toNumber(raw.total_ttc),
    total_tva: toNumber(raw.total_tva),
    product_id: raw.product_id ? toString(raw.product_id) : undefined,
    rang: toNumber(raw.rang),
    date_modification: toNumber(raw.tms),
});
