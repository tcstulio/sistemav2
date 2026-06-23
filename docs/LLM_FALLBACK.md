# Cadeia de Fallback de LLM — Arquitetura e Operação

**Issues:** #784 (bug raiz), #789 (runWithChain), #791 (LlmHealthService), #792 (docs — este arquivo), #793 (UI)
**Plano master:** `docs/PLANO_LLM_FALLBACK_INSTITUCIONALIZADO.md`

---

## 1. Visão geral

O sistema expõe três camadas de resiliência para chamadas LLM:

```
Chamada de serviço (ex.: botService, bankingService)
    │
    ▼
aiService.<método> (generateReply, analyzeSystem, …)
    │
    ├─ [1] backoff exponencial por chamada — postChatCompletion (#779)
    │       timeout configurável: LLM_PRIMARY_TIMEOUT_MS (default 180s)
    │       retry até LLM_RETRY_DEADLINE_MS (default 60s) em 429/timeout/5xx
    │
    ├─ [2] fallback interno GLM → MiniMax (#714)
    │       só ativo quando provider = glm + LocalProvider
    │       hard-coded (pré-institucionalização)
    │
    └─ [3] cadeia institucional runWithChain (#789) ← NOVA
            ativa quando LLM_RUN_WITH_CHAIN=true
            provider saudável selecionado por LlmHealthService (#791)
            cadeia configurável por módulo (configService + data/config.json)
            16 métodos públicos cobertos
```

### Providers suportados

| Identificador | Serviço                   | Env obrigatória         |
|---|---|---|
| `glm`         | Z.AI / GLM (PaaS)         | `ZAI_API_KEY`           |
| `minimax`     | MiniMax M3                | `MINIMAX_API_KEY`       |
| `google`      | Google Gemini             | `GOOGLE_GENAI_API_KEY`  |
| `local`       | Ollama / LLM local        | `LOCAL_LLM_URL`         |

---

## 2. Cadeia de fallback — ordem de resolução

Para cada módulo (`chat`, `banking`, `system_analysis`, `proposals`), o `configService.getFallbackChain(moduleName)` resolve a cadeia nesta ordem de prioridade:

1. **Override explícito no `ModuleConfig`** — campo `fallbackChain` dentro do objeto de configuração do módulo (editado via UI ou API).
2. **`data/config.json` → `fallbackChains[moduleName]`** — chain salva pelo endpoint `POST /api/admin/config/llm/fallback-chain`.
3. **Env por módulo** — variável `LLM_<MODULO>_CHAIN` (ex.: `LLM_CHAT_CHAIN=glm,minimax,google`).
4. **Env global** — `LLM_DEFAULT_CHAIN` (ex.: `glm,minimax`).
5. **Sem fallback** — apenas `[moduleConfig.provider]`; nenhum fallback será tentado.

O resultado é sempre `[primary, ...alternates]` onde o primeiro elemento é o provider ativo do módulo. Providers inválidos ou desconhecidos são filtrados silenciosamente.

---

## 3. Feature flag `LLM_RUN_WITH_CHAIN`

| Variável               | Valor   | Efeito                                         |
|---|---|---|
| `LLM_RUN_WITH_CHAIN`   | `true`  | wrapper ativo (cadeia de 3+ providers tentada) |
| `LLM_RUN_WITH_CHAIN`   | `false` | wrapper desligado (comportamento anterior)     |
| *(não definida)*       | —       | `true` em dev/staging; `false` em produção     |

### Compat com legado `LLM_FALLBACK_ENABLED`

Usuários que tinham `LLM_FALLBACK_ENABLED=false` no `.env` continuam com o fallback desligado — a variável legada é verificada primeiro e traduzida para `LLM_RUN_WITH_CHAIN=false` internamente (em `configService.isRunWithChainEnabled()`). Não é necessário definir ambas; prefira `LLM_RUN_WITH_CHAIN` em novos deploys.

---

## 4. `data/config.json` — persistência em runtime

O `configService` persiste o estado de configuração em `data/config.json` usando escrita atômica (`atomicWriteSync`). Isso garante que mudanças feitas via UI ou API sobrevivam restart do backend.

### Estrutura do arquivo

