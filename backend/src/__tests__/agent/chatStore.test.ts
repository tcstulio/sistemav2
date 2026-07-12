import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock do Pool do Postgres — não há DB nos testes unitários, e abrir um Pool real
// falharia (sem DATABASE_URL). Cobrimos a SQL emitida e o mapeamento de row -> record.
const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn().mockResolvedValue({
    query: queryMock,
    release: releaseMock,
});

vi.mock('../../db/pool', () => ({
    getPool: () => ({
        query: queryMock,
        connect: connectMock,
    }),
    closePool: vi.fn(),
    __resetPoolForTests: vi.fn(),
}));

import {
    insertMessage,
    listMessages,
    updateJobStatus,
    type ChatMessageRecord,
} from '../../agent/chatStore';

describe('chatStore (#1372)', () => {
    beforeEach(() => {
        queryMock.mockReset();
        releaseMock.mockReset();
        connectMock.mockClear();
    });

    describe('insertMessage', () => {
        it('emite INSERT com os parâmetros na ordem e faz cast de tool_calls para ::jsonb', async () => {
            queryMock.mockResolvedValueOnce({
                rows: [
                    {
                        id: 1,
                        sessao_id: 's1',
                        role: 'assistant',
                        content: 'olá',
                        tool_calls: [{ tool: 'foo', args: { x: 1 } }],
                        job_id: null,
                        job_status: null,
                        ts: new Date('2025-01-15T12:00:00Z'),
                    },
                ],
            });

            const record = await insertMessage({
                sessao_id: 's1',
                role: 'assistant',
                content: 'olá',
                tool_calls: [{ tool: 'foo', args: { x: 1 } }],
            });

            expect(queryMock).toHaveBeenCalledTimes(1);
            const [sql, params] = queryMock.mock.calls[0]!;
            expect(sql).toContain('INSERT INTO chat_messages');
            expect(sql).toContain('::jsonb');
            expect(sql).toContain('RETURNING');
            expect(params).toEqual(['s1', 'assistant', 'olá', JSON.stringify([{ tool: 'foo', args: { x: 1 } }]), null, null]);
            expect(record).toMatchObject<Partial<ChatMessageRecord>>({
                id: '1',
                sessao_id: 's1',
                role: 'assistant',
                content: 'olá',
                tool_calls: [{ tool: 'foo', args: { x: 1 } }],
                job_id: null,
                job_status: null,
                ts: '2025-01-15T12:00:00.000Z',
            });
        });

        it('serializa tool_calls apenas quando definido (null não vira "null" string)', async () => {
            queryMock.mockResolvedValueOnce({
                rows: [{ id: 2, sessao_id: 's', role: 'user', content: 'oi', tool_calls: null, job_id: null, job_status: null, ts: new Date() }],
            });

            await insertMessage({ sessao_id: 's', role: 'user', content: 'oi' });

            const [, params] = queryMock.mock.calls[0]!;
            expect(params[3]).toBeNull();
        });

        it('persiste job_id e job_status quando informados', async () => {
            queryMock.mockResolvedValueOnce({
                rows: [{ id: 3, sessao_id: 's', role: 'tool', content: 'r', tool_calls: null, job_id: 'job-7', job_status: 'running', ts: new Date() }],
            });

            await insertMessage({
                sessao_id: 's',
                role: 'tool',
                content: 'r',
                job_id: 'job-7',
                job_status: 'running',
            });

            const [, params] = queryMock.mock.calls[0]!;
            expect(params[4]).toBe('job-7');
            expect(params[5]).toBe('running');
        });
    });

    describe('listMessages', () => {
        it('filtra por sessao_id e ordena por (ts ASC, id ASC) — ordem cronológica estável', async () => {
            queryMock.mockResolvedValueOnce({
                rows: [
                    { id: 1, sessao_id: 's1', role: 'user', content: 'a', tool_calls: null, job_id: null, job_status: null, ts: new Date('2025-01-15T10:00:00Z') },
                    { id: 2, sessao_id: 's1', role: 'assistant', content: 'b', tool_calls: null, job_id: null, job_status: null, ts: new Date('2025-01-15T10:00:05Z') },
                ],
            });

            const messages = await listMessages('s1');

            const [sql, params] = queryMock.mock.calls[0]!;
            expect(sql).toContain('WHERE sessao_id = $1');
            expect(sql).toContain('ORDER BY ts ASC, id ASC');
            expect(params).toEqual(['s1']);
            expect(messages).toHaveLength(2);
            expect(messages[0]!.content).toBe('a');
            expect(messages[1]!.content).toBe('b');
        });

        it('retorna [] quando a sessão não tem mensagens', async () => {
            queryMock.mockResolvedValueOnce({ rows: [] });

            expect(await listMessages('vazia')).toEqual([]);
        });
    });

    describe('updateJobStatus', () => {
        it('emite UPDATE filtrando por job_id e retorna rowCount', async () => {
            queryMock.mockResolvedValueOnce({ rowCount: 3 });

            const affected = await updateJobStatus('job-7', 'done');

            const [sql, params] = queryMock.mock.calls[0]!;
            expect(sql).toContain('UPDATE chat_messages');
            expect(sql).toContain('SET job_status = $1');
            expect(sql).toContain('WHERE job_id = $2');
            expect(params).toEqual(['done', 'job-7']);
            expect(affected).toBe(3);
        });

        it('trata rowCount=null como 0 (driver que não devolve contagem)', async () => {
            queryMock.mockResolvedValueOnce({ rowCount: null });

            expect(await updateJobStatus('job-x', 'error')).toBe(0);
        });

        it('retorna 0 sem tocar no pool quando jobId é vazio (curto-circuito defensivo)', async () => {
            const affected = await updateJobStatus('', 'done');

            expect(affected).toBe(0);
            expect(queryMock).not.toHaveBeenCalled();
        });

        it('aceita todos os status do CHECK constraint do banco', async () => {
            const statuses = ['queued', 'running', 'done', 'error', 'cancelled'] as const;
            for (const status of statuses) {
                queryMock.mockResolvedValueOnce({ rowCount: 1 });
                expect(await updateJobStatus('job-1', status)).toBe(1);
            }
            // 5 chamadas, uma por status.
            expect(queryMock).toHaveBeenCalledTimes(statuses.length);
        });
    });
});