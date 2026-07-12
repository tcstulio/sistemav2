import { getPool } from '../db/pool';
import { createLogger } from '../utils/logger';

const log = createLogger('ChatStore');

// Store Postgres das mensagens do chat (#1372). Persiste o histórico por sessão
// (sessao_id) com vínculo lógico ao job do sessionQueue (job_id). Espelha o
// conteúdo do chatSessionService (JSON local) mas em storage durável do schema
// do Dolibarr/Postgres, permitindo auditoria, busca e dashboards que o JSON
// local não atende.
//
// Convenções:
//   - tool_calls é JSONB (Postgres valida JSON); null quando não há tool-calls.
//   - job_status é NULLABLE — só preenchido quando há job_id; CHECK garante os
//     valores válidos no banco (defesa em profundidade, replicado no TS).
//   - listMessages ordena por (ts ASC, id ASC) para empates estáveis em inserts
//     no mesmo instante de relógio (granularidade de NOW() é 1µs mas não confiável
//     sob concorrência); o índice chat_messages_sessao_ts_idx cobre a query.

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export type ChatJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface ChatMessageRecord {
    id: string;
    sessao_id: string;
    role: ChatRole;
    content: string;
    tool_calls: unknown | null;
    job_id: string | null;
    job_status: ChatJobStatus | null;
    ts: string;
}

export interface InsertMessageInput {
    sessao_id: string;
    role: ChatRole;
    content: string;
    tool_calls?: unknown | null;
    job_id?: string | null;
    job_status?: ChatJobStatus | null;
}

interface ChatMessageRow {
    id: string | number;
    sessao_id: string;
    role: string;
    content: string;
    tool_calls: unknown;
    job_id: string | null;
    job_status: string | null;
    ts: Date | string;
}

function mapRow(row: ChatMessageRow): ChatMessageRecord {
    return {
        id: String(row.id),
        sessao_id: row.sessao_id,
        role: row.role as ChatRole,
        content: row.content,
        tool_calls: row.tool_calls ?? null,
        job_id: row.job_id ?? null,
        job_status: (row.job_status as ChatJobStatus | null) ?? null,
        ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
    };
}

/**
 * Insere uma mensagem no histórico da sessão. Retorna o registro completo (com
 * `id` e `ts` gerados pelo banco). Lança em erro do pool/SQL — o caller decide
 * se isola (try/catch) ou propaga.
 */
export async function insertMessage(input: InsertMessageInput): Promise<ChatMessageRecord> {
    const pool = getPool();
    const toolCallsJson =
        input.tool_calls === undefined || input.tool_calls === null
            ? null
            : JSON.stringify(input.tool_calls);
    const result = await pool.query<ChatMessageRow>(
        `INSERT INTO chat_messages
            (sessao_id, role, content, tool_calls, job_id, job_status)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         RETURNING id, sessao_id, role, content, tool_calls, job_id, job_status, ts`,
        [
            input.sessao_id,
            input.role,
            input.content,
            toolCallsJson,
            input.job_id ?? null,
            input.job_status ?? null,
        ],
    );
    const row = result.rows[0];
    if (!row) {
        // Postgres sempre devolve a linha inserida via RETURNING; esta guarda existe
        // para satisfazer o type-checker (result.rows é unknown[] sem narrowing).
        throw new Error('insertMessage: RETURNING não devolveu a linha inserida.');
    }
    return mapRow(row);
}

/**
 * Lista as mensagens da sessão em ordem cronológica. Retorna array vazio quando a
 * sessão não tem mensagens (ou não existe) — caller distingue via getSession().
 */
export async function listMessages(sessaoId: string): Promise<ChatMessageRecord[]> {
    const pool = getPool();
    const result = await pool.query<ChatMessageRow>(
        `SELECT id, sessao_id, role, content, tool_calls, job_id, job_status, ts
           FROM chat_messages
          WHERE sessao_id = $1
          ORDER BY ts ASC, id ASC`,
        [sessaoId],
    );
    return result.rows.map(mapRow);
}

/**
 * Atualiza o `job_status` de TODAS as mensagens vinculadas a um job_id. Usado
 * pelo listener do sessionQueue para refletir mudanças de estado (running → done
 * → error). Retorna o número de linhas afetadas — 0 é válido (job_id sem msgs
 * vinculadas ainda não persistidas; não é erro).
 */
export async function updateJobStatus(
    jobId: string,
    status: ChatJobStatus,
): Promise<number> {
    if (!jobId) {
        log.warn('updateJobStatus chamado com jobId vazio — nada a fazer.');
        return 0;
    }
    const pool = getPool();
    const result = await pool.query(
        `UPDATE chat_messages
            SET job_status = $1
          WHERE job_id = $2`,
        [status, jobId],
    );
    return result.rowCount ?? 0;
}