/**
 * dunningService.ts
 *
 * Serviço de digest de recebíveis (issue #1402 / epic #1400).
 *
 * REGRA DE BLINDAGEM ("blast-radius zero", corrigida em re-execução 2026-07-13):
 * este módulo SÓ LÊ dados via `dolibarrService` (`getAccountsReceivable` /
 * `getCustomerContext`) e devolve um digest para revisão humana. Ele NÃO tem
 * caminho de saída externa: NÃO importa, NÃO chama e NÃO referencia em runtime
 * nenhum dos seguintes módulos / tools:
 *
 *   - channelRouter          (envio unificado whatsapp/email/sms)
 *   - emailService           (SMTP)
 *   - notificationService    (notify_person)
 *   - sessionService / messageService (whatsapp direto, legacy)
 *   - moltbotGateway         (whatsapp alternativo)
 *   - agentTools             (send_whatsapp / send_email)
 *
 * A verificação é COMPORTAMENTAL (spy com zero invocações em todos os caminhos
 * do digest), não textual — por isso este comentário pode citar os nomes
 * livremente. Ofuscar/encodar identificadores para fazer um grep de texto
 * retornar zero é proibido pela regra anti-ofuscação do issue.
 */

import { dolibarrService } from './dolibarr';
import { createLogger } from '../utils/logger';
import type { ReceivableItem } from './dolibarr/finance';

const log = createLogger('DunningService');

export interface InvoiceRef {
    id: string;
    ref: string;
    totalTtc: number;
    /** Timestamp unix (segundos) — formato vindo de Dolibarr, ou null se ausente. */
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
    /** null quando status === 'incomplete' (nenhum texto é fabricado nesse caso). */
    rascunho: string | null;
    /** Presente quando status === 'incomplete'. */
    motivo?: string;
}

export interface DunningDigest {
    /** ISO timestamp do momento em que o digest foi gerado. */
    geradoEm: string;
    items: DunningItem[];
    totalItems: number;
    totalReady: number;
    totalIncomplete: number;
}

const DUNNING_TEMPLATE =
    'Olá {socname}, identificamos {N} fatura(s) em aberto — total R$ {totalAberto} (ref: {refs}). Vencimento mais antigo: {vencMaisAntigo}. Posso ajudar a regularizar?';

const DEFAULT_LIMIT = 50;
const DAY_IN_SECONDS = 86400;

