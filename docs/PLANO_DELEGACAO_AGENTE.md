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
  - Delegação sobre Tarefa+extrafields + solicitante.
  - Corrigir `prepare_create_task` → `setTaskContact`. UI de atribuir (2f). Criar delegação via chat (HITL).
  - Tick por **regras**: cobra o responsável (in-app) e reporta ao solicitante na conclusão. Verificação N1. Trava externa off.
  - **Entrega:** pedidos viram delegações rastreáveis, cobradas e reportadas — **testável 100% no webapp**.
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

## 12. Decisões em aberto (para validar)
1. A Delegação **é** a Tarefa do Dolibarr (recomendado) ou um conceito separado?
2. Solicitante = criador (`fk_user_creat`) ou papel explícito?
3. Acompanhamento começa por **regras** (Fase 1) e ganha **LLM** depois (Fase 2)? *(recomendado)*
4. **Cadência inicial** (ex.: lembra 1 dia antes do prazo · cobra no vencimento · re-cobra a cada 2 dias · escala ao solicitante após 3 cobranças sem progresso).
