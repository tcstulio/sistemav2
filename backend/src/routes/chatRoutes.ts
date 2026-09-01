/**
 * #1575 — Rotas HTTP do agente: SSE de eventos + cancelamento assíncrono de job.
 *
 *  GET  /chat/jobs/:id/events  →  text/event-stream. Subscribe no ProgressStream do jobId
 *                                 e entrega os eventos como SSE formatado (`data: <json>\nid: <seq>\n\n`).
 *                                 Suporta retomada via header `Last-Event-ID` (replay do buffer
 *                                 a partir daquele id antes de seguir o live stream).
 *  POST /chat/jobs/:id/cancel  →  sinaliza cancelamento via `requestCancel(jobId)` no stream.
 *                                 Resposta em ≤1s com `{success:true, data:{jobId, status:'cancelling'}}`.
 *
 *  Critérios de aceite:
 *   - [✓] SSE envia `data: {json}\nid: {id}\n\n` corretamente.
 *   - [✓] Last-Event-ID válido → replay do buffer desde aquele id antes de continuar ao vivo.
 *   - [✓] Cancel responde em ≤1s (requestCancel é O(1)).
 *   - [✓] Loop aborta em ≤2s após cancel com resumo parcial (#1575 — checado no agentLoop.test.ts).
 *   - [✓] Headers SSE evitam buffering de proxy (`Cache-Control: no-cache`,
 *                                                     `Connection: keep-alive`,
 *                                                     `X-Accel-Buffering: no`).
 *
 *  Como integrar com o frontend (consumidor SSE):
 *   const es = new EventSource('/api/chat/jobs/' + jobId + '/events', { withCredentials: true });
 *   es.addEventListener('message', (ev) => { const data = JSON.parse(ev.data); ... });
 *   es.addEventListener('cancelled', (ev) => { es.close(); ... }); // terminal
 *
 *  Por que endpoint separado (e não fundido com `/ai/jobs/:id`)? Porque SSE precisa de headers
 *  custom (Content-Type: text/event-stream, X-Accel-Buffering: no) que NÃO combinam com a resposta
 *  JSON padrão do endpoint de polling. Manter paths distintos evita acoplar o consumidor SSE
 *  ao envelope `{success,data}` do helper `ok()`.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { ok } from '../utils/apiResponse';
import { getProgressStream, type ProgressEvent } from '../agent/progressStream';
import { analyzePdf } from '../services/analyzePdf';
import { describeVideoAttachment } from '../services/describeVideoAttachment';
import { VideoAnalysisError } from '../services/describeVideo';
import { config } from '../config/env';
import { createLogger } from '../utils/logger';
// #1059: cancelamento propagado até a chamada HTTP da OpenAI. O `cancel(jobId)` do
// aiJobService aciona o AbortController registrado no enqueue, que `postChatCompletion`
// lê via `getSignal(jobId)` para abortar axios + retry loop em ≤2s.
import { aiJobService } from '../services/aiJobService';

const log = createLogger('ChatRoutes');

const router = Router();

// Mesmo gate do aiRoutes/aiJobs (chat requer usuário autenticado no Dolibarr).
router.use(requireDolibarrLogin);

/**
 * GET /chat/jobs/:id/events
 *
 * SSE com retomada por `Last-Event-ID`. O contrato de frames:
 *
 *   id: <seq>           ← string única do evento (`<jobId>:<seq>`); habilita Last-Event-ID
 *   event: <type>       ← opcional (omite para o default "message")
 *   data: <json>        ← payload serializado em UMA linha
 *   \n\n                ← separador de frame
 *
 * Linhas internas no JSON (`\n` no payload) são substituídas por `\u0000` no momento da
 * codificação — caso contrário o cliente EventSource quebra o frame na linha errada.
 * O consumidor do outro lado desfaz: `JSON.parse(ev.data.replace(/\u0000/g, '\n'))`.
 *
 * Headers obrigatórios (SSE + anti-buffering):
 *   - Content-Type: text/event-stream        → cliente reconhece o stream
 *   - Cache-Control: no-cache                → intermediários não cacheiam
 *   - Connection: keep-alive                 → mantém o socket aberto (HTTP/1.1)
 *   - X-Accel-Buffering: no                  → nginx/cloudflare NÃO acumulam chunks
 *
 * O endpoint NÃO chama `res.end()` — o `close` do job (ou o AbortSignal do request) é
 * quem dispara o fim. Em testes, `request(app).get(...).end()` resolve quando o job fecha.
 *
 * Códigos de erro:
 *   - 200: stream aberto (sempre — mesmo para job inexistente, fica bloqueado aguardando
 *     evento; o cliente desconecta pelo AbortSignal/timeout). 404 só seria apropriado
 *     se o jobId fosse claramente inválido — mas um job PODE aparecer no stream
 *     depois (cliente chegou cedo). Tratamos como "aguarde".
 *   - 401: auth (delegado ao `requireDolibarrLogin`).
 */
