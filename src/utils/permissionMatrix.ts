// Matriz papel×tela×ação — deriva, de forma PURA, o que uma identidade (papel/grupo) pode VER e FAZER
// em cada tela. Junta o VER (screenAccess) com o FAZER (writePermissions) sobre a lista canônica de
// telas (MENU_REGISTRY_ITEMS). É o oráculo RBAC: dá pra gerar specs de teste "permitir/negar" por papel,
// personalizar a guia no chat, e documentar quem-pode-o-quê — sem UI e sem logar como cada papel.
//
// Alimente `ident.rights` com o retorno de `getGroupRights(config, groupId)` (hrAdmin.ts) p/ a matriz
// REAL de um grupo. As funções aqui são puras/testáveis; o fetch dos grupos vive em scripts/.

import { canAccessScreen, AccessIdentity } from './screenAccess';
import { canDoAction, WriteAction, WRITE_MAP } from './writePermissions';
import { MENU_REGISTRY_ITEMS, MenuRegistryItem } from '../config/menuRegistry';

export const WRITE_ACTIONS: WriteAction[] = [
    'create', 'edit', 'delete', 'validate', 'pay', 'approve', 'receive', 'close', 'reopen',
];

export interface ScreenAccessRow {
    screenId: string;
    label: string;
    path: string;
    /** Pode VER a tela? */
    canView: boolean;
    /** A tela tem gate de ESCRITA no WRITE_MAP? Se false, as ações abaixo são default-permissivo
     *  (o canDo não bloqueia) — importante NÃO ler `true` como "gate confirmado". */
    actionsGated: boolean;
    /** Ação -> permitido (EFETIVO: só pode FAZER numa tela que também pode VER). */
    actions: Record<WriteAction, boolean>;
}

/** Deriva, para UMA identidade (papel/grupo), o que ela VÊ e FAZ em cada tela. */
export function deriveScreenMatrix(
    ident: AccessIdentity,
    screens: MenuRegistryItem[] = MENU_REGISTRY_ITEMS,
): ScreenAccessRow[] {
    return screens.map((s) => {
        const canView = canAccessScreen(ident, s.id);
        const actions = {} as Record<WriteAction, boolean>;
        for (const a of WRITE_ACTIONS) {
            // EFETIVO: não dá pra FAZER numa tela que não se VÊ.
            actions[a] = canView && canDoAction(ident, s.id, a);
        }
        return { screenId: s.id, label: s.label, path: s.path, canView, actionsGated: !!WRITE_MAP[s.id], actions };
    });
}

/** Só as telas visíveis (útil p/ um "tour" personalizado por papel). */
export function visibleScreens(ident: AccessIdentity, screens: MenuRegistryItem[] = MENU_REGISTRY_ITEMS): ScreenAccessRow[] {
    return deriveScreenMatrix(ident, screens).filter((r) => r.canView);
}

/** Matriz em Markdown (uma linha por tela). Bom p/ CI/artefato/documentação viva. */
export function matrixToMarkdown(rows: ScreenAccessRow[], roleLabel: string): string {
    const head = `### ${roleLabel}\n\n| Tela | Ver | Criar | Editar | Excluir | Validar/Pagar | Gate? |\n|---|:-:|:-:|:-:|:-:|:-:|:-:|`;
    const b = (v: boolean) => (v ? '✅' : '—');
    const lines = rows.map((r) =>
        `| ${r.label} | ${b(r.canView)} | ${b(r.actions.create)} | ${b(r.actions.edit)} | ${b(r.actions.delete)} | ${b(r.actions.validate || r.actions.pay)} | ${r.actionsGated ? 'sim' : 'não'} |`,
    );
    return [head, ...lines].join('\n');
}
