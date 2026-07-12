import type { PoolClient } from 'pg';

// Migration UP/DOWN da tabela chat_messages (#1372). Persistência durável do histórico
// do chat por sessão (sessao_id) + vínculo lógico com job_id do sessionQueue
// (atualização assíncrona de job_status). Recebe um PoolClient transacionado pelo
// runner — o caller controla BEGIN/COMMIT, o migration NÃO abre transação própria.

export const up = async (client: PoolClient): Promise<void> => {
    await client.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id BIGSERIAL PRIMARY KEY,
            sessao_id VARCHAR(64) NOT NULL,
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            tool_calls JSONB NULL,
            job_id VARCHAR(64) NULL,
            job_status VARCHAR(20) NULL,
            ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT chat_messages_role_chk CHECK (role IN ('user', 'assistant', 'system', 'tool')),
            CONSTRAINT chat_messages_job_status_chk CHECK (
                job_status IS NULL OR job_status IN ('queued', 'running', 'done', 'error', 'cancelled')
            )
        );
    `);

    // Ordenação cronológica por sessão (leitura de histórico) — ASC é o default
    // do Postgres mas declarado explicitamente para documentar a intenção.
    await client.query(`
        CREATE INDEX IF NOT EXISTS chat_messages_sessao_ts_idx
            ON chat_messages (sessao_id, ts ASC);
    `);

    // Lookup de status por job_id (chatStore.updateJobStatus + dashboards).
    await client.query(`
        CREATE INDEX IF NOT EXISTS chat_messages_job_id_idx
            ON chat_messages (job_id);
    `);
};

export const down = async (client: PoolClient): Promise<void> => {
    // DROP TABLE remove índices automaticamente; IF EXISTS para down idempotente
    // (rodar o down duas vezes não estoura erro — comum em testes e re-aplicações).
    await client.query(`DROP TABLE IF EXISTS chat_messages;`);
};