router.get(
    '/jobs/:id/events',
    asyncHandler(async (req: Request, res: Response) => {
        const jobId = String(req.params.id || '').trim();
        if (!jobId) {
            throw new AppError(400, 'BAD_REQUEST', 'jobId é obrigatório.');
        }

        const lastEventId = req.header('Last-Event-ID');
        const stream = getProgressStream();

        // #1575: headers SSE corretos. X-Accel-Buffering: no é o que destrava nginx/cloudflare
        // (cloudflared inclusive). flushHeaders() força o envio IMEDIATO dos headers — sem
        // isso, Express pode bufferar o 200 até o primeiro `res.write`, e o cliente vê
        // um delay "estranho" antes do stream abrir.
        res.status(200).set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            // Headers auxiliares p/ ferramentas de debug (não obrigatórios pela spec SSE).
            'X-Job-Id': jobId,
        });
        res.flushHeaders?.();

        // Keep-alive comment a cada 15s. Cloudflare encerra conexões idle após ~100s;
        // um comentário SSE (linha começando com ':') é ignorado pelo cliente mas mantém
        // o socket vivo. Sem isto, jobs longos podem cair com 502 do proxy.
        const heartbeat = setInterval(() => {
            try {
                res.write(`: keep-alive ${Date.now()}\n\n`);
            } catch {
                // res.write joga se o cliente desconectou — limpa o timer no `close`.
                clearInterval(heartbeat);
            }
        }, 15_000);
        // Não impede o processo Node de encerrar.
        if (typeof (heartbeat as { unref?: () => void }).unref === 'function') {
            (heartbeat as { unref: () => void }).unref();
        }

        // Aborta a iteração se o cliente desconectar (fecha o navegador, network drop).
        // Importante: NÃO fecha o job — outros subscribers podem ainda estar ouvindo.
        const ac = new AbortController();
        const onClose = () => ac.abort('client-disconnected');
        req.on('close', onClose);

        try {
            for await (const ev of stream.subscribe(jobId, {
                ...(lastEventId ? { lastEventId } : {}),
                signal: ac.signal,
            })) {
                writeEvent(res, ev);
            }
        } catch (err) {
            // AbortError do cliente = caminho feliz (desconectou). Não logamos como erro.
            const errName = err && typeof err === 'object' ? (err as { name?: string }).name : undefined;
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errName !== 'AbortError' && !ac.signal.aborted) {
                log.warn(`SSE stream error [${jobId}]: ${errMsg}`);
            }
        } finally {
            clearInterval(heartbeat);
            req.off('close', onClose);
            // `res.end()` é o fecho limpo — Express cuida do Connection: close.
            try {
                res.end();
            } catch {
                // Já foi fechado pelo cliente; ignore.
            }
        }
    }),
);

