# Plano completo — Operacionalizar o TaskRunner (backend ✅ + frontend + shipping)

**Data:** 2026-06-15
**Branch de trabalho:** `fix/335-taskrunner-orphan-concurrency` (12 commits à frente da origin/main, **não pushada**)

## Objetivo

Tornar o agente autônomo (issue `opencode-task` → opencode → testes → PR → Judge → CI → auto-merge) **utilizável de verdade para implementar o projeto**, cobrindo backend (feito) **e frontend** (faltando), no padrão da indústria de 2026: **gate determinístico** (testes + regressão visual na CI), **IA só como autor/filtro/triagem não-bloqueante**.

---

## 0. Status atual

### Backend — ✅ COMPLETO e PROVADO (falta shippar)
Loop 100% autônomo provado hands-off: canário #396 (`max`) → PR #397 → Judge 10/10 → rebase → mergeabilidade → typecheck → **esperou CI** → **merge na main**, sem intervenção.

3 bugs do auto-merge encontrados e corrigidos nesta branch:
1. `hasFrontendChanges` casava `backend/src/...` como frontend (`includes('src/')`) → fix `startsWith('src/')` (`f14ebfc`).
2. Auto-merge usava `gh pr merge --dry-run` (flag inexistente) → fix `gh pr view --json mergeable` (`873841a`).
3. Auto-merge mergeava antes da CI → fix `waitForPrMergeable()` espera `mergeStateStatus` (`707b634`).
Mais: modo cumulativo, timeouts por env, fixes de órfão/lock.

**Pendências do backend:** branch não pushada; `sum.ts`/`max.ts` (canários) na main; arquivo solto `backend/tmpcodex_upgrades.html`; 2 merge-commits de `pullMainRepo` na branch.

### Frontend — ❌ NÃO validado
Trava no "Juiz Visual" (LLM julga screenshot): ele captura `afterUrl = :3000+issue%1000`, mas **nada sobe esse preview** no fluxo automático (e `startPreview` usa porta diferente, `:5174+issue%10`). Screenshot falha → `tryAutoMerge` bloqueia (`hasFrontend && visualScore undefined`) → **tasks de UI nunca auto-mergeiam**.

### Decisão de arquitetura (baseada em deep-research + estado 2026)
- LLM de visão é não-determinístico (15–52% alucinação em 2026) → **não serve de portão**.
- Padrão: **execução determinística** (Playwright) + **testes** (Vitest+RTL / E2E) + **regressão visual determinística** (`toHaveScreenshot`) como gate; IA **autora/filtro/self-healing**, nunca bloqueante.
- O **mesmo agente escreve a feature E os testes dela** na mesma sessão.

---

## Fase 0 — Shippar o backend (landar os fixes na main)

1. **Limpeza de resíduos:**
   - Decidir `sum.ts` / `max.ts` (canários): remover da main (PR de limpeza) **ou** manter (são utils corretos/testados). *Decisão do usuário.*
   - Remover/gitignore `backend/tmpcodex_upgrades.html` (arquivo solto).
2. **Higienizar a branch:** os 2 merge-commits de `pullMainRepo` poluem o histórico. Opção: rebase em `origin/main` (resolve), ou aceitar e abrir o PR assim.
3. **Push + PR da `fix/335`:** ela mesma passa pela CI (`backend`/`frontend`) e branch protection — dogfooding. Revisar e mergear.
4. **(Hardening opcional, recomendado)** dois ajustes de robustez:
   - `syncWithGitHub` não reconciliar status de uma task com **run vivo** (causou split-brain quando re-rodei a mesma task). Guardar por `status running/fixing` ou por lock.
   - `pullMainRepo` faz `git pull` na **branch de trabalho** (gera merge-commit + reinicia o backend a cada merge). Deveria atualizar `main` num checkout separado, não a branch atual.

**Arquivos:** `backend/src/services/taskRunnerService.ts` (syncWithGitHub ~582, pullMainRepo), `.gitignore`.
**Esforço:** baixo (limpeza + push) / médio (hardening).

---

## Fase 1 — Frontend Nível A: testes de componente (igual backend)

**Meta:** tasks de UI auto-mergeiam com base em **build + testes de componente** (Vitest + React Testing Library) + Juiz de código, exatamente como backend. Juiz Visual LLM deixa de bloquear.

