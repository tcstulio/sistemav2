# Auditoria: Controles de ordenação fora do `ListToolbar`

Issue: #575 · Parent Epic: #567 · Complexidade: low

## Objetivo

Verificar se alguma tela de lista renderiza um `<select>` de ordenação ou botão de
direção **fora** do componente padronizado `ListToolbar` (`src/components/ui/ListToolbar.tsx`),
caracterizando controle manual/próprio de ordenação. Eventuais exceções deveriam ser
migradas para o `ListToolbar`.

## Metodologia de busca

Foram executadas buscas (`grep`/glob) em `src/components/*.tsx` e
`src/components/**/*.tsx` pelos padrões indicados na issue e variantes:

- Ícones canônicos de ordenação: `ArrowDownAZ`, `ArrowUpAZ`
- Estado de ordenação: `sortDir`, `sortField`, `sortConfig`
- Rótulos de ordenação: `ordenar por`, `Ordenar por`
- Variantes de UI: `SortAsc`, `SortDesc`, `sortBy`, `setSort`, `orderBy`
- Estrutural: todos os arquivos `*List.tsx` e checagem de `import ... ListToolbar`

Foram também inspecionados os `<select>` existentes nos componentes de lista para
distinguir selects de **formulário/modal** (Cliente, Projeto, Armazém, Produto, etc.)
de selects de **ordenação**.

### Resultado das buscas-chave

| Padrão | Onde aparece |
| --- | --- |
| `ArrowDownAZ` / `ArrowUpAZ` | somente `src/components/ui/ListToolbar.tsx` e seu teste |
| `sortDir` | somente consumidores de `ListToolbar`: adaptador `hrToolbarControls` em `HRList.tsx`, `controls.sortDir` em `Finance/TaxPaymentList.tsx`, `ListToolbar.tsx` e teste |
| `title="Ordenar por"` | somente `src/components/ui/ListToolbar.tsx` |
| `sortConfig` | estado central em `HRList.tsx`, repassado às abas de RH **apenas para lógica de ordenação** (sem renderizar UI própria) |

Nenhum controle de ordenação (select ou botão de direção) foi encontrado fora do
`ListToolbar`. A conclusão está codificada como invariant de regressão em
`src/__tests__/audit/sorting-controls-audit.test.ts`, que agora também verifica,
de forma complementar, que **nenhum `<select>` fora do `ListToolbar`** está ligado
a tokens de estado de ordenação (`sortKey`, `sortDir`, `sortConfig`, `orderBy`,
`sortBy`, etc.) — capturando reimplementações de UI mesmo sem os marcadores
canônicos (ícones/affordances).

## Telas verificadas

### Listas que já usam `ListToolbar` (ordenação padronizada) — sem migração

| Tela | Arquivo |
| --- | --- |
| VenueList | `src/components/VenueList.tsx` |
| CustomerList | `src/components/CustomerList.tsx` |
| ProductList | `src/components/ProductList.tsx` |
| InvoiceList | `src/components/InvoiceList.tsx` |
| ProposalList | `src/components/ProposalList.tsx` |
| OrderList | `src/components/OrderList.tsx` |
| SupplierList | `src/components/SupplierList.tsx` |
| ContactList | `src/components/ContactList.tsx` |
| CategoryList | `src/components/CategoryList.tsx` |
| ContractList | `src/components/ContractList.tsx` |
| TicketList | `src/components/TicketList.tsx` |
| ShipmentList | `src/components/ShipmentList.tsx` |
| InterventionList | `src/components/InterventionList.tsx` |
| BankAccountList | `src/components/BankAccountList.tsx` |
| HRList | `src/components/HRList.tsx` |
| SupplierInvoiceList | `src/components/SupplierInvoiceList.tsx` |
| SupplierProposalList | `src/components/SupplierProposalList.tsx` |
| SupplierPaymentList | `src/components/SupplierPaymentList.tsx` |
| PaymentList | `src/components/PaymentList.tsx` |
| TaxPaymentList | `src/components/Finance/TaxPaymentList.tsx` |
| ExpenseReportPaymentList | `src/components/Finance/ExpenseReportPaymentList.tsx` |
| SalaryPaymentList | `src/components/HR/SalaryPaymentList.tsx` |

### Listas que NÃO usam `ListToolbar` — sem ordenação exposta ao usuário (sem migração necessária)

| Tela | Arquivo | Observação |
| --- | --- | --- |
| ProjectList | `src/components/ProjectList.tsx` | Nenhuma lógica de ordenação |
| WarehouseList | `src/components/WarehouseList.tsx` | Apenas `.sort()` fixo p/ exibição (sem controle) |
| ConversationList | `src/components/whatsapp/ConversationList.tsx` | Apenas `.sort()` fixo por timestamp (sem controle) |
| ClusterList | `src/components/CentroVibe/ClusterList.tsx` | Sem ordenação |
| ArtistList | `src/components/CentroVibe/ArtistList.tsx` | Possui filtro (`filterCluster`), sem ordenação |
| EmailList | `src/components/Email/EmailList.tsx` | Sem ordenação |
| EmailAccountList | `src/components/Email/EmailAccountList.tsx` | Sem ordenação |

### Abas de RH que consomem `sortConfig` do `HRList` (UI já centralizada no `ListToolbar`)

O `HRList.tsx` mantém o estado `sortConfig` e o adapta para o `<ListToolbar>` em
`src/components/HRList.tsx:430`. As abas abaixo apenas **consomem** `sortConfig`
para aplicar a ordenação nos dados — **não** renderizam UI de ordenação própria:

| Aba | Arquivo |
| --- | --- |
| TeamTab | `src/components/HR/tabs/TeamTab.tsx` |
| LeavesTab | `src/components/HR/tabs/LeavesTab.tsx` |
| GroupsTab | `src/components/HR/tabs/GroupsTab.tsx` |
| ExpensesTab | `src/components/HR/tabs/ExpensesTab.tsx` |
| RecruitmentTab | `src/components/HR/tabs/RecruitmentTab.tsx` |
| RecruitmentJobsList | `src/components/HR/tabs/RecruitmentJobsList.tsx` |
| RecruitmentCandidatesList | `src/components/HR/tabs/RecruitmentCandidatesList.tsx` |

## Conclusão

**Auditoria concluída: nenhuma exceção encontrada.** Todas as listas que expõem
ordenação ao usuário já utilizam o `ListToolbar`. As listas que não importam o
`ListToolbar` não implementam ordenação voltada ao usuário (apenas ordenação fixa
de exibição ou apenas filtro). Nenhuma migração foi necessária.

## Critérios de aceite

- [x] Auditoria documentada: lista de telas verificadas (seções acima).
- [x] Nenhuma exceção encontrada — nada a migrar.
- [x] Sem mudanças de código de produção: nenhuma regressão visual/funcional possível.
- [x] Invariant de regressão reforçado em `sorting-controls-audit.test.ts` (heurística `<select>` + estado de ordenação).
- [x] `npx tsc --noEmit` passa (exit 0).
