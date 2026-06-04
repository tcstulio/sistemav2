# UI Configurável por Admin (layout editável)

Sistema que permite a **administradores** editarem a aparência/layout do sistema de forma
**org-wide** (vale para todos), com **override por usuário** por cima. Épica: **#109**.

> Estado: **Fase 1 (fundação + branding) concluída** (PRs #107, #108). Fases 2–5 no roadmap.

---

## Modelo de dados

Duas camadas, mescladas no frontend:

1. **Padrão da organização** — definido pelo admin, persistido **no servidor** em
   `backend/data/ui_config.json` (mesmo padrão do `storeService`: `atomicWriteSync`, JSON).
   Vale para todos os usuários.
2. **Override do usuário** — preferências individuais por cima do padrão da org
   (frontend, `localStorage` em `coolgroove_config`). É como o **tema** (cor + dark mode)
   já funciona hoje.

> Decisão: **não** usamos SQLite — o backend persiste em arquivo JSON em todo o resto do
> sistema; mantivemos o padrão para consistência e zero dependência nativa.

---

## Arquitetura

### Backend
- **`backend/src/services/uiConfigService.ts`** — store JSON da config da organização.
  - `UiConfig` (campos atuais): `companyName`, `logoText`, `logoUrl?`, `themeColor`.
  - `get()` retorna a config; `update(partial)` valida/sanitiza e persiste.
  - Validação: `themeColor` restrito a `ALLOWED_THEME_COLORS` (allowlist Tailwind);
    limites de tamanho em textos. Campos inválidos são ignorados (mantém o valor atual).
  - `class UiConfigService` é exportada (aceita `storePath` para testes isolados);
    `uiConfigService` é a instância singleton.
- **`backend/src/routes/uiConfigRoutes.ts`** — `/api/ui-config`:
  - `GET /` — `requireDolibarrLogin` (qualquer usuário logado lê, para renderizar a UI).
  - `PUT /` — `requireDolibarrAdmin` + validação Zod (**só admin** altera o padrão da org).
  - Registrado em `backend/src/server.ts` (`app.use('/api/ui-config', uiConfigRoutes)`).

### Frontend
- **`src/services/uiConfigService.ts`** — `getUiConfig()` / `updateUiConfig(patch)`.
  Autenticação: header `Authorization: Bearer <apiKey>` (apiKey do `coolgroove_config` no
  `localStorage`), o mesmo padrão do `AiService`.
- **`src/hooks/useOrgBranding.ts`** — cache em módulo + pub/sub. Busca a config **uma vez**,
  compartilha entre componentes, e `setOrgBranding(updated)` atualiza todos os consumidores
  na hora (ex.: o Sidebar reflete a mudança assim que o admin salva).
- **Consumo (Fase 1):** `src/components/Layout/Sidebar.tsx` usa `companyName`/`logoText`
  da org (fallback `CoolGroove`/`D`).
- **Editor admin (Fase 1):** `src/components/Settings.tsx` → card **"Identidade da Empresa
  (Admin)"** (visível só para admin) edita nome/logo e salva via `updateUiConfig`.
- **Vite proxy:** `vite.config.ts` precisa rotear `/api/ui-config` para o backend (3004).
  **Todo endpoint novo precisa ser adicionado lá**, senão o front recebe 404 do dev server.

---

## Referência da API

### `GET /api/ui-config`
Auth: usuário logado (Bearer apiKey). Retorna o `UiConfig` da organização.
```json
{ "companyName": "CoolGroove", "logoText": "D", "themeColor": "indigo" }
```

### `PUT /api/ui-config`
Auth: **admin**. Body com os campos a alterar (todos opcionais). Retorna o `UiConfig` final.
```json
{ "companyName": "ACME Ltda", "logoText": "A", "themeColor": "emerald" }
```
- `themeColor` fora da allowlist é ignorado; textos são limitados em tamanho.

---

## Como usar (admin)
1. Login como **admin**.
2. **Configurações** → card **"Identidade da Empresa (Admin)"**.
3. Editar **nome** e **logo (texto/inicial)** → **Salvar identidade**.
4. Vale para **todos** (salvo no servidor); o Sidebar atualiza imediatamente.

---

## Como estender (receita para as próximas fases)

Padrão para acrescentar um novo aspecto configurável:

1. **Backend** — novo campo na interface `UiConfig` (`uiConfigService.ts`) + validação no
   `update()`. (Persistência e rotas já cobrem.)
2. **Frontend** — espelhar o campo na interface `UiConfig` de `src/services/uiConfigService.ts`.
3. **Editor admin** — novo controle no card de Settings (admin-only), salvando via
   `updateUiConfig` + `setOrgBranding` (para refletir na hora).
4. **Consumo** — o componente alvo lê via `useOrgBranding()` (ou um hook análogo) com fallback.
5. **Override do usuário** (quando aplicável) — camada `localStorage` por cima do default da org.
6. **Testes** — serviço (back, fs mockado + `atomicWrite` espiado) e rota (supertest, auth mockada).

### Roadmap das fases
| Fase | Issue | Conteúdo |
|------|-------|----------|
| 1 ✅ | #107/#108 | Fundação + Branding (nome/logo/cor) |
| 2 | #110 | Menu lateral (reordenar/ocultar itens e grupos) |
| 3 | #111 | Dashboard (escolher/reordenar widgets) |
| 4 | #112 | Permissões de tela por pessoa/grupo (estende `canAccess`) |
| 5 | #113 | Telas customizadas por pessoa/grupo |

### Notas para fases específicas
- **Menu (#110):** `Sidebar.tsx` define `menuGroups` hardcoded; adicionar `menuOrder[]` e
  `hiddenMenuItems[]` no `UiConfig` e filtrar/ordenar na renderização.
- **Dashboard (#111):** `Dashboard.tsx` é grade fixa; refatorar para um registro de widgets
  (id → componente) e guardar `dashboardWidgets[]` (ordem + on/off).
- **Permissões (#112):** RBAC vive em `src/context/DolibarrContext.tsx` (`canAccess(module)`,
  admin vê tudo; senão checa `rightsMap` dos direitos Dolibarr). Acrescentar overrides
  por pessoa/grupo no `UiConfig` e considerá-los em `canAccess`.

---

## Testes
- Backend: `backend/src/__tests__/services/uiConfigService.test.ts` e
  `backend/src/__tests__/routes/uiConfigRoutes.test.ts`.
- `backend/data/` está no `.gitignore` (a config da org não vai para o repositório).
