// #850 — Mapa de permissões de ESCRITA do Dolibarr por tela + resolução pura/testável.
//
// canDo (DolibarrContext) gateia botões (Novo/Editar/Excluir/Validar/Pagar/...) pelos
// direitos de ESCRITA reais do Dolibarr (creer = criar/editar, supprimer = excluir,
// valider = validar; transições: paiement/cloturer/approuver/receptionner/approve).
// Ação/tela sem perm mapeada => NÃO bloqueia (default seguro).

export type WriteAction =
    | 'create' | 'edit' | 'delete' | 'validate'
    | 'pay' | 'approve' | 'receive' | 'close' | 'reopen';

export interface WriteEntry {
    module: string;
    create?: string;
    // Edit usa `edit` se definido; senão cai em `create` (Dolibarr usa 'creer' p/ criar+editar).
    edit?: string;
    delete?: string;
    validate?: string;
    pay?: string;
    approve?: string;
    receive?: string;
    close?: string;
    reopen?: string;
}

export interface WriteIdentity {
    admin?: number | string | boolean;
    rights?: any;
}

// Mapa de perms de ESCRITA por tela. Só perms confirmados/convenção sólida do Dolibarr.
export const WRITE_MAP: Record<string, WriteEntry> = {
    customers: { module: 'societe', create: 'creer', delete: 'supprimer' },
    contacts: { module: 'societe', create: 'contact.creer', delete: 'contact.supprimer' },
    suppliers: { module: 'societe', create: 'creer', delete: 'supprimer' },
    proposals: { module: 'propal', create: 'creer', delete: 'supprimer', validate: 'valider', close: 'cloturer' },
    orders: { module: 'commande', create: 'creer', delete: 'supprimer', validate: 'valider', close: 'cloturer' },
    invoices: { module: 'facture', create: 'creer', delete: 'supprimer', validate: 'valider', pay: 'paiement' },
    supplier_invoices: {
        module: 'fournisseur',
        create: 'facture.creer',
        delete: 'facture.supprimer',
        pay: 'facture.paiement',
        validate: 'facture.valider',
        reopen: 'facture.valider',
    },
    supplier_orders: { module: 'fournisseur', create: 'commande.creer', delete: 'commande.supprimer', approve: 'commande.approuver', receive: 'commande.receptionner' },
    supplier_proposals: { module: 'supplier_proposal', create: 'creer', delete: 'supprimer' },
    projects: { module: 'projet', create: 'creer', delete: 'supprimer' },
    tasks: { module: 'projet', create: 'creer', delete: 'supprimer' },
    // #1416 — exclusão de usuário Dolibarr precisa do gate padrão. Dolibarr aninha
    // as perms do módulo "user" sob "user.user.<perm>", daí o prefixo "user." nas
    // chaves do WRITE_MAP (resolvido por dot-walk em canDoAction).
    users: { module: 'user', create: 'user.creer', edit: 'user.creer', delete: 'user.supprimer' },
    products: { module: 'produit', create: 'creer', delete: 'supprimer' },
    services: { module: 'produit', create: 'creer', delete: 'supprimer' },
    tickets: { module: 'ticket', create: 'creer', delete: 'supprimer' },
    interventions: { module: 'ficheinter', create: 'creer', delete: 'supprimer' },
    contracts: { module: 'contrat', create: 'creer', delete: 'supprimer' },
    venues: { module: 'societe', create: 'creer', delete: 'supprimer' },
    categories: { module: 'categorie', create: 'creer', delete: 'supprimer' },
    shipments: { module: 'expedition', create: 'creer', delete: 'supprimer', validate: 'valider' },
    warehouses: { module: 'stock', create: 'creer', delete: 'supprimer', edit: 'stock' },
    expense_reports: { module: 'expensereport', create: 'creer', delete: 'supprimer', approve: 'approve' },
    centrovibe: { module: 'centrovibe', create: 'centrovibe', edit: 'centrovibe', delete: 'centrovibe' },
};

/**
 * Resolve se uma identidade (usuário logado OU alvo do "ver como") pode executar uma
 * ação de escrita numa tela. Função PURA — sem React/efeitos colaterais — p/ ser testada
 * isoladamente. Espelha a semântica do canDo original:
 *   - admin bypassa tudo;
 *   - rights ausentes (ainda não carregados) => não bloqueia (evita esconder por engano);
 *   - tela/ação sem perm mapeada => não bloqueia.
 */
export function canDoAction(ident: WriteIdentity | null | undefined, screen: string, action: WriteAction): boolean {
    if (!ident) return false;
    const isAdmin = ident.admin === 1 || ident.admin === '1' || ident.admin === true;
    if (isAdmin) return true;
    if (!ident.rights) return true; // rights não carregados: não bloqueia (evita esconder por engano)

    const map = WRITE_MAP[screen];
    if (!map) return true; // tela não mapeada: não bloqueia
    // Dolibarr usa 'creer' p/ criar+editar; `edit` próprio da tela vence quando definido.
    const perm = action === 'edit' ? (map.edit ?? map.create) : (map as any)[action];
    if (!perm) return true; // ação não suportada nessa tela: não bloqueia

    const moduleRights = ident.rights[map.module];
    if (!moduleRights) return false;

    // resolve perm aninhado (ex.: contact.creer, facture.creer)
    let cur: any = moduleRights;
    for (const part of perm.split('.')) {
        if (cur && typeof cur === 'object' && cur[part] !== undefined) cur = cur[part];
        else return false;
    }
    return cur === '1' || cur === 1 || cur === true;
}
