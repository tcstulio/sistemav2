# Arquitetura — CoolGroove

Sistema de gestão (ERP/CRM) construído **sobre o Dolibarr**, com integração de **WhatsApp** e um **agente de IA** que opera sobre os dados do negócio. Este documento descreve os componentes, o fluxo de dados e os principais subsistemas.

## Visão geral

```
┌─────────────┐      /api (cookie httpOnly + Bearer apiKey)      ┌──────────────────────┐
│  Frontend   │ ───────────────────────────────────────────────▶ │   Backend (Express)  │
│ React+Vite  │ ◀─────────────────────────────────────────────── │      backend/        │
│   src/      │            socket.io (tempo real)                 └───────────┬──────────┘
└─────────────┘                                                              │
                                                                              │ REST + custom_sync.php
                      ┌───────────────────────────────────────────────┬──────┴───────┬──────────────┐
                      ▼                     ▼                          ▼              ▼              ▼
                 ┌─────────┐         ┌─────────────┐            ┌───────────┐  ┌───────────┐  ┌───────────┐
                 │ Dolibarr│         │ WhatsApp     │            │ LLMs       │  │ Bancos    │  │ Stores    │
                 │  (ERP)  │         │ whatsapp-web │            │ GLM/MiniMax│  │ Inter/Itaú│  │ JSON+SQLite│
                 └─────────┘         └─────────────┘            │ Gemini/local│ │ (mTLS)    │  │ backend/data│
                                                                └───────────┘  └───────────┘  └───────────┘
```

## Componentes

| Componente | Caminho | Papel |
|---|---|---|
| **Frontend** | `src/` | SPA React + Vite (TypeScript). Fala com o backend via `/api` (proxy do Vite em dev). |
| **Backend** | `backend/` | API Express que orquestra Dolibarr, WhatsApp, o agente, os bancos e o scheduler. |
| **Dolibarr** | externo | ERP — fonte de verdade de clientes, faturas, propostas, projetos, tarefas, RH. Acessado via REST e por um `custom_sync.php` (dados que a API REST não expõe). |
| **Stores locais** | `backend/data/` | JSON para estado próprio do sistema (sessões de chat, scheduler, e-mail, credenciais). Campos sensíveis são **cifrados** (`crypto.ts`, AES-256-GCM). SQLite via `better-sqlite3` onde aplicável. |

## Subsistemas

- **WhatsApp / Bot** — `whatsapp-web.js` (Puppeteer). `sessionService` (multi-sessão), `botService`, `messageService`. O envio passa sempre pelo **`channelRouter`** (suporta provider `legacy` ou `moltbot` via feature flag).
- **Agente de IA** — `aiService` roda um loop ReAct com roteamento **multi-provedor** (GLM/Z.AI, MiniMax, Gemini, LLM local). `agentTools` expõe ferramentas de leitura/escrita no Dolibarr + geração de mídia (TTS/imagem/vídeo MiniMax, visão GLM-4.6V). Ações de escrita usam **deeplinks HITL** (tela de confirmação antes de criar/editar). `VirtualAssistant` (FAB) é o chat do frontend.
- **TaskRunner** — pega uma **issue do GitHub → PR autônomo** via `opencode`/glm em **worktree isolado**, com `Judge` (avaliação) e **auto-merge gated por CI**. Ver `docs/PLANO_TASKRUNNER_OPERACIONALIZACAO.md` e `taskRunnerService.ts`.
- **Banking** — Inter e Itaú (mTLS + OAuth2) via `BankingApiBase` (`services/banking/`). Credenciais cifradas em `bankingCredentialsStore` (store > `.env`). Webhooks com verificação HMAC.
- **Scheduler** — `schedulerService`: mensagens agendadas, broadcast (com cap de destinatários), lembretes recorrentes e regras de automação.
- **E-mail** — `emailService` (IMAP/SMTP). Credenciais cifradas em `emailStoreService`.
- **Delegação** — ciclo de vida de tarefas delegadas pelo agente (`delegationService` + painéis em `TaskDetail`).
- **Observabilidade** — `logger` (pino), Sentry (backend e frontend, *gated* por DSN), `GET /health` com checagem de dependências.

## Autenticação

- **Login** (`POST /api/auth/login`) valida credenciais no Dolibarr e cria uma **proto-session**: um token **opaco** (`sess_…`) entregue ao cliente e gravado num **cookie httpOnly**. A **chave real do Dolibarr nunca sai do servidor** (`protoSession` mapeia o token → chave de serviço).
- Middlewares `requireDolibarrLogin` e `requireDolibarrAdmin` aceitam o cookie httpOnly, `Authorization: Bearer <token>`, header `DOLAPIKEY` ou a break-glass `x-admin-key`.

## Persistência

- **Dolibarr** (ERP) é a fonte de verdade do negócio.
- **`backend/data/*.json`** guarda estado do próprio sistema (não versionado; sensível é cifrado).
- **SQLite** (`better-sqlite3`) onde há necessidade de consulta estruturada.

## Feature flags (env)

`WHATSAPP_PROVIDER` (`legacy`|`moltbot`), `MOLTBOT_ENABLED`, `TULIPA_ENABLED`, `SYNC_BRAIN_ENABLED`, `AUTO_REPLY_ENABLED`, `AUDIO_TRANSCRIPTION_ENABLED`, `CRM_CONTEXT_INJECTION` — ver `backend/.env.example`.

## Direção futura

O plano é **substituir gradualmente** o sistemav2/Dolibarr pelo **Tulipa v4** (OS para agentes) — ver `docs/TULIPA_V4_INTEGRATION_SPEC.md` e `docs/MOLTBOT_INTEGRATION_PLAN.md`.
