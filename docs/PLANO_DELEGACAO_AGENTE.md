# Plano Completo — Delegação Garantida por Agente

> **Princípio:** uma pessoa pede algo a outra(s) e um **agente se certifica de que aconteça** —
> acompanha, cobra, ajuda, verifica e reporta de volta. O sistema deixa de ser um *registro de
> tarefas* e vira um **executor de compromissos**.

---

## 1. O conceito central: a "Delegação"

Uma **Delegação** é um compromisso com dono, prazo e critério de pronto:

| Elemento | Significado |
|---|---|
| **Solicitante** | quem pediu (A) — recebe o reporte no fim |
| **Responsável** | quem faz (B) — `TASKEXECUTIVE` via #72 |
| **Interveniente** | quem ajuda/acompanha — `TASKCONTRIBUTOR` |
| **Agente garantidor** | quem se certifica (acompanha/cobra/ajuda/verifica/reporta) |
| **Objetivo / prazo / critério de pronto** | o "o quê", o "até quando", o "como sei que terminou" |

### Máquina de estados
```
rascunho → PEDIDA → EM_ANDAMENTO → (COBRADA ↺) → CONCLUÍDA → VERIFICADA → REPORTADA → encerrada
                         ├─ BLOQUEADA (precisa de ajuda/decisão)
                         ├─ ESCALADA  (sem resposta → sobe ao solicitante/gestor)
                         ├─ RECUSADA
                         └─ CANCELADA
```
Cada transição tem **um gatilho** (tempo ou evento) e **uma ação do agente**.

---

## 2. Onde mora o dado (modelo)

Reaproveitar a **Tarefa do Dolibarr (`projet_task`)** como o **contrato durável** — já sincroniza, conecta a projetos e clientes, e sobrevive a restart.

