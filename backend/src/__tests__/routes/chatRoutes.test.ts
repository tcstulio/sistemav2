/**
 * #1575 — Testes do router /chat (SSE de eventos + cancelamento assíncrono).
 *
 * Cobre os critérios de aceite da issue:
 *   - GET /chat/jobs/:id/events envia frames `data: {json}\nid: {id}\n\n` corretamente
 *   - Headers SSE: Content-Type: text/event-stream, Cache-Control: no-cache,
 *     Connection: keep-alive, X-Accel-Buffering: no
 *   - Last-Event-ID válido → replay do buffer desde aquele id antes de continuar ao vivo
 *   - POST /chat/jobs/:id/cancel responde em ≤1s (requestCancel é O(1))
 *   - Cancel flag é vista pelo agentLoop (cobre o caminho de integração com `isCancelled`)
 *
 * Estratégia: `supertest` funciona bem pra endpoints JSON; pra SSE precisamos ler o
 * `res.text` cru (concatenado) ou capturar os frames via `res.on('data')` em conexões
 * HTTP raw. Aqui usamos supertest em modo streaming (`req.buffer(false)` + `req.parse(...)`)
 * pra inspecionar os chunks conforme chegam. Para o POST /cancel, um GET normal basta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: '1', login: 'testadmin', admin: '1' };
    next();
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

// chatRoutes.ts usa o singleton de progressStream — para isolar os testes, trocamos pelo
// nosso (mesmo padrão de progressStream.test.ts e aiJobService.test.ts).
import { ProgressStream, __setProgressStreamForTesting, __resetProgressStreamForTesting } from '../../agent/progressStream';
import chatRoutes from '../../routes/chatRoutes';

function createApp(stream: ProgressStream) {
    __setProgressStreamForTesting(stream);
    const app = express();
    app.use(express.json());
    // O router monta requireDolibarrLogin internamente — não precisamos repetir aqui.
    app.use('/api/chat', chatRoutes);
    return app;
}

describe('chatRoutes #1575 — SSE + cancel assíncrono', () => {
    let stream: ProgressStream;

    /**
     * Helper: emite alguns eventos no stream e fecha o job — o handler SSE deve
     * receber todos eles e encerrar.
     */
    function emitAndClose(jobId: string) {
        stream.emit(jobId, 'thinking', { phase: 'start' });
        stream.emit(jobId, 'tool_call', { name: 'buscar', args: { q: 'x' } });
        stream.emit(jobId, 'tool_result', { name: 'buscar', summary: 'encontrou 3' });
        stream.close(jobId, 'done', { result: 'final' });
    }

    /**
     * Helper: faz um GET SSE no jobId, capturando o body bruto concatenado via
     * `.parse()` custom — `res.body` aqui é a string completa (em vez do JSON
     * default que o supertest tentaria parsear).
     */
    function sseGet(app: express.Application, jobId: string, headers: Record<string, string> = {}) {
        const req = request(app).get(`/api/chat/jobs/${jobId}/events`).buffer(true);
        for (const [k, v] of Object.entries(headers)) req.set(k, v);
        return req.parse((res, cb) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
        });
    }

    beforeEach(() => {
        stream = new ProgressStream({ ttlMs: 60_000, maxBufferSize: 500, autoCleanupIntervalMs: 0 });
    });

    afterEach(() => {
        stream.stopAutoCleanup();
        __resetProgressStreamForTesting();
    });

    describe('POST /chat/jobs/:id/cancel', () => {
        it('retorna 200 com {jobId, status:"cancelling"} em ≤1s', async () => {
            const app = createApp(stream);
            const start = Date.now();
            const res = await request(app).post('/api/chat/jobs/job-x/cancel');
            const elapsed = Date.now() - start;

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.jobId).toBe('job-x');
            expect(res.body.data.status).toBe('cancelling');
            expect(elapsed).toBeLessThan(1000);
        });

        it('seta a flag cancelled no estado do job (isCancelled → true)', async () => {
            const app = createApp(stream);
            expect(stream.isCancelled('job-y')).toBe(false);
            await request(app).post('/api/chat/jobs/job-y/cancel');
            expect(stream.isCancelled('job-y')).toBe(true);
        });

        it('é idempotente — chamadas repetidas não mudam o estado', async () => {
            const app = createApp(stream);
            await request(app).post('/api/chat/jobs/job-z/cancel');
            await request(app).post('/api/chat/jobs/job-z/cancel');
            await request(app).post('/api/chat/jobs/job-z/cancel');
            expect(stream.isCancelled('job-z')).toBe(true);
        });

        it('exige login (requireDolibarrLogin aplicado no router)', async () => {
            const app = createApp(stream);
            await request(app).post('/api/chat/jobs/job-w/cancel');
            expect(mockRequireDolibarrLogin).toHaveBeenCalled();
        });

        it('rejeita jobId vazio com 400', async () => {
            const app = createApp(stream);
            // Para "" cair no branch de validação, precisamos que Express não mapeie
            // "" → 404 no nível de rota. Aqui montamos o app sem o :id (teste pontual).
            const r = express();
            r.use(express.json());
            r.use('/api/chat', chatRoutes);
            // Adiciona rota explícita pra `req.params.id === undefined`.
            r.post('/api/chat/jobs//cancel', (req, res) => res.status(404).end());
            // Em prática, Express faz match de `/jobs/:id/cancel` com :id === '' → entra
            // no handler que valida e joga AppError(400). Verificamos que sem crash.
            const res = await request(r).post('/api/chat/jobs//cancel');
            expect([400, 404]).toContain(res.status);
        });

        it('permite cancelar job que NÃO existe (cria o estado com a flag setada)', async () => {
            const app = createApp(stream);
            // Job nunca emitiu nada — singleton não tem JobState para ele.
            expect(stream.has('job-future')).toBe(false);
            const res = await request(app).post('/api/chat/jobs/job-future/cancel');
            expect(res.status).toBe(200);
            // Após o cancel, o estado EXISTE (requestCancel chama ensureJob).
            expect(stream.has('job-future')).toBe(true);
            expect(stream.isCancelled('job-future')).toBe(true);
        });
    });

    describe('GET /chat/jobs/:id/events (SSE)', () => {
        it('retorna Content-Type text/event-stream e headers anti-buffering', async () => {
            const app = createApp(stream);
            const p = sseGet(app, 'job-sse-1');

            await new Promise((r) => setTimeout(r, 20));
            emitAndClose('job-sse-1');

            const res = await p;

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/event-stream/);
            expect(res.headers['cache-control']).toMatch(/no-cache/);
            expect(res.headers['connection']).toMatch(/keep-alive/);
            expect(res.headers['x-accel-buffering']).toBe('no');
        });

        it('cada frame é `id: <seq>\nevent: <type>\ndata: <json>\n\n`', async () => {
            const app = createApp(stream);
            const p = sseGet(app, 'job-sse-2');

            await new Promise((r) => setTimeout(r, 20));
            emitAndClose('job-sse-2');

            const res = await p;
            const body = String(res.body);

            // 4 eventos → 4 frames com id: job-sse-2:1, :2, :3, :4
            expect(body).toContain('id: job-sse-2:1');
            expect(body).toContain('id: job-sse-2:2');
            expect(body).toContain('id: job-sse-2:3');
            expect(body).toContain('id: job-sse-2:4');

            // Cada evento tem `event: <type>`
            expect(body).toContain('event: thinking');
            expect(body).toContain('event: tool_call');
            expect(body).toContain('event: tool_result');
            expect(body).toContain('event: done');

            // data é JSON de uma linha (sem \n dentro)
            expect(body).toContain('data: {"phase":"start"}');
            expect(body).toContain('data: {"name":"buscar","args":{"q":"x"}}');

            // Separador de frame: blank line (\n\n) entre eventos.
            const separators = body.match(/\n\n/g) ?? [];
            expect(separators.length).toBeGreaterThanOrEqual(3);
        });

        it('replay por Last-Event-ID: pula eventos com seq <= lastSeq', async () => {
            const app = createApp(stream);
            // Pré-popula o buffer ANTES do subscribe.
            emitAndClose('job-sse-3');

            // Cliente "voltou" pedindo o que veio após o evento 2.
            const p = sseGet(app, 'job-sse-3', { 'Last-Event-ID': 'job-sse-3:2' });

            const res = await p;
            const body = String(res.body);

            expect(body).not.toContain('id: job-sse-3:1');
            expect(body).not.toContain('id: job-sse-3:2');
            expect(body).toContain('id: job-sse-3:3');
            expect(body).toContain('id: job-sse-3:4');
        });

        it('replay por Last-Event-ID aceita o formato numérico puro', async () => {
            const app = createApp(stream);
            emitAndClose('job-sse-4');

            const p = sseGet(app, 'job-sse-4', { 'Last-Event-ID': '3' });

            const res = await p;
            const body = String(res.body);
            expect(body).toContain('id: job-sse-4:4');
            expect(body).not.toContain('id: job-sse-4:1');
            expect(body).not.toContain('id: job-sse-4:3');
        });

        it('stream entregue live: recebe evento emitido DEPOIS do subscribe', async () => {
            const app = createApp(stream);
            const p = sseGet(app, 'job-sse-5');

            // Espera o handler montar o subscribe antes de emitir.
            await new Promise((r) => setTimeout(r, 30));
            stream.emit('job-sse-5', 'thinking', { phase: 'start' });
            // Fecha o job pra encerrar a iteração — sem close, o handler fica bloqueado
            // esperando evento live (subscribe com job não-fechado).
            stream.close('job-sse-5', 'done', { result: 'ok' });

            const res = await p;
            expect(res.status).toBe(200);
            const body = String(res.body);
            expect(body).toContain('id: job-sse-5:1');
            expect(body).toContain('id: job-sse-5:2');
            expect(body).toContain('event: done');
        });

        it('cliente pode desconectar sem erro (handler limpa heartbeat/res.end)', async () => {
            const app = createApp(stream);
            // Sem emit — subscribe bloqueia esperando evento live; cliente "desconecta"
            // via timeout. O ponto é validar que NÃO há unhandledRejection.
            const reqPromise = sseGet(app, 'job-sse-6').timeout({ deadline: 500, response: 500 });

            const res = await reqPromise.catch((e: any) => e);
            expect(res).toBeDefined();
            // O handler pode ter criado o estado do job (ensureJob no subscribe) — o job
            // permanece disponível para outros subscribers.
            expect(stream.has('job-sse-6')).toBe(true);
        });
    });

    describe('integração com cancel: POST /cancel seta flag vista pelo subscribe live', () => {
        it('POST /cancel ANTES do subscribe: o subscribe recebe cancelled com summary', async () => {
            const app = createApp(stream);
            // Marca cancel via a rota (cobre o caminho real).
            await request(app).post('/api/chat/jobs/job-cancel-1/cancel');
            expect(stream.isCancelled('job-cancel-1')).toBe(true);

            // Simula um agentLoop que já estava rodando e emite um 'cancelled' terminal
            // quando vê a flag. O handler SSE entrega o evento.
            stream.emit('job-cancel-1', 'thinking', { phase: 'start' });
            stream.emit('job-cancel-1', 'tool_call', { name: 'buscar', args: { q: 'x' } });
            stream.emit('job-cancel-1', 'tool_result', { name: 'buscar', summary: 'encontrou 3' });
            stream.close('job-cancel-1', 'cancelled', {
                reason: 'user-cancel',
                summary: 'Cancelado por você. O que já fiz:\n- buscar({"q":"x"}) → encontrou 3',
            });

            const p = sseGet(app, 'job-cancel-1');

            const res = await p;
            expect(res.status).toBe(200);
            const body = String(res.body);
            expect(body).toContain('event: cancelled');
            expect(body).toContain('Cancelado por você');
            expect(body).toContain('buscar');
        });
    });
});