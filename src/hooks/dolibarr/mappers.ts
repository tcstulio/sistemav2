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
} from '../../types';

// ============ Helper Functions ============

/** Safely parse a date value to timestamp */
export const toTimestamp = (value: any): number => {
    if (!value) return 0;

    // Handle numeric strings (e.g. "1700000000" from PHP/MySQL drivers)
    if (typeof value === 'string' && !isNaN(Number(value)) && /^\d+$/.test(value)) {
        value = Number(value);
    }

    if (typeof value === 'number') {
        // If value is small (< 100 billion), assume seconds and convert to ms
        // 10,000,000,000 is year 2286 in seconds. 
        // 1,000,000,000,000 is year 2001 in milliseconds.
        // So checking < 100,000,000,000 is safe intersection.
        if (value < 100000000000) {
            return value * 1000;
        }
        return value;
    }
    const date = new Date(value);
    return isNaN(date.getTime()) ? 0 : date.getTime();
};

/** Safely convert to string */
export const toString = (value: any): string => {
    if (value === null || value === undefined) return '';
    return String(value);
};

/** Safely convert to number */
export const toNumber = (value: any): number => {
    const num = Number(value);
    return isNaN(num) ? 0 : num;
};

// ============ Entity Mappers ============

/**
 * Map raw supplier data (alias for mapThirdParty with supplier-specific handling)
 */
export const mapSupplier = (raw: any): ThirdParty => ({
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
export const mapThirdParty = (raw: any): ThirdParty => ({
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
export const mapInvoice = (raw: any): Invoice => ({
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
export const mapSupplierInvoice = (raw: any): SupplierInvoice => ({
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
export const mapOrder = (raw: any): Order => ({
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
export const mapSupplierOrder = (raw: any): SupplierOrder => ({
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
export const mapProject = (raw: any): Project => ({
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
export const mapTask = (raw: any): Task => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    label: raw.label || '',
    description: raw.description,
    project_id: raw.project_id ? toString(raw.project_id) : '',
    date_start: raw.date_start ? toTimestamp(raw.date_start) : 0,
    date_end: raw.date_end ? toTimestamp(raw.date_end) : 0,
    progress: toNumber(raw.progress),
    planned_workload: toNumber(raw.planned_workload),
    duration_effective: toNumber(raw.duration_effective),
    fk_user_assign: raw.fk_user_assign ? toString(raw.fk_user_assign) : undefined,
    fk_user_creat: raw.fk_user_creat ? toString(raw.fk_user_creat) : undefined,
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw proposal data to Proposal entity
 */
export const mapProposal = (raw: any): Proposal => ({
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
 * Map raw ticket data to Ticket entity
 */
export const mapTicket = (raw: any): Ticket => ({
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
});

/**
 * Map raw payment data to Payment entity
 */
export const mapPayment = (raw: any): Payment => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    date_payment: toTimestamp(raw.datep || raw.date_payment),
    amount: toNumber(raw.amount),
    fk_bank: raw.fk_bank ? toString(raw.fk_bank) : '',
    fk_user_create: raw.fk_user_create ? toString(raw.fk_user_create) : undefined,
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw supplier payment data to SupplierPayment entity
 */
export const mapSupplierPayment = (raw: any): SupplierPayment => ({
    id: toString(raw.id),
    ref: raw.ref || '',
    date_payment: toTimestamp(raw.datep || raw.date_payment),
    amount: toNumber(raw.amount),
    fk_bank: raw.fk_bank ? toString(raw.fk_bank) : '',
    fk_user_create: raw.fk_user_create ? toString(raw.fk_user_create) : undefined,
    date_creation: toTimestamp(raw.datec),
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw contract data to Contract entity
 */
export const mapContract = (raw: any): Contract => ({
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
export const mapIntervention = (raw: any): Intervention => ({
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
});

/**
 * Map raw bank account data to BankAccount entity
 */
export const mapBankAccount = (raw: any): BankAccount => ({
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
export const mapBankLine = (raw: any): BankLine => ({
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
export const mapProduct = (raw: any): Product => ({
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
});

/**
 * Map raw category data to Category entity
 */
export const mapCategory = (raw: any): Category => ({
    id: toString(raw.id),
    label: raw.label || '',
    type: raw.type || '',
    description: raw.description,
    date_modification: toTimestamp(raw.tms),
    parent_id: raw.parent_id ? toString(raw.parent_id) : undefined,
});

/**
 * Map raw agenda event data to AgendaEvent entity
 */
export const mapAgendaEvent = (raw: any): AgendaEvent => {
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
export const mapShipment = (raw: any): Shipment => ({
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
export const mapContact = (raw: any): Contact => ({
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
export const mapWarehouse = (raw: any): Warehouse => ({
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
export const mapStockMovement = (raw: any): StockMovement => ({
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
export const mapUser = (raw: any): DolibarrUser => ({
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
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw expense report data to ExpenseReport entity
 */
export const mapExpenseReport = (raw: any): ExpenseReport => ({
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
export const mapLeaveRequest = (raw: any): LeaveRequest => ({
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
export const mapCandidate = (raw: any): Candidate => ({
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
export const mapJobPosition = (raw: any): RecruitmentJobPosition => ({
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
export const mapManufacturingOrder = (raw: any): ManufacturingOrder => ({
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
export const mapBOM = (raw: any): BOM => ({
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
export const mapBOMLine = (raw: any): BOMLine => ({
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
export const mapSystemLog = (raw: any): SystemLog => ({
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
export const mapLink = (raw: any): Link => ({
    id: toString(raw.id),
    sourcetype: raw.sourcetype || '',
    sourceid: toString(raw.sourceid),
    targettype: raw.targettype || '',
    targetid: toString(raw.targetid),
    date_modification: Number(raw.id), // Links não têm tms, usar ID para sync incremental
});

/**
 * Map raw shipment line data
 */
export const mapShipmentLine = (raw: any): ShipmentLine => ({
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
export const mapSupplierInvoiceLine = (raw: any): SupplierInvoiceLine => ({
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
export const mapSupplierOrderLine = (raw: any): SupplierOrderLine => ({
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
export const mapInterventionLine = (raw: any): InterventionLine => ({
    id: toString(raw.id),
    parent_id: toString(raw.parent_id),
    desc: raw.description || '',
    qty: toNumber(raw.qty),
    date: toTimestamp(raw.tms),
    duration: 0,
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw proposal line data
 */
export const mapProposalLine = (raw: any): ProposalLine => ({
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
    remise_percent: toNumber(raw.remise_percent), // ADDED
    date_modification: toTimestamp(raw.tms),
});

/**
 * Map raw order line data
 */
export const mapOrderLine = (raw: any): OrderLine => ({
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
export const mapInvoiceLine = (raw: any): InvoiceLine => ({
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
    rang: toNumber(raw.rang),
    date_modification: toTimestamp(raw.tms),
});
