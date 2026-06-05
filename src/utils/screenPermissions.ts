// #112 — Resolução de permissão de tela por pessoa/grupo (override do RBAC base).
//
// Modelo: o admin define, org-wide, telas explicitamente liberadas (`allowed`) ou
// ocultadas (`hidden`) por GRUPO e por PESSOA. Isso é aplicado POR CIMA do `canAccess`
// base (direitos Dolibarr). Precedência: pessoa vence grupo; dentro do mesmo escopo,
// `hidden` vence `allowed`. Admin sempre tem acesso (bypass total).

export interface ScreenRule {
    hidden: string[];
    allowed: string[];
}

export interface ScreenPermissions {
    groups: Record<string, ScreenRule>;
    users: Record<string, ScreenRule>;
}

export const EMPTY_SCREEN_PERMISSIONS: ScreenPermissions = { groups: {}, users: {} };

// Telas que nunca podem ser ocultadas (evita travar o usuário fora do próprio sistema).
export const PROTECTED_SCREENS = new Set<string>(['dashboard', 'settings']);

export interface ResolveScreenAccessOpts {
    screenId: string;
    base: boolean;            // resultado do canAccess base (direitos Dolibarr)
    isAdmin: boolean;
    userId?: string | null;
    groupIds?: string[];
    perms?: ScreenPermissions | null;
}

/**
 * Decide se o usuário pode acessar uma tela, combinando o RBAC base com os overrides
 * de pessoa/grupo definidos pelo admin.
 *
 * Ordem de aplicação (do mais fraco ao mais forte):
 *   base → grupo.allowed → grupo.hidden → pessoa.allowed → pessoa.hidden
 * Telas em PROTECTED_SCREENS ignoram `hidden` (não podem ser bloqueadas por override).
 */
export function resolveScreenAccess(opts: ResolveScreenAccessOpts): boolean {
    const { screenId, base, isAdmin, userId, groupIds = [], perms } = opts;

    // Admin enxerga tudo — overrides nunca bloqueiam admin.
    if (isAdmin) return true;
    if (!perms) return base;

    const isProtected = PROTECTED_SCREENS.has(screenId);
    let eff = base;

    // Grupos (qualquer grupo do usuário): allow concede, hidden bloqueia (hidden vence).
    let groupAllow = false;
    let groupHide = false;
    for (const gid of groupIds) {
        const rule = perms.groups?.[gid];
        if (!rule) continue;
        if (rule.allowed?.includes(screenId)) groupAllow = true;
        if (rule.hidden?.includes(screenId)) groupHide = true;
    }
    if (groupAllow) eff = true;
    if (groupHide && !isProtected) eff = false;

    // Pessoa (vence grupo).
    const userRule = userId ? perms.users?.[userId] : undefined;
    if (userRule) {
        if (userRule.allowed?.includes(screenId)) eff = true;
        if (userRule.hidden?.includes(screenId) && !isProtected) eff = false;
    }

    return eff;
}
