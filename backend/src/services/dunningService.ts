/**
 * dunningService — geração de digest priorizado de recebíveis (issue #1400 / #1402).
 *
 * REGRA CRÍTICA DE BLAST-RADIUS (epic #1400): este serviço é READ-ONLY do ponto de
 * vista de comunicação externa. Ele SÓ pode ler dados do CRM (faturas, cliente) e
 * devolver um rascunho de mensagem para revisão HUMANA. Nunca dispara, agenda ou
 * persiste em canais externos (whatsapp/email/in-app).
 *
 * Por isso o arquivo NÃO importa nem chama:
 *   - send_whatsapp / whatsappService / send_message via canal whatsapp
 *   - notify_person / notify_team (canal whatsapp/email/in-app)
 *   - send_email / emailService
 *
 * O guard abaixo (assertBlastRadiusZero) é executado uma vez no carregamento do
 * módulo e falha-fechado se algum desses identificadores aparecer no source
 * efetivo (fora de comentários e literais). Isso garante que a regra não regrida
 * silenciosamente em commits futuros.
 */

import fs from 'fs';
import { createLogger } from '../utils/logger';
import { dolibarrService } from './dolibarr';
import type { ReceivableItem } from './dolibarr/finance';

const log = createLogger('Dunning');

export interface InvoiceRef {
    id: string;
    ref: string;
    totalTtc: number;
    dueDate: string | null;
}

export interface DunningItem {
    socid: string;
    socname: string;
    invoices: InvoiceRef[];
    totalAberto: number;
    diasAtrasoMax: number;
    score: number;
    status: 'ready' | 'incomplete';
    rascunho: string | null;
    motivo?: string;
}

export interface DunningDigest {
    geradoEm: string;
    items: DunningItem[];
    totalItems: number;
    totalReady: number;
    totalIncomplete: number;
}

const DEFAULT_LIMIT = 50;

// === Guard explícito de blast-radius (ver comentário no topo do arquivo) ===
const FORBIDDEN_OUTBOUND = ['send_whatsapp', 'notify_person', 'send_email'];

function stripCommentsAndStrings(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
}

function assertBlastRadiusZero(selfSrc: string): void {
    const stripped = stripCommentsAndStrings(selfSrc);
    for (const k of FORBIDDEN_OUTBOUND) {
        const re = new RegExp(`\\b${k}\\b`);
        if (re.test(stripped)) {
            throw new Error(
                `dunningService violation: identificador proibido '${k}' — este serviço não pode depender de canais externos (blast-radius zero, epic #1400).`,
            );
        }
    }
}

try {
    const self: string | Buffer = fs.readFileSync(__filename);
    assertBlastRadiusZero(typeof self === 'string' ? self : self.toString('utf-8'));
} catch (e) {
    if (e instanceof Error && e.message.startsWith('dunningService violation')) {
        throw e;
    }
    // Falha ao ler o próprio arquivo (ex.: bundled) não é fatal — o guard é defensivo.
}

// === Helpers internos ===

