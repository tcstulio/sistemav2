# API — CoolGroove Backend

A API é servida pelo Express em `backend/src/server.ts` sob o prefixo `/api`. Esta referência lista os **grupos de rotas**, sua autenticação e os endpoints principais. Para o contrato exato de cada rota, consulte o arquivo de rota correspondente em `backend/src/routes/`.

## Autenticação

A maioria das rotas exige sessão. As formas aceitas (em ordem) pelos middlewares (`backend/src/middleware/authMiddleware.ts`):

1. Header `dolapikey` / `DOLAPIKEY`
2. Query `?DOLAPIKEY=` / `?apiKey=`
3. Header `Authorization: Bearer <token>`
4. **Cookie httpOnly `dolapikey`** (definido no login — é o que o navegador envia automaticamente)

`requireDolibarrAdmin` ainda aceita a break-glass `x-admin-key` (master key do `.env`).

> O token é a **proto-session** opaca (`sess_…`); a chave real do Dolibarr fica no servidor.

## Rate limiting

Limiters por grupo em `server.ts`: global 500/15min, AI 20/min (só POST), banking 30/min, scheduler 30/min, auth 20/min. `/health` é isento.

## Grupos de rotas

| Prefixo | Auth | Descrição |
|---|---|---|
| `GET /health` | pública | Status do servidor + dependências (Dolibarr, Scheduler, Inter, Itaú, **WhatsApp**). |
| `/api/auth` | pública (login) | `POST /login` (cria proto-session + cookie httpOnly), `POST /logout` (limpa o cookie). |
| `/api/dolibarr` | login | Proxy/operações sobre o Dolibarr (clientes, faturas, propostas, projetos, tarefas, RH, delegação). |
| `/api/ai` | login | Agente: `generate-reply`, `generate-reply-async` + jobs, análise de PDF/imagem, sessões de chat, automação de análise financeira. |
| `/api/whatsapp` | login | Sessões (QR, status), envio, conversas. |
| `/api/scheduler` | login | `POST /schedule`, `POST /broadcast` (com cap), `POST /reminder`, `POST /confirmation`, `GET /pending`, `GET /history`, `DELETE /:id`. |
| `/api/banking` | login | Importação OFX/CSV e operações gerais de banco. |
| `/api/banking/credentials` | **admin** | `POST` (salva credenciais cifradas + aplica em runtime), `GET /status` (só flags), `DELETE /:bank`. |
| `/api/inter` | login (webhooks públicos) | Banco Inter: `GET /status`, `POST /test`, `POST /certificates`, saldo, extrato, Pix, boletos, `POST /webhook/*`. |
| `/api/itau` | login (webhooks públicos) | Banco Itaú: análogo ao Inter, com verificação HMAC nos webhooks. |
| `/api/documents` | login | `POST /send` (via WhatsApp, com aprovação), previews de boleto/fatura (PDF), `GET /:entityType/:entityId/pdf`, `GET /user-photo` (proxy do avatar). |
| `/api/approvals` | login | Fila de aprovação (ações sensíveis do agente/financeiro), com TTL. |
| `/api/email` | login | Contas IMAP/SMTP, leitura/envio, templates. |
| `/api/centrovibe` | login | Agregador de eventos (scrapers Sympla/Shotgun/Blacktag). |
| `/api/admin` | **admin** | Status do sistema, restart, auditoria, permissões do agente por usuário. |
| `/api/ui-config` | login / admin (escrita) | Config da organização (branding, menu, dashboard, permissões de tela, automação de tasks). |
| `/api/dashboard` | login | Artefatos/widgets do dashboard. |
| `/api/tasks` | login | TaskRunner: criar/listar tasks (issue→PR), métricas, histórico, preview. |
| `/api/notifications` | login | Notificações de tarefa por papel (responsável/interveniente/criador). |
| `/api/integration` | login | Integrações externas (Tulipa/Moltbot). |
| `/api/github` | login | Operações no GitHub (issues/PRs) usadas pelo TaskRunner. |
| `/api/webhook` | segredo opcional | Webhooks de entrada (`/trigger`, eventos do Dolibarr). Header `x-webhook-secret` se `WEBHOOK_SECRET` definido. |

## Validação

Rotas usam **Zod** via o middleware `validateBody`/`validateQuery`/`validateParams` (`backend/src/middleware/validation.ts`). Erros de validação retornam `400` com `{ error, details/issues }`.

## Tempo real (socket.io)

`socketService` autentica o handshake por `auth.token` (proto-session) e emite eventos como `inter:transaction`, atualizações de task e atividade do agente.