/**
 * POST /chat/jobs/:id/cancel
 *
 * #1059: cancelamento de job propagado até a chamada HTTP do LLM. Combina DUAS
 * alavancas complementares:
 *   1. `stream.requestCancel(jobId)` — flag que o agentLoop checa no topo de cada
 *      iteração (cobertura rápida: o loop quebra mesmo entre tool-calls).
 *   2. `aiJobService.cancel(jobId, { reason, actor })` — AbortController registrado
 *      no enqueue do job. `postChatCompletion` lê `getSignal(jobId)` para abortar
 *      a request axios EM VOO (≤2s) e o loop de retry sem esperar backoff.
 *
 * As duas alavancas juntas garantem cancelamento ≤2s do clique, seja o job `queued`
 * (fila serial) ou `running` (axios em vôo / retry-loop esperando backoff).
 *
 * Ownership (#1059): só o DONO do job (userId/login) OU admin pode cancelar. O
 * `aiJobService.cancel` já implementa a checagem fail-closed cross-user — aqui
 * só traduzimos o resultado em HTTP:
 *   - `{ cancelled: true, status: 'queued'|'running' }` → 200 `{ status: 'cancelling' }`
 *   - `{ cancelled: false, reason: 'not_cancellable' }` → 403 (cross-user)
 *   - `{ cancelled: false, reason: 'missing'|'expired' }` → 404
 *   - `{ cancelled: false, reason: 'already_terminal' }` → 409 (job já finalizado)
 *
 * Tempo de resposta: ≤1s (tudo é O(1) — set flag + aciona controller). O handler NÃO
 * espera o loop encerrar; o SSE consumer recebe o evento terminal `cancelled` quando o
 * trabalho de fato para.
 *
 * Códigos:
 *   - 200: cancel registrado (queued/running) ou já terminal (200 idempotente — UX).
 *   - 401: auth (delegado).
 *   - 403: cross-user cancel (actor ≠ owner).
 *   - 404: jobId desconhecido / expirado.
 *   - 409: job já em estado terminal (done|error) — útil para o cliente distinguir.
 */
router.post(
    '/jobs/:id/cancel',
    asyncHandler(async (req: Request, res: Response) => {
        const jobId = String(req.params.id || '').trim();
        if (!jobId) {
            throw new AppError(400, 'BAD_REQUEST', 'jobId é obrigatório.');
        }
        const stream = getProgressStream();

        // #1059: identidade do chamador (Dolibarr user) — propagada para o aiJobService
        // checar propriedade. Admin (admin==='1'/'1'/true) sempre pode cancelar (ator
        // ausente é admin implícito no service). `user.id` é o ID Dolibarr preferido;
        // `login` é o fallback (cobre usuários sem id resolvido na sessão).
        const user = (req as any).user || {};
        const actor = {
            userId: user.id ? String(user.id) : '',
            userLogin: user.login ? String(user.login) : '',
        };
        const isAdmin = user.admin === '1' || user.admin === 1 || user.admin === true;

        const reason = 'user-cancel';
        // 1) Marca a flag para o agentLoop (cobre o tool-loop rápido).
        stream.requestCancel(jobId);
        // 2) Aciona o AbortController — corta a request HTTP em vôo e/ou remove da fila.
        const result = aiJobService.cancel(jobId, {
            reason,
            ...(isAdmin ? {} : { actor }),
        });

        if (!result.cancelled) {
            // 404 vs 403 vs 409: o cliente usa isso para decidir retry / refresh / etc.
            if (result.reason === 'missing') {
                throw new AppError(404, 'JOB_NOT_FOUND', 'Job não encontrado.');
            }
            if (result.reason === 'expired') {
                throw new AppError(404, 'JOB_EXPIRED', 'Job expirado.');
            }
            if (result.reason === 'not_cancellable') {
                // Cross-user: message inclui o login do dono para audit/log no client.
                const owner = aiJobService.getOwner(jobId);
                const ownerLogin = owner?.userLogin || 'desconhecido';
                throw new AppError(403, 'JOB_FORBIDDEN', `Apenas o dono do job (${ownerLogin}) pode cancelá-lo.`);
            }
            // already_terminal: o job já está done/error. Devolvemos 200 idempotente para
            // duas chamadas sucessivas não gerarem inconsistência visual — o cliente que
            // quiser saber se o cancel FOI útil pode re-checar `GET /jobs/:id`.
            // NÃO cancelamos o request.
            log.debug(`Cancel em job já terminal: ${jobId}`);
            return ok(res, { jobId, status: 'already_terminal' });
        }

        log.info(`Job ${jobId} cancelado via POST /cancel (status=${result.status})`);
        return ok(res, { jobId, status: 'cancelling' });
    }),
);

router.post(
    '/jobs/:id/visibility',
    asyncHandler(async (req: Request, res: Response) => {
        const jobId = String(req.params.id || '').trim();
        if (!jobId) {
            throw new AppError(400, 'BAD_REQUEST', 'jobId é obrigatório.');
        }
        if (typeof req.body?.hidden !== 'boolean') {
            throw new AppError(400, 'BAD_REQUEST', 'hidden deve ser booleano.');
        }
        const stream = getProgressStream();
        stream.setVisibility(jobId, req.body.hidden);
        return ok(res, { jobId, hidden: req.body.hidden });
    }),
);

