# Especificação de Integração: sistemav2 ↔ tulipa-v4

> Issue de referência: #155 (Ponte tulipa-v4 — agente externo como engine do chat)

## 1. Visão Geral

O tulipa-v4 é o engine de agente com 235+ tools, contrato formal, routing inteligente e multi-tenant.
O sistemav2 é o frontend web (React) com integração profunda ao Dolibarr ERP.

Na integração, o sistemav2 vira um **surface** (como WhatsApp já é para o tulipa-v4).

```
[Usuário] → [sistemav2 Frontend] → [sistemav2 Backend (proxy)] → [tulipa-v4 Agent Engine] → [Tools]
                                     ↕                                                    ↕
                               [Dolibarr API]                                        [Dolibarr API]
```

## 2. Formato de Resposta do Agente

### 2.1. Links Internos (entidades do sistemav2)

O tulipa-v4 DEVE retornar links no formato HTML que o sistemav2 já renderiza:

```html
<a href="/customers/123" class="text-blue-600 underline font-semibold">Nome do Cliente</a>
<a href="/invoices/456" class="text-blue-600 underline font-semibold">IN2606-0633</a>
<a href="/projects/789" class="text-blue-600 underline font-semibold">PJ2606-0554 — Talk Talk</a>
```

O frontend usa regex para detectar e tornar clicáveis:
- Deeplinks internos: `/[path]?prefill=[token]` → botão "Revisar e criar"
- Links de entidade: `/[entidade]/[id]` → navegação in-app (React Router)
- URLs externas: `https://...` → abre em nova aba

### 2.2. Mapa de Rotas do sistemav2

O tulipa-v4 deve conhecer estas rotas para gerar links corretos:

| Entidade | Rota Detalhe | Rota Lista | Rota Criação | Rota Edição |
|---|---|---|---|---|
| Cliente | `/customers/:id` | `/customers` | `/customers/new` | `/customers/:id/edit` |
| Contato | `/contacts/:id` | `/contacts` | `/contacts/new` | `/contacts/:id/edit` |
| Fornecedor | `/suppliers/:id` | `/suppliers` | `/suppliers/new` | `/suppliers/:id/edit` |
| Projeto | `/projects/:id` | `/projects` | `/projects/new` | `/projects/:id/edit` |
| Tarefa | `/tasks/:id` | `/tasks` | `/tasks/new` | `/tasks/:id/edit` |
| Fatura | `/invoices/:id` | `/invoices` | `/invoices/new` | `/invoices/:id/edit` |
| Fatura Fornecedor | `/supplier_invoices/:id` | `/supplier_invoices` | `/supplier_invoices/new` | `/supplier_invoices/:id/edit` |
| Proposta | `/proposals/:id` | `/proposals` | `/proposals/new` | `/proposals/:id/edit` |
| Solicitação Preço | `/supplier_proposals/:id` | `/supplier_proposals` | `/supplier_proposals/new` | `/supplier_proposals/:id/edit` |
| Pedido | `/orders/:id` | `/orders` | `/orders/new` | `/orders/:id/edit` |
| Ticket | `/tickets/:id` | `/tickets` | `/tickets/new` | `/tickets/:id/edit` |
| Produto | `/products/:id` | `/products` | `/products/new` | `/products/:id/edit` |
| Serviço | `/services/:id` | `/services` | - | `/services/:id` |
| Contrato | `/contracts` (sem :id) | `/contracts` | `/contracts/new` | `/contracts/:id/edit` |
| Intervenção | `/interventions` (sem :id) | `/interventions` | `/interventions/new` | `/interventions/:id/edit` |
| Envio | N/A | `/shipments` | - | - |
| Pagamento | `/payments/:id` | `/payments` | - | - |
| Banco | `/bank_accounts` | `/bank_accounts` | - | - |
| Usuário | `/hr/:id` | `/hr` | `/hr/users/new` | `/hr/users/:id/edit` |
| Candidato | `/hr` (tab) | `/hr` | `/hr/candidates/new` | `/hr/candidates/:id/edit` |
| Vaga | `/hr` (tab) | `/hr` | `/hr/jobs/new` | `/hr/jobs/:id/edit` |
| Grupo | `/admin/groups` | `/admin/groups` | `/hr/groups/new` | `/hr/groups/:id/edit` |
| Despesa | `/hr` (tab) | `/hr` | `/hr/expenses/new` | `/hr/expenses/:id/edit` |
| Evento | `/agenda/:id` | `/agenda` | `/agenda/new` | `/agenda/:id/edit` |
| BOM | `/manufacturing` | `/manufacturing` | `/manufacturing/bom/new` | `/manufacturing/bom/:id/edit` |
| Ordem Produção | `/manufacturing` | `/manufacturing` | `/manufacturing/mo/new` | `/manufacturing/mo/:id/edit` |
| Lote | N/A | `/batch/new` | `/batch/new` | - |

