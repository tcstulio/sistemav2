# Contribuindo — CoolGroove

## Setup

```bash
npm install
cd backend && npm install && cd ..
cp backend/.env.example backend/.env   # preencha os valores
npm run dev:all
```

## Estrutura do repositório

| Caminho | O quê |
|---|---|
| `src/` | Frontend (React + Vite). Componentes em `src/components/`, serviços em `src/services/`, hooks em `src/hooks/`. |
| `backend/src/routes/` | Rotas Express (um arquivo por grupo). |
| `backend/src/services/` | Lógica de negócio (Dolibarr, WhatsApp, agente, bancos, scheduler, taskrunner…). |
| `backend/src/middleware/` | Auth, validação (Zod), auditoria, erro. |
| `backend/data/` | Stores JSON locais (**não versionado**; sensível é cifrado). |
| `tests/` | E2E Playwright. Testes unitários ficam em `__tests__/` (front e back). |
| `docs/` | Arquitetura, API, deployment + planos/specs. |

## Convenções

### Commits

Padrão **Conventional Commits**, em geral referenciando a issue:

```
feat(#123): descrição curta no imperativo
fix(taskrunner): ...
security(#34): ...
chore(#35,#32): ...
```

### Pull Requests

- **Saia da `main`**, uma branch por mudança; PRs **pequenos e focados** (idealmente 1 issue/fatia por PR).
- `Closes #N` quando o PR resolve a issue por completo; `Refs #N` para uma **fatia** (deixa a issue aberta).
- A `main` é protegida: o merge exige os **checks de CI verdes** e a branch **atualizada** com a `main`.

### Estilo

- TypeScript `strict`. Evite `any` (o ESLint avisa).
- Reuse padrões existentes: validação com **Zod** (`validateBody`), persistência cifrada no padrão do `emailStoreService`/`crypto.ts`, envio de mensagens **sempre** pelo `channelRouter`.
- Comentários e mensagens ao usuário em **pt-BR**.

## Testes

```bash
npm run test:unit            # unit do frontend (Vitest)
cd backend && npm test       # unit do backend (Vitest)
npm test                     # E2E (Playwright)
```

Antes de abrir um PR, garanta `tsc` limpo e os testes verdes:

```bash
npx tsc --noEmit             # frontend
cd backend && npx tsc --noEmit
```

## TaskRunner (contribuição autônoma)

Muitas issues podem ser resolvidas pelo **TaskRunner**: ele pega a issue, gera um PR via `opencode`/glm num worktree isolado, um `Judge` avalia e o **auto-merge** acontece se a CI passar. Issues bem escopadas, com critério de aceite testável por CI, são as melhores candidatas. Detalhes em `docs/PLANO_TASKRUNNER_OPERACIONALIZACAO.md`.

> Regra: o TaskRunner **não deve alterar o próprio motor** (`taskRunnerService.ts`) de forma autônoma — essas mudanças são feitas supervisionadas.
