# Auditoria de lacunas da UI (estática) — 2026-06-10

Primeira passada **estática** (varredura por padrões no código). Cobre o que dá pra detectar sem rodar o app; o crawler Playwright (fase 3) pega o resto (telas quebradas, layout, fluxo real).

Método: varredura por padrões de lacuna em `src/**/*.{ts,tsx}` — erros engolidos, diálogos nativos, campos read-only sem edição, deep-links externos, TODO/placeholder, cruft de debug.

---

## P0 — Sistêmicas (afetam o app inteiro)

### 1. Erros engolidos em silêncio — **133 ocorrências / 60 arquivos**
`catch { log.warn(...) }` sem nenhum feedback na tela. Foi o que escondeu o **401** dos painéis de delegação (o botão "não fazia nada"). Concentrações: `SupplierInvoiceList` (8), `aiService` (7), `WhatsAppProfileSettings` (6), `EmailView`/`ReceiptWizard`/`whatsappService` (5), painéis de `Tasks/` (14 somados).
- **Fix:** camada central de erro — toast/banner "algo falhou" com botão **Reportar**; em chamadas autenticadas, detectar **401 → "sessão expirada, faça login"**. Resolve a invisibilidade de falha de uma vez.

### 2. Diálogos nativos `alert/confirm/prompt` — ~40+ ocorrências
UX inconsistente, bloqueiam a thread e somem em alguns contextos (iframe/modal). Ex.: `ContractList`, `WhatsAppView`, `HRList`, `AgendaEntryDetail`, `Manufacturing/modals/*`, `AdminApp`, `GroupManager`.
- **Fix:** componente padrão de **toast** + **modal de confirmação**.

---

## P1 — Funcionalidades faltando (lacunas como a das datas)

| # | Lacuna | Arquivo:linha |
|---|--------|---------------|
| 3 | **Editar campos da tarefa** (início/término/prazo `date_end`/carga/%): só Descrição é editável | `TaskDetail.tsx` (cabeçalho 194-208) |
| 4 | **Excluir usuário**: botão só dá `alert("pendente de implementação na API")` | `HRList.tsx:361` |
| 5 | **Detalhe de licença** "não implementado" | `HRList.tsx:626` |
| 6 | **IBAN hardcoded** `XXXX-XXXX-XXXX` (dado falso em tela) | `HR/UserDetail.tsx:178` |
| 7 | **Add/remover grupo** não atualiza a lista ("sync necessário") | `HR/UserDetail.tsx:82,95` |
| 8 | **Transações de conta** não sincronizadas (TODO) | `BankAccountList.tsx:268` |

---

## P2 — UX & navegação

### 9. Deep-links abrem o **Dolibarr externo** (5 pontos)
`TaskDetail:210` ("Abrir no Dolibarr"), `AgendaEntryDetail` (×2), `InvoiceList`, `ProposalList`, `SupplierInvoiceList`. O base-URL já foi corrigido (não 404 mais), mas o tema maior: deviam abrir tela **dentro do app**, não jogar pro Dolibarr.

### 10. Cruft de debug em produção
`TaskDetail.tsx:299-300` "Debug Data (Temporary)" expõe o **JSON cru** da tarefa. Remover ou gate por flag de dev.

---

## Como isto vira o loop
Cada item acima é candidato a **issue** (label `opencode-task`) → TaskRunner implementa → PR → revisão. As P0 (erro engolido + diálogos) são as de maior alavancagem: corrigi-las faz o próprio app **revelar** os bugs seguintes, alimentando a fase 2 (botão Reportar) e a fase 3 (crawler).
