---
description: Próximas tarefas de refatoração pendentes
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
