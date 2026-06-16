# Regressão visual (Fase 2 / Nível B)

Gate de regressão visual **determinístico e self-hosted** — Playwright `toHaveScreenshot`.
**Privacidade:** screenshots e baselines **nunca saem** do nosso repo/CI (sem nuvem de terceiros) —
importa porque telas de ERP ficam atrás de login e podem conter PII.

## Como funciona

- Config própria `playwright.visual.config.ts` (chromium-only, determinístico). A config E2E
  (`playwright.config.ts`) **ignora** `tests/visual/` (`testIgnore`).
- Testes em `tests/visual/*.visual.spec.ts`. Baselines versionadas em
  `tests/visual/**-snapshots/*-chromium-linux.png` (geradas na CI/**Linux** — nunca no Mac/Windows).
- Workflow `.github/workflows/visual.yml` roda em **todo PR** e é um check **obrigatório** (`visual`).
- O `.gitignore` ignora `*.png`, MAS há a exceção `!tests/visual/**/*.png` (baselines versionadas).

## Quando o `visual` FALHA num PR

Significa que a tela mudou em relação à baseline. Dois casos:

### 1) Mudança NÃO intencional (regressão) → corrija o código
Baixe o artefato `visual-report` do run (tem o diff/antes/depois) e conserte a UI.

### 2) Mudança INTENCIONAL → aprove a nova baseline (gate humano)
1. **Revise** o diff (artefato `visual-report`) e confirme que o novo visual está correto.
2. **Atualize a baseline:** Actions → workflow **Visual** → *Run workflow* → selecione a **branch do PR**
   → `update_baselines = true`. Ele regenera a baseline na CI/Linux e **commita na branch**.
3. **Re-rode o check `visual`** do PR: Actions → o run `visual` que falhou → **Re-run jobs**
   (ou `gh run rerun <run-id>`). *Necessário porque o push feito pelo `GITHUB_TOKEN` não
   re-dispara workflows automaticamente.*
4. `visual` fica verde → merge.

> **Enhancement opcional (remove o passo 3):** criar um PAT fino (`contents:write` + `actions`) como
> secret `VISUAL_PAT` e usá-lo no push do workflow — pushes via PAT **re-disparam** a CI, tornando a
> aprovação um clique só (passo 2). Hoje usamos `GITHUB_TOKEN` (sem secret extra) + re-run manual.

## Adicionar um novo teste visual

1. Crie `tests/visual/<nome>.visual.spec.ts` com `await expect(page).toHaveScreenshot('<nome>.png')`.
2. Abra o PR. Na 1ª rodada **sem baseline**, o workflow **auto-gera a baseline na CI/Linux e commita**
   (bootstrap); depois disso, mudanças visuais passam pelo fluxo de aprovação acima.
3. Telas **atrás de login** precisam autenticar no teste (e do backend + dados de seed na CI) — por
   isso a cobertura inicial é a **tela de login** (`/`, sem auth, sem PII). Expandir para telas
   internas exige subir backend + seed no CI (atividade deliberada, não automática).

## Princípios

- **Determinístico, não IA:** comparação pixel/perceptual (pixelmatch), sem modelo de IA frágil.
- **Aprovação humana só no visual:** backend e a parte comportamental (testes de componente) seguem
  100% automáticos; mudança de **aparência** intencional exige seu OK (atualizar a baseline).
- Escolha de ferramenta documentada via 2 deep-researches (Argos/Chromatic/Percy/Applitools/Playwright);
  Playwright self-hosted venceu por privacidade + determinismo + custo + aprovação no próprio GitHub.
