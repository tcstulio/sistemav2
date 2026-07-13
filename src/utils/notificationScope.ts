/**
 * #1428 — Util compartilhado para classificar o escopo (personal × system)
 * de uma `AppNotification`. Extraído de `MyNotificationsView.tsx` (linhas 25-33)
 * para permitir reuso por outros pontos que precisem do mesmo particionamento
 * (ex.: painel lateral, widgets de dashboard) sem acoplar à árvore React.
 *
 * Função PURA — sem hooks, sem contexto, sem DOM — para ficar testável de forma
 * isolada.
 *
 * Assinatura intencionalmente IDÊNTICA à versão original portada:
 *   classifyScope(n: AppNotification, userId: string | undefined): ScopeTab
 * Como `DolibarrUser.id` é tipado como `string` em `types/common.ts`, o caller
 * passa o id do usuário já como string (sem coerções) — o que mantém a
 * equivalência runtime original: `'42' === '42'`.
 *
 * Precedência do fallback (mesma do original):
 *   1. `n.scope` definido pelo backend  → respeita o que veio do servidor
 *   2. sem `recipient`                  → 'system' (broadcast sem alvo)
 *   3. `recipient === userId`           → 'personal' (alvo é o próprio usuário)
 *   4. `recipient` em {'team','all'}     → 'system'
 *   5. eventos 'agent.action'/'stock.low'/'custom' → 'system' (metadado de evento)
 *   6. default                          → 'system'
 */
import type { AppNotification } from '../types';

export type NotificationScope = 'personal' | 'system';

export function classifyScope(n: AppNotification, userId: string | undefined): NotificationScope {
    if (n.scope) return n.scope;
    if (!n.recipient) return 'system';
    if (n.recipient === userId) return 'personal';
    if (n.recipient === 'team' || n.recipient === 'all') return 'system';
    if (n.event === 'agent.action' || n.event === 'stock.low' || n.event === 'custom') return 'system';
    return 'system';
}
