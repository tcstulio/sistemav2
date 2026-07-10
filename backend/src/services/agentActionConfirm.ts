/**
 * HITL de ação irreversível — infra genérica de "confirmar ação" (robô-de-negócio, plano §8.1).
 *
 * Quando o dial (`actionGovernance.irreversibleRequiresApproval`) está ligado, as tools de EFEITO
 * DIRETO (validate_*) não executam na hora: o agente devolve um deeplink `/confirm-action?token=…`
 * com um token ASSINADO (HMAC, TTL) descrevendo a ação. O humano revisa numa tela e confirma; o
 * backend então executa **com a chave DO PRÓPRIO USUÁRIO** (RBAC real do Dolibarr) — o que também
 * resolve o problema da chave-master no caminho confirmado. Anti-replay por `jti`.
 *
 * Reusa o `deeplinkToken` (mesmo mecanismo dos `prepare_*`). Registry define o conjunto de ações
 * HITL-executáveis (v1 = validate_*); novas ações (ex.: send_whatsapp) entram aqui, não ad-hoc.
 */
import { signDeeplink, verifyDeeplink } from '../utils/deeplinkToken';
import { dolibarrService } from './dolibarrService';
import { createLogger } from '../utils/logger';

const log = createLogger('AgentActionConfirm');

const CONFIRM_KIND = 'confirm_action';
const TOKEN_TTL_SECONDS = 1800; // 30 min (mesmo dos prepare_*)

export interface ConfirmDescription {
    title: string;
    summary: string;
    entityType: string;
    entityId: string;
}

interface ConfirmableAction {
    describe(args: any): ConfirmDescription;
    execute(args: any, userKey: string): Promise<any>;
}

/** Extrai o id da entidade dos args do validate_* (aceita invoice_id/order_id/proposal_id/id). */
function idOf(args: any): string {
    return String(args?.invoice_id ?? args?.order_id ?? args?.proposal_id ?? args?.id ?? '').trim();
}

/** Registry de ações HITL-executáveis. v1 = validate_* (efeito irreversível, RBAC-limpo com a chave do user). */
const REGISTRY: Record<string, ConfirmableAction> = {
    validate_invoice: {
        describe: (a) => ({ title: 'Validar fatura', summary: `Validar (confirmar) a fatura #${idOf(a)}. Efeito irreversível — atribui numeração fiscal.`, entityType: 'invoice', entityId: idOf(a) }),
        execute: (a, key) => dolibarrService.validateInvoice(idOf(a), key),
    },
    validate_order: {
        describe: (a) => ({ title: 'Validar pedido', summary: `Validar (confirmar) o pedido #${idOf(a)}. Efeito irreversível.`, entityType: 'order', entityId: idOf(a) }),
        execute: (a, key) => dolibarrService.validateOrder(idOf(a), key),
    },
    validate_proposal: {
        describe: (a) => ({ title: 'Validar proposta', summary: `Validar (confirmar) a proposta #${idOf(a)}. Efeito irreversível.`, entityType: 'proposal', entityId: idOf(a) }),
        execute: (a, key) => dolibarrService.validateProposal(idOf(a), key),
    },
};

/** True se a ação é confirmável (está no registry) — o gate só desvia estas. */
export function isConfirmable(action: string): boolean {
    return Object.prototype.hasOwnProperty.call(REGISTRY, action);
}

// Anti-replay: jti consumidos (memória, expira junto do token). v1 = validate (~idempotente); ao
// adicionar send_whatsapp (não-idempotente) migrar p/ store persistido.
const consumed = new Map<string, number>();
function cleanupConsumed(now: number) {
    for (const [j, exp] of consumed) if (exp < now) consumed.delete(j);
}

/** Gera o deeplink de confirmação para uma ação. */
export function buildConfirmDeeplink(action: string, args: any, actorUserId: string): string {
    const jti = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const token = signDeeplink(CONFIRM_KIND, { action, args, actorUserId, jti }, TOKEN_TTL_SECONDS);
    return `/confirm-action?token=${encodeURIComponent(token)}`;
}

/** Verifica o token e devolve a descrição legível (SEM executar) — alimenta a tela de confirmação. */
export function describeConfirm(token: string): { ok: true; action: string; actorUserId: string } & ConfirmDescription | { ok: false; error: string } {
    const p = verifyDeeplink<{ action: string; args: any; actorUserId: string; jti: string }>(token, CONFIRM_KIND);
    if (!p) return { ok: false, error: 'Confirmação inválida ou expirada.' };
    const { action, args, actorUserId } = p.data;
    if (!isConfirmable(action)) return { ok: false, error: `Ação "${action}" não é confirmável.` };
    return { ok: true, action, actorUserId, ...REGISTRY[action].describe(args) };
}

/** Verifica + anti-replay + EXECUTA com a chave do usuário (RBAC real). */
export async function executeConfirm(token: string, userKey: string): Promise<{ ok: true; action: string; result: any } | { ok: false; error: string }> {
    const p = verifyDeeplink<{ action: string; args: any; actorUserId: string; jti: string }>(token, CONFIRM_KIND);
    if (!p) return { ok: false, error: 'Confirmação inválida ou expirada.' };
    const { action, args, jti } = p.data;
    if (!isConfirmable(action)) return { ok: false, error: `Ação "${action}" não é confirmável.` };

    const now = Math.floor(Date.now() / 1000);
    cleanupConsumed(now);
    if (consumed.has(jti)) return { ok: false, error: 'Esta confirmação já foi usada.' };
    consumed.set(jti, p.exp); // marca ANTES de executar (evita corrida de duplo-clique)

    try {
        const result = await REGISTRY[action].execute(args, userKey);
        log.info(`Ação confirmada executada: ${action} (jti=${jti})`);
        return { ok: true, action, result };
    } catch (e: any) {
        consumed.delete(jti); // erro real (ex.: RBAC 403, HTTP 5xx) → libera p/ nova tentativa
        return { ok: false, error: e?.message || String(e) };
    }
}