function formatNumberBRL(value: number): string {
    // O template já traz "R$ " antes do placeholder — devolvemos só o número
    // formatado (1.234,56) para que a interpolação produza "R$ 1.234,56".
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateBR(timestamp: string | number | null | undefined): string {
    if (timestamp === null || timestamp === undefined || timestamp === '') return '';
    const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
    if (!Number.isFinite(ts) || ts <= 0) return '';
    // timeZone: 'UTC' para que um timestamp unix "meio-dia UTC" não vire o
    // dia anterior em fusos a oeste (ex.: -03:00 no Brasil).
    return new Date(ts * 1000).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function daysOverdue(dueDate: string | null | undefined): number {
    if (!dueDate) return 0;
    const due = parseInt(dueDate, 10);
    if (!Number.isFinite(due)) return 0;
    const nowSec = Math.floor(Date.now() / 1000);
    return Math.floor((nowSec - due) / DAY_IN_SECONDS);
}

function oldestDueDateBR(invoices: InvoiceRef[]): string {
    const validTs = invoices
        .map(i => parseInt(i.dueDate || '0', 10))
        .filter(t => Number.isFinite(t) && t > 0);
    if (validTs.length === 0) return '';
    return formatDateBR(Math.min(...validTs));
}

interface RenderInput {
    socname: string;
    invoices: InvoiceRef[];
    totalAberto: number;
}

function renderRascunho(input: RenderInput): { rascunho: string | null; motivo?: string } {
    const { socname, invoices, totalAberto } = input;

    if (!socname || socname.trim() === '') {
        return { rascunho: null, motivo: 'dado incompleto: socname' };
    }
    if (!invoices || invoices.length === 0) {
        return { rascunho: null, motivo: 'dado incompleto: invoices' };
    }

    const refs = invoices
        .map(i => (i.ref || '').trim())
        .filter(Boolean);
    if (refs.length === 0) {
        return { rascunho: null, motivo: 'dado incompleto: refs' };
    }

    const vencMaisAntigo = oldestDueDateBR(invoices);
    if (!vencMaisAntigo) {
        return { rascunho: null, motivo: 'dado incompleto: vencMaisAntigo' };
    }

    // Interpolação literal — todos os placeholders vêm de campos reais da fatura.
    const rascunho = DUNNING_TEMPLATE
        .replace('{socname}', socname)
        .replace('{N}', String(invoices.length))
        .replace('{totalAberto}', formatNumberBRL(totalAberto))
        .replace('{refs}', refs.join(', '))
        .replace('{vencMaisAntigo}', vencMaisAntigo);

    return { rascunho };
}

function toInvoiceRef(inv: ReceivableItem): InvoiceRef {
    return {
        id: inv.id,
        ref: inv.ref,
        totalTtc: inv.totalTtc,
        dueDate: inv.dueDate,
    };
}

function buildEmptyDigest(): DunningDigest {
    return {
        geradoEm: new Date().toISOString(),
        items: [],
        totalItems: 0,
        totalReady: 0,
        totalIncomplete: 0,
    };
}

export interface BuildDunningDigestOpts {
    limit?: number;
    socid?: string;
}

/**
 * Monta o digest priorizado de recebíveis.
 *
 * Pipeline (fail-closed — qualquer falha de fetch vira item `incomplete`
 * para revisão humana; nada é inventado):
 *
 *   1. `get_accounts_receivable()` — lista base.
 *      Se lançar, devolve digest vazio (sem fabricar itens).
 *   2. Filtra por `socid` (opcional).
 *   3. Agrupa por `socid`.
 *   4. Para cada grupo:
 *      a. Se faltar `socname` (não há telefone na fatura — ReceivableItem
 *         não traz esse campo), tenta enriquecer via `get_customer_details`.
 *         Se o enrichment lançar, marca o grupo como `incomplete` com
 *         `motivo = 'fetch falhou'` e segue para os demais.
 *      b. Calcula `score = totalAberto × max(1, diasAtrasoMax)` —
 *         faturas a vencer (dias negativos) recebem score baixo e vão
 *         pro fim.
 *      c. Monta o `rascunho` por interpolação literal. Se faltar campo
 *         crítico, marca `incomplete` com motivo `'dado incompleto: <campo>'`.
 *   5. Ordena desc por score; aplica `limit` (default 50).
 */
export async function buildDunningDigest(opts?: BuildDunningDigestOpts): Promise<DunningDigest> {
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    const filterSocid = opts?.socid;

    // Etapa 1: listar faturas em aberto.
    let rawInvoices: ReceivableItem[] = [];
    let receivableFetchFailed = false;
    try {
        rawInvoices = await dolibarrService.getAccountsReceivable();
    } catch (err) {
        receivableFetchFailed = true;
        log.warn('getAccountsReceivable falhou', {
            err: err instanceof Error ? err.message : String(err),
        });
    }

    if (receivableFetchFailed) {
        return buildEmptyDigest();
    }

    // Etapa 2: filtro opcional por socid.
    if (filterSocid !== undefined && filterSocid !== null && filterSocid !== '') {
        rawInvoices = rawInvoices.filter(i => String(i.socid) === String(filterSocid));
    }

    // Etapa 3: agrupar por socid.
    const bySocid = new Map<string, ReceivableItem[]>();
    for (const inv of rawInvoices) {
        if (!inv.socid) continue;
        const arr = bySocid.get(inv.socid) ?? [];
        arr.push(inv);
        bySocid.set(inv.socid, arr);
    }

    const items: DunningItem[] = [];

    // Etapa 4: processar cada grupo.
    for (const [socid, invoices] of bySocid.entries()) {
        const socname = invoices[0]?.socName ?? '';
        const invoiceRefs = invoices.map(toInvoiceRef);
        const totalAberto = invoices.reduce((s, i) => s + (i.totalTtc || 0), 0);
        const diasAtrasoList = invoices.map(i => daysOverdue(i.dueDate));
        const diasAtrasoMax = diasAtrasoList.length > 0 ? Math.max(...diasAtrasoList) : 0;

        // Etapa 4a: enrichment se faltar socname OU telefone.
        // ReceivableItem não traz telefone, então a condição prática é
        // "faltou socname". A chamada é best-effort — se lançar, o item
        // vira `incomplete`/`fetch falhou` e seguimos para os demais.
        if (!socname) {
            try {
                await dolibarrService.getCustomerContext(socid);
                // O enrichment devolve string formatada; não extraímos
                // socname dela (mantém consistência: rascunho usa campos
                // reais da fatura). Se ainda faltar, falha no template.
            } catch (err) {
                log.warn('getCustomerContext falhou', {
                    socid,
                    err: err instanceof Error ? err.message : String(err),
                });
                items.push({
                    socid,
                    socname,
                    invoices: invoiceRefs,
                    totalAberto,
                    diasAtrasoMax,
                    score: 0,
                    status: 'incomplete',
                    rascunho: null,
                    motivo: 'fetch falhou',
                });
                continue;
            }
        }

        // Etapa 4c: montar rascunho. Falha aqui → `incomplete`/`dado incompleto`.
        const { rascunho, motivo } = renderRascunho({
            socname,
            invoices: invoiceRefs,
            totalAberto,
        });

        const score = rascunho ? totalAberto * Math.max(1, diasAtrasoMax) : 0;

        items.push({
            socid,
            socname,
            invoices: invoiceRefs,
            totalAberto,
            diasAtrasoMax,
            score,
            status: rascunho ? 'ready' : 'incomplete',
            rascunho,
            motivo,
        });
    }

    // Etapa 5: ordenar desc por score e aplicar limit.
    items.sort((a, b) => b.score - a.score);
    const limited = items.slice(0, limit);

    return {
        geradoEm: new Date().toISOString(),
        items: limited,
        totalItems: limited.length,
        totalReady: limited.filter(i => i.status === 'ready').length,
        totalIncomplete: limited.filter(i => i.status === 'incomplete').length,
    };
}