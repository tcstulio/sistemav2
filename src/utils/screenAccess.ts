// VER (canAccess) — mapa de permissões de LEITURA do Dolibarr por tela + resolução PURA/testável.
//
// FONTE CANÔNICA do VER — o DolibarrContext.computeBaseAccess importa daqui (de-dup #1073 / adversarial:
// antes havia 2 cópias do rightsMap que podiam divergir). É o PAR do `writePermissions.ts` (FAZER):
// juntos, `permissionMatrix.ts` deriva a matriz papel×tela×ação SEM UI e SEM login por papel.

export interface AccessIdentity {
    admin?: number | string | boolean;
    /** shape de user.rights do Dolibarr (mesmo shape que getGroupRights devolve p/ um grupo). */
    rights?: any;
}

interface AccessEntry { module: string; perms: string[]; }

/** Telas "públicas": visíveis a qualquer um logado (não passam por RBAC de módulo). */
export const PUBLIC_SCREENS = new Set<string>(['dashboard']);

/** Mapa de LEITURA por tela (screenId -> módulo Dolibarr + perms aceitas). Fonte canônica do VER. */
export const RIGHTS_MAP: Record<string, AccessEntry> = {
    customers: { module: 'societe', perms: ['lire', 'read', 'client.voir'] },
    suppliers: { module: 'fournisseur', perms: ['lire', 'read', 'facture.lire'] },
    contacts: { module: 'contact', perms: ['lire', 'read'] },
    proposals: { module: 'propale', perms: ['lire', 'read'] },
    orders: { module: 'commande', perms: ['lire', 'read'] },
    invoices: { module: 'facture', perms: ['lire', 'read'] },
    payments: { module: 'facture', perms: ['lire', 'read'] },
    contracts: { module: 'contrat', perms: ['lire', 'read'] },
    supplier_orders: { module: 'fournisseur', perms: ['commande.lire'] },
    supplier_invoices: { module: 'fournisseur', perms: ['facture.lire'] },
    projects: { module: 'projet', perms: ['lire', 'read'] },
    tasks: { module: 'projet', perms: ['lire', 'read'] },
    interventions: { module: 'ficheinter', perms: ['lire', 'read'] },
    agenda: { module: 'agenda', perms: ['myevent.read', 'allactions.read'] },
    products: { module: 'produit', perms: ['lire', 'read'] },
    services: { module: 'service', perms: ['lire', 'read'] },
    inventory: { module: 'stock', perms: ['lire', 'read'] },
    shipments: { module: 'expedition', perms: ['lire', 'read'] },
    warehouses: { module: 'stock', perms: ['lire', 'read'] },
    manufacturing: { module: 'mrp', perms: ['read', 'lire'] },
    boms: { module: 'bom', perms: ['read', 'lire'] },
    users: { module: 'user', perms: ['user.lire', 'user.read', 'self.read'] },
    hr: { module: 'holiday', perms: ['read', 'lire'] },
    tickets: { module: 'ticket', perms: ['read', 'lire'] },
    bank_accounts: { module: 'banque', perms: ['lire', 'read'] },
    categories: { module: 'categorie', perms: ['lire', 'read'] },
    // Vendas/Finanças extras
    supplier_proposals: { module: 'fournisseur', perms: ['lire', 'read'] },
    supplier_payments: { module: 'fournisseur', perms: ['facture.lire'] },
    tax_payments: { module: 'tax', perms: ['charges.lire', 'read', 'lire'] },
    salary_payments: { module: 'salaries', perms: ['read', 'lire'] },
    expense_report_payments: { module: 'expensereport', perms: ['lire', 'read'] },
    movements: { module: 'stock', perms: ['mouvement.lire'] },
    // Comunicação & IA (liberadas a qualquer autenticado — societe.lire)
    whatsapp: { module: 'societe', perms: ['lire', 'read'] },
    email: { module: 'societe', perms: ['lire', 'read'] },
    chat: { module: 'societe', perms: ['lire', 'read'] },
    automation: { module: 'societe', perms: ['lire', 'read'] },
    partnerships: { module: 'societe', perms: ['lire', 'read'] },
    venues: { module: 'societe', perms: ['lire', 'read'] },
    // Relatórios
    reports: { module: 'facture', perms: ['lire', 'read'] },
    monthly_report: { module: 'facture', perms: ['lire', 'read'] },
    // Sistema
    activity: { module: 'agenda', perms: ['myevent.read', 'allactions.read'] },
    system_events: { module: 'societe', perms: ['lire', 'read'] },
    development: { module: 'user', perms: ['user.lire'] },
    settings: { module: 'user', perms: ['self.read'] },
    simulator: { module: 'societe', perms: ['lire', 'read'] },
};

function truthy(v: any): boolean { return v === '1' || v === 1 || v === true; }

/** Resolve um perm (plano `lire` ou aninhado `client.voir`) contra os rights de um módulo. */
function hasPerm(moduleRights: any, perm: string): boolean {
    if (!moduleRights) return false;
    if (perm.includes('.')) {
        let cur: any = moduleRights;
        for (const part of perm.split('.')) {
            if (cur && typeof cur === 'object' && cur[part] !== undefined) cur = cur[part];
            else return false;
        }
        return truthy(cur);
    }
    return truthy(moduleRights[perm]);
}

/**
 * Uma identidade (usuário logado OU grupo/papel via getGroupRights) pode VER a tela?
 *   - admin bypassa tudo;
 *   - tela pública (dashboard) sempre visível;
 *   - rights ausentes => não vê (secure-default p/ VER, ao contrário do FAZER);
 *   - tela mapeada => precisa de ao menos um perm; tela não mapeada => fallback rights[screen].read/lire/consulter.
 */
export function canAccessScreen(ident: AccessIdentity | null | undefined, screenId: string): boolean {
    if (!ident) return false;
    if (PUBLIC_SCREENS.has(screenId)) return true;
    if (truthy(ident.admin)) return true;
    if (!ident.rights) return false;

    const mapping = RIGHTS_MAP[screenId];
    if (mapping) {
        const moduleRights = ident.rights[mapping.module];
        if (!moduleRights) return false;
        return mapping.perms.some((p) => hasPerm(moduleRights, p));
    }
    const r = ident.rights[screenId];
    return !!(r && (r.read || r.lire || r.consulter));
}
