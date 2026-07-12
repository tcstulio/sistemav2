import { Pool, PoolConfig } from 'pg';
import { createLogger } from '../utils/logger';

const log = createLogger('DbPool');

// Pool de conexões Postgres para tabelas de runtime do agente (ex.: chat_messages).
// Singleton lazy: a primeira chamada cria o Pool; chamadas subsequentes reutilizam.
// Conexão via DATABASE_URL (string completa) ou PG* (host/port/etc). Quando nenhuma
// variável está definida (dev/CI sem DB), o módulo só é instanciado sob demanda —
// testes que mockam getPool nunca chegam a abrir o Pool real.

let pool: Pool | null = null;

function resolveConfig(): PoolConfig {
    const url = process.env.DATABASE_URL;
    if (url && url.trim().length > 0) {
        return { connectionString: url.trim() };
    }
    const host = process.env.PGHOST;
    if (host && host.trim().length > 0) {
        return {
            host: host.trim(),
            port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
            database: process.env.PGDATABASE || undefined,
            user: process.env.PGUSER || undefined,
            password: process.env.PGPASSWORD || undefined,
        };
    }
    // Fallback explícito: 127.0.0.1:5432, db=postgres, sem auth. Logs warn para o
    // operador não ficar no escuro se o deploy esquecer DATABASE_URL/PGHOST.
    log.warn('DATABASE_URL/PGHOST não definidos — usando fallback 127.0.0.1:5432 (apenas dev local).');
    return { host: '127.0.0.1', port: 5432, database: process.env.PGDATABASE || 'postgres' };
}

export function getPool(): Pool {
    if (!pool) {
        pool = new Pool(resolveConfig());
    }
    return pool;
}

export async function closePool(): Promise<void> {
    if (pool) {
        const current = pool;
        pool = null;
        await current.end();
    }
}

/** Reseta o singleton (uso em testes que re-apontam o pool). */
export function __resetPoolForTests(): void {
    pool = null;
}