# Deployment & Operação — CoolGroove

## Pré-requisitos

- **Node.js 20+**
- Acesso a uma instância **Dolibarr** (com API REST habilitada) e uma API key
- (Opcional) Certificados mTLS dos bancos (Inter/Itaú), chaves de LLM (GLM/Gemini/MiniMax)

## Configuração

### Backend

1. `cp backend/.env.example backend/.env` e preencha os valores.
2. Variáveis essenciais:
   - `DOLIBARR_API_URL`, `DOLIBARR_API_KEY` — conexão com o ERP.
   - `ADMIN_KEY` — gere com `openssl rand -hex 32`.
   - `ENCRYPTION_KEY` — gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Obrigatória** para os stores cifrados (e-mail, credenciais bancárias). Use **sempre a mesma** chave que cifrou os dados existentes — trocá-la invalida os segredos já salvos.
   - LLM: `ZAI_API_KEY` (GLM), `GOOGLE_GENAI_API_KEY` (Gemini), `MINIMAX_API_KEY`.
   - Bancos: `INTER_*` / `ITAU_*` (ou configure pela UI — ver abaixo).
3. Certificados mTLS dos bancos em `backend/certs/` (ou via UI → Configurações → Inter/Itaú → "Enviar Certificados").

### Frontend

- `cp .env.example .env` (na raiz — o Vite lê o `.env` da raiz) e ajuste se necessário. Variáveis são **opcionais** (têm defaults). Para ativar o Sentry no frontend, defina `VITE_SENTRY_DSN`.

> As **credenciais bancárias** (Client ID/Secret) podem ser salvas pela UI (admin) — ficam **cifradas** em `backend/data/banking_credentials.json` e têm prioridade sobre o `.env`.

## Rodar localmente

```bash
npm install
cd backend && npm install && cd ..

# tudo junto (frontend :3000 + backend :3004)
npm run dev:all

# ou separados
npm run dev:backend   # nodemon (tsx)
npm run dev:frontend  # vite
```

## Build

```bash
npm run build           # frontend: tsc + vite build -> dist/
cd backend && npm run build   # backend: tsc -> dist/
```

Em produção, o backend roda com `node dist/server.js` (`npm start`).

## Acesso externo (túnel)

Para expor o app de teste publicamente, o projeto usa um **túnel Cloudflare** (`cloudflared`) apontando para a porta local. O `tunnelService` registra a URL ativa e a expõe em `GET /api/tunnel/url`. Há um script `start-app-fixo.ps1` que sobe o app num endereço fixo (ver memória do projeto / repositório).

> Atenção (CORS): em produção só os domínios fixos são liberados; o túnel `*.trycloudflare.com` é liberado apenas **fora** de produção (`server.ts`).

## CI/CD

Workflows em `.github/workflows/`:

- **`ci.yml`** — backend (build + testes) e frontend (`tsc` + `test:unit` + build).
- **`playwright.yml`** — smoke E2E.
- **`visual.yml`** — regressão visual.

> Os jobs usam `npm install` (não `npm ci`) por incompatibilidade de lockfile Windows↔Linux (`@emnapi`).

## TaskRunner (issue → PR autônomo)

O sistema tem um **TaskRunner** que pega uma issue do GitHub e gera um PR automaticamente via `opencode`/glm num worktree isolado, com `Judge` e **auto-merge gated por CI** (a branch protection de `main` exige os checks verdes + estar atualizada). Operação detalhada em `docs/PLANO_TASKRUNNER_OPERACIONALIZACAO.md`.

## Segurança operacional

- Nunca commite `backend/.env` nem `backend/data/*.json` (já no `.gitignore`).
- Rotacione `ADMIN_KEY` e as chaves de API periodicamente; use chaves diferentes por ambiente.
- Webhooks bancários verificam assinatura (HMAC) quando o segredo está configurado.
