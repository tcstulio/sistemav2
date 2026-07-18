# Plano: modelo do CODER configurável na UI (não só no .env)

## Problema (o dono não achou onde configurar)
O modelo do **coder** (que resolve as issues) é a única peça do robô que NÃO está na UI:
- `OPENCODE_PRIMARY_MODEL` = env `TASKRUNNER_OPENCODE_PRIMARY_MODEL` (taskRunnerService.ts:65) — hoje forçado
  em `minimax/MiniMax-M3` por um stopgap do GLM esgotado (comentário: "REMOVER quando o GLM voltar").
- `OPENCODE_FALLBACK_MODEL` = env `TASKRUNNER_OPENCODE_FALLBACK_MODEL` (:60, default `minimax/MiniMax-M3`).
- Se o primary estiver vazio, o opencode usa o default dele (`~/.config/opencode/opencode.json` → `zai-coding-plan/glm-5.2`).
Juiz (`judgeModel`) e escalada (`coderEscalationModel`) JÁ estão na UI (Admin→Automações). O coder, não.

## Objetivo
Expor `coderModel` e `coderFallbackModel` no `ui_config.taskAutomation` + tela Admin→Automações, igual ao
`judgeModel`. Assim o dono troca GLM↔MiniMax pela TELA, sem editar `.env` nem reiniciar (getAutomationConfig
lê o ui_config AO VIVO → vale no PRÓXIMO run, sem restart — melhor que o env de hoje).

## Onde mexer (padrão do judgeModel, já mapeado)
1. **`backend/src/services/uiConfigService.ts`**:
   - Interface `TaskAutomationConfig` (~:97): `coderModel?: string; coderFallbackModel?: string;`
   - `DEFAULTS.taskAutomation` (~:350): `coderModel: '', coderFallbackModel: ''` (vazio = "usa o default do env/opencode" — NÃO quebra o stopgap).
   - Sanitize (~:530): `coderModel: typeof a.coderModel === 'string' ? a.coderModel.trim().slice(0, 60) : d.coderModel` (idem fallback).
2. **`backend/src/routes/uiConfigRoutes.ts`** (~:85): `coderModel: z.string().optional(), coderFallbackModel: z.string().optional(),` no z.object do taskAutomation.
3. **`backend/src/services/taskRunnerService.ts`** (`runOpencodeIsolated` ~:1972): a resolução do modelo passa a ter PRECEDÊNCIA:
   `ui_config.coderModel` (se não-vazio) → `OPENCODE_PRIMARY_MODEL` (env) → '' (default do opencode). Idem o fallback:
   `ui_config.coderFallbackModel` → `OPENCODE_FALLBACK_MODEL` (env) → 'minimax/MiniMax-M3'. Ler via `this.getAutomationConfig()`.
4. **`src/components/admin/TaskAutomationEditor.tsx`**: 2 campos de texto (coderModel, coderFallbackModel) com
   placeholder do default e helper ("vazio = usa o default do opencode / env"). Mesmo padrão do judgeModel.
5. **Testes**: sanitize (trim/slice/empty→default); precedência no runOpencodeIsolated (ui > env > default) —
   mockando getAutomationConfig e checando o comando (`--model <X>` ou sem `--model`).

## Riscos a checar no red-team (Fable)
1. **Precedência**: ui-vazio deve cair no env (não sobrescrever o stopgap com vazio). Semântica de "vazio = herda".
2. **Hot-reload sem restart**: getAutomationConfig lê ui_config a cada run? (confirmar — é o ganho principal). O env
   é lido 1× no load (module const) — a UI passa a mandar. Documentar que o env vira só DEFAULT.
3. **Injeção no comando**: o valor do modelo entra em `opencode run --model <X> "..."`. Sanitizar contra shell
   injection (o modelo vai literal no comando bash -lc). slice(60) + validar charset? (modelos são `provider/name`).
   ISSO É O FURO MAIS PROVÁVEL — um `coderModel` malicioso via UI = RCE no bash do worktree. Precisa allowlist de charset.
4. **Interação com a escalada Opus**: coderEscalationModel (já na UI) muda algo? (é outro caminho, tryOpusCoderRound).
5. **Fallback == primary**: se o dono setar os dois iguais, o `primaryIsFallback` (:1977) já trata (não re-roda). OK?
6. **Menor mudança segura** + como não regredir o stopgap atual (MiniMax) até o dono trocar na tela.

## Fora do escopo
Trocar o coder pro GLM AGORA = remover a linha do `.env` + restart (feito à parte, bundle com o deploy da Fase 1a).
Esta feature é p/ o dono trocar SOZINHO pela tela daqui pra frente.
