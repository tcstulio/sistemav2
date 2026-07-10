/**
 * Resolve o celular (WhatsApp) de um usuário Dolibarr.
 *
 * O Dolibarr às vezes expõe o mesmo número em dois campos distintos:
 *   - `phone_mobile` -> campo de LEITURA retornado por /users/info, /users/:id, etc.
 *   - `user_mobile`  -> campo de ESCRITA aceito pelo PUT /users/:id (e por vezes
 *                       também retornado em listagens).
 * Em muitos payloads só um deles vem preenchido, daí a regra de fallback.
 *
 * Centralizamos essa regra aqui para evitar duplicá-la (issue #1003) — antes ela
 * estava espalhada em 4 pontos do código, inclusive com ordem invertida em um
 * deles (mapUser priorizava user_mobile sobre phone_mobile).
 *
 * Prioridade: phone_mobile -> user_mobile. Retorna undefined quando ausente/vazio.
 */
export function resolveUserMobile(
    user: { phone_mobile?: unknown; user_mobile?: unknown } | null | undefined,
): string | undefined {
    if (!user) return undefined;
    const raw = user.phone_mobile || user.user_mobile;
    if (raw === undefined || raw === null) return undefined;
    const trimmed = String(raw).trim();
    return trimmed || undefined;
}
