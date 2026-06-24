# Plano — Gestão completa de Grupos & Permissões do Dolibarr no app

> Status: aprovado, em implementação · PR app: `tcstulio/sistemav2` · PR PHP: `tcstulio/dolibarr`
> Issues: [sistemav2#820](https://github.com/tcstulio/sistemav2/issues/820) · [dolibarr#137](https://github.com/tcstulio/dolibarr/issues/137)

## Contexto / problema

A **Central de Permissões** já controla **VER** (`canAccess`/`computeBaseAccess`, lê direitos `lire/read` reais)
e **FAZER** (`canDo`, lê direitos de escrita reais), com enforcement por chave-do-próprio-usuário. Mas para
**editar** grupos, membros e direitos, o admin ainda precisa ir à tela do Dolibarr.

Objetivo: gerenciar **grupos e permissões de forma completa dentro do app** (criar/editar/excluir grupos,
pôr/tirar pessoas, adicionar/remover direitos) e que esses direitos governem telas (VER) e ações (FAZER).

### Nó técnico (verificado no fonte do Dolibarr)

A API REST expõe só **leitura** de grupos + `GET {id}/setGroup/{group}` (adicionar a grupo). **Não há** REST
para criar/editar/excluir grupo, remover de grupo, nem **adicionar/remover direito**. As classes PHP
(`UserGroup`/`User`) têm tudo (`create/update/delete/addrights/delrights/SetInGroup/RemoveFromGroup`), com
gatilhos de auditoria. O `custom_sync.php` (no webroot, já versionado e já fazendo writes de tarefas) prova
que dá para chamar essas classes a partir de um script custom.

Como `canAccess`/`canDo` já leem os direitos reais, **editar direitos reflete automaticamente** em telas/ações
(com um refresh de cache). O que falta é só a **camada de escrita**.

## Arquitetura (3 camadas)

```
Frontend (Central → aba "Grupos & Permissões": GroupManager + PermissionManager reusados)
   → writes chamam NOSSOS endpoints de backend (não mais REST inventada)
Backend (/api/admin/groups/* sob requireDolibarrAdmin + auditoria adminAuditService)
   → proxyCustomSync com a CHAVE DE SERVIÇO (admin)
Dolibarr produção: NOVO custom_groups.php (admin-gated) → UserGroup/User::addrights/delrights/create/...
```

**Segurança — dupla trava:** `requireDolibarrAdmin` no backend **e** `if (empty($user->admin)) → 403` no PHP.
O `custom_sync.php` hoje NÃO checa admin; o novo arquivo NÃO herda esse furo.

## A) PHP — `custom_groups.php` (novo, no webroot do Dolibarr)

Arquivo separado (não empilhar no `custom_sync.php`) para isolar as escritas de alto risco atrás de um guard
de admin explícito. Cabeçalho/bootstrap/auth copiados do `custom_sync.php`; guard de admin obrigatório.

| `action` | params | método PHP | resposta |
|---|---|---|---|
| `create_group` | `name`,`note` | `UserGroup::create()` (usa `$user` global) | `{success, group_id}` |
| `update_group` | `group_id`,`name`,`note` | `fetch`+`update()` | `{success, group_id}` |
| `delete_group` | `group_id` | `fetch`+`delete($user)` | `{success}` |
| `add_group_user` | `group_id`,`user_id` | `User::SetInGroup($gid,$entity)` | `{success}` |
| `remove_group_user` | `group_id`,`user_id` | `User::RemoveFromGroup($gid,$entity)` | `{success}` |
| `add_group_right` | `group_id`,`rid` | `UserGroup::addrights($rid,'','',$entity)` | `{success, rid}` |
| `remove_group_right` | `group_id`,`rid` | `UserGroup::delrights($rid,'','',$entity)` | `{success, rid}` |
| `add_user_right` | `user_id`,`rid` | `User::addrights($rid,'','',$entity)` | `{success, rid}` |
| `remove_user_right` | `user_id`,`rid` | `User::delrights($rid,'','',$entity)` | `{success, rid}` |

`rid` = `id` de `llx_rights_def` (= `fk_id` que `getGroupRights`/`permissions` já usam). `entity` uniforme
(`$conf->entity`) em add+remove de membro para evitar mismatch. `fetch()<=0` → 404.

## B) Backend

- `backend/src/services/dolibarr/hr.ts`: `groupsWrite()` (via `proxyCustomSync(..., 'custom_groups.php')`) + 8 métodos; expor em `index.ts`.
- `backend/src/routes/groupsRoutes.ts` (novo, `requireDolibarrAdmin` + `zod` + `adminAuditService`):

| método + path | audit action |
|---|---|
| `POST /api/admin/groups` | `group.create` |
| `PUT /api/admin/groups/:groupId` | `group.update` |
| `DELETE /api/admin/groups/:groupId` | `group.delete` |
| `POST/DELETE /api/admin/groups/:groupId/users/:userId` | `group.user.add/remove` |
| `POST/DELETE /api/admin/groups/:groupId/rights/:rid` | `group.right.add/remove` |
| `POST/DELETE /api/admin/users/:userId/rights/:rid` | `user.right.add/remove` |

## C) Frontend

- **Rewire** dos 9 writes em `src/services/api/hrAdmin.ts` para os endpoints do backend (mantendo nomes/assinaturas → `PermissionManager`/`GroupDetail`/`GroupModal`/`GroupManager` seguem iguais).
- **Refresh/invalidação** (`src/hooks/dolibarr/useInvalidatePermissions.ts`): `dbService.clearStores(['groupRights','userRights','groupUsers','groups'])` + `invalidateQueries`. Necessário porque o delta-sync (`rowid > watermark`) **não detecta remoções**.
- **`canAccess`/`canDo` e "Ver como"** (`src/context/DolibarrContext.tsx`): `refreshCurrentUser()` + re-resolver `previewTarget.rights` após edição.
- **Aba "Grupos & Permissões"** em `PermissionsCenter.tsx` (extrair `GroupManagerInner` sem `PageLayout`). Aviso ao editar direitos do módulo `user` (direito 342 → pode quebrar a geração da chave de API / acesso ao app).

### Modelo de 2 camadas
1. **Direitos Dolibarr** (esta aba) → dirige VER+FAZER nos módulos do ERP (fonte de verdade).
2. **Matriz de Telas** (`ScreenAccessMatrix`/`ui_config`) → override fino por tela + telas só-de-app.
A aba **"Acesso ao App"** é ortogonal (só põe no grupo que gera a chave de API).

## Segurança / rollback
- Escalonamento barrado por dupla trava (admin guard PHP + `requireDolibarrAdmin`).
- Auditoria dupla: gatilhos nativos do Dolibarr + `adminAuditService`.
- Rollback em camadas: esconder a aba, remover `custom_groups.php` do webroot (desliga 100% das escritas), `git revert` do `hrAdmin.ts`.

## Deploy (produção Dolibarr) — fluxo do `AGENTS.md`
1. Abrir issue em `tcstulio/dolibarr`.
2. Criar `custom_groups.php` local.
3. `powershell -ExecutionPolicy Bypass -File deploy_dolibarr.ps1 "custom_groups.php"` (FTP via `.env.local`).
4. Commit + push `main`; registrar em `AGENTS.md`; fechar issue.

## Verificação E2E
1. Criar grupo "E2E Teste".
2. Dar `facture.lire` → linha em `llx_usergroup_rights` + auditoria.
3. Pôr usuário não-admin no grupo.
4. "Ver como" → tela Faturas aparece.
5. Login real → Faturas aparece (enforcement).
6. Remover `facture.lire` → tela some (testa detecção de remoção via `clearStores`).
7. Teste negativo: chamada com chave não-admin → 403 (backend e PHP).
8. Excluir grupo → some + auditoria `group.delete`.
