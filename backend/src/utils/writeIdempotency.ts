/**
 * Idempotência de ESCRITA do agente — garante que uma tool com efeito real (write/externo) executa
 * NO MÁXIMO UMA VEZ por "turno" lógico, mesmo que a cadeia do agente seja re-invocada.
 *
 * Motivação (red-team 2026-07-17, bug PROVADO com oráculo): o `retryWithBackoff` do botService
 * re-invoca `generateReply` DO ZERO quando ela lança DEPOIS de uma escrita já ter rodado (ex.: 429
 * na iteração seguinte). Como `seenToolCalls`/`mutantToolRan` são LOCAIS a cada invocação, a mesma
 * escrita (validate_invoice, create_*, send_whatsapp…) rodava 1× por tentativa → fatura/validação
 * DUPLICADA. Além do retry, o mesmo furo aparece na re-emissão de evento do whatsapp-web.js e num
 * fallback entre providers.
 *
 * A defesa é uma chave natural ESTÁVEL entre todas essas re-execuções: o `turnId`. No WhatsApp ele é
 * o `msg.id._serialized` (o mesmo em todas as tentativas do retry, na re-emissão e após restart). Por
 * isso o store é PERSISTIDO (resiste a restart) — mesmo padrão do anti-replay de `agentActionConfirm`.
 *
 * NÃO substitui os gates de permissão/HITL: roda DEPOIS deles, envolvendo só o despacho real.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from './atomicWrite';
import { createLogger } from './logger';

const log = createLogger('WriteIdempotency');

// TTL da entrada. Cobre com folga a janela de retry (segundos) e de re-emissão de evento (minutos),
// sem crescer o arquivo indefinidamente. Um turno legítimo REPETIDO depois disso gera uma chave nova
// (turnId diferente = msg.id diferente), então nada é bloqueado indevidamente.
const TTL_MS = 60 * 60 * 1000; // 1h
const STORE_PATH = path.join(__dirname, '../../data/write_idempotency.json');

interface Entry { result: string; exp: number }
const store = new Map<string, Entry>();

/** Serialização estável de args (chaves ordenadas) — a MESMA chamada gera a MESMA chave. */
function stableStringify(v: any): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
    const keys = Object.keys(v).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** Chave determinística de uma escrita: (turno, ator, tool, args). Curta (sha256) e estável. */
export function writeIdempotencyKey(turnId: string, actor: string, tool: string, args: any): string {
    const raw = `${turnId}|${actor}|${tool}|${stableStringify(args ?? {})}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function load(): void {
    try {
        if (!fs.existsSync(STORE_PATH)) return;
        const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
        const now = Date.now();
        if (raw && typeof raw === 'object') {
            for (const [k, e] of Object.entries(raw)) {
                const entry = e as Entry;
                if (entry && typeof entry.exp === 'number' && entry.exp > now && typeof entry.result === 'string') {
                    store.set(k, entry);
                }
            }
        }
        if (store.size) log.info(`Idempotência: ${store.size} escrita(s) recente(s) carregada(s) do disco.`);
    } catch (e: any) {
        // Corrompido → começa vazio, mas AVISA: a janela de re-execução reabre até as entradas expirarem.
        log.error(`Idempotência: falha ao carregar ${STORE_PATH} (${e?.message}) — iniciando vazio.`);
    }
}

function persist(): void {
    try {
        atomicWriteSync(STORE_PATH, Object.fromEntries(store));
    } catch (e: any) {
        // Não-fatal: o Map em memória segue valendo p/ ESTE processo; o risco volta a ser só o de restart.
        log.error(`Idempotência: falha ao persistir ${STORE_PATH}: ${e?.message}`);
    }
}

function cleanup(now: number): void {
    let dirty = false;
    for (const [k, e] of store) if (e.exp <= now) { store.delete(k); dirty = true; }
    if (dirty) persist();
}

/** Resultado já registrado para esta chave (dentro do TTL), ou undefined. */
export function getIdempotentWrite(key: string): string | undefined {
    const now = Date.now();
    cleanup(now);
    const e = store.get(key);
    return e && e.exp > now ? e.result : undefined;
}

/** Registra o resultado de uma escrita bem-sucedida sob a chave. Persiste. */
export function rememberWrite(key: string, result: string): void {
    store.set(key, { result, exp: Date.now() + TTL_MS });
    persist();
}

load();

/** SÓ TESTES: zera o estado em memória e recarrega do disco — simula um restart do processo. */
export function __reloadWriteIdempotencyForTests(): void {
    store.clear();
    load();
}

/** SÓ TESTES: limpa memória E disco. */
export function __clearWriteIdempotencyForTests(): void {
    store.clear();
    try { if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH); } catch { /* ignore */ }
}