- **Responsável/Interveniente** → `element_contact` (canal de escrita **#72**, já em produção).
- **Solicitante** → `fk_user_creat` por enquanto; idealmente um papel/extrafield explícito.
- **Estado de acompanhamento** (última cobrança, nº de cobranças, próximo follow-up, critério de pronto, status do agente) → **extrafields** (`array_options`) ou store próprio.
- **Abstração:** tratar tudo como "Delegação" na nossa camada, com Dolibarr como *storage* — assim migra para o Tulipa depois sem reescrever a lógica.

---

## 3. O agente garantidor — capacidades

**Reutiliza (já existe):** `prepare_create_task/project`, `notify_person/notify_team`, `send_whatsapp`, `list_user_tasks`, `getUserById`, + `setTaskContact` (#72) e `dispatchTaskNotification` (camada 2).

**Novas tools:**
- `criar_delegacao` — do pedido no chat: cria a tarefa, **atribui o responsável via `setTaskContact`** (não `fk_user_assign`), registra solicitante, prazo e critério.
- `cobrar` — mensagem contextual ao responsável (o agente escreve, não template fixo).
- `ajudar` — responde dúvida / desbloqueia / dá contexto.
- `verificar` — checa status/entregável.
- `reportar` — avisa o solicitante do desfecho.

> **Dívida a corrigir:** `prepare_create_task` hoje usa `fk_user_assign` (que **não grava** o responsável). Precisa passar a usar o canal `setTaskContact`. *(Tarefa concreta para a Fase 1.)*

**HITL × autonomia (a tensão sadia):**
- Escrita **estrutural** (criar/editar tarefa) → continua **HITL** (a pessoa confirma na tela).
- **Cobrança/ajuda/reporte** (mensagens, baixo risco) → **diretas**, sem confirmação.
- O agente **acorda sozinho** para acompanhar, mas só *fala*; mexer no dado estrutural pede confirmação. Tudo auditável.

---

## 4. A peça que falta: o motor de acompanhamento (autonomia no tempo)

Hoje o agente só roda no chat. Para "se certificar", ele precisa de um **modo autônomo**. A boa notícia: **a infra de tempo já existe** — `schedulerService` (fila durável + recorrência), `alertCronService` (crons), `eventRouter` (eventos).

**Design do "Tick de acompanhamento":**
1. A **fila de delegações** = tarefas em aberto (Dolibarr) + estado nos extrafields.
2. Um **tick** (cron, ex. de hora em hora ou diário) percorre as delegações abertas e, para cada uma, decide a próxima ação em **dois níveis**:
   - **Por REGRAS** (rede de segurança, barato): venceu → cobra; sem progresso há X → lembra; concluída → reporta. *(É a camada 2d, generalizada.)*
   - **Por AGENTE** (inteligência, onde precisa de julgamento): cobrança personalizada, ajuda, escalonamento → invoca o LLM com o contexto da delegação.
3. **Cadência anti-spam:** escalonamento (lembrete suave → cobrança → escalação ao solicitante), com **dedup** (já temos) e agrupamento por pessoa.
4. **Gatilhos:** tempo (tick) **+** evento (mudança na tarefa via sync → `eventRouter`).

---

## 5. Interação (canais)

- **Entrada:** chat em linguagem natural ("peça pro B entregar X até sexta") → agente cria a delegação (HITL). **+** UI manual (atribuir responsável).
- **Acompanhamento:** notificação por papel (camada 2) + mensagem do agente.
- **Reporte:** ao solicitante (chat / notificação).
- **Trava:** canais externos **off** até validar — tudo testável **in-app no webapp** primeiro.

---

## 6. Verificação — em níveis

- **N1 (MVP):** status/progresso da tarefa (o responsável marca como feito).
- **N2:** o agente **verifica o entregável** quando é auto-verificável (anexo presente, fatura criada, valor lançado) — usando as tools de leitura do Dolibarr.
- **N3 (futuro):** o agente executa parte e valida.

---

## 7. Configurabilidade (a camada 2 encaixa aqui)

- **Matriz** quem-recebe-o-quê por papel/evento/canal — **já feita**.
- **Cadência** de cobrança (quando lembrar/cobrar/escalar) — nova config.
- **Critério de pronto** por delegação.

---

## 8. Reutilização × novo

| Já existe (reaproveita) | Novo (construir) |
|---|---|
| Agente "Marciano" + tools + HITL/deeplink | Conceito **Delegação** + **Solicitante** explícito |
| `setTaskContact` (#72), notificação por papel (camada 2) | **Motor de acompanhamento** (tick + decisão regras/agente) |
| `schedulerService` (fila durável + recorrência) | **Modo autônomo** do agente (acordar sem chat) |
| `alertCronService`, `eventRouter`, sync delta | **Verificação** (N1→N2) + **reporte** ao solicitante |
| `list_user_tasks`, `getUserById` | **Cadência** anti-spam configurável |

---

## 9. Roadmap em fases

- **Fase 0 — FEITO:** responsável gravável (#72) + notificação por papel + cron de overdue (rede de segurança). *(Em produção / acumulado.)*
- **Fase 1 — MVP "delegação rastreável" (regras, sem LLM autônomo):**
  - ✅ 1a responsável gravável (`setTaskContact`) · ✅ #74 responsável visível · ✅ 1b/2f UI de atribuir · ✅ 1d motor por regras (cobra/escala/reporta) + verificação N1 · ⬜ **1c criar delegação via chat (HITL) — issue #286**.
  - **Entrega:** pedidos viram delegações rastreáveis, cobradas e reportadas — **testável 100% no webapp**.
- **Fase 1.5 — "delegação como fluxo" (ver §13):** ciclo de vida com **aceite (prazo + escala imediata)**, **documentação oficial** (critério de pronto), **sub-tarefas + barra de progresso**, transparência a todos os envolvidos, e **templates estruturados** (1º: contagem de estoque = verificação N2). *(Issues abaixo.)*
- **Fase 2 — "agente cobra com inteligência":**
  - Modo autônomo: o tick invoca o LLM para os casos de julgamento (cobrança contextual, ajuda, escalonamento). Cadência configurável. WhatsApp/e-mail ligados após validação.
- **Fase 3 — "verificação e visibilidade":**
  - Verificação N2 + dashboard de delegações (status, atrasos, SLA) + métricas.
- **Fase 4 — "Tulipa":** agente por pessoa, DAG, Brain Hub; a Delegação migra para o OS vivo (a lógica é portável por ter sido abstraída).

---

## 10. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Spam / ruído | cadência + trava + in-app primeiro + dedup + agrupar por pessoa |
| Autonomia × segurança | escrita estrutural HITL; cobrança (baixo risco) direta; auditável |
| Responsável errado | confirmar na criação; agente revalida antes de cobrar |
| Sobre-engenharia | regras na Fase 1; LLM autônomo só na Fase 2 |
| Acoplamento Dolibarr / futuro Tulipa | abstrair "Delegação"; motor portável |
| Custo de LLM no tick | regras para o trivial; LLM só onde há julgamento |

---

## 11. Métricas de sucesso
% de delegações concluídas no prazo · tempo médio até concluir · nº de delegações "esquecidas" (cai) · nº de cobranças até concluir · nível de ruído (reclamação).

---

## 12. Decisões (validadas)
1. A Delegação **é** a Tarefa do Dolibarr. ✅
2. Solicitante = criador (`fk_user_creat`) por ora. ✅
3. Acompanhamento começa por **regras** (Fase 1) e ganha **LLM** depois (Fase 2). ✅
4. **Cadência inicial:** lembra 1 dia antes · cobra no vencimento · re-cobra a cada 2 dias · escala ao solicitante após 3 cobranças sem progresso. ✅ (implementada em `delegationFollowUpLogic`)
5. **Comunicação automática (sem aprovação por mensagem), porém auditável.** ✅ Toda mensagem fica logada; supervisão vem da trilha, não de um portão por envio.
6. **Aceite obrigatório com prazo:** ao receber, o responsável tem um **prazo de aceite** para confirmar. **Recusa OU prazo estourado sem resposta → escala imediatamente ao solicitante.** ✅

---

## 13. Ciclo de vida da delegação (execução estruturada, auditável e transparente)

A Delegação deixa de ser "tarefa com prazo" e vira um **objeto de fluxo**: criada → avisada → **aceita** → documentada → decomposta em passos → acompanhada por barra de progresso → concluída e registrada — com **todos os envolvidos vendo o que é esperado**.

### 13.1 O ciclo
| Etapa | O que acontece | No sistema |
|---|---|---|
| **Criada** | o pedido vira delegação | tarefa-mãe (solicitante = `fk_user_creat`) |
| **Aviso** | avisa o responsável e quem deve saber | matriz (`assigned` → responsável + intervenientes) |
| **Aceite (com prazo)** | o responsável confirma que recebeu/aceita, dentro do **prazo de aceite** | novo estado "aguardando aceite" → "aceita"; registra quem/quando |
| **↳ recusa ou sem resposta no prazo** | **escala imediatamente ao solicitante** | evento de escalação de aceite |
| **Documentação oficial** | o "o que é esperado": objetivo, critério de pronto, passos | o **contrato** da delegação (visível a todos) |
| **Fluxo de tarefas** | a doc vira passos | **sub-tarefas** (`fk_task_parent`, nativo do Dolibarr) |
| **Barra de progresso** | acompanha o avanço | `progress` da mãe = agregado das filhas |
| **Todos informados** | cada envolvido vê o esperado e onde está | tela + notificações por papel |
| **Concluída + registrada** | fecha e comprova | progresso 100% + registro auditável; **motor reporta ao solicitante** |

### 13.2 A "documentação oficial" — um artefato, quatro funções
O documento do que é esperado serve simultaneamente como: **(1) clareza** (todos sabem o combinado), **(2) checklist** (vira os passos/barra), **(3) critério de verificação** (pronto = passos registrados) e **(4) registro de auditoria** (foi isto que foi combinado, confirmado por fulano às HH:MM).
- **Fase 1 (regras):** a doc é escrita por uma pessoa ou vem de um **template**.
- **Fase 2 (LLM):** o agente **gera** a doc a partir do pedido; a pessoa só **confirma** (o "aceite").

### 13.3 Respostas limitadas = templates estruturados (verificação N2)
Para tornar a execução auditável e auto-verificável, uma delegação de **tipo conhecido** abre um **fluxo guiado com resposta tipada e validada** (não texto livre). Primeiro template: **contagem de estoque** — apresenta item a item, recebe um número por item, valida (item ∈ lista, qtd ≥ 0) e, ao enviar, **registra o movimento de estoque no Dolibarr** + marca 100%. A contagem registrada *é* a prova de conclusão (N2), sem confirmação "no olho".
- **Canal:** o estruturado vive **in-app** (onde dá pra limitar/validar); o WhatsApp/automático é só o **toque + link** que abre a tela.

### 13.4 Transparência e auditoria
- **Transparência:** a matriz define quem é avisado por papel/evento; a doc oficial é visível na tela a todos que podem ver a tarefa — todos veem o mesmo "esperado" e a mesma barra.
- **Auditoria (trilha por delegação):** notificações enviadas (`notifications.json`) + estado do acompanhamento (`delegation_tracking.json`: cobranças/datas/aceite) + o registro final no Dolibarr (autor + timestamp). Comunicação automática, mas tudo rastreável.

### 13.5 Ponte para o Tulipa
O "fluxo de tarefas" é exatamente o **DAG de orquestração do Tulipa** (Fase 4): começa nativo com sub-tarefas do Dolibarr e migra sem reescrever a lógica (que já é abstraída como "Delegação").