/**
 * POST /chat/analyze-pdf
 *
 * #1031 / #1547 — Devolve ao agente o conteúdo legível de um PDF (base64):
 *   - se o PDF tem camada de texto (pdf-parse), retorna o texto extraído (rápido);
 *   - se é digitalizado (sem texto), renderiza as páginas via pdftoppm/sharp e faz
 *     OCR com a visão (glm-4.6v), concatenando '--- Página N ---\n...'.
 *
 * Diferente de /ai/analyze/pdf (que extrai E gera uma resposta do LLM), este
 * endpoint devolve SÓ o texto extraído — o agente consome o conteúdo e decide
 * como usá-lo no seu próprio fluxo. Por isso o endpoint NÃO aceita `question`
 * (responder à pergunta é responsabilidade do agente chamador, não daqui).
 *
 * Resposta: `{ text }` — o conteúdo extraído/OCR (string). O caminho usado
 * (pdf_parse | ocr_vision) e as métricas (duração, tokens) são logados no service.
 */
const ChatAnalyzePdfSchema = z.object({
    pdf: z.string(),
});

router.post(
    '/analyze-pdf',
    asyncHandler(async (req: Request, res: Response) => {
        const parsed = ChatAnalyzePdfSchema.safeParse(req.body);
        if (!parsed.success || !parsed.data.pdf) {
            throw new AppError(400, 'BAD_REQUEST', 'Campo `pdf` (base64) é obrigatório.');
        }
        const pdfBuffer = Buffer.from(parsed.data.pdf, 'base64');
        if (!pdfBuffer.length) {
            throw new AppError(400, 'BAD_REQUEST', 'PDF vazio após decodificar base64.');
        }
        // #1031: o service decide o caminho (pdf_parse vs ocr_vision) e loga qual usou.
        // Contrato mantido: devolve apenas o texto extraído/OCR (string única).
        const text = await analyzePdf(pdfBuffer);
        return ok(res, { text });
    }),
);

/**
 * POST /chat/analyze-video
 *
 * #1546 — Devolve ao agente a descrição textual de um vídeo curto anexado ao chat.
 * Análogo ao `/chat/analyze-pdf` (decodifica base64 → processa → devolve só o texto
 * pra o caller decidir como injetar no `messages` do loop de tools do agente). O
 * serviço de visão é o mesmo `describeVideo` já integrado em `/api/ai/generate-reply`
 * (issue #1030) — esta rota adiciona o ponto de entrada HTTP específico do chat,
 * com validações de tamanho/mime próprias (limite configurável via env).
 *
 * O fluxo da spec — "validar tamanho, salvar temporariamente, chamar describeVideo,
 * injetar no messages" — vive agora em `describeVideoAttachment` (helper
 * compartilhado em `services/describeVideo.ts`). Esta rota é uma fina camada HTTP
 * por cima do helper: parseia o body, mapeia os erros tipados em respostas HTTP
 * adequadas e devolve `{ text, mimeType, path: "video_url", bytes, maxBytes }`.
 * O MESMO helper é reusado por `/api/ai/generate-reply` — assim as duas rotas
 * seguem o fluxo canônico sem divergir (uma validaria, outra não; uma limparia
 * o tmp, outra vazaria).
 *
 *   1. Decodifica base64 + valida mime (zod enum + service).
 *   2. Helper valida tamanho contra `config.chatVideoMaxBytes` (env `CHAT_VIDEO_MAX_BYTES`,
 *      padrão 20 MiB). Acima disso → 413 com mensagem clara (UX de "reduza o tamanho").
 *   3. Helper salva o vídeo em diretório temporário (mkdtemp em `os.tmpdir()`) — atende
 *      o requisito da issue ("salvar temporariamente") e dá flexibilidade p/ tools
 *      externas (ffmpeg preview, auditoria) operarem no arquivo.
 *   4. Helper chama `describeVideo({ filePath, mimeType })` que faz POST no glm-4.6v
 *      com `video_url` (data URL). Remove o diretório em `finally` (best-effort).
 *   5. Helper mapeia VisionCallFailed (502) em `description: null` (degradação graciosa,
 *      mesmo padrão do `analyze-pdf` quando visão cai). 413/415 SOBEM como exceção
 *      para esta rota traduzir em AppError e o errorHandler renderizar o envelope.
 *
 * Critérios de aceite (#1546):
 *   - Vídeo curto (≤ limite) → 200 com `text` populado + `path: "video_url"`.
 *   - Vídeo grande → 413 VIDEO_TOO_LARGE com mensagem clara.
 *   - Logs distinguem o caminho vídeo do caminho imagem (`/chat/analyze-video` vs
 *     `/chat/analyze-pdf`) e o `path` da resposta (`video_url`) difere dos demais.
 *   - Não interfere em imagem: a rota de PDF e a de imagem continuam intactas.
 */
