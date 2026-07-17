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
import fs from 'fs';
import path from 'path';
import { signDeeplink, verifyDeeplink } from '../utils/deeplinkToken';
import { dolibarrService } from './dolibarrService';
import { channelRouter } from './channelRouter';
import { uiConfigService } from './uiConfigService';
import { getWhatsappAllowlist, whatsappDestinationAllowed } from '../utils/actionGuards';
import { atomicWriteSync } from '../utils/atomicWrite';
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

/** Registry de ações HITL-executáveis: validate_* (RBAC com a chave do user) + send_whatsapp (Fase 2). */
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
    // Exclui uma proposta — mas SÓ se for RASCUNHO. O Dolibarr NÃO tem defesa-em-profundidade
    // (verificado: DELETE de uma proposta validada retorna 200 "deleted"); este guard é a ÚNICA
    // proteção contra apagar um documento real. WHITELIST estrita: deleta só se o status for
    // provadamente 0 (rascunho). `String(status) !== '0'` recusa 1/"1"/2/null/undefined/''/NaN
    // (NÃO usar `!status` nem `Number(status)!==0`: `!1===false` e `Number(null)===0` deletariam
    // uma não-rascunho). Fetch falho / proposta ausente ⇒ `p` null ⇒ recusa (fail-closed).
    delete_proposal: {
        describe: (a) => ({ title: 'Excluir rascunho de proposta', summary: `Excluir o RASCUNHO da proposta #${idOf(a)}. Efeito irreversível — só rascunhos (não validadas).`, entityType: 'proposal', entityId: idOf(a) }),
        execute: async (a, key) => {
            const id = idOf(a);
            const p = await dolibarrService.getProposal(id);
            if (String(p?.status) !== '0') {
                throw new Error(`Só rascunhos podem ser excluídos pelo agente. A proposta #${id} não é um rascunho (status=${p?.status ?? 'desconhecido'}) — exclua manualmente se realmente necessário.`);
            }
            return dolibarrService.deleteProposal(id, key);
        },
    },
    // Fase 2 (governança): comunicação externa — mensagem enviada não se desfaz. O catálogo
    // (actionCatalog.ts) já marcava requiresHITL; agora o gate consegue de fato desviar.
    // Diferente dos validate_*, NÃO usa chave Dolibarr (envio sai pela sessão do sistema via
    // channelRouter) — a autoria do humano fica no actorUserId do token; `key` é ignorada.
    send_whatsapp: {
        describe: (a) => {
            const phone = String(a?.phone || '').replace(/\D/g, '');
            const msg = String(a?.message || '').trim();
            return {
                title: 'Enviar WhatsApp',
                summary: `Enviar WhatsApp para ${phone || '(sem destino)'}: "${msg.substring(0, 200)}${msg.length > 200 ? '…' : ''}". Efeito irreversível — a mensagem não pode ser desfeita após o envio.`,
                entityType: 'whatsapp',
                entityId: phone,
            };
        },
        execute: async (a) => {
            const phone = String(a?.phone || '').replace(/\D/g, '');
            const msg = String(a?.message || '').trim();
            if (!phone) throw new Error('Destino (phone) ausente na confirmação.');
            if (!msg) throw new Error('Mensagem vazia na confirmação.');
            // Re-checa a allowlist NO MOMENTO da confirmação (não só quando o token foi gerado):
            // entre o deeplink e o clique passam até 30min — o admin pode ter restringido o destino.
            if (!whatsappDestinationAllowed(phone, getWhatsappAllowlist(uiConfigService.get()))) {
                throw new Error(`Destino ${phone} não está mais na allowlist de WhatsApp configurada pelo admin.`);
            }
            const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
            const result = await channelRouter.sendWhatsApp(chatId, msg);
            if (!result.success) throw new Error(result.error || 'Falha ao enviar WhatsApp.');
            return { sentTo: phone, preview: msg.substring(0, 80) };
        },
    },
};

/** True se a ação é confirmável (está no registry) — o gate só desvia estas. */
export function isConfirmable(action: string): boolean {
    return Object.prototype.hasOwnProperty.call(REGISTRY, action);
}

// Anti-replay: jti consumidos, PERSISTIDOS em disco (Fase 1 do roadmap de governança).
// Em memória (versão anterior) um restart do backend dentro do TTL de 30min esquecia os jti
// consumidos — o mesmo deeplink podia re-executar uma ação irreversível. O volume é baixíssimo
// (confirmações humanas), então arquivo JSON + atomicWriteSync (mesmo padrão do approvalService)
// basta; entradas expiram junto do token (exp do HMAC), então o arquivo se auto-limita.
const CONSUMED_PATH = path.join(__dirname, '../../data/consumed_confirmations.json');
const consumed = new Map<string, number>();

