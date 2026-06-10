# Plano de correções — sequência única (2026-06-10)

Consolida tudo que apareceu na sessão. Princípio de ordenação: **primeiro o que torna o sistema capaz de revelar os próprios bugs** (diagnosticabilidade), depois o assistente (bug ativo), depois as lacunas funcionais, UX e infra. Cada item é candidato a issue → (TaskRunner) → PR → revisão.

---

## Fase 0 — Consolidar o que já está pronto (rápido; protege o trabalho)
- [ ] **Commitar os 3 blocos** já prontos, separados:
  - Loop de correção (auditoria + ReportButton + reportContext + rota `POST /github/issues` + crawler)
  - Endereço fixo (`vite.config.ts` allowedHosts, `backend/.env` tunnel off, `start-app-fixo.ps1`)
  - TaskRunner git-bash (com a pendência documentada)
- [ ] **Smoke test do botão 🐛** no browser (relogado) → cria issue de verdade.
- [ ] **Rodar o crawler** 1× (`TEST_LOGIN/TEST_PASSWORD … npx playwright test ui-crawler`) → gera `test-results/crawler/REPORT.md` e alimenta o backlog.

## Fase 1 — Diagnosticabilidade (P0 — alavanca tudo)
- [ ] **Camada central de erro:** 401 → "sessão expirada, faça login"; demais falhas → toast com botão **Reportar**. Mata o "botão que não faz nada" (**133 catches silenciosos / 60 arquivos**). Liga com o 🐛 já feito.
- [ ] Aplicar primeiro nos painéis de delegação (onde o 401 ficou invisível).

## Fase 2 — Assistente robusto (o bug de agora)
**Requisito (definido pelo usuário):** o job do agente tem que **SEMPRE concluir** (criar projeto + todas as tarefas), **demore o que demorar**, e **NÃO pode bloquear outras sessões**. Logo: não é "streaming de tokens", é **execução assíncrona em background (job)**.

- [ ] **Modelo de job assíncrono:** o `POST` do chat **enfileira o job e responde na hora** com um `jobId` (não segura a conexão → mata o **524 do Cloudflare** de uma vez). O agente roda server-side até o fim, **sem limite de tempo**.
- [ ] **Progresso via socket.io** (já existe): passos/tokens/resultado chegam ao vivo por evento `job:<id>`; se a conexão cair, o cliente reconecta e busca o estado (o job não morre junto).
- [ ] **Não-bloqueante entre sessões:** cada job é isolado por sessão; uma fila/limite de concorrência impede que um job pesado degrade os outros. Persistir o estado do job (sobrevive a reconexão; idealmente a restart).
- [ ] **Enxugar contexto por turno** — hoje reenvia o histórico inteiro (28k tokens, incl. a planilha) a cada mensagem; latência cresce 30s → 49s → cai. (Reduz custo/tempo, mas o job assíncrono é o que garante a conclusão.)
- [ ] **Corrigir `listTasks`** (`backend/src/services/dolibarr/operations.ts:80`): `sqlfilter` que dá **400** + só aceita status 200 (404 = "sem tarefas" também quebra). Tratar 404 como vazio e validar o filtro.
- [ ] → **destrava a tarefa real:** criar o projeto a partir da planilha (Google Sheets) usando um projeto-modelo — agora rodando como job que conclui sozinho.

## Fase 3 — Lacunas funcionais (P1)
- [ ] **Editar campos da tarefa** (início/término/prazo `date_end`/carga/%) em `TaskDetail` — a lacuna que iniciou tudo. Canal `updateTask` já existe.
- [ ] **HRList**: excluir usuário (hoje só `alert "pendente"`, `HRList:361`).
- [ ] **UserDetail**: IBAN hardcoded `XXXX-XXXX-XXXX` (`:178`); add/remover grupo não atualiza a lista (`:82,95`).
- [ ] **BankAccountList**: transações não sincronizadas (`:268`).

## Fase 4 — UX & navegação (P2)
- [ ] **Diálogos nativos → toasts/modais** (~40 `alert/confirm/prompt`).
- [ ] **Deep-links** abrirem tela **in-app** em vez de jogar pro Dolibarr externo (5 pontos do `useDolibarrLink`).
- [ ] Remover **Debug Data (Temporary)** de produção (`TaskDetail:299`).

## Fase 5 — Infra / hygiene
- [ ] **Persistir proto-sessões** em disco (`protoSession.ts` usa `Map` em memória → todo restart do backend desloga todo mundo; foi o que causou o 401 de hoje).
- [ ] **Finalizar o TaskRunner**: 1ª-tentativa-vazia (prompt imperativo) + **tree-kill** de órfãos no timeout. Depois, usá-lo pra implementar as issues das fases acima — **fechando o loop**.

---

## Ordem recomendada
**0 → 1 → 2 → (tarefa do projeto) → 3 → 4 → 5.**
A Fase 1 faz as fases seguintes renderem mais (bugs param de ficar invisíveis); a Fase 2 destrava o uso real do assistente; 3/4 são as lacunas concretas; 5 fecha o ciclo (sessões estáveis + TaskRunner implementando o resto).