### 2.3. Deeplinks HITL (Human-In-The-Loop)

O tulipa-v4 pode propor criações/edições via deeplinks assinados:

```
/customers/new?prefill=<HMAC-token>
/invoices/123/edit?prefill=<HMAC-token>
/batch/new?prefill=<HMAC-token>
```

**O tulipa-v4 NÃO deve gerar o token diretamente.** O fluxo é:

1. tulipa-v4 identifica que precisa criar/editar → retorna um JSON com tipo + dados
2. sistemav2 backend gera o deeplink assinado (HMAC-SHA256, 30min TTL)
3. Retorna o link para o tulipa-v4 incluir na resposta

Formato do JSON do tulipa-v4:
```json
{
  "action": "create" | "edit" | "batch_create",
  "entity": "customer",
  "data": { "name": "Foo", "email": "bar@baz.com" }
}
```

### 2.4. Formato de Resposta de Mídia

Links de mídia (gerados pelo tulipa-v4 ou MiniMax) devem ser URLs absolutas:

```
Áudio: https://...mp3
Imagem: https://...png
Vídeo: https://...mp4 (ou task_id para polling)
```

## 3. API do Proxy (sistemav2 Backend)

### `POST /api/ai/chat`

Proxy autenticado para o tulipa-v4.

**Request:**
```json
{
  "message": "Mostre as faturas do cliente Talk Talk",
  "history": [
    { "role": "user", "parts": "..." },
    { "role": "model", "parts": "..." }
  ],
  "context": "Data atual: 2026-06-05",
  "sessionId": "opcional — se tulipa gerenciar sessões",
  "image": "base64... (opcional)"
}
```

**Response:**
```json
{
  "reply": "HTML com links e formatação",
  "actions": [
    {
      "type": "create",
      "entity": "customer",
      "deeplink": "/customers/new?prefill=eyJ..."
    }
  ]
}
```

### `GET /api/ai/prefill?token=...`

Resolve deeplink HITL (já existe, não muda).

### Headers de Autenticação

```
Authorization: Bearer <HMAC-token-emitido-por-tulipa-v4>
X-Tulipa-Person-Id: <id-da-person-no-tulipa>
```

## 4. Regras do Agente (contrato comportamental)

O tulipa-v4 deve seguir estas regras ao responder no surface web:

1. **NUNCA** passe query vazia — sempre use termo específico ou pergunte ao usuário
2. **Sempre** inclua links HTML para entidades mencionadas (formato da seção 2.2)
3. **Sempre** busque IDs antes de criar/editar (nunca invente IDs)
4. **Sempre** use português do Brasil
5. **Nunca** altere dados diretamente — sempre via deeplinks HITL
6. Se não encontrar resultados, sugira alternativas ao usuário
7. Formate respostas com HTML (h3, ul, li, strong) para melhor renderização

## 5. Fases da Integração

### Fase 1: Autenticação
- tulipa-v4#2250: Mapear Person ↔ usuário Dolibarr
- tulipa-v4#2249: Endpoint emitir token por pessoa
- sistemav2 envia token HMAC no header

### Fase 2: Proxy do Agente
- Novo endpoint `POST /api/ai/chat` faz proxy para tulipa-v4
- tulipa-v4 processa com tools completas (IntelligentRouter + ToolGroups)
- sistemav2 backend gera deeplinks HITL quando tulipa-v4 solicita ação
- Resposta volta para o VirtualAssistant

### Fase 3: Surface Avançado
- Tulipa transport layer gerencia sessões web
- SDUI (Server-Driven UI) do tulipa-v4 renderiza componentes ricos
- Chat persistido no backend (tulipa cuida)
- Múltiplas sessões por usuário

## 6. Dependências

| Ticket | Descrição | Status |
|---|---|---|
| tulipa-v4#2252 | Login Universal | Pendente |
| tulipa-v4#2250 | Person ↔ Dolibarr mapping | Pendente |
| tulipa-v4#2249 | Token emission endpoint | Pendente |
| sistemav2#155 | Ponte tulipa-v4 | Em progresso |
| sistemav2#159 | Persistir sessões | Bloqueado por #155 |

## 7. Compatibilidade com Agente Local

Enquanto a ponte não estiver pronta, o agente local continua funcionando.
O proxy deve ter fallback: se tulipa-v4 não responde, usa o agente local.

```typescript
// aiService.ts — lógica de fallback
if (config.tulipaEnabled) {
    try {
        return await tulipaProxy.chat(message, history);
    } catch {
        log.warn('Tulipa unavailable, falling back to local agent');
    }
}
return localProvider.generateReply(history, context, image);
```
