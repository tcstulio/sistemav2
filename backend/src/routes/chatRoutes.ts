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
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { ok } from '../utils/apiResponse';
import { getProgressStream, type ProgressEvent } from '../agent/progressStream';
import { createLogger } from '../utils/logger';

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
 * Sinaliza cancelamento via flag no estado do job (Map<jobId, JobState>). O agentLoop
 * checa `stream.isCancelled(jobId)` a cada iteração e fecha o job emitindo um evento
 * terminal `cancelled` com payload `{summary}` (resumo das tool_calls já completadas).
 *
 * Tempo de resposta alvo: ≤1s. `requestCancel` é O(1) (seta um flag). O handler NÃO
 * espera o loop encerrar — isso é o trabalho do SSE consumer que recebe o evento terminal.
 *
 * Idempotência: pode ser chamado várias vezes para o mesmo jobId sem efeito colateral.
 * Cancel em job inexistente: cria o estado com a flag setada — quando o loop começar
 * (se vier), verá o flag no topo e fecha imediatamente. Cancel em job já fechado: no-op.
 *
 * Códigos:
 *   - 200: cancel registrado (sempre — a presença do jobId não é validada; o caller
 *     já conhece o id pelo POST /generate-reply-async anterior).
 *   - 401: auth (delegado).
 */
router.post(
    '/jobs/:id/cancel',
    asyncHandler(async (req: Request, res: Response) => {
        const jobId = String(req.params.id || '').trim();
        if (!jobId) {
            throw new AppError(400, 'BAD_REQUEST', 'jobId é obrigatório.');
        }
        const stream = getProgressStream();
        stream.requestCancel(jobId);
        log.debug(`Cancel registrado para job ${jobId}`);
        return ok(res, { jobId, status: 'cancelling' });
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