```json
{
  "moduleConfigs": {
    "chat":            { "provider": "glm", "model": "glm-5.1", "fallbackChain": ["glm", "minimax"] },
    "banking":         { "provider": "glm", "model": "glm-5.1" },
    "system_analysis": { "provider": "glm", "model": "glm-5.1" },
    "proposals":       { "provider": "glm", "model": "glm-5.1" }
  },
  "customPrompts": {
    "system_base": "...",
    "banking_categorization": "...",
    "banking_anomalies": "...",
    "chat_signature": "..."
  },
  "fallbackChains": {
    "chat": ["glm", "minimax", "google"]
  }
}
```

### Comportamento de boot

1. O diretório `data/` é criado automaticamente na inicialização (se não existir).
2. `configService` (singleton) chama `load()` no construtor — lê `data/config.json`.
3. `aiService` usa `configService` para resolver provider e cadeia por módulo.

### Migration — primeiro boot com o novo código

| Situação                   | Comportamento                                                    |
|---|---|
| `data/config.json` não existe | Criado automaticamente com defaults derivados do `.env` (`LLM_PROVIDER`, `LLM_DEFAULT_CHAIN` etc.) |
| `data/config.json` existe    | Carregado como está, sem sobrescrever                           |
| `data/config.json` corrompido (JSON inválido) | Log de aviso + fallback para defaults do env. Boot não é interrompido. |

Não há script de migration necessário — o `configService` resolve automaticamente na primeira inicialização.

---

## 5. Endpoints de operação

### Saúde dos providers

```
GET  /api/admin/llm-health
```

Retorna status de cada provider (`healthy` / `degraded` / `exhausted`), erros consecutivos, último erro e cooldown restante.

```
POST /api/admin/llm-health/reset/:provider
```

Força limpeza de cooldown de um provider (útil após troca de API key ou resolução de incidente).

### Cadeia por módulo

```
GET  /api/admin/config/llm/fallback-chain
POST /api/admin/config/llm/fallback-chain
     body: { "module": "chat", "chain": ["glm", "minimax", "google"] }
```

A chain salva persiste em `data/config.json` e sobrevive restart.

### Log de chamadas

```
GET  /api/admin/llm-calls?summary=true
```

Retorna resumo de chamadas por provider: `totalCalls`, `successRate`, `avgLatencyMs`.

---

## 6. LlmHealthService — cooldown escalonado

O `LlmHealthService` mantém saúde por provider com cooldown automático:

| Falhas consecutivas | Cooldown  |
|---|---|
| 1ª                  | 30 s      |
| 2ª                  | 2 min     |
| 3ª+                 | 10 min    |

Qualquer chamada bem-sucedida zera o contador de erros consecutivos e remove o cooldown.

`isAvailable(provider)` retorna `true` se o provider nunca esteve em cooldown ou se o cooldown já expirou. O `runWithChain` pula providers indisponíveis e tenta o próximo da cadeia.

---

## 7. O que NÃO usa a cadeia

Os seguintes endpoints são **excluídos intencionalmente** do wrapper `runWithChain`:

- `POST /api/admin/config/llm/playground` — teste manual de provider específico
- `POST /api/admin/config/llm/test` — teste de conectividade
- `GET  /api/admin/config/llm/models?provider=X` — lista de modelos

Esses endpoints continuam usando o provider explicitamente selecionado pelo admin.

---

## 8. Como operar

### Habilitar a cadeia em produção

```env
# backend/.env
LLM_RUN_WITH_CHAIN=true
LLM_DEFAULT_CHAIN=glm,minimax
LLM_PRIMARY_TIMEOUT_MS=120000   # reduzir se 180s for longo demais
LLM_RETRY_DEADLINE_MS=60000
```

### Verificar estado

1. Abrir o Console de Desenvolvimento → aba **Saúde** (issue #793)
2. Ou chamar diretamente: `GET /api/admin/llm-health`

### Resetar provider manualmente

```bash
curl -X POST https://<host>/api/admin/llm-health/reset/glm \
  -H "x-admin-key: $ADMIN_KEY"
```

### Reverter para comportamento anterior (sem cadeia)

```env
LLM_RUN_WITH_CHAIN=false
# ou (legado):
LLM_FALLBACK_ENABLED=false
```

Ambas as formas produzem o mesmo resultado: a cadeia é desabilitada e cada módulo usa apenas seu provider configurado, sem fallback automático.