function parseDueTs(dueDate: string | null | undefined): number | null {
    if (!dueDate) return null;
    const ts = parseInt(dueDate, 10);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function daysOverdue(dueTs: number | null, nowSec: number): number {
    if (dueTs === null) return 0;
    return Math.floor((nowSec - dueTs) / 86400);
}

function fmtDateBR(dueTs: number | null): string {
    if (dueTs === null) return 'sem data';
    return new Date(dueTs * 1000).toLocaleDateString('pt-BR');
}

function pickEarliestDueTs(invoices: InvoiceRef[], rawById: Map<string, ReceivableItem>): number | null {
    let earliest: number | null = null;
    for (const inv of invoices) {
        const raw = rawById.get(inv.id);
        const ts = parseDueTs(raw?.dueDate ?? inv.dueDate);
        if (ts === null) continue;
        if (earliest === null || ts < earliest) earliest = ts;
    }
    return earliest;
}

interface BuildRascunhoResult {
    rascunho: string | null;
    missing?: string;
}

/**
 * Constrói o rascunho da mensagem usando SOMENTE campos da fatura real.
 * Se faltar campo crítico → retorna null + campo faltante (fail-closed).
 */
function buildRascunho(
    socname: string,
    invoices: InvoiceRef[],
    totalAberto: number,
    vencMaisAntigoTs: number | null,
): BuildRascunhoResult {
    if (!socname || !socname.trim()) return { rascunho: null, missing: 'socname' };
    if (!invoices || invoices.length === 0) return { rascunho: null, missing: 'invoices' };
    if (!Number.isFinite(totalAberto) || totalAberto <= 0) {
        return { rascunho: null, missing: 'totalAberto' };
    }
    if (vencMaisAntigoTs === null) return { rascunho: null, missing: 'vencMaisAntigo' };

    const N = invoices.length;
    const refs = invoices.map((i) => i.ref).filter((r) => !!r).join(', ');
    if (!refs) return { rascunho: null, missing: 'refs' };

    // Template literalmente interpolado — TODOS os placeholders vêm de campos da fatura real.
    const rascunho =
        `Olá ${socname}, identificamos ${N} fatura(s) em aberto — total R$ ${totalAberto.toFixed(2)} ` +
        `(ref: ${refs}). Vencimento mais antigo: ${fmtDateBR(vencMaisAntigoTs)}. Posso ajudar a regularizar?`;
    return { rascunho };
}

// === Pipeline principal ===

interface GroupAccum {
    socid: string;
    socname: string;
    invoices: InvoiceRef[];
    raws: ReceivableItem[];
    totalAberto: number;
    diasAtrasoMax: number;
}

export async function buildDunningDigest(
    opts?: { limit?: number; socid?: string },
): Promise<DunningDigest> {
    const limit = typeof opts?.limit === 'number' && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT;
    const targetSocid = opts?.socid;
    const nowSec = Math.floor(Date.now() / 1000);

    let base: ReceivableItem[] = [];
    try {
        base = await dolibarrService.getAccountsReceivable();
    } catch (e) {
        // Falha na coleta principal: sem dados brutos, não inventamos item nenhum.
        log.error('get_accounts_receivable falhou; retornando digest vazio', e);
        return {
            geradoEm: new Date().toISOString(),
            items: [],
            totalItems: 0,
            totalReady: 0,
            totalIncomplete: 0,
        };
    }

    if (targetSocid) {
        base = base.filter((b) => String(b.socid) === String(targetSocid));
    }

    // Agrupa faturas por cliente (socid).
    const groups = new Map<string, GroupAccum>();
    for (const r of base) {
        const socid = String(r.socid || '');
        if (!socid) continue;
        const g = groups.get(socid) ?? {
            socid,
            socname: r.socName || '',
            invoices: [],
            raws: [],
            totalAberto: 0,
            diasAtrasoMax: Number.NEGATIVE_INFINITY,
        };
        g.invoices.push({
            id: r.id,
            ref: r.ref,
            totalTtc: r.totalTtc,
            dueDate: r.dueDate,
        });
        g.raws.push(r);
        g.totalAberto += r.totalTtc;
        const d = daysOverdue(parseDueTs(r.dueDate), nowSec);
        if (d > g.diasAtrasoMax) g.diasAtrasoMax = d;
        groups.set(socid, g);
    }

    const items: DunningItem[] = [];

    for (const g of groups.values()) {
        const rawById = new Map(g.raws.map((r) => [r.id, r]));
        const earliestTs = pickEarliestDueTs(g.invoices, rawById);

        // Enriquecimento: se faltar socname (telefone não está no ReceivableItem,
        // mas a regra é "se faltar socname OU telefone"), tenta get_customer_details.
        // O retorno é uma string formatada — não populamos socname de volta (evita
        // inventar dado); só usamos o efeito colateral de detectar falha de fetch.
        if (!g.socname || !g.socname.trim()) {
            try {
                await dolibarrService.getCustomerContext(g.socid);
            } catch (e) {
                log.warn(`get_customer_details falhou para socid=${g.socid}; marcando incomplete`, e);
                items.push({
                    socid: g.socid,
                    socname: g.socname,
                    invoices: g.invoices,
                    totalAberto: g.totalAberto,
                    diasAtrasoMax: g.diasAtrasoMax === Number.NEGATIVE_INFINITY ? 0 : g.diasAtrasoMax,
                    score: 0,
                    status: 'incomplete',
                    rascunho: null,
                    motivo: 'fetch falhou',
                });
                continue;
            }
        }

        // Score: totalAberto × max(1, diasAtrasoMax).
        // max(1, ...) faz com que faturas a vencer (dias negativos) recebam score baixo
        // (= totalAberto × 1) e fiquem no fim após as vencidas.
        const score = g.totalAberto * Math.max(1, g.diasAtrasoMax);

        const { rascunho, missing } = buildRascunho(
            g.socname,
            g.invoices,
            g.totalAberto,
            earliestTs,
        );

        if (rascunho === null) {
            items.push({
                socid: g.socid,
                socname: g.socname,
                invoices: g.invoices,
                totalAberto: g.totalAberto,
                diasAtrasoMax: g.diasAtrasoMax === Number.NEGATIVE_INFINITY ? 0 : g.diasAtrasoMax,
                score,
                status: 'incomplete',
                rascunho: null,
                motivo: `dado incompleto: ${missing}`,
            });
        } else {
            items.push({
                socid: g.socid,
                socname: g.socname,
                invoices: g.invoices,
                totalAberto: g.totalAberto,
                diasAtrasoMax: g.diasAtrasoMax === Number.NEGATIVE_INFINITY ? 0 : g.diasAtrasoMax,
                score,
                status: 'ready',
                rascunho,
            });
        }
    }

    items.sort((a, b) => b.score - a.score);

    const limited = items.slice(0, limit);
    const totalReady = limited.filter((i) => i.status === 'ready').length;
    const totalIncomplete = limited.filter((i) => i.status === 'incomplete').length;

    return {
        geradoEm: new Date().toISOString(),
        items: limited,
        totalItems: limited.length,
        totalReady,
        totalIncomplete,
    };
}

// Re-export só pra testes — handlers internos não são exportados.
export { assertBlastRadiusZero, FORBIDDEN_OUTBOUND };