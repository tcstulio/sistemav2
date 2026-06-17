<div align="center">

# CoolGroove — ERP/CRM + WhatsApp

[![CI](https://github.com/tcstulio/sistemav2/actions/workflows/ci.yml/badge.svg)](https://github.com/tcstulio/sistemav2/actions/workflows/ci.yml)
[![E2E](https://github.com/tcstulio/sistemav2/actions/workflows/playwright.yml/badge.svg)](https://github.com/tcstulio/sistemav2/actions/workflows/playwright.yml)
[![Visual](https://github.com/tcstulio/sistemav2/actions/workflows/visual.yml/badge.svg)](https://github.com/tcstulio/sistemav2/actions/workflows/visual.yml)

</div>

Sistema de gestão (ERP/CRM) integrado ao **Dolibarr** e ao **WhatsApp**, com um agente de IA que opera sobre os dados do negócio (clientes, propostas, faturas, projetos, tarefas, financeiro).

## Stack

- **Frontend:** React + Vite + TypeScript (`src/`)
- **Backend:** Express + Node.js + TypeScript (`backend/`)
- **Dados:** Dolibarr (ERP) + stores JSON locais; SQLite via `better-sqlite3`
- **WhatsApp:** `whatsapp-web.js`
- **IA:** roteamento multi-provedor (GLM/ZAI, MiniMax, Gemini, local)

## Estrutura

| Caminho | O quê |
|---|---|
| `src/` | Frontend (React + Vite) |
| `backend/` | API Express + serviços (WhatsApp, agente, scheduler, bancos) |
| `tests/` | E2E Playwright |
| `docs/` | Planos e specs de arquitetura |
| `scripts/` | Utilitários de dev/diagnóstico |

## Rodar localmente

**Pré-requisitos:** Node.js 20+

```bash
# dependências
npm install
cd backend && npm install && cd ..

# tudo junto (frontend :3000 + backend :3004)
npm run dev:all

# ou separados
npm run dev:backend
npm run dev:frontend
```

Configure as variáveis do backend em `backend/.env` (veja `backend/.env.example`).
Opcionalmente, defina `VITE_SENTRY_DSN` para ativar o monitoramento de erros no frontend.

## Testes

```bash
npm run test:unit          # unit do frontend (Vitest)
cd backend && npm test     # unit do backend (Vitest)
npm test                   # E2E (Playwright)
```

## Documentação

Docs detalhados de arquitetura, API e deployment estão em construção (issue #31). Specs e planos atuais ficam em `docs/`.