1. **Tornar o Juiz Visual NÃO-bloqueante.** Em `tryAutoMerge` (taskRunnerService ~1800): remover o bloqueio `if (hasFrontend && visualScore === undefined) → task_failed`. O gate passa a ser a **CI** (que já roda em PRs e é exigida pela branch protection). O Juiz Visual, se rodar, vira comentário/sinal — nunca trava.
2. **Fazer o agente escrever testes de componente nas tasks de UI.** Reforçar o prompt (`buildCumulativePrompt` / `buildPrompt`) para tasks que tocam frontend: "inclua testes de componente (Vitest + React Testing Library) que renderizam, **simulam clique** (`userEvent.click`) e verificam o DOM resultante". E/ou padronizar isso no corpo das issues `opencode-task` de UI (como os critérios de aceite dos canários de backend).
3. **Garantir que a CI `frontend` roda os testes.** Verificar o workflow (`.github/workflows/*`): a check `frontend` deve rodar `vitest run` (componentes) além do build. Hoje já existem `src/__tests__/components/*.test.tsx` + `vitest.config.ts`.
4. **Validar com canário de componente:** criar uma issue tiny de UI (ex.: um componente `<Counter/>` com botão que incrementa) + teste RTL que clica e confere → rodar 1 vez → ver **auto-merge** (build + teste verdes na CI).

**Arquivos:** `taskRunnerService.ts` (tryAutoMerge, prompt builders), `.github/workflows/*`, `vitest.config.ts` (já existe).
**Esforço:** baixo–médio. **Cobre:** "o clique funciona? apareceu o conteúdo certo?" (lógica/comportamento).

---

## Fase 2 — Frontend Nível B: regressão visual determinística

**Meta:** pegar "ficou no lugar certo / não quebrou o layout" de forma determinística (pixel a pixel), como check de CI. O projeto **já tem `playwright.config.ts`** e scripts Playwright.

1. **Adicionar testes de snapshot visual** com Playwright `toHaveScreenshot()` (ou avaliar Argos/Lost Pixel para evitar flakiness de ambiente).
2. **CRÍTICO — baselines geradas NA CI (Linux), não no Mac do dev.** Fontes/anti-aliasing diferem (maior fonte de falso-positivo). Opções: rodar Playwright dentro do mesmo container da CI, ou usar renderizador na nuvem (Lost Pixel OSS p/ custo, Argos pixel-diff barato, Chromatic/Percy gerenciado). Aplicar **masking** de conteúdo dinâmico (datas, dados).
3. **Novo check de CI** (ex.: `visual`) rodando os snapshots; adicionar como required na branch protection (ou dentro da check `frontend`).
4. **Fluxo de baseline para o agente:** mudança intencional de UI gera diff → precisa **aprovar a nova baseline**. Decidir: o agente commita a baseline nova automaticamente (auto-aprovação) ou isso exige revisão humana. *Decisão do usuário* (é o ponto onde "auto-merge total de UI" encosta no risco).
5. **Validar:** task de UI que muda o visual → snapshot diverge → check falha → (após aprovar baseline) passa.

**Arquivos:** `playwright.config.ts` (existe), novos `*.spec.ts` de visual, `.github/workflows/*` (job visual + Playwright em container).
**Esforço:** médio. **Cobre:** "apareceu no lugar certo **visualmente**?"

---

## Fase 3 — Frontend Nível C (estado da arte 2026): E2E no browser real + IA como filtro

**Meta:** o agente escreve testes E2E (Playwright) que **clicam nos fluxos reais** no browser e conferem o resultado; IA atua como filtro/triagem dos diffs e (aspiracional) self-healing de seletores.

1. **Agente escreve E2E por intenção** nas tasks de UI: navega, clica, preenche, e verifica (`expect(page.getByText(...)).toBeVisible()`).
2. **CI roda E2E** contra o app buildado/preview (subir o app na CI, rodar Playwright). Determinístico = gate.
3. **Repropor o "Juiz Visual" LLM como FILTRO não-bloqueante:** em vez de dar nota crua, ele triagem o **diff determinístico já detectado** ("isso é regressão real ou ruído?") e comenta no PR. Nunca bloqueia.
4. **(Opcional/futuro)** self-healing de seletores via LLM quando a UI muda.

**Arquivos:** `playwright.config.ts`, `e2e/*.spec.ts`, `.github/workflows/*`, `taskRunnerService.ts` (runVisualJudge → filtro/comentário).
**Esforço:** médio–alto. **Cobre:** fluxos reais de clique ponta a ponta + posicionamento, com a IA agregando sem travar.

---

## Tarefas mistas (backend + frontend) — transversal

Uma feature que toca os dois lados (ex.: endpoint + tela que o usa) é **uma unidade atômica**: 1 worktree → 1 branch `fix-N` → 1 PR. O agente edita `backend/src/...` e `src/...` na mesma sessão (vê os dois lados → mantém o contrato API↔UI coerente). Portões aplicados ao PR inteiro: typecheck back+front, Judge no diff completo, CI `backend` **e** `frontend` verdes, testes dos dois lados (Vitest + componente/E2E), e regressão visual se a tela mudou.
- **Como toca o frontend, herda a regra de UI:** se houve mudança visual, **pausa p/ aprovação humana da baseline** — mesmo a parte de backend estando ok (backend+frontend de uma feature **landam juntos**, atômico).
- Sem mudança visual → auto-merge normal.
- **E2E (Nível C) é essencial aqui:** só ele testa a integração real (tela chama endpoint, dado volta e aparece) — testes isolados não pegam.
- **Não dividir** tarefas mistas coesas; o Planner cuida de dependências (`blockedBy`/overlap) se forem issues separadas.