function loadConsumed(): void {
    try {
        if (!fs.existsSync(CONSUMED_PATH)) return;
        const raw = JSON.parse(fs.readFileSync(CONSUMED_PATH, 'utf-8'));
        const now = Math.floor(Date.now() / 1000);
        if (raw && typeof raw === 'object') {
            for (const [jti, exp] of Object.entries(raw)) {
                if (typeof exp === 'number' && exp >= now) consumed.set(jti, exp);
            }
        }
        log.info(`Anti-replay: ${consumed.size} confirmação(ões) consumida(s) carregada(s) do disco.`);
    } catch (e: any) {
        // Arquivo corrompido → começa vazio, mas AVISA: a janela de replay reabre até os tokens expirarem.
        log.error(`Anti-replay: falha ao carregar ${CONSUMED_PATH} (${e?.message}) — iniciando vazio.`);
    }
}

function persistConsumed(): void {
    try {
        atomicWriteSync(CONSUMED_PATH, Object.fromEntries(consumed));
    } catch (e: any) {
        // Não-fatal por design: o Map em memória segue valendo p/ ESTE processo; o risco volta a
        // ser só o de restart (estado anterior). Logar alto para não virar falha silenciosa.
        log.error(`Anti-replay: falha ao persistir ${CONSUMED_PATH}: ${e?.message}`);
    }
}

function cleanupConsumed(now: number) {
    let dirty = false;
    for (const [j, exp] of consumed) if (exp < now) { consumed.delete(j); dirty = true; }
    if (dirty) persistConsumed();
}

loadConsumed();

/** SÓ TESTES: zera o estado em memória e recarrega do disco — simula um restart do processo. */
export function __reloadConsumedForTests(): void {
    consumed.clear();
    loadConsumed();
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

/**
 * Verifica + ATOR + anti-replay + EXECUTA com a chave do usuário (RBAC real).
 *
 * `sessionUserId` = id do usuário LOGADO que está confirmando (da sessão, não do token). O token
 * carrega `actorUserId` = para QUEM o agente emitiu a confirmação. Exigir a igualdade fecha o furo
 * do "bearer": um deeplink emitido para o funcionário X, se vazar/for encaminhado, NÃO executa nas
 * mãos de outro logado Y — mesmo que Y tenha permissão. O fluxo real (X pede no WhatsApp → confirma
 * logado como X no webapp; Y no webapp → emitido para Y) tem sempre ator == logado, então não quebra.
 */
export async function executeConfirm(token: string, sessionUserId: string, userKey: string): Promise<{ ok: true; action: string; result: any } | { ok: false; error: string }> {
    const p = verifyDeeplink<{ action: string; args: any; actorUserId: string; jti: string }>(token, CONFIRM_KIND);
    if (!p) return { ok: false, error: 'Confirmação inválida ou expirada.' };
    const { action, args, jti, actorUserId } = p.data;
    if (!isConfirmable(action)) return { ok: false, error: `Ação "${action}" não é confirmável.` };

    // D (actor-binding, red-team 2026-07-17): a confirmação só executa nas mãos do ator para quem
    // foi emitida. Fail-closed: token sem ator (não deveria ocorrer — o gate HITL só é atingido com
    // userId) também é recusado. NÃO consome o jti aqui — o ator legítimo ainda pode usar o link.
    if (!actorUserId || String(actorUserId) !== String(sessionUserId || '')) {
        log.warn(`Confirmação recusada: ator do token (${actorUserId || 'vazio'}) ≠ usuário logado (${sessionUserId || 'anônimo'}) — jti=${jti}.`);
        return { ok: false, error: 'Esta confirmação foi emitida para outro usuário. Peça ao agente um novo link com a sua conta.' };
    }

    const now = Math.floor(Date.now() / 1000);
    cleanupConsumed(now);
    if (consumed.has(jti)) return { ok: false, error: 'Esta confirmação já foi usada.' };
    consumed.set(jti, p.exp); // marca ANTES de executar (evita corrida de duplo-clique)
    persistConsumed();        // ... e PERSISTE antes de executar: crash pós-execução não reabre o replay

    try {
        const result = await REGISTRY[action].execute(args, userKey);
        log.info(`Ação confirmada executada: ${action} (jti=${jti})`);
        return { ok: true, action, result };
    } catch (e: any) {
        consumed.delete(jti); // erro real (ex.: RBAC 403, HTTP 5xx) → libera p/ nova tentativa
        persistConsumed();
        return { ok: false, error: e?.message || String(e) };
    }
}
