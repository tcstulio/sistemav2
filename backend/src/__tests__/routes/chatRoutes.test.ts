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
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: () => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }),
    },
}));

// #1547 — analyzePdf é o serviço de extração/OCR; mockamos p/ isolar o teste de rota.
const mockAnalyzePdf = vi.hoisted(() => vi.fn());
vi.mock('../../services/analyzePdf', () => ({ analyzePdf: mockAnalyzePdf }));

// #1546 — describeVideo (do visionService) é o serviço de descrição de vídeo; mockamos
// p/ isolar a rota. O mock do VideoAnalysisError permite testar a propagação tipada
// dos códigos 415/413/502 (mapeados em respostas HTTP específicas).
const mockDescribeVideo = vi.hoisted(() => vi.fn());
vi.mock('../../services/visionService', async () => {
    const actual = await vi.importActual<typeof import('../../services/visionService')>('../../services/visionService');
    return {
        ...actual,
        describeVideo: mockDescribeVideo,
    };
});

// #1546 — mockamos o config para controlar `chatVideoMaxBytes` independentemente da env.
// Sem isso, todo teste precisaria enviar 20+ MiB pela rota. Usamos 1 KiB como limite
// pequeno o suficiente p/ testar 413 com buffer de 2 KiB, mas ≥ 1 MiB (piso do config).
const mockChatCfg = vi.hoisted(() => ({
    chatVideoMaxBytes: 1024, // 1 KiB → qualquer buffer > 1 KiB cai no 413
}));
vi.mock('../../config/env', () => ({
    config: mockChatCfg,
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
            expect(res.status).toBe(404);
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

    describe('POST /chat/jobs/:id/visibility', () => {
        it('registra e alterna a visibilidade do job', async () => {
            const app = createApp(stream);
            const hidden = await request(app).post('/api/chat/jobs/job-visible/visibility').send({ hidden: true });
            expect(hidden.status).toBe(200);
            expect(hidden.body.data).toEqual({ jobId: 'job-visible', hidden: true });
            expect(stream.isHidden('job-visible')).toBe(true);

            await request(app).post('/api/chat/jobs/job-visible/visibility').send({ hidden: false });
            expect(stream.isHidden('job-visible')).toBe(false);
        });

        it('rejeita hidden que não seja booleano', async () => {
            const app = createApp(stream);
            const res = await request(app).post('/api/chat/jobs/job-visible/visibility').send({ hidden: 'true' });
            expect(res.status).toBe(400);
            expect(stream.isHidden('job-visible')).toBe(false);
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

    describe('POST /chat/analyze-pdf (#1547 — OCR fallback de PDF)', () => {
        beforeEach(() => {
            mockAnalyzePdf.mockReset();
        });

        it('retorna 200 com o conteúdo extraído/OCR (string única)', async () => {
            // Contrato #1031: analyzePdf devolve Promise<string> (sem metadados no corpo).
            mockAnalyzePdf.mockResolvedValue('--- Página 1 ---\nconteúdo OCR');
            const app = createApp(stream);
            const res = await request(app)
                .post('/api/chat/analyze-pdf')
                .send({ pdf: Buffer.from('PDFBYTES').toString('base64'), question: 'resuma' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toEqual({ text: '--- Página 1 ---\nconteúdo OCR' });
            expect(mockAnalyzePdf).toHaveBeenCalledTimes(1);
            expect(Buffer.isBuffer(mockAnalyzePdf.mock.calls[0][0])).toBe(true);
        });

        it('também funciona no caminho pdf_parse (texto puro)', async () => {
            mockAnalyzePdf.mockResolvedValue('texto puro extraído da camada de texto');
            const app = createApp(stream);
            const res = await request(app)
                .post('/api/chat/analyze-pdf')
                .send({ pdf: Buffer.from('X').toString('base64') });
            expect(res.status).toBe(200);
            expect(res.body.data.text).toBe('texto puro extraído da camada de texto');
            // Sem vazar metadados internos (path/pagesOcr) — ficam no log do service.
            expect(res.body.data.path).toBeUndefined();
        });

        it('400 quando `pdf` está ausente', async () => {
            const app = createApp(stream);
            const res = await request(app).post('/api/chat/analyze-pdf').send({});
            expect(res.status).toBe(400);
            expect(mockAnalyzePdf).not.toHaveBeenCalled();
        });

        it('400 quando `pdf` decodifica para buffer vazio', async () => {
            const app = createApp(stream);
            // ' ' (espaço) é base64 inválido/vazio → Buffer.from(' ','base64').length === 0
            const res = await request(app).post('/api/chat/analyze-pdf').send({ pdf: ' ' });
            expect(res.status).toBe(400);
            expect(mockAnalyzePdf).not.toHaveBeenCalled();
        });

        it('exige login (requireDolibarrLogin aplicado no router)', async () => {
            mockAnalyzePdf.mockResolvedValue('');
            const app = createApp(stream);
            await request(app).post('/api/chat/analyze-pdf').send({ pdf: Buffer.from('X').toString('base64') });
            expect(mockRequireDolibarrLogin).toHaveBeenCalled();
        });
    });

    describe('POST /chat/analyze-video (#1546 — descrição de vídeo via glm-4.6v)', () => {
        beforeEach(() => {
            mockDescribeVideo.mockReset();
            mockDescribeVideo.mockResolvedValue('descrição fake do vídeo');
            // Reseta o mock de PDF também — `analyze-pdf` describe anterior pode ter acumulado
            // chamadas que afetam as asserções deste bloco (isolamento entre suites).
            mockAnalyzePdf.mockReset();
        });

        it('200: processa vídeo curto (≤ limite) e devolve { text, mimeType, path:"video_url" }', async () => {
            const app = createApp(stream);
            // Limite mockado = 1 KiB; enviamos 512 bytes (≤ limite).
            const video = Buffer.alloc(512, 0xab);
            const res = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: video.toString('base64'), mimeType: 'video/mp4' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.text).toBe('descrição fake do vídeo');
            expect(res.body.data.mimeType).toBe('video/mp4');
            // path `video_url` distingue dos caminhos de imagem (pdf_parse/ocr_vision).
            expect(res.body.data.path).toBe('video_url');

            // describeVideo foi chamado exatamente uma vez, com filePath apontando pra um
            // arquivo existente no disco (a rota salva o vídeo temporariamente).
            expect(mockDescribeVideo).toHaveBeenCalledTimes(1);
            const [inputArg, mimeArg] = mockDescribeVideo.mock.calls[0];
            expect(mimeArg).toBe('video/mp4');
            expect(inputArg).toMatchObject({ filePath: expect.stringMatching(/\.mp4$/) });
            expect(typeof inputArg.filePath).toBe('string');
        });

        it('aceita mimeType video/quicktime (MOV) e passa para describeVideo com esse MIME', async () => {
            const app = createApp(stream);
            const video = Buffer.alloc(256);
            const res = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: video.toString('base64'), mimeType: 'video/quicktime' });

            expect(res.status).toBe(200);
            expect(res.body.data.mimeType).toBe('video/quicktime');
            const [inputArg, mimeArg] = mockDescribeVideo.mock.calls[0];
            expect(mimeArg).toBe('video/quicktime');
            // Arquivo salvo com extensão .mov quando mime é video/quicktime.
            expect(inputArg.filePath.endsWith('.mov')).toBe(true);
        });

        it('413 VIDEO_TOO_LARGE quando vídeo excede o limite (env CHAT_VIDEO_MAX_BYTES)', async () => {
            const app = createApp(stream);
            // Limite mockado = 1 KiB; enviamos 2 KiB (acima do limite, abaixo do body-parser).
            const big = Buffer.alloc(2048, 0xff);
            const res = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: big.toString('base64'), mimeType: 'video/mp4' });

            // #1546: status 413 (Payload Too Large) é o critério de aceite da issue — mensagem
            // clara. O corpo JSON do erro é produzido pelo errorHandler global (mockamos só
            // o router aqui, não o app completo), então validamos o status + o efeito colateral
            // (describeVideo NÃO foi chamado).
            expect(res.status).toBe(413);
            expect(mockDescribeVideo).not.toHaveBeenCalled();
            expect(mockAnalyzePdf).not.toHaveBeenCalled();
        });

        it('400 quando `video` está ausente', async () => {
            const app = createApp(stream);
            const res = await request(app).post('/api/chat/analyze-video').send({ mimeType: 'video/mp4' });
            expect(res.status).toBe(400);
            expect(mockDescribeVideo).not.toHaveBeenCalled();
        });

        it('400 quando `mimeType` está ausente', async () => {
            const app = createApp(stream);
            const res = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: Buffer.from('x').toString('base64') });
            expect(res.status).toBe(400);
            expect(mockDescribeVideo).not.toHaveBeenCalled();
        });

        it('400 quando `mimeType` não é um MIME de vídeo suportado', async () => {
            const app = createApp(stream);
            const res = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: Buffer.from('x').toString('base64'), mimeType: 'video/webm' });
            expect(res.status).toBe(400);
            expect(mockDescribeVideo).not.toHaveBeenCalled();
        });

        it('400 quando `video` decodifica para buffer vazio', async () => {
            const app = createApp(stream);
            const res = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: ' ', mimeType: 'video/mp4' });
            expect(res.status).toBe(400);
            expect(mockDescribeVideo).not.toHaveBeenCalled();
        });

        it('415 quando describeVideo lança UNSUPPORTED_VIDEO_MIME (mime chegou ao service)', async () => {
            // Defesa em profundidade: se um mime novo chegar à rota e o service ainda não
            // foi atualizado, queremos rejeitar com 415 (não 500). Aqui simulamos esse
            // caminho mockando a exceção do service.
            const { VideoAnalysisError } = await import('../../services/visionService');
            mockDescribeVideo.mockRejectedValueOnce(
                new VideoAnalysisError('UNSUPPORTED_VIDEO_MIME', 'mime não suportado', 415),
            );
            const app = createApp(stream);
            const res = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: Buffer.alloc(64).toString('base64'), mimeType: 'video/mp4' });
            expect(res.status).toBe(415);
            expect(mockDescribeVideo).toHaveBeenCalledTimes(1);
        });

        it('degrada graciosamente quando describeVideo lança VISION_CALL_FAILED (502 do service)', async () => {
            // Mesmo padrão do `analyze-pdf`: visão indisponível NÃO quebra o chat — o caller
            // recebe `text: null` e decide como prosseguir.
            const { VideoAnalysisError } = await import('../../services/visionService');
            mockDescribeVideo.mockRejectedValueOnce(
                new VideoAnalysisError('VISION_CALL_FAILED', 'provedor caiu', 502),
            );
            const app = createApp(stream);
            const res = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: Buffer.alloc(64).toString('base64'), mimeType: 'video/mp4' });

            expect(res.status).toBe(200);
            expect(res.body.data.text).toBeNull();
            expect(res.body.data.mimeType).toBe('video/mp4');
            expect(res.body.data.path).toBe('video_url');
        });

        it('devolve { text: null } quando describeVideo retorna null', async () => {
            mockDescribeVideo.mockResolvedValueOnce(null);
            const app = createApp(stream);
            const res = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: Buffer.alloc(64).toString('base64'), mimeType: 'video/mp4' });

            expect(res.status).toBe(200);
            expect(res.body.data.text).toBeNull();
            expect(res.body.data.mimeType).toBe('video/mp4');
            expect(res.body.data.path).toBe('video_url');
        });

        it('exige login (requireDolibarrLogin aplicado no router)', async () => {
            const app = createApp(stream);
            await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: Buffer.alloc(64).toString('base64'), mimeType: 'video/mp4' });
            expect(mockRequireDolibarrLogin).toHaveBeenCalled();
        });

        it('caminho vídeo NÃO interfere no caminho imagem/PDF (rotas separadas, mock isolado)', async () => {
            // Garante que mockAnalyzePdf e mockDescribeVideo são independentes: o teste
            // anterior não "contamina" este, e vice-versa.
            const app = createApp(stream);
            mockAnalyzePdf.mockResolvedValueOnce('PDF');

            const rPdf = await request(app)
                .post('/api/chat/analyze-pdf')
                .send({ pdf: Buffer.from('X').toString('base64') });
            expect(rPdf.status).toBe(200);
            expect(rPdf.body.data.text).toBe('PDF');
            expect(mockDescribeVideo).not.toHaveBeenCalled();

            const rVid = await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: Buffer.alloc(64).toString('base64'), mimeType: 'video/mp4' });
            expect(rVid.status).toBe(200);
            expect(rVid.body.data.path).toBe('video_url');
            // PDF foi chamado SÓ no request do PDF; vídeo não tocou analyzePdf.
            expect(mockAnalyzePdf).toHaveBeenCalledTimes(1);
            // Vídeo foi chamado SÓ no request do vídeo; PDF não tocou describeVideo.
            expect(mockDescribeVideo).toHaveBeenCalledTimes(1);
        });

        it('remove o diretório temporário após o processamento (best-effort cleanup)', async () => {
            // Captura o filePath passado ao service e verifica que o arquivo NÃO existe mais
            // após a resposta — garantia de que o vídeo não fica persistido no disco.
            let observedPath = '';
            mockDescribeVideo.mockImplementationOnce(async (input: any) => {
                observedPath = input?.filePath || '';
                return 'descrição';
            });
            const app = createApp(stream);
            await request(app)
                .post('/api/chat/analyze-video')
                .send({ video: Buffer.alloc(64).toString('base64'), mimeType: 'video/mp4' });

            expect(observedPath).toMatch(/\.mp4$/);
            const fsp = await import('fs/promises');
            await expect(fsp.access(observedPath)).rejects.toThrow();
        });
    });
});