## Ciclo de correção (humano → agente, SEM perder o trabalho) — transversal

Como apontar o que está errado e o agente consertar incrementalmente:

1. **Indicar o erro:**
   - Humano: `POST /api/tasks/:n/fix {feedback}` (campo de feedback na UI) ou `/redo {instruction}`.
   - Automático: o Judge já re-roda com a crítica como feedback (até 3 ciclos).
   - **Sinal preferido = determinístico:** sempre que possível, expressar "o que está errado" como um **teste que falha** ou o **diff visual** — alvo preciso e verificável, não só prosa.
2. **Mostrar ao agente:** o feedback entra em `feedbackHistory` → injetado no prompt na seção "correções a ATENDER" (`buildPrompt`/`buildCumulativePrompt`, ~1024/1104). O agente lê e atende.
3. **⚠️ LACUNA — não perder o trabalho:** hoje `ensureWorktree` faz `git checkout -B fix-N origin/main` (linha 951) → **reseta a branch pro main a cada re-run** → o agente **regenera do zero** (ok p/ task pequena, ruim p/ trabalho grande). O modo cumulativo só preserva DENTRO de um run.
   - **FIX a implementar:** no caminho de `/fix` (status `fixing`), `ensureWorktree` deve **fazer checkout da branch existente** (`origin/fix-N`, que tem o trabalho) e editar **por cima**, incremental — opcionalmente rebaseando em `main`. `/redo` permanece como "descarta e recomeça". Resultado: correção preserva o que já estava certo.

**Arquivos:** `taskRunnerService.ts` (`ensureWorktree` ~938 — parametrizar "fresh from main" vs "preserve branch"; `addFeedback` ~1937 sinaliza modo-preserva).
**Esforço:** baixo–médio. **Entra junto com:** Fase 0/1 (vale p/ backend e frontend).

## Operacionalização (transversal, em paralelo)

- **Entrada de tasks:** definir se o polling de 5min **auto-inicia** issues `opencode-task` novas (totalmente automático) ou fica manual (`POST /start`). Hoje: manual + `autoPlay` pega da fila.
- **Política de merge / governança:** auto-merge total (atual: Judge≥8 + CI) vs. PR-only para áreas sensíveis. Lembrar: auto-merge total é **mais agressivo que o default dos grandes agentes** (Copilot/Codex não auto-mergeiam) — o que torna seguro são os **gates determinísticos fortes** (estas fases).
- **Monitoramento:** UI do painel de tarefas (já existe) + backend de pé. Opcional: alerta quando uma task cai em `reviewing` (precisa de humano).

---

## Ordem recomendada

Fase 0 (shippar backend) → Fase 1 (Nível A, destrava UI já) → validar → Fase 2 (Nível B visual) → Fase 3 (Nível C E2E). Operacionalização em paralelo.

## Decisões (finalizadas 2026-06-15)

1. **Canários na main** (`sum.ts`/`max.ts`): **REMOVER** num PR de limpeza (são resíduo de teste, nada os usa).
2. **Aprovação de baseline visual** (Fase 2/3): **HUMANO no loop.** Quando uma task de UI muda o visual, a regressão visual diverge da baseline → o auto-merge **pausa** e o usuário aprova o antes/depois (a nova baseline) antes de mergear. Backend e a parte comportamental (testes de componente/E2E) seguem 100% automáticos; só a **aprovação visual** exige humano. É o padrão da indústria.
3. **Entrada de tasks:** **LIGAR auto-start no polling** (atrás de um flag, ex.: `autoStart`). Hoje o polling (5min) já vira a issue `opencode-task` em task e **notifica**; passa a também chamar `startTask` (Planner segue filtrando go/esperar/pular). Fluxo: criar issue + label → largar → robô executa.
4. **Escopo:** ir até o **Nível C** (E2E no browser real + IA como filtro/triagem), construindo incremental A → B → C.

### Implicação no fluxo final de UI
- Task de UI **sem mudança visual** (ou cujo snapshot bate com a baseline) + testes verdes → **auto-merge** (igual backend).
- Task de UI **com mudança visual intencional** → testes comportamentais passam, mas o snapshot diverge → **pausa para você aprovar a nova baseline** → merge. (Esse é o único ponto humano restante, por escolha.)
