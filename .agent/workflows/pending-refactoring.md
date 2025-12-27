---
description: Próximas tarefas de refatoração pendentes
---

# Tarefas de Refatoração Pendentes 🔄

## 📌 1. Decomposição de Componentes Monolíticos (Prioridade: ALTA)

### 1.1 ProjectList.tsx (1310 linhas, 83KB)
**Problema:** Componente "god object" com 22+ funções internas misturando:
- CRUD de projetos, tasks e tickets
- Upload/delete de documentos
- Lógica de navegação e modais
- Filtros e paginação

**Solução proposta:**
```
src/components/Projects/
├── ProjectList.tsx          # Lista e filtros
├── ProjectDetail.tsx        # Visualização detalhada
├── ProjectForm.tsx          # Criar/editar projeto
├── ProjectDocuments.tsx     # Upload/gestão de docs
├── TaskManager.tsx          # CRUD de tasks
├── TicketManager.tsx        # CRUD de tickets
└── hooks/useProjectCRUD.ts  # Lógica de mutations
```

### 1.2 SchedulerAdmin.tsx (1305 linhas, 72KB)
**Problema:** Mistura 8 interfaces + 20 funções + lógica de UI:
- Agendamento de mensagens
- Templates
- Chat flows
- Automação
- Broadcast

**Solução proposta:**
```
src/components/Scheduler/
├── SchedulerAdmin.tsx        # Container principal
├── MessageScheduler.tsx      # Agendamentos
├── TemplateManager.tsx       # Templates
├── ChatFlowBuilder.tsx       # Fluxos
├── AutomationRules.tsx       # Regras
├── BroadcastManager.tsx      # Envio em massa
├── types.ts                  # Interfaces locais
└── hooks/useScheduler.ts     # Estado e API
```

### 1.3 BankAccountList.tsx (819 linhas, 67KB)
**Problema:** Componente com múltiplas responsabilidades:
- Listagem de contas
- Reconciliação bancária
- Importação OFX
- Transferências
- Matching de faturas

**Solução proposta:**
```
src/components/Banking/
├── BankAccountList.tsx       # Lista de contas
├── ReconciliationView.tsx    # Tela de reconciliação
├── TransactionMatcher.tsx    # Matching automático
├── ImportWizard.tsx          # Importação OFX
└── TransferModal.tsx         # Modal de transferência
```

---

## ✅ 2. Eliminação de Duplicação de Mappers (24/12/2024)

**Concluído:** 40+ funções de mapeamento duplicadas foram consolidadas:
- `backgroundSyncService.ts` reduzido de 735 para 102 linhas (-86%)
- `mappers.ts` agora é a única fonte de verdade para mapeamentos
- Adicionado `mapSupplier` e exportados helpers

---

## ✅ 3. Limpeza de Arquivos de Diagnóstico (24/12/2024)

**Concluído:** 11 arquivos movidos para `scripts/diagnostics/`:
- 6 PHP: `diagnostic_lines.php`, `diagnostic_projects.php`, `diagnostic_specific.php`, `diagnostic_sync.php`, `diagnostic_tasks.php`, `diagnostic_values.php`
- 1 PHP: `check_proposal_link.php`
- 4 JS: `analyze_api_gaps.js`, `analyze_data_density.js`, `analyze_data_links.js`, `analyze_openapi.cjs`

---

## ✅ 4. Consolidação de Tipos (24/12/2024)

**Analisado:** 12 arquivos de tipos verificados.
- `dolibarr.actions.d.ts` (567KB) é auto-gerado pelo `openapi-typescript` - **correto**
- `email.ts` estava faltando no barrel export - **corrigido**
- Nenhuma redundância significativa encontrada

---

## 📌 5. Refatoração do custom_sync.php (Prioridade: BAIXA)

**Problema:** Switch/case de 400+ linhas com queries SQL inline para 30+ tipos de entidade.

**Solução proposta:**
```php
// Padrão atual
switch ($type) {
    case 'thirdparties': $sql = "..."; break;
    case 'orders': $sql = "..."; break;
    // ... 30+ cases
}

// Padrão proposto
$queryMap = [
    'thirdparties' => new ThirdPartiesQuery($db),
    'orders'       => new OrdersQuery($db),
    // ...
];
$handler = $queryMap[$type] ?? null;
$data = $handler?->execute($last_modified, $limit, $offset);
```

---

## 📌 6. Padronização de Layouts de Lista (Prioridade: BAIXA)

**Problema:** Componentes de lista com código duplicado de:
- Paginação
- Filtros de status
- Modais de criação/edição
- Estilos de tabela

**Componentes afetados:**
- CustomerList.tsx (43KB)
- SupplierList.tsx (40KB)
- InvoiceList.tsx (43KB)
- OrderList.tsx (38KB)
- TicketList.tsx (47KB)

**Solução proposta:**
Criar componentes reutilizáveis:
```
src/components/common/
├── DataTable.tsx           # Tabela com paginação
├── FilterBar.tsx           # Barra de filtros genérica
├── CRUDModal.tsx          # Modal de criar/editar
└── ActionButtons.tsx       # Botões de ação
```

---

# Tarefas de Refatoração - CONCLUÍDAS ✅

## ✅ 1. Refatoração de Serviços Bancários (23/12/2024)
- `InterApiService` refatorado para herdar de `BankingApiBase`
- `ItauApiService` refatorado para herdar de `BankingApiBase`

## ✅ 2. Decomposição do dolibarrService.ts (23/12/2024)

O arquivo monolítico (1293 linhas, 50KB) foi decomposto em 10 módulos:

```
backend/src/services/dolibarr/
├── core.ts          # Base class, auth, proxy
├── thirdparties.ts  # Clientes, fornecedores
├── commercial.ts    # Faturas, propostas, pedidos
├── payments.ts      # Pagamentos, bancos
├── products.ts      # Produtos, estoque
├── operations.ts    # Projetos, tickets, envios
├── hr.ts            # Usuários, RH
├── manufacturing.ts # BOMs, produção
├── suppliers.ts     # Fornecedores
└── index.ts         # Interface unificada
```

## ✅ 3. Limpeza de Hooks Legados
- `useModules.ts` mantido (funcional, pequeno, específico)

---

## Referência: Trabalho Concluído (22/12/2024)

✅ Refatoração completa dos hooks Dolibarr (32 hooks -> 4 arquivos)
✅ Atualização de 18+ componentes UI
✅ Zero erros TypeScript

Ver: `CHANGELOG_2024-12-22.md`
