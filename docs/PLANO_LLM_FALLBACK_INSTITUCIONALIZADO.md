# Plano: Cadeia de Fallback de LLM Institucionalizada

**Status:** rascunho para revisão adversarial
**Issue raiz:** #784
**Pré-requisito:** este plano pressupõe que o bug raiz de `configService.moduleConfigs` não sincronizado está resolvido (issue #784).

---

## 1. Contexto e motivação

Hoje o sistema tem um fallback **parcial, embutido e opaco**:

- `LocalProvider.postChatCompletion` (`backend/src/services/aiService.ts:845-884`) tenta GLM e cai em MiniMax em 429/timeout/5xx.
- O fallback **só vale** quando o provider ativo é `glm` e a chamada cai no `LocalProvider`. **17 call sites de análise** usam `getProvider()` direto e **não têm fallback**.
- O estado de quota (`backend/src/services/llmQuotaState.ts`) é **global e binário** (esgotado/não-esgotado), sem cooldown automático, sem distinção por provider, sem exposição na UI.
- A UI (`src/components/DevelopmentConsole/LlmSettingsTab.tsx`) permite escolher UM provider por módulo mas não tem como configurar cadeia de fallback, nem ver status por provider.

Resultado: usuário precisa reiniciar o backend para trocar de provider (#784), 17 call sites falham duro quando o provider cai, e ninguém sabe qual provider está saudável sem inspecionar logs.

## 2. Objetivos

1. **Cobertura universal** — todos os métodos públicos de `aiService` se beneficiam de fallback, não só `generateReply`.
2. **Cadeia configurável por módulo** — admin pode definir ordem (`glm → minimax → google`) por módulo no console dev.
3. **Auto-skip de provider com problema** — cooldown escalonado por provider (30s → 2min → 10min).
4. **Visibilidade em tempo real** — UI mostra estado por provider, cadeia ativa, último erro, total de chamadas/fallbacks.
5. **Compatibilidade preservada** — `LLM_PROVIDER=glm`, `LLM_FALLBACK_ENABLED=false` e o call site do playground continuam funcionando como hoje.

## 3. Não-objetivos

- Não substituir o `GoogleProvider` por outra coisa. Manter como opção na cadeia.
- Não implementar retry dentro da mesma provider (o retry atual do `LocalProvider.generateReply` interno — até 5 iterações de tool-call — permanece).
- Não mudar o modelo de prompts customizados. Prompts continuam por nome, não por provider.
- Não persistir config em `.env`. Usar `data/config.json` (atômico) para refletir edição runtime.

## 4. Work streams (issues)

> ⚠️ **Plano revisado após validação adversarial (2026-06-22).** Mudanças principais:
> - Adicionada **WS-A (pré-requisito absoluto)**: corrigir `LocalProvider` que engole erros sintéticos — sem isso, o wrapper WS-D nunca dispara.
> - Adicionado parâmetro `module` em 15 métodos públicos (`aiService.analyzeSystem` etc. hoje não recebem módulo).
> - Adicionado `aiService.probeProvider()` para a sonda de cota não drenar provider saudável.
> - Adicionada proteção contra race em `defaultProvider` (resolver provider por request, não pelo singleton mutável).
> - **WS9 fundido com WS4** (trivial). **WS3 + parte do WS5** pode ser merge único. **WS6 dividido** (extensão de `summary()` pode entrar em WS3; endpoints write em WS-F).
> - Cronograma revisado: nada é realmente paralelo.

Cada work stream vira uma issue separada no GitHub. Mapeamento final:

| WS | Issue | Status |
|---|---|---|
| WS1 (bug raiz `configService`) | [#784](https://github.com/tcstulio/sistemav2/issues/784) | ✅ criada |
| WS2 (bugs frontend `LlmSettingsTab`) | [#785](https://github.com/tcstulio/sistemav2/issues/785) | ✅ criada |
| WS-A (`LocalProvider` propaga erros) | [#786](https://github.com/tcstulio/sistemav2/issues/786) | ✅ criada |
| WS-B (`configService` persistente) | [#788](https://github.com/tcstulio/sistemav2/issues/788) | ✅ criada |
| WS-C (`LlmHealthService`) | [#791](https://github.com/tcstulio/sistemav2/issues/791) | ✅ criada |
| WS-D (`runWithChain` + `probeProvider`) | [#789](https://github.com/tcstulio/sistemav2/issues/789) | ✅ criada |
| WS-E (endpoints write + reset) | [#790](https://github.com/tcstulio/sistemav2/issues/790) | ✅ criada |
| WS-F (UI saúde + cadeia) | [#793](https://github.com/tcstulio/sistemav2/issues/793) | ✅ criada |
| WS-G (testes) | [#787](https://github.com/tcstulio/sistemav2/issues/787) | ✅ criada |
| WS-H (docs + migration) | [#792](https://github.com/tcstulio/sistemav2/issues/792) | ✅ criada |

### WS1 — Bug raiz: `configService` não sincroniza (#784, já criada)

**Escopo:** corrigir `backend/src/services/configService.ts` e `backend/src/routes/adminRoutes.ts` para que `POST /config/llm` sincronize `moduleConfigs` com `config.llmProvider`.

**Implementação:**
- Adicionar `ConfigService.resetModulesToGlobal()` (`configService.ts`) que reaplica `config.llmProvider` atual a todos os módulos.
- Chamar `configService.resetModulesToGlobal()` em `adminRoutes.ts:333` logo após `config.llmProvider = provider`.

**Sem dependência.** Pode ser mergeada imediatamente.

### WS2 — Bugs do frontend `LlmSettingsTab` (#785, a criar)

**Escopo:** corrigir bugs latentes na UI.

**Bugs:**
1. **CRÍTICO** — `handleSaveConfig` envia `url: config.localUrl` sempre (`LlmSettingsTab.tsx:224`), sobrescrevendo `config.minimaxBaseUrl` ou `config.zaiBaseUrl` com URL do Ollama quando o provider ativo é glm/minimax.
2. **CRÍTICO** — `handleTestConnection` mesmo bug em `:278`.
3. Após salvar config, não recarrega estado (toast mentiroso se backend rejeitar parcialmente).
4. `modelName` resetado hardcoded ao clicar em botão de provider (`:417, :433, :449, :465`) — perde config do user.
5. Após trocar de provider, `fetchModels` não é chamado para o novo provider; lista fica vazia até reload manual.

**Sem dependência de WS1.** Pode ser mergeada em paralelo.

### WS-A — Pré-requisito: `LocalProvider` propaga erros + `module` em 15 métodos (#786, a criar)

> ⚠️ **Descoberto pela revisão adversarial — bloqueia WS-D.** Sem isso, `runWithChain` nunca dispara porque o `LocalProvider` engole erros sintéticos.

**Escopo:** tornar o contrato de erro dos providers explícito e adicionar `module` onde falta.

**Sub-tarefas:**
1. **Refatorar `LocalProvider`** (`backend/src/services/aiService.ts:1046-1286`) para **re-lançar** exceções em vez de retornar strings/objetos sintéticos de erro. Locais exatos onde hoje engole:
   - `:1046` → `return "Erro ao conectar com LLM Local."` (analyzeSentiment).
   - `:1074` → `return { score: 50, label: 'Error' }` (extractCustomerInfo).
   - `:1110, :1154` → `return null` (extractReceiptData).
   - `:1178` → `return "Erro ao gerar análise financeira local."` (analyzeFinancialHealth).
   - `:1269` → `return JSON.stringify({ subject: 'Lembrete de Pagamento', body: 'Erro ao gerar email.' })` (draftCollectionEmail).
   - `:1286` → `return JSON.stringify({ forecast: [], summary: 'Erro na previsão.' })` (generateSalesForecast).
   - Mais 8 lugares similares em `analyzeSystemLogs`, `analyzeMonthlyReport`, `auditProposal`, `auditProject`, `fixApiCall`, `generateCode`, `transcribeAudio`, `analyzeSystem`.
2. **Refatorar `LocalProvider.generateReply`** (`:988-994`) — capturar erros do `postChatCompletion` no nível da tool-call iteration mas re-lançar se for a iteração final (`:925` é o limite). Hoje retorna `{ text: "Erro LLM Local: ..." }`.
3. **Adicionar parâmetro `module: string`** em 15 métodos públicos de `aiService` que hoje não recebem:
   - `analyzeSystem(prompt, rootPath, module)`
   - `analyzeSentiment(text, module)`
   - `extractReceiptData(imageBase64, module)`
   - `extractCustomerInfo(text, module)`
   - `analyzeFinancialHealth(data, module)`
   - `fixApiCall(logData, module)`
   - `generateCode(endpoint, method, description, module)`
   - `transcribeAudio(audioBase64, mimeType, module)`
   - `draftCollectionEmail(customer, amount, module)`
   - `generateSalesForecast(invoices, module)`
   - `analyzeCustomerSentiment(customer, invoices, module)`
   - `auditProposal(data, module)`
   - `auditProject(data, module)`
   - `analyzeSystemLogs(logs, module)`
   - `analyzeMonthlyReport(data, module)`
4. **Atualizar 28 call sites** para passar `module` apropriado. Mapeamento inicial:
   - `bankingService.ts:281,351,425,500` — hoje passa strings como `rootPath`; **migrar** para `'banking'` como módulo.
   - `aiRoutes.ts:224,241,...` — adicionar `'system_analysis'` ou outro módulo.
   - `botService.ts:303` — `module: 'chat'`.

**Critério de aceite:** rodar suite de testes atual; testes que mockam `aiService.analyzeSystem.mockRejectedValue(...)` precisam ser **adaptados** ou vão falhar. Adaptar **junto** com WS-G.

**Dependência:** nenhuma (mas é pré-requisito de WS-D).

### WS-B — Backend: `configService` persistente + `LLM_RUN_WITH_CHAIN` flag (#787, a criar)

> Substitui/estende WS4 do plano original. Funde com WS1 (bug raiz).

**Escopo:** tornar `configService` persistente em `data/config.json` (atômico) e adicionar feature flag.

**Mudanças:**
- `configService.ts`:
  - Adicionar `interface ModuleConfig { provider; model; fallbackChain?: string[] }`.
  - Constructor chama `load()` que lê `data/config.json` (se existir) ou cria com defaults do env.
  - Cada `setModuleConfigs` / `setFallbackChain` / `setPrompts` chama `flush()` (`atomicWriteSync`).
  - `getFallbackChain(moduleName)` retorna `[moduleConfig.provider, ...(moduleConfig.fallbackChain ?? [])]`.
- Defaults via env: `LLM_CHAT_CHAIN=glm,minimax,google` (CSV), `LLM_BANKING_CHAIN=glm,google`, `LLM_DEFAULT_CHAIN=glm,minimax`.
- Boot order em `server.ts`: garantir que `data/` existe e JSON carregado antes de `aiService` ser usado.
- Política de load error: log + fallback para defaults (não derrubar boot).

**Compat preservada:**
- `LLM_PROVIDER=glm` continua sendo provider primário default.
- `LLM_FALLBACK_ENABLED=false` legado: traduzir para `LLM_RUN_WITH_CHAIN=false` internamente.
- Adicionar `LLM_RUN_WITH_CHAIN` (default `true` em dev, `false` em prod até WS-D estar validado).

**Dependência:** nenhuma (funde WS1).

### WS-C — Backend: `LlmHealthService` (substitui `llmQuotaState`) (#788, a criar)

**Escopo:** novo service `backend/src/services/llmHealthService.ts` que mantém saúde POR PROVIDER.

**Estado por provider:**
```ts
interface ProviderHealth {
    provider: string;                          // 'glm' | 'minimax' | 'google' | 'local'
    state: 'healthy' | 'degraded' | 'exhausted';
    exhaustedSince?: number;
    consecutiveErrors: number;                // zera em sucesso
    lastError?: { code: string; message: string; at: number };
    totalCalls: number;
    totalErrors: number;
    totalFallbacks: number;                   // vezes que este provider foi usado como fallback
}
```

**Cooldown escalonado:**
- 1ª quota error → 30s
- 2ª consecutiva → 2min
- 3ª+ consecutiva → 10min (capped)
- Reset em qualquer sucesso.
- `isAvailable(provider)`: true se `exhaustedSince + cooldownMs < Date.now()` ou nunca esteve exhausted.

**Compat com `llmQuotaState`:** manter `isQuotaError`, `markQuotaExhausted`, `clearQuotaExhausted`, `isQuotaExhausted`, `quotaStatus` como wrappers que delegam ao novo service. `taskRunnerService` e `aiService.ts:790` continuam funcionando sem mudança.

**Endpoints read-only** (parte deste WS):
- `GET /api/admin/llm-health` → `{ providers: ProviderHealth[], modules: Record<moduleName, { chain: string[]; active: string }> }`.
- Estender `llmCallLogService.summary()` para incluir `byProvider: { glm: { totalCalls, successRate, avgLatencyMs }, ... }`.

**Dependência:** nenhuma.

### WS-D — Backend: `aiService.runWithChain` + `probeProvider` (#789, a criar)

> **Maior risco.** Substitui WS5 do plano original.

**Escopo:** todo método público de `aiService` passa a wrappear com a cadeia.

**Pré-requisito absoluto:** WS-A (LocalProvider propaga erros). Sem isso, `runWithChain` nunca dispara.

**Implementação:**
- Helper interno: `runWithChain<T>(methodName, args, opts: { module: string; capability?: 'text'|'vision'|'audio' }): Promise<T>`.
- Resolver provider **por request**, não via singleton mutável `defaultProvider`:
  - Pegar cadeia via `configService.getFallbackChain(moduleName)` filtrada por capability.
  - Para cada provider: `isAvailable(provider)` (consulta `LlmHealthService`) → pula se não.
  - Chamar método via `getProvider(providerName)` (já existe, retorna nova instância se não cacheada).
  - Em sucesso: `llmHealthService.recordSuccess(provider)`, `clearQuotaExhausted()`, `llmCallLogService.record({ chain, activeIndex, ok: true })`.
  - Em `isRetryableError`: `llmHealthService.recordQuotaError(provider)`, marca cooldown, tenta próximo.
  - Em erro não-recuperável: re-lança.
- **Excluídos do wrapper (intencional):**
  - `/config/llm/playground` (`adminRoutes.ts:457`).
  - `/config/llm/test` (`adminRoutes.ts:147`).
  - `/config/llm/models?provider=X`.
- `LocalProvider.generateReply` interno (loop até 5 iterações de tool-call, `aiService.ts:925`) **fica de fora** — fallback é 1× por chamada do user.
- **`aiService.probeProvider(name: string)`** — caminho explícito para a sonda de cota (`taskRunnerService.ts:368`):
  - Pula o wrapper.
  - Não chama `record()` no log (test, não call real).
  - Não consome tokens significativos (usa o `ping` mínimo existente).
  - Se provider não disponível (cooldown), retorna erro de quota sem tentar próximo.
- **Race protection em `defaultProvider`:** refatorar `setConfig` para **não mutar** `defaultProvider` em runtime, ou torná-lo read-only após boot. Wrapper usa `getProvider(providerName)` por request.

**Cobre:**
- `generateReply`, `analyzeSystem`, `analyzeSentiment`, `extractReceiptData`, `extractCustomerInfo`, `analyzeFinancialHealth`, `fixApiCall`, `generateCode`, `transcribeAudio`, `draftCollectionEmail`, `generateSalesForecast`, `analyzeCustomerSentiment`, `auditProposal`, `auditProject`, `analyzeSystemLogs`, `analyzeMonthlyReport`.

**Dependência:** WS-A + WS-C + WS-B.

### WS-E — Backend: Endpoints write + action de reset (#790, a criar)

**Escopo:** expor controles para a UI.

**Novos endpoints:**
- `POST /api/admin/config/llm/fallback-chain` body: `{ module: string, chain: string[] }` → `configService.setFallbackChain(module, chain)`.
- `GET /api/admin/config/llm/fallback-chain` → `{ chat: [...], banking: [...], ... }`.
- `POST /api/admin/llm-health/reset/:provider` → force-clear de cooldown (admin manual, útil após identificar/configurar nova key).

**Validação:** cadeia deve conter apenas providers conhecidos (`glm`/`minimax`/`google`/`local`); rejeitar 400 se inválido.

**Dependência:** WS-B + WS-C.

### WS-F — Frontend: UI de saúde + cadeia (#791, a criar)

**Escopo:** nova aba "Saúde" + editor de cadeia na `LlmSettingsTab`.

**UI:**
- **Aba "Saúde"** (entre Monitor e Prompts):
  - Cards por provider (glm/minimax/google/local) com: status (badge colorido), `consecutiveErrors`, `lastError`, `cooldown remaining` (countdown regressivo).
  - Botão "Resetar cooldown" → `POST /api/admin/llm-health/reset/:provider`.
- **Editor de cadeia** dentro da aba "Módulos" (ou nova sub-aba):
  - Por módulo: **select ordenado** com `↑ ↓` (sem drag-and-drop — evita lib nova; ref WS-F se user pedir UX melhor).
  - Botão "Salvar Cadeia" → `POST /api/admin/config/llm/fallback-chain`.
- **Banner de status** no header da Central de IA quando algum provider está `exhausted`:
  - Polling 5s em `GET /api/admin/llm-health` com **cleanup no unmount** e **pause quando aba inativa**.
- **Consumir `GET /api/admin/llm-calls?summary=true`** para mostrar "últimas N chamadas por provider" no Monitor.

**Dependência:** WS-E.

### WS-G — Testes + regressão (#792, a criar)

**Escopo:** adaptar mocks existentes + adicionar cobertura nova.

**Ações:**
- `aiService.test.ts`: mocks atualizados para o wrapper `runWithChain`. Adicionar testes:
  - Cai no segundo provider quando o primeiro retorna 429.
  - Pula provider em cooldown (verifica `isAvailable`).
  - Loga `chain` e `activeIndex` no `llmCallLogService`.
  - `probeProvider` não chama log nem consume tokens.
- `bankingService.test.ts`: hoje `aiService.analyzeSystem.mockRejectedValue(...)` — adaptar (mockar para rejeitar TUDO ou retornar valor do fallback). Decisão consciente: continuar wrappeado OU `banking` checa `error.code === 'fallback_failed'` antes de cair em heurística.
- `eventScraperService.test.ts:253` (fallback keyword): idem.
- `llmQuotaState.test.ts`: garantir que os wrappers delegam corretamente ao `LlmHealthService`.
- Novo: `llmHealthService.test.ts` cobrindo cooldown escalonado, `isAvailable` após tempo, `recordSuccess` zera consecutiveErrors.
- Novo: `aiService.runWithChain.test.ts` cobrindo fallback chain, capability routing, race protection.
- **E2E Playwright:** smoke test "trocar provider sem restart, próxima chamada usa novo provider".

**Dependência:** WS-D.

### WS-H — Migração e docs (#793, a criar)

**Escopo:** garantir compat com `.env` e documentar.

**Ações:**
- Atualizar `docs/` e `.env.example` com novas envs: `LLM_DEFAULT_CHAIN`, `LLM_CHAT_CHAIN`, `LLM_BANKING_CHAIN`, `LLM_RUN_WITH_CHAIN`.
- Documentar `LLM_FALLBACK_ENABLED` legado (mapeamento para `LLM_RUN_WITH_CHAIN`).
- Migration: na primeira inicialização com o novo código, se `data/config.json` não existir, criar com defaults derivados do `.env`. Se existir (de alguma versão anterior), carregar como está.
- Documentar ordem de boot e erro de load (quando JSON corrompido).

**Dependência:** WS-B.

## 5. Cronograma e ordem de merge

Nada é realmente paralelo. Ordem obrigatória:

```
[Sem dependência]   WS1   ─► merge imediato (bug raiz, trivial)
[Sem dependência]   WS2   ─► merge imediato (bugs UI, isolado)
[Sem dependência]   WS-A  ─► merge (pré-requisito absoluto de WS-D)
[Sem dependência]   WS-C  ─► merge (LlmHealthService + read-only endpoints)
[Depende WS1]       WS-B  ─► merge (configService persistente; funde com WS1)
[Depende WS-B+C]    WS-D  ─► merge (runWithChain + probeProvider, maior risco)
[Depende WS-B+C]    WS-E  ─► merge (endpoints write + reset)
[Depende WS-D+E]    WS-G  ─► merge (testes adaptados)
[Depende WS-E]      WS-F  ─► merge (UI saúde + cadeia)
[Depende WS-B]      WS-H  ─► merge (docs + migration)
```

**Checkpoints:**
- Após merge de **WS-A**: confirmar que suite de testes atual ainda passa (sem adaptação, sem WS-D ativo).
- Após merge de **WS-D**: medir latência P95 com cadeia de 3 antes de liberar UI (WS-F). Se > 30s P95, reverter `LLM_RUN_WITH_CHAIN=false` em prod.

**Feature flag:** `LLM_RUN_WITH_CHAIN` (default `true` em dev, `false` em prod até WS-D validado em staging).

## 6. Critérios de aceite globais

- [ ] Trocar provider via `POST /config/llm` reflete imediatamente em todos os módulos (WS1 / WS-B).
- [ ] Salvar config pelo UI não corrompe `minimaxBaseUrl`/`zaiBaseUrl` (WS2).
- [ ] `LocalProvider` re-lança erros em vez de devolver string sintética (WS-A).
- [ ] `analyzeSystem` (e 14 outros métodos de análise) se beneficia de fallback quando provider primário cai (WS-D).
- [ ] Provider com 429 sustentado fica em cooldown; próxima chamada pula direto para o próximo da cadeia (WS-C + WS-D).
- [ ] Sonda de cota (`taskRunnerService.pollSync`) usa `probeProvider` e não drena provider saudável (WS-D).
- [ ] UI mostra estado por provider em tempo real (polling 5s com cleanup) e permite editar cadeia por módulo (WS-F).
- [ ] `GET /api/admin/llm-health` retorna status correto de providers e módulos (WS-C).
- [ ] `POST /api/admin/config/llm/fallback-chain` persiste em `data/config.json` e sobrevive restart (WS-B + WS-E).
- [ ] Cooldown auto-clear após tempo configurado; reset manual via UI funciona (WS-C + WS-F).
- [ ] `LLM_FALLBACK_ENABLED=false` mantém comportamento idêntico ao atual (WS-H).
- [ ] Suite de testes existente adaptada e passando; cobertura dos novos módulos ≥ 80% (WS-G).
- [ ] Lint + typecheck + smoke E2E Playwright passam (WS-G).

## 7. Riscos identificados

1. **LocalProvider engole erros** — sem WS-A, WS-D não funciona. **Bloqueador absoluto.** (WS-A)
2. **Race em `defaultProvider`** — `setConfig` em runtime pode trocar provider mid-request. Mitigar resolvendo provider por request em WS-D. (WS-D)
3. **Sonda de cota drena provider saudável** — wrapper sem `probeProvider` faz a sonda consumir cota. Mitigar com `probeProvider` dedicado. (WS-D)
4. **Latência** — cadeia de 3 com timeout 180s = 9 min pior caso. Mitigar com timeout mais curto para fallbacks (60s). (WS-D)
5. **Loop combinatorial** — se fallback for reavaliado em cada iteração interna do `generateReply`. Mitigar: fallback só na entrada do método público (1× por chamada do user). (WS-D)
6. **Quebra de testes existentes** — `bankingService.test.ts`, `eventScraperService.test.ts` dependem de erro duro. Adaptar mocks em WS-G **após** WS-D estável.
7. **Persistência parcial** — `configService` é in-memory hoje. Sem `data/config.json`, edição runtime se perde no restart. Mitigar com WS-B (atomicWrite).
8. **Compat com `.env`** — `LLM_PROVIDER` continua sendo o default primário. Cadeia só é avaliada se houver mais de 1 provider configurado. `LLM_FALLBACK_ENABLED=false` legado → traduzir para `LLM_RUN_WITH_CHAIN=false`. (WS-H)
9. **Playground / test endpoints** — não wrappear intencionalmente. Garantir que a UI distingue "testar provider X" de "rodar prompt com cadeia". (WS-D)
10. **Polling 5s na UI** — sem cleanup pode causar memory leak. Mitigar com cleanup no unmount e pause quando aba inativa. (WS-F)
11. **28 call sites a adaptar com `module` novo** — risco de breaking change silencioso. Mitigar com testes E2E em WS-G.

---

**Apêndice A — Inventário de call sites** (mapeados na investigação, **28 em produção**):

| Tipo | Contagem | Fallback hoje? |
|---|---|---|
| `generateReply` (chat/agent/planner/judge) | 12 | parcial (LocalProvider fallback) |
| `analyzeSystem` (system analysis, banking, playground) | 9 | **NÃO** |
| `extractReceiptData` (multimodal OCR) | 1 | parcial (multimodal routing) |
| `transcribeAudio` (multimodal áudio) | 2 | parcial (multimodal routing) |
| `generateSalesForecast` | 1 | **NÃO** |
| `analyzeSentiment`, `extractCustomerInfo`, `analyzeFinancialHealth`, `fixApiCall`, `generateCode`, `draftCollectionEmail`, `analyzeCustomerSentiment`, `auditProposal`, `auditProject`, `analyzeSystemLogs`, `analyzeMonthlyReport` | ~3 | **NÃO** |
| **TOTAL** | **~28** | — |

Backend: `backend/src/routes/aiRoutes.ts`, `bankingService.ts`, `botService.ts`, `centrovibeRoutes.ts`, `eventScraperService.ts`, `taskPlannerService.ts`, `taskRunnerService.ts`, `analyzeService.ts`, `adminRoutes.ts` (playground/test).

Frontend — 1 wrapper central `src/services/aiService.ts` com 30 métodos, consumido por ≥10 componentes. UI admin em `src/components/DevelopmentConsole/LlmSettingsTab.tsx`.

**Apêndice B — Bugs descobertos no console dev** (a entrar na issue #785):

- `handleSaveConfig` envia `url: config.localUrl` sempre (`:224`).
- `handleTestConnection` mesmo bug (`:278`).
- `handleSaveConfig` não recarrega estado.
- `modelName` resetado hardcoded ao trocar provider no UI (`:417, :433, :449, :465`).
- Após trocar provider, `fetchModels` não é chamado para o novo provider.

**Apêndice C — Bugs descobertos pela revisão adversarial** (incluídos em WS-A e WS-D):

- `LocalProvider` engole erros e devolve string/objeto sintético (`aiService.ts:1046, :1074, :1110, :1154, :1178, :1269, :1286` e mais 8) — **bloqueia WS-D**.
- `LocalProvider.generateReply` captura erro do `postChatCompletion` na iteração final e devolve texto de erro (`:988-994`) — sem distinção entre "iterando" e "resposta final".
- `defaultProvider` mutado em runtime por `setConfig` é race-prone — wrapper precisa resolver por request.
- `taskRunnerService.pollSync:368-383` (sonda de cota) chamará `generateReply` wrappado e drenará provider saudável sem `probeProvider` dedicado.
- 15 métodos públicos de `aiService` (`analyzeSystem` etc.) **não recebem `module`** — refatoração de assinatura obrigatória.
