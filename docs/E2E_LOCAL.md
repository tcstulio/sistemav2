# E2E local (Modo B) — contra Dolibarr real

Validação de **ponta a ponta** profunda, rodada **localmente / on-demand** (não na CI). Sobe a stack
inteira — **backend + frontend + um Dolibarr real local** — e roda a suite Playwright completa
(auth, navegação, fluxos internos).

## Por que local (e não na CI)

A CI **não tem** backend nem Dolibarr, e o repo é **público** → dados reais/PII **não podem** ir pra
nuvem. Então:
- **CI** roda só o **smoke** (frontend sobe / React monta) — ver `.github/workflows/playwright.yml`.
- **E2E completo** roda **local**, contra um Dolibarr seu, com dados reais/sanitizados que **nunca
  saem da sua máquina**.

## Passo a passo

### 1. Suba um Dolibarr local
```sh
docker compose -f docker-compose.e2e.yml up -d
# 1ª vez: o auto-install cria o schema (pode levar 1-2 min). Acompanhe:
docker compose -f docker-compose.e2e.yml logs -f e2e-dolibarr
```
Dolibarr fica em `http://localhost:8088` (admin / e2eadmin). O compose monta o `custom_sync.php` do
nosso fork (`../dolibarr`); descomente o mount de `custom` se houver módulos custom.

> **Shakeout de 1ª vez:** o auto-install da imagem oficial pode precisar de ajuste de módulos/versão
> para casar 100% com o nosso fork. Rode, veja os logs, e a gente itera os mounts/módulos.

### 2. (Opcional) Carregue o "último estado" — SANITIZADO
Para testar com dados realistas, carregue um dump **sanitizado** da produção (remova PII):
```sh
# Exporte da prod (faça isso num ambiente seguro), sanitize (anonimize nomes/emails/docs), e:
docker compose -f docker-compose.e2e.yml exec -T e2e-db mysql -udolibarr -pdolibarr dolibarr < dump_sanitizado.sql
```
⚠️ **Nunca** commite dumps nem use dados não-sanitizados — fica só local.

### 3. Configure a chave
No Dolibarr (`:8088`): Usuários → admin → gere a **API key**. Então:
```sh
cp .env.e2e.example .env.e2e   # .env.e2e é git-ignored
# edite .env.e2e e cole a DOLIBARR_API_KEY
```

### 4. Rode o E2E
```sh
npm run test:e2e:local
```
O runner (`scripts/e2e-local.ps1`) sobe backend (:3004, apontado pro Dolibarr local) + frontend
(:3003), espera as portas, roda `npx playwright test --project=chromium` (suite completa) e derruba
tudo no fim.

### 5. Derrube a stack
```sh
docker compose -f docker-compose.e2e.yml down       # mantém o volume/DB
docker compose -f docker-compose.e2e.yml down -v     # apaga o DB também
```

## Onde isto se encaixa

| Camada | Onde roda | O que cobre |
|---|---|---|
| Testes de componente (Vitest+RTL) | CI (gate) | lógica/interação de componentes |
| Regressão visual (Playwright) | CI (gate) | aparência das telas com baseline |
| Backend (Vitest) | CI (gate) | lógica de backend |
| **E2E (este doc)** | **local/on-demand** | **fluxos reais frontend↔backend↔Dolibarr** |

## Status / pendências

- ✅ Runner, compose e docs criados; CI saneada (smoke).
- ⏳ **Validação de 1ª execução** do Dolibarr em Docker (ajuste de módulos/versão p/ o nosso fork) —
  fazer no primeiro `up` e iterar.
- ⏳ Evolução opcional: Modo A (E2E como gate na CI com **seed sintético**, sem PII).
