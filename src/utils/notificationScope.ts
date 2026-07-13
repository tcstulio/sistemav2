/**
 * #1428 — Util compartilhado para classificar o escopo (personal × system)
 * de uma `AppNotification`. Extraído de `MyNotificationsView.tsx` para permitir
 * reuso por outros pontos que precisem do mesmo particionamento (ex.: painel
 * lateral, widgets de dashboard) sem acoplar à árvore React.
 *
 * Função PURA — sem hooks, sem contexto, sem DOM — para ficar testável de forma
 * isolada. A precedência do fallback é a MESMA da versão original portada:
 *
 *   1. `n.scope` definido pelo backend  → respeita o que veio do servidor
 *   2. sem `recipient`                  → 'system' (broadcast sem alvo)
 *   3. `recipient === currentUserId`    → 'personal' (alvo é o próprio usuário)
 *   4. `recipient` em {'team','all'}     → 'system'
 *   5. eventos 'agent.action'/'stock.low'/'custom' → 'system' (metadado de evento)
 *   6. default                          → 'system'
 *
 * O parâmetro `currentUserId` é tipado como `number | null` (a `id` do
 * `DolibarrUser`). Como `AppNotification.recipient` é `string`, a comparação
 * é feita convertendo o id numérico para string, preservando o comportamento
 * original (`'123' === '123'` continua casando).
 */
import type { AppNotification } from '../types';

export type NotificationScope = 'personal' | 'system';

export function classifyScope(n: AppNotification, currentUserId: number | null): NotificationScope {
    if (n.scope) return n.scope;
    if (!n.recipient) return 'system';
    if (currentUserId !== null && String(currentUserId) === n.recipient) return 'personal';
    if (n.recipient === 'team' || n.recipient === 'all') return 'system';
    if (n.event === 'agent.action' || n.event === 'stock.low' || n.event === 'custom') return 'system';
    return 'system';
}