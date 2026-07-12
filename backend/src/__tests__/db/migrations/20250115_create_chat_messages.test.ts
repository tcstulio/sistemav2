import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock do PoolClient — o migration recebe um client transacionado pelo runner; aqui
// só validamos a SQL emitida (CREATE TABLE/INDEX/DROP) e os parâmetros.
const queryMock = vi.fn();

const fakeClient = { query: queryMock } as any;

import { up, down } from '../../../db/migrations/20250115_create_chat_messages';

describe('migration 20250115_create_chat_messages (#1372)', () => {
    beforeEach(() => {
        queryMock.mockReset();
        queryMock.mockResolvedValue({ rows: [] });
    });

    describe('up', () => {
        it('cria a tabela chat_messages com todas as colunas esperadas e CHECKs', async () => {
            await up(fakeClient);

            const sqls = queryMock.mock.calls.map((c) => String(c[0]));
            const createTable = sqls.find((s) => s.includes('CREATE TABLE'));
            expect(createTable, 'esperava um CREATE TABLE').toBeTruthy();
            expect(createTable).toContain('id BIGSERIAL PRIMARY KEY');
            expect(createTable).toContain('sessao_id VARCHAR(64) NOT NULL');
            expect(createTable).toContain('role VARCHAR(20) NOT NULL');
            expect(createTable).toContain("CHECK (role IN ('user', 'assistant', 'system', 'tool'))");
            expect(createTable).toContain('content TEXT NOT NULL');
            expect(createTable).toContain('tool_calls JSONB NULL');
            expect(createTable).toContain('job_id VARCHAR(64) NULL');
            expect(createTable).toContain('job_status VARCHAR(20) NULL');
            expect(createTable).toContain("job_status IN ('queued', 'running', 'done', 'error', 'cancelled')");
            expect(createTable).toContain('ts TIMESTAMPTZ NOT NULL DEFAULT NOW()');
        });

        it('cria o índice composto (sessao_id, ts ASC) para leitura cronológica', async () => {
            await up(fakeClient);

            const sqls = queryMock.mock.calls.map((c) => String(c[0]));
            const sessaoIdx = sqls.find((s) => s.includes('chat_messages_sessao_ts_idx'));
            expect(sessaoIdx, 'esperava índice sessao_id+ts').toBeTruthy();
            expect(sessaoIdx).toContain('(sessao_id, ts ASC)');
        });

        it('cria o índice em job_id para lookup de status', async () => {
            await up(fakeClient);

            const sqls = queryMock.mock.calls.map((c) => String(c[0]));
            const jobIdx = sqls.find((s) => s.includes('chat_messages_job_id_idx'));
            expect(jobIdx, 'esperava índice job_id').toBeTruthy();
            expect(jobIdx).toContain('(job_id)');
        });

        it('emite CREATE INDEX IF NOT EXISTS para re-execução idempotente', async () => {
            await up(fakeClient);

            const sqls = queryMock.mock.calls.map((c) => String(c[0]));
            for (const s of sqls) {
                if (s.includes('CREATE INDEX')) {
                    expect(s).toContain('IF NOT EXISTS');
                }
            }
        });
    });

    describe('down', () => {
        it('remove a tabela chat_messages sem erro (DROP TABLE IF EXISTS)', async () => {
            await down(fakeClient);

            const sqls = queryMock.mock.calls.map((c) => String(c[0]));
            expect(sqls).toHaveLength(1);
            expect(sqls[0]).toBe('DROP TABLE IF EXISTS chat_messages;');
        });

        it('pode rodar duas vezes seguidas sem lançar (idempotente)', async () => {
            await expect(down(fakeClient)).resolves.toBeUndefined();
            await expect(down(fakeClient)).resolves.toBeUndefined();
            expect(queryMock).toHaveBeenCalledTimes(2);
        });
    });

    describe('round-trip', () => {
        it('down após up reverte ao estado pré-migration (mesmo número de operações de DDL)', async () => {
            await up(fakeClient);
            const upCount = queryMock.mock.calls.length;
            // down é 1 statement (DROP TABLE remove os índices automaticamente).
            expect(upCount).toBeGreaterThanOrEqual(3); // CREATE TABLE + 2 CREATE INDEX

            queryMock.mockClear();
            await down(fakeClient);
            expect(queryMock).toHaveBeenCalledTimes(1);
            expect(String(queryMock.mock.calls[0]![0])).toContain('DROP TABLE');
        });
    });
});