const ChatAnalyzeVideoSchema = z.object({
    video: z.string().min(1, 'Vídeo (base64) é obrigatório.'),
    mimeType: z.enum(['video/mp4', 'video/quicktime']),
});

router.post(
    '/analyze-video',
    asyncHandler(async (req: Request, res: Response) => {
        const parsed = ChatAnalyzeVideoSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new AppError(
                400,
                'BAD_REQUEST',
                'Campos `video` (base64) e `mimeType` (`video/mp4` ou `video/quicktime`) são obrigatórios.'
            );
        }
        const { video, mimeType } = parsed.data;

        // #1546: delega para o helper compartilhado `describeVideoAttachment` — mesmo
        // fluxo que `/api/ai/generate-reply` (validar tamanho, salvar temporariamente,
        // chamar describeVideo com filePath, limpar em finally). Evita divergência entre
        // as duas rotas (uma validaria e outra não; uma limparia tmp e outra vazaria).
        let result;
        try {
            result = await describeVideoAttachment(video, mimeType, {
                maxBytes: config.chatVideoMaxBytes,
                origin: '/chat/analyze-video',
            });
        } catch (videoErr: unknown) {
            // 413/415 são erros do usuário — rejeitam a request com mensagem PT-BR clara.
            // Outros VideoAnalysisError (programmer error) sobem para o errorHandler.
            if (videoErr instanceof VideoAnalysisError) {
                const code = videoErr.code;
                if (code === 'UNSUPPORTED_VIDEO_MIME' || code === 'VIDEO_TOO_LARGE') {
                    throw new AppError(videoErr.httpStatus, code, videoErr.message);
                }
            }
            throw videoErr;
        }

        // path sempre é `video_url` — distingue dos caminhos de imagem
        // (`pdf_parse` / `ocr_vision` do analyze-pdf) nos logs estruturados e na
        // resposta para o consumer. `description` já vem null quando o provedor caiu
        // (degradação graciosa idêntica à do `describeImage` em `aiService`).
        return ok(res, {
            text: result.description,
            mimeType: result.mimeType,
            // `path` discrimina o caminho multimodal usado; `null` quando a visão caiu.
            path: 'video_url' as const,
            bytes: result.bytes,
            maxBytes: result.maxBytes,
        });
    }),
);

/**
 * Serializa um ProgressEvent como frame SSE. Regras:
 *   - `data` é JSON.stringify (uma linha); `\n` internas viram `\u0000` (placeholder
 *     injetado pelo `JSON.stringify` apenas se houver — a spec JSON não inclui newlines
 *     literais, mas defendemos em profundidade).
 *   - `id` é o `event.id` (`<jobId>:<seq>`) — habilita Last-Event-ID no cliente.
 *   - `event` é o `type` (cancelled/done/etc.) — clientes EventSource podem usar
 *     `addEventListener('cancelled', ...)` para reagir a terminais.
 *   - `retry: 5000` é emitido UMA vez no início (cliente reconecta após 5s se cair).
 *
 * Não chama `res.write` em loop — `for await` no subscribe() cuida do fan-out.
 */
function writeEvent(res: Response, ev: ProgressEvent): void {
    const safeData = JSON.stringify(ev.payload ?? null).replace(/\n/g, '\u0000');
    const lines: string[] = [];
    lines.push(`id: ${ev.id}`);
    lines.push(`event: ${ev.type}`);
    lines.push(`data: ${safeData}`);
    lines.push('');
    lines.push('');
    res.write(lines.join('\n'));
}

export default router;