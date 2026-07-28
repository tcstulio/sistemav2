import fs from 'fs';
import path from 'path';
import { createLogger } from './logger';

const log = createLogger('CrashHandler');

// backend/logs/crash.log  (este arquivo vive em backend/src/utils → ../../logs)
export const CRASH_LOG_PATH = path.resolve(__dirname, '../../logs/crash.log');

export type CrashKind = 'uncaughtException' | 'unhandledRejection';

function safeStringify(v: unknown): string {
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

/**
 * Formata uma entrada de crash de forma legível e determinística (pura — testável).
 * Aceita qualquer coisa como `err` (Error, string, objeto rejeitado, undefined).
 */
export function formatCrashEntry(kind: CrashKind, err: unknown, at: Date): string {
    const ts = at.toISOString();
    const e = err as { name?: string; message?: string; stack?: string } | null | undefined;
    const name = e?.name || (typeof err === 'string' ? 'Error' : err === undefined ? 'undefined' : typeof err);
    const message = e?.message ?? (typeof err === 'string' ? err : safeStringify(err));
    const stack = e?.stack || '(sem stack)';
    return [
        '='.repeat(72),
        `[${ts}] ${kind}: ${name}: ${message}`,
        stack,
        '',
    ].join('\n') + '\n';
}

/** Grava a entrada no arquivo de crash (best-effort, síncrono — nunca lança). */
export function appendCrashLog(entry: string): void {
    try {
        fs.mkdirSync(path.dirname(CRASH_LOG_PATH), { recursive: true });
        fs.appendFileSync(CRASH_LOG_PATH, entry, 'utf8');
    } catch {
        /* best-effort: um handler de crash não pode falhar por causa do log */
    }
}

let installed = false;

/**
 * Instala handlers globais que CAPTURAM a causa de um crash num arquivo
 * (backend/logs/crash.log) antes do processo morrer. #29 — nasceu do incidente de 20/07:
 * o backend crashou 19:48 e ficou ~2h fora porque o nodemon loga só no PRÓPRIO stdout
 * (que some depois), então a causa não foi capturada e o nodemon não respawnou.
 *
 * Política:
 * - `unhandledRejection`: LOGA e CONTINUA. Uma promise solta em um caminho periférico não deve
 *   derrubar o ERP inteiro (bot, schedulers, bancos). Nada é escondido — toda rejeição vai pro
 *   arquivo p/ triagem. Isto SOZINHO teria evitado o outage se a causa foi uma rejeição.
 * - `uncaughtException`: LOGA e SAI(1). Pós-uncaughtException o estado do processo é indefinido
 *   (guia do Node) — continuar é perigoso. Sair é o correto; o respawn automático é papel do
 *   process-manager (nodemon hoje espera troca de arquivo — follow-up separado).
 *
 * Idempotente: chamar 2x não registra handlers duplicados.
 */
export function installCrashHandlers(): void {
    if (installed) return;
    installed = true;

    process.on('unhandledRejection', (reason: unknown) => {
        appendCrashLog(formatCrashEntry('unhandledRejection', reason, new Date()));
        const msg = (reason as { message?: string } | null | undefined)?.message ?? String(reason);
        log.error(`unhandledRejection capturado (ver ${CRASH_LOG_PATH}) — continuando`, { reason: msg });
    });

    process.on('uncaughtException', (err: Error) => {
        appendCrashLog(formatCrashEntry('uncaughtException', err, new Date()));
        log.fatal(`uncaughtException capturado (ver ${CRASH_LOG_PATH}) — encerrando`, { message: err?.message });
        process.exit(1);
    });